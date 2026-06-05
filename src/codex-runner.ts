import { spawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import type { ArtifactStore } from "./artifacts.js";
import {
  auditCompletenessForMode,
  findingKinds,
  resolveOutputAuditMode,
  sanitizeText,
  sanitizeValue,
  secretSentinel,
  sha256,
} from "./hygiene.js";
import { parseNoisyJsonl } from "./jsonl.js";
import { reasoningEfforts } from "./policy.js";
import { routeProfileIds } from "./profiles.js";
import { redactText, redactValue } from "./redaction.js";
import type { SafetyFinding } from "./safety.js";
import type { AgentRunInput, AgentRunOutput, AuditMetadata, EvidenceValidity, ResultSource, WorkflowPolicy } from "./types.js";
import { latestUsageFromEvents } from "./usage.js";

export interface CodexExecRunnerOptions {
  cwd: string;
  store: ArtifactStore;
  policy: WorkflowPolicy;
  codexBin?: string;
  env?: NodeJS.ProcessEnv;
}

export class CodexExecRunner {
  private readonly cwd: string;
  private readonly store: ArtifactStore;
  private readonly policy: WorkflowPolicy;
  private readonly codexBin: string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private count = 0;

  constructor(options: CodexExecRunnerOptions) {
    this.cwd = options.cwd;
    this.store = options.store;
    this.policy = options.policy;
    this.codexBin = options.codexBin ?? process.env.CODEX_FLOW_CODEX_BIN ?? "codex";
    this.baseEnv = options.env ?? process.env;
  }

  async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const started = Date.now();
    const agentId = input.agentId ?? `codex-${String(++this.count).padStart(3, "0")}`;
    await this.store.initAgent(agentId, input.label, input.prompt);
    const schemaPath = input.schema ? await this.store.writeAgentJson(agentId, "schema.json", input.schema) : undefined;
    const sandbox = input.options.sandbox ?? (this.policy.mode === "read-only" ? "read-only" : "workspace-write");
    if (sandbox === "workspace-write" && this.policy.mode !== "write-worktree") {
      throw new Error("workspace-write worker rejected by read-only policy");
    }
    if (!this.policy.allowedCommands.includes("codex")) {
      throw new Error("policy does not allow codex command");
    }
    if (input.options.model && this.policy.allowedModels.length > 0 && !this.policy.allowedModels.includes(input.options.model)) {
      throw new Error(`model not allowed by policy: ${input.options.model}`);
    }
    if (input.options.reasoningEffort && !reasoningEfforts.includes(input.options.reasoningEffort)) {
      throw new Error(`unsupported reasoning effort: ${input.options.reasoningEffort}`);
    }
    if (input.options.profile && !routeProfileIds().includes(input.options.profile)) {
      throw new Error(`unsupported route profile: ${input.options.profile}`);
    }
    if (
      input.options.profile &&
      this.policy.allowedRouteProfiles.length > 0 &&
      !this.policy.allowedRouteProfiles.includes(input.options.profile)
    ) {
      throw new Error(`route profile not allowed by policy: ${input.options.profile}`);
    }
    if (
      input.options.reasoningEffort &&
      this.policy.allowedReasoningEfforts.length > 0 &&
      !this.policy.allowedReasoningEfforts.includes(input.options.reasoningEffort)
    ) {
      throw new Error(`reasoning effort not allowed by policy: ${input.options.reasoningEffort}`);
    }
    if (sandbox === "workspace-write") {
      const resolvedCwd = resolve(this.cwd);
      if (!this.policy.writableRoots.some((root) => resolvedCwd.startsWith(resolve(root)))) {
        throw new Error("worker cwd is outside policy writableRoots");
      }
    }

    const lastMessageDir = await mkdtemp(join(tmpdir(), `codex-flow-last-message-${agentId}-`));
    const lastMessagePath = join(lastMessageDir, "last-message.txt");
    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--ignore-user-config",
      "--sandbox",
      sandbox,
      "--cd",
      this.cwd,
      "-o",
      lastMessagePath,
    ];
    if (schemaPath) args.push("--output-schema", schemaPath);
    if (input.options.model) args.push("--model", input.options.model);
    if (input.options.reasoningEffort) args.push("-c", `model_reasoning_effort="${input.options.reasoningEffort}"`);
    args.push("-");

    await this.store.writeAgentJson(agentId, "command.json", {
      command: this.codexBin,
      args,
      cwd: this.cwd,
      sandbox,
      model: input.options.model,
      reasoningEffort: input.options.reasoningEffort,
      profile: input.options.profile,
    });

    const worker = await this.workerEnv(agentId);
    const timeoutMs = input.options.timeoutMs ?? this.policy.maxWorkerDurationMs;
    let result: ProcessResult;
    try {
      result = await runProcess({
        command: this.codexBin,
        args,
        stdin: input.prompt,
        cwd: this.cwd,
        env: worker.env,
        timeoutMs,
      });
    } finally {
      await cleanupWorkerTempDirs(worker.tempDirs);
    }

    const resolvedAuditMode = resolveOutputAuditMode(this.policy);
    const parsed = parseNoisyJsonl(result.stdout);
    const usage = latestUsageFromEvents(parsed.events);
    const lastMessage = await readTextFile(lastMessagePath);
    await rm(lastMessageDir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
    const stdoutOverflowed = Buffer.byteLength(result.stdout) > this.policy.maxOutputBytesPerWorker;
    const stdoutFallbackUsed = stdoutOverflowed && !result.timedOut && result.exitCode === 0 && !!lastMessage?.trim();
    const stdoutAudit = sanitizeText("agent.stdout", result.stdout, { suppressOnSecret: true });
    const stderrAudit = sanitizeText("agent.stderr", result.stderr, { suppressOnSecret: true });
    const lastMessageAudit = sanitizeText("agent.lastMessage", lastMessage ?? "", { suppressOnSecret: true });
    const eventsAudit = sanitizeValue("agent.events", parsed.events, { suppressOnSecret: true });

    let resultSource: ResultSource = "none";
    let finalResult: unknown = null;
    let finalResultFindings: SafetyFinding[] = [];
    if (!result.timedOut && result.exitCode === 0) {
      if (lastMessage?.trim()) {
        resultSource = "last_message";
        const audited = sanitizeText("agent.result", lastMessage, { suppressOnSecret: true });
        finalResult = audited.suppressed ? secretSentinel("agent.result", audited.findings) : audited.text;
        finalResultFindings = audited.findings;
      } else if (!stdoutOverflowed) {
        resultSource = "events";
        const audited = sanitizeValue("agent.result", extractFinalResult(parsed.events), { suppressOnSecret: true });
        finalResult = audited.value;
        finalResultFindings = audited.findings;
      }
    }

    const allFindings = [
      ...stdoutAudit.findings,
      ...stderrAudit.findings,
      ...lastMessageAudit.findings,
      ...eventsAudit.findings,
      ...finalResultFindings,
    ];
    const secretFindingKinds = findingKinds(allFindings);
    const stdoutSuppressedForSecrets = stdoutAudit.suppressed || stderrAudit.suppressed || lastMessageAudit.suppressed || eventsAudit.suppressed;
    const secretHit = secretFindingKinds.length > 0;
    const persistFullOutputs = resolvedAuditMode === "full" && !secretHit;
    const artifacts: Record<string, string> = {};

    if (persistFullOutputs) {
      artifacts.stderr = await this.store.writeAgentText(agentId, "stderr.log", stderrAudit.text);
      artifacts.stdout = await this.store.writeAgentText(
        agentId,
        "stdout.log",
        stdoutOverflowed ? truncateUtf8(stdoutAudit.text, this.policy.maxOutputBytesPerWorker) : stdoutAudit.text,
      );
      if (!stdoutOverflowed) {
        artifacts.events = await this.store.writeAgentJson(agentId, "events.json", eventsAudit.value);
      }
      if (lastMessage !== undefined) {
        artifacts.lastMessage = await this.store.writeAgentText(agentId, "last-message.txt", lastMessageAudit.text);
      }
    }

    const validityReasons = [];
    if (secretHit) validityReasons.push("secret-like worker output suppressed");
    if (stdoutFallbackUsed) validityReasons.push("stdout exceeded policy and last-message fallback was used");
    const validity: EvidenceValidity = secretHit ? "invalid" : stdoutFallbackUsed ? "diagnostic_only" : "valid";
    const auditMetadata: AuditMetadata = {
      outputAuditMode: this.policy.outputAuditMode,
      resolvedOutputAuditMode: resolvedAuditMode,
      auditCompleteness: persistFullOutputs ? auditCompletenessForMode(resolvedAuditMode) : resolvedAuditMode === "none" ? "none" : "metadata_only",
      resultSource,
      usageSource: usage ? "jsonl" : "none",
      stdoutBytes: Buffer.byteLength(result.stdout),
      stderrBytes: Buffer.byteLength(result.stderr),
      stdoutSha256: sha256(result.stdout),
      stderrSha256: sha256(result.stderr),
      stdoutPersisted: !!artifacts.stdout,
      stderrPersisted: !!artifacts.stderr,
      lastMessagePersisted: !!artifacts.lastMessage,
      eventsPersisted: !!artifacts.events,
      stdoutOverflowed,
      stdoutFallbackUsed,
      stdoutSuppressedForSecrets,
      secretFindingKinds,
      eventsParsed: parsed.events.length,
      validity,
      validityReasons,
    };
    artifacts.captureMetadata = await this.store.writeAgentJson(agentId, "capture-metadata.json", auditMetadata);

    const warnings = parsed.warnings.map((warning) => redactText(warning));
    if (stdoutOverflowed) warnings.push("worker stdout exceeded policy");
    if (stdoutFallbackUsed) warnings.push("used last-message fallback");
    if (secretHit) warnings.push("worker output suppressed by artifact hygiene");

    if (result.timedOut) {
      return this.output(agentId, input.label, "timed_out", null, started, warnings, artifacts, input, usage, auditMetadata);
    }
    if (result.exitCode !== 0) {
      return this.output(agentId, input.label, "failed", null, started, warnings.concat(`exit ${result.exitCode}`), artifacts, input, usage, auditMetadata);
    }
    if (stdoutOverflowed && !stdoutFallbackUsed) {
      return this.output(agentId, input.label, "failed", null, started, warnings, artifacts, input, usage, auditMetadata);
    }
    if (secretHit) {
      finalResult = secretSentinel("agent.result", allFindings);
    }
    return this.output(agentId, input.label, "completed", finalResult, started, warnings, artifacts, input, usage, auditMetadata);
  }

  private async workerEnv(agentId: string): Promise<WorkerEnvironment> {
    const home = await mkdtemp(join(tmpdir(), `codex-flow-home-${agentId}-`));
    const codexHome = await mkdtemp(join(tmpdir(), `codex-flow-codex-home-${agentId}-`));
    const tempDirs = [home, codexHome];
    try {
      await mkdir(home, { recursive: true });
      if (this.policy.secrets === "codex-auth-only") {
        await copyCodexAuthOnly(this.baseEnv, codexHome);
      }
      return {
        env: {
          PATH: this.baseEnv.PATH,
          HOME: home,
          TMPDIR: tmpdir(),
          CODEX_HOME: codexHome,
          CODEX_FLOW_WORKER: "1",
        },
        tempDirs,
      };
    } catch (error) {
      await cleanupWorkerTempDirs(tempDirs);
      throw error;
    }
  }

  private output(
    agentId: string,
    label: string,
    status: AgentRunOutput["status"],
    result: unknown,
    started: number,
    warnings: string[],
    artifacts: Record<string, string>,
    input: AgentRunInput,
    usage: AgentRunOutput["usage"],
    auditMetadata: AuditMetadata,
  ): AgentRunOutput {
    return {
      agentId,
      label,
      status,
      result,
      durationMs: Date.now() - started,
      warnings,
      artifacts,
      model: input.options.model,
      reasoningEffort: input.options.reasoningEffort,
      profile: input.options.profile,
      usage,
      validity: auditMetadata.validity,
      validityReasons: auditMetadata.validityReasons,
      auditCompleteness: auditMetadata.auditCompleteness,
      resultSource: auditMetadata.resultSource,
      stdoutOverflowed: auditMetadata.stdoutOverflowed,
      stdoutFallbackUsed: auditMetadata.stdoutFallbackUsed,
      stdoutSuppressedForSecrets: auditMetadata.stdoutSuppressedForSecrets,
      secretFindingKinds: auditMetadata.secretFindingKinds,
      auditMetadata,
    };
  }
}

