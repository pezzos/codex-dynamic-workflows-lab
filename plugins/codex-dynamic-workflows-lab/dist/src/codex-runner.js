import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseNoisyJsonl } from "./jsonl.js";
export class CodexExecRunner {
    cwd;
    store;
    policy;
    codexBin;
    baseEnv;
    count = 0;
    constructor(options) {
        this.cwd = options.cwd;
        this.store = options.store;
        this.policy = options.policy;
        this.codexBin = options.codexBin ?? process.env.CODEX_FLOW_CODEX_BIN ?? "codex";
        this.baseEnv = options.env ?? process.env;
    }
    async run(input) {
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
            "--sandbox",
            sandbox,
            "--cd",
            this.cwd,
            "-o",
            lastMessagePath,
        ];
        if (schemaPath)
            args.push("--output-schema", schemaPath);
        if (input.options.model)
            args.push("--model", input.options.model);
        args.push("-");
        await this.store.writeAgentJson(agentId, "command.json", {
            command: this.codexBin,
            args,
            cwd: this.cwd,
            sandbox,
        });
        const childEnv = await this.workerEnv(agentId);
        const timeoutMs = input.options.timeoutMs ?? this.policy.maxWorkerDurationMs;
        const result = await runProcess({
            command: this.codexBin,
            args,
            stdin: input.prompt,
            cwd: this.cwd,
            env: childEnv,
            timeoutMs,
        });
        const stdoutPath = join(agentDir, "stdout.log");
        const stderrPath = join(agentDir, "stderr.log");
        await this.store.writeAgentText(agentId, "stderr.log", result.stderr);
        if (Buffer.byteLength(result.stdout) > this.policy.maxOutputBytesPerWorker) {
            await this.store.writeAgentText(agentId, "stdout.log", truncateUtf8(result.stdout, this.policy.maxOutputBytesPerWorker));
            return this.output(agentId, input.label, "failed", null, started, ["worker stdout exceeded policy"], {
                stdout: stdoutPath,
                stderr: stderrPath,
            });
        }
        await this.store.writeAgentText(agentId, "stdout.log", result.stdout);
        const parsed = parseNoisyJsonl(result.stdout);
        await this.store.writeAgentJson(agentId, "events.json", parsed.events);
        if (result.timedOut) {
            return this.output(agentId, input.label, "timed_out", null, started, parsed.warnings, {
                stdout: stdoutPath,
                stderr: stderrPath,
            });
        }
        if (result.exitCode !== 0) {
            return this.output(agentId, input.label, "failed", null, started, parsed.warnings.concat(`exit ${result.exitCode}`), {
                stdout: stdoutPath,
                stderr: stderrPath,
            });
        }
        const finalResult = extractFinalResult(parsed.events);
        return this.output(agentId, input.label, "completed", finalResult, started, parsed.warnings, {
            stdout: stdoutPath,
            stderr: stderrPath,
            lastMessage: lastMessagePath,
        });
    }
    async workerEnv(agentId) {
        const home = await mkdtemp(join(tmpdir(), `codex-flow-home-${agentId}-`));
        const codexHome = await mkdtemp(join(tmpdir(), `codex-flow-codex-home-${agentId}-`));
        await mkdir(home, { recursive: true });
        return {
            PATH: this.baseEnv.PATH,
            HOME: home,
            TMPDIR: tmpdir(),
            CODEX_HOME: this.policy.secrets === "codex-auth-only" && this.baseEnv.CODEX_HOME ? this.baseEnv.CODEX_HOME : codexHome,
            CODEX_FLOW_WORKER: "1",
        };
    }
    output(agentId, label, status, result, started, warnings, artifacts) {
        return { agentId, label, status, result, durationMs: Date.now() - started, warnings, artifacts };
    }
}
function truncateUtf8(value, maxBytes) {
    const buffer = Buffer.from(value);
    if (buffer.byteLength <= maxBytes)
        return value;
    const marker = "\n[truncated: worker stdout exceeded policy]\n";
    return `${buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8")}${marker}`;
}
async function runProcess(options) {
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
                if (child.pid)
                    process.kill(-child.pid, "SIGTERM");
            }
            catch {
                child.kill("SIGTERM");
            }
            setTimeout(() => {
                try {
                    if (child.pid)
                        process.kill(-child.pid, "SIGKILL");
                }
                catch {
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
function extractFinalResult(events) {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event?.type === "item.completed" && event.item?.type === "agent_message")
            return event.item.text;
        if (event?.type === "turn.completed" && event.result !== undefined)
            return event.result;
    }
    return events.at(-1) ?? "";
}
export async function writeSchemaFile(path, schema) {
    await writeFile(path, JSON.stringify(schema, null, 2), "utf8");
}
