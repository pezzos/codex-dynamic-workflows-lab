import { spawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import type { ArtifactStore } from "./artifacts.js";
import { parseNoisyJsonl } from "./jsonl.js";
import { reasoningEfforts } from "./policy.js";
import { redactText, redactValue } from "./redaction.js";
import type { AgentRunInput, AgentRunOutput, WorkflowPolicy } from "./types.js";
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
    const agentDir = await this.store.initAgent(agentId, input.label, input.prompt);
    const schemaPath = input.schema ? await this.store.writeAgentJson(agentId, "schema.json", input.schema) : undefined;
    const lastMessagePath = join(agentDir, "last-message.txt");
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

    const redactedStdout = redactText(result.stdout);
    const redactedStderr = redactText(result.stderr);
    const parsed = parseNoisyJsonl(redactedStdout);
    const usage = latestUsageFromEvents(parsed.events);
    const lastMessage = await readAndRedactTextFile(lastMessagePath);
    const stdoutPath = join(agentDir, "stdout.log");
    const stderrPath = join(agentDir, "stderr.log");
    await this.store.writeAgentText(agentId, "stderr.log", redactedStderr);

    if (Buffer.byteLength(redactedStdout) > this.policy.maxOutputBytesPerWorker) {
      await this.store.writeAgentText(agentId, "stdout.log", truncateUtf8(redactedStdout, this.policy.maxOutputBytesPerWorker));
      const warnings = ["worker stdout exceeded policy"];
      if (!result.timedOut && result.exitCode === 0 && lastMessage?.trim()) {
        return this.output(agentId, input.label, "completed", lastMessage, started, warnings.concat("used last-message fallback"), {
          stdout: stdoutPath,
          stderr: stderrPath,
          lastMessage: lastMessagePath,
        }, input, usage);
      }
      return this.output(agentId, input.label, "failed", null, started, ["worker stdout exceeded policy"], {
        stdout: stdoutPath,
        stderr: stderrPath,
      }, input, usage);
    }

    await this.store.writeAgentText(agentId, "stdout.log", redactedStdout);
    const events = redactValue(parsed.events);
    await this.store.writeAgentJson(agentId, "events.json", events);

    if (result.timedOut) {
      return this.output(agentId, input.label, "timed_out", null, started, parsed.warnings, {
        stdout: stdoutPath,
        stderr: stderrPath,
      }, input, usage);
    }
    if (result.exitCode !== 0) {
      return this.output(agentId, input.label, "failed", null, started, parsed.warnings.concat(`exit ${result.exitCode}`), {
        stdout: stdoutPath,
        stderr: stderrPath,
      }, input, usage);
    }

    const finalResult = lastMessage?.trim() ? lastMessage : extractFinalResult(events);
    return this.output(agentId, input.label, "completed", finalResult, started, parsed.warnings, {
      stdout: stdoutPath,
      stderr: stderrPath,
      lastMessage: lastMessagePath,
    }, input, usage);
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
      usage,
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

async function readAndRedactTextFile(path: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const redacted = redactText(raw);
    if (redacted !== raw) await writeFile(path, redacted, "utf8");
    return redacted;
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
