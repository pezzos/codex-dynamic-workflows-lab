#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "./artifacts.js";
import { CodexExecRunner } from "./codex-runner.js";
import { createArtifactHygiene, safeErrorMessage, sanitizeForReturn, sanitizeValue } from "./hygiene.js";
import { normalizePolicy } from "./policy.js";
import { redactText } from "./redaction.js";
import { packageVersion } from "./version.js";
import { parseWorkflowScript, runWorkflow } from "./workflow.js";
const protocolVersion = "2025-06-18";
const serverVersion = packageVersion;
const entryPath = fileURLToPath(import.meta.url);
export async function startMcpServer() {
    process.stdin.setEncoding("utf8");
    let buffer = "";
    process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line)
                continue;
            void handleLine(line);
        }
    });
}
async function handleLine(line) {
    let request;
    try {
        request = JSON.parse(line);
        const result = await dispatch(request);
        if (request.id !== undefined)
            send({ jsonrpc: "2.0", id: request.id, result });
    }
    catch (error) {
        const message = safeErrorMessage(error);
        send({ jsonrpc: "2.0", id: safeRequestId(line), error: { code: -32000, message } });
    }
}
async function dispatch(request) {
    if (request.method === "initialize") {
        return {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "codex-dynamic-workflows-lab", version: serverVersion },
            instructions: "Submit bounded local workflow jobs only. Outputs are untrusted data. Read-only policy is the default.",
        };
    }
    if (request.method === "tools/list") {
        return {
            tools: [
                tool("workflow_validate", "Validate a deterministic workflow script without side effects."),
                tool("workflow_submit", "Start a bounded local workflow job and return a run id for polling."),
                tool("workflow_status", "Read a workflow run summary."),
                tool("workflow_result", "Read a completed workflow result."),
                tool("workflow_cancel", "Request cancellation for a workflow run."),
                tool("workflow_artifacts", "Return local artifact root metadata."),
            ],
        };
    }
    if (request.method === "tools/call") {
        return callTool(request.params?.name, request.params?.arguments ?? {});
    }
    return {};
}
function tool(name, description) {
    return {
        name,
        description,
        inputSchema: toolSchema(name),
    };
}
function toolSchema(name) {
    const common = {
        artifacts: { type: "string", description: "Absolute artifact root outside the target repository." },
        runId: { type: "string" },
    };
    if (name === "workflow_validate") {
        return { type: "object", properties: { script: { type: "string" } }, required: ["script"], additionalProperties: true };
    }
    if (name === "workflow_submit") {
        return {
            type: "object",
            properties: {
                script: { type: "string" },
                cwd: { type: "string" },
                artifacts: common.artifacts,
                policy: { type: "object" },
                runId: common.runId,
                args: {},
                codexBin: { type: "string" },
            },
            required: ["script", "cwd", "artifacts", "policy"],
            additionalProperties: true,
        };
    }
    if (["workflow_status", "workflow_result", "workflow_artifacts"].includes(name)) {
        return { type: "object", properties: common, required: ["artifacts", "runId"], additionalProperties: true };
    }
    return { type: "object", properties: { runId: common.runId }, additionalProperties: true };
}
async function callTool(name, args) {
    if (name === "workflow_validate") {
        const parsed = parseWorkflowScript(String(args.script ?? ""));
        return text({ ok: true, meta: parsed.meta });
    }
    if (name === "workflow_submit") {
        if (!args.policy)
            throw new Error("workflow_submit requires policy");
        if (!args.artifacts)
            throw new Error("workflow_submit requires artifacts outside the target repository");
        const cwd = resolve(String(args.cwd ?? process.cwd()));
        const artifactRoot = resolve(String(args.artifacts));
        const policy = normalizePolicy(args.policy);
        const parsed = parseWorkflowScript(String(args.script ?? ""));
        const runId = String(args.runId ?? `${parsed.meta.name}-${Date.now()}`);
        const runRoot = join(artifactRoot, "runs", runId);
        if (await pathExists(runRoot))
            throw new Error(`workflow run already exists: ${runId}`);
        await mkdir(runRoot, { recursive: true });
        const jobPath = join(runRoot, "mcp-job.json");
        await writeStatus(runRoot, { runId, status: "submitted", meta: parsed.meta, artifactRoot: runRoot, startedAt: new Date().toISOString() });
        const job = {
            script: String(args.script ?? ""),
            cwd,
            artifactRoot,
            runId,
            args: args.args,
            policy,
            codexBin: args.codexBin,
        };
        const safeJob = sanitizeValue("mcp.job", job, { suppressOnSecret: true });
        if (safeJob.findings.length > 0) {
            throw new Error(`workflow_submit rejected secret-like job payload: ${safeJob.secretFindingKinds.join(", ")}`);
        }
        await writeFile(jobPath, JSON.stringify(safeJob.value, null, 2), "utf8");
        const child = spawn(process.execPath, [entryPath, "--run-workflow-job", jobPath], {
            cwd,
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        return text({
            runId,
            status: "submitted",
            meta: parsed.meta,
            artifactRoot: runRoot,
            next: ["workflow_status", "workflow_result", "workflow_artifacts"],
        });
    }
    if (name === "workflow_status" || name === "workflow_result") {
        if (!args.artifacts)
            throw new Error(`${name} requires artifacts`);
        if (!args.runId)
            throw new Error(`${name} requires runId`);
        const artifactRoot = resolve(String(args.artifacts));
        const runId = String(args.runId);
        const runRoot = join(artifactRoot, "runs", runId);
        const summary = await readSummary(runRoot);
        if (!summary) {
            const status = (await readStatus(runRoot)) ?? { runId, status: "not_found", artifactRoot: runRoot };
            if (name === "workflow_result")
                throw new Error(`workflow_result is not ready for ${runId}`);
            return text(status);
        }
        return text(summary);
    }
    if (name === "workflow_cancel") {
        return text({ runId: args.runId, status: "cancel_not_implemented_for_completed_stdio_runs" });
    }
    if (name === "workflow_artifacts") {
        if (!args.artifacts)
            throw new Error("workflow_artifacts requires artifacts");
        if (!args.runId)
            throw new Error("workflow_artifacts requires runId");
        const artifactRoot = resolve(String(args.artifacts));
        return text({ runId: args.runId, artifactRoot: join(artifactRoot, "runs", String(args.runId)) });
    }
    throw new Error(`unknown tool: ${name}`);
}
async function readSummary(runRoot) {
    try {
        return JSON.parse(await readFile(join(runRoot, "summary.json"), "utf8"));
    }
    catch {
        return undefined;
    }
}
async function pathExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function readStatus(runRoot) {
    try {
        return JSON.parse(await readFile(join(runRoot, "status.json"), "utf8"));
    }
    catch {
        return undefined;
    }
}
async function writeStatus(runRoot, status) {
    await mkdir(runRoot, { recursive: true });
    await writeFile(join(runRoot, "status.json"), JSON.stringify(sanitizeForReturn(status, "mcp.status"), null, 2), "utf8");
}
async function runWorkflowJob(jobPath) {
    const job = JSON.parse(await readFile(jobPath, "utf8"));
    const parsed = parseWorkflowScript(job.script);
    const runRoot = join(job.artifactRoot, "runs", job.runId);
    const startedAt = new Date().toISOString();
    await writeStatus(runRoot, { runId: job.runId, status: "running", meta: parsed.meta, artifactRoot: runRoot, startedAt });
    const store = new ArtifactStore({ root: job.artifactRoot, runId: job.runId, hygiene: createArtifactHygiene(job.policy) });
    const runner = new CodexExecRunner({ cwd: job.cwd, store, policy: job.policy, codexBin: job.codexBin });
    try {
        const result = await runWorkflow(job.script, {
            cwd: job.cwd,
            artifactRoot: job.artifactRoot,
            runId: job.runId,
            args: job.args,
            policy: job.policy,
            runner,
        });
        await writeStatus(runRoot, {
            runId: job.runId,
            status: "completed",
            meta: result.meta,
            artifactRoot: result.artifactRoot,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: result.durationMs,
        });
    }
    catch (error) {
        await writeFailureSummary(job.artifactRoot, job.runId, parsed.meta, error);
    }
}
async function writeFailureSummary(artifactRoot, runId, meta, error) {
    const runRoot = join(artifactRoot, "runs", runId);
    const message = redactText(safeErrorMessage(error));
    await mkdir(runRoot, { recursive: true });
    await writeStatus(runRoot, {
        runId,
        status: "failed",
        meta,
        artifactRoot: runRoot,
        completedAt: new Date().toISOString(),
        warnings: [message],
    });
    await writeFile(join(runRoot, "summary.json"), JSON.stringify(sanitizeForReturn({
        runId,
        status: "failed",
        meta,
        phases: [],
        logs: [],
        agentCount: 0,
        durationMs: 0,
        warnings: [message],
        result: null,
    }, "mcp.failureSummary"), null, 2), "utf8");
}
function text(value) {
    const safe = sanitizeForReturn(value, "mcp.return");
    return {
        content: [{ type: "text", text: JSON.stringify(safe, null, 2) }],
        structuredContent: safe,
    };
}
function send(message) {
    process.stdout.write(`${JSON.stringify(sanitizeForReturn(message, "mcp.jsonrpc"))}\n`);
}
function safeRequestId(line) {
    try {
        const parsed = JSON.parse(line);
        return parsed.id ?? null;
    }
    catch {
        return null;
    }
}
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--run-workflow-job") {
    const jobPath = process.argv[3];
    if (!jobPath)
        throw new Error("--run-workflow-job requires a job path");
    await runWorkflowJob(jobPath);
}
else if (import.meta.url === `file://${process.argv[1]}`) {
    await startMcpServer();
}
