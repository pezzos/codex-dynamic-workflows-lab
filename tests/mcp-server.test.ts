import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("MCP workflow_artifacts requires runId and artifacts", async () => {
  const missing = await callMcp([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "workflow_artifacts", arguments: {} } }]);
  assert.match(JSON.stringify(missing), /requires artifacts|requires runId/);
  assert.doesNotMatch(JSON.stringify(missing), /runs\/undefined/);
});

test("MCP workflow_artifacts returns explicit artifact root", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "codex-flow-mcp-artifacts-"));
  const messages = await callMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "workflow_artifacts", arguments: { artifacts, runId: "run-ok" } },
    },
  ]);
  assert.match(JSON.stringify(messages), new RegExp(`${escapeRegex(artifacts)}.*runs.*run-ok`));
});

function callMcp(requests: unknown[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/src/mcp-server.js"], { stdio: ["pipe", "pipe", "pipe"] });
    const messages: unknown[] = [];
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MCP test timed out: ${stderr}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", () => {
      clearTimeout(timeout);
      for (const line of stdout.trim().split("\n").filter(Boolean)) messages.push(JSON.parse(line));
      resolve(messages);
    });
    child.on("error", reject);
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