interface WorkerEnvironment {
  env: NodeJS.ProcessEnv;
  tempDirs: string[];
}

async function copyCodexAuthOnly(env: NodeJS.ProcessEnv, workerCodexHome: string): Promise<void> {
  const sourceCodexHome = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(env.HOME ?? homedir(), ".codex");
  const sourceAuth = join(sourceCodexHome, "auth.json");
  const targetAuth = join(workerCodexHome, "auth.json");
  try {
    const sourceCodexHomeReal = await realpath(sourceCodexHome);
    const sourceAuthStat = await lstat(sourceAuth);
    if (sourceAuthStat.isSymbolicLink()) throw new Error("auth.json must not be a symlink");
    if (!sourceAuthStat.isFile()) throw new Error("auth.json must be a regular file");
    const sourceAuthReal = await realpath(sourceAuth);
    if (!isInsidePath(sourceAuthReal, sourceCodexHomeReal)) {
      throw new Error("auth.json must resolve inside CODEX_HOME");
    }
    await copyFile(sourceAuth, targetAuth);
    await chmod(targetAuth, 0o600);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`codex-auth-only requires file-based Codex auth at ${sourceAuth}: ${message}`);
  }
}

async function cleanupWorkerTempDirs(tempDirs: string[]): Promise<void> {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 2 })));
}

function isInsidePath(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  const marker = "\n[truncated: worker stdout exceeded policy]\n";
  return `${buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8")}${marker}`;
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

async function runProcess(options: {
  command: string;
  args: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + error.message, exitCode: 127, timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
    child.stdin.end(options.stdin);
  });
}

function extractFinalResult(events: unknown[]): unknown {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as any;
    if (event?.type === "item.completed" && event.item?.type === "agent_message") return redactValue(event.item.text);
    if (event?.type === "turn.completed" && event.result !== undefined) return redactValue(event.result);
  }
  return redactValue(events.at(-1) ?? "");
}

export async function writeSchemaFile(path: string, schema: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(schema, null, 2), "utf8");
}
