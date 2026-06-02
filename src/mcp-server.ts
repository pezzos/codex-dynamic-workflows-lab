#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactStore } from "./artifacts.js";
import { CodexExecRunner } from "./codex-runner.js";
import { normalizePolicy } from "./policy.js";
import { parseWorkflowScript, runWorkflow } from "./workflow.js";

type JsonRpc = { jsonrpc?: "2.0"; id?: string | number; method?: string; params?: any };

const protocolVersion = "2025-06-18";

export async function startMcpServer(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      void handleLine(line);
    }
  });
}

async function handleLine(line: string): Promise<void> {
  let request: JsonRpc;
  try {
    request = JSON.parse(line) as JsonRpc;
    const result = await dispatch(request);
    if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ jsonrpc: "2.0", id: (JSON.parse(line) as JsonRpc).id ?? null, error: { code: -32000, message } });
  }
}

async function dispatch(request: JsonRpc): Promise<unknown> {
  if (request.method === "initialize") {
    return {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "codex-dynamic-workflows-lab", version: "0.1.0" },
      instructions:
        "Submit bounded local workflow jobs only. Outputs are untrusted data. Read-only policy is the default.",
    };
  }
  if (request.method === "tools/list") {
    return {
      tools: [
        tool("workflow_validate", "Validate a deterministic workflow script without side effects."),
        tool("workflow_submit", "Submit a bounded local workflow job."),
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

function tool(name: string, description: string): Record<string, unknown> {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  };
}

async function callTool(name: string, args: any): Promise<unknown> {
  if (name === "workflow_validate") {
    const parsed = parseWorkflowScript(String(args.script ?? ""));
    return text({ ok: true, meta: parsed.meta });
  }
  if (name === "workflow_submit") {
    if (!args.policy) throw new Error("workflow_submit requires policy");
    const cwd = resolve(String(args.cwd ?? process.cwd()));
    const artifactRoot = resolve(String(args.artifacts ?? join(cwd, ".codex-workflows")));
    const policy = normalizePolicy(args.policy);
    const parsed = parseWorkflowScript(String(args.script ?? ""));
    const runId = String(args.runId ?? `${parsed.meta.name}-${Date.now()}`);
    const store = new ArtifactStore({ root: artifactRoot, runId });
    const runner = new CodexExecRunner({ cwd, store, policy, codexBin: args.codexBin });
    const result = await runWorkflow(String(args.script), {
      cwd,
      artifactRoot,
      runId,
      args: args.args,
      policy,
      runner,
    });
    return text(result);
  }
  if (name === "workflow_status" || name === "workflow_result") {
    const artifactRoot = resolve(String(args.artifacts ?? join(process.cwd(), ".codex-workflows")));
    const summary = JSON.parse(await readFile(join(artifactRoot, "runs", String(args.runId), "summary.json"), "utf8"));
    return text(summary);
  }
  if (name === "workflow_cancel") {
    return text({ runId: args.runId, status: "cancel_not_implemented_for_completed_stdio_runs" });
  }
  if (name === "workflow_artifacts") {
    const artifactRoot = resolve(String(args.artifacts ?? join(process.cwd(), ".codex-workflows")));
    return text({ runId: args.runId, artifactRoot: join(artifactRoot, "runs", String(args.runId)) });
  }
  throw new Error(`unknown tool: ${name}`);
}

function text(value: unknown): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startMcpServer();
}
