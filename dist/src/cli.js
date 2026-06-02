#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ArtifactStore } from "./artifacts.js";
import { CodexExecRunner } from "./codex-runner.js";
import { normalizePolicy } from "./policy.js";
import { parseWorkflowScript, runWorkflow } from "./workflow.js";
async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || ["-h", "--help", "help"].includes(command)) {
        printHelp();
        return;
    }
    if (command === "validate") {
        const { workflowPath } = parseWorkflowPath(rest);
        const script = await readFile(workflowPath, "utf8");
        const parsed = parseWorkflowScript(script);
        console.log(JSON.stringify({ ok: true, meta: parsed.meta }, null, 2));
        return;
    }
    if (command === "run" || command === "submit") {
        const { workflowPath, options } = parseRunArgs(rest);
        const script = await readFile(workflowPath, "utf8");
        const cwd = resolve(options.cwd);
        const artifactRoot = resolve(options.artifacts);
        const policy = normalizePolicy(options.policyPath ? JSON.parse(await readFile(options.policyPath, "utf8")) : {});
        const args = options.argsPath ? JSON.parse(await readFile(options.argsPath, "utf8")) : undefined;
        const parsed = parseWorkflowScript(script);
        const runId = `${parsed.meta.name}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
        const store = new ArtifactStore({ root: artifactRoot, runId });
        const runner = new CodexExecRunner({
            cwd,
            store,
            policy,
            codexBin: options.fake ? join(process.cwd(), "scripts", "fake-codex.js") : undefined,
        });
        const result = await runWorkflow(script, { cwd, artifactRoot, runId, args, policy, runner });
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (command === "status" || command === "result") {
        const runId = rest[0];
        if (!runId)
            throw new Error(`${command} requires runId`);
        const options = parseOptions(rest.slice(1));
        const summary = await readFile(join(resolve(options.artifacts), "runs", runId, "summary.json"), "utf8");
        console.log(summary);
        return;
    }
    if (command === "artifacts") {
        const runId = rest[0];
        if (!runId)
            throw new Error("artifacts requires runId");
        const options = parseOptions(rest.slice(1));
        console.log(JSON.stringify({ runId, artifactRoot: join(resolve(options.artifacts), "runs", runId) }, null, 2));
        return;
    }
    if (command === "cancel") {
        const runId = rest[0];
        if (!runId)
            throw new Error("cancel requires runId");
        const options = parseOptions(rest.slice(1));
        const root = join(resolve(options.artifacts), "runs", runId);
        await mkdir(root, { recursive: true });
        await writeFile(join(root, "cancelled.json"), JSON.stringify({ runId, cancelledAt: new Date().toISOString() }, null, 2));
        console.log(JSON.stringify({ runId, status: "cancel_requested" }, null, 2));
        return;
    }
    if (command === "server") {
        const { startMcpServer } = await import("./mcp-server.js");
        await startMcpServer();
        return;
    }
    throw new Error(`unknown command: ${command}`);
}
function parseWorkflowPath(args) {
    const workflowPath = args.find((arg) => !arg.startsWith("--"));
    if (!workflowPath)
        throw new Error("workflow file path required");
    return { workflowPath: resolve(workflowPath) };
}
function parseRunArgs(args) {
    const { workflowPath } = parseWorkflowPath(args);
    return { workflowPath, options: parseOptions(args.filter((arg) => arg !== workflowPath)) };
}
function parseOptions(args) {
    const options = {
        cwd: process.cwd(),
        artifacts: join(process.cwd(), ".codex-workflows"),
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--cwd")
            options.cwd = args[++index];
        else if (arg === "--artifacts")
            options.artifacts = args[++index];
        else if (arg === "--policy")
            options.policyPath = resolve(args[++index]);
        else if (arg === "--args")
            options.argsPath = resolve(args[++index]);
        else if (arg === "--fake")
            options.fake = true;
    }
    return options;
}
function printHelp() {
    console.log(`codex-flow

Usage:
  codex-flow validate <workflow.js>
  codex-flow run <workflow.js> [--cwd DIR] [--artifacts DIR] [--policy FILE] [--args FILE] [--fake]
  codex-flow status <runId> [--artifacts DIR]
  codex-flow result <runId> [--artifacts DIR]
  codex-flow artifacts <runId> [--artifacts DIR]
  codex-flow cancel <runId> [--artifacts DIR]
  codex-flow server
`);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
