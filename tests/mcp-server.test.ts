import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

test("MCP workflow_submit preserves codex-auth-only policy into the runner", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "codex-flow-mcp-artifacts-"));
  const parentHome = await mkdtemp(join(tmpdir(), "codex-flow-parent-home-"));
  const parentCodexHome = join(parentHome, ".codex");
  const authJson = JSON.stringify({ token: "mcp-auth" });
  await mkdir(parentCodexHome, { recursive: true });
  await writeFile(join(parentCodexHome, "auth.json"), authJson, "utf8");

  const script = [
    'export const meta = { name: "env_probe_mcp", description: "env probe mcp" }',
    'return await agent("FAKE_ENV_PROBE", { label: "env" })',
  ].join("\n");
  const messages = await callMcp(
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "workflow_submit",
          arguments: {
            script,
            cwd: process.cwd(),
            artifacts,
            policy: { secrets: "codex-auth-only" },
            runId: "offline-mcp-auth-probe",
            codexBin: resolve("scripts/fake-codex.js"),
          },
        },
      },
    ],
    { env: { ...process.env, HOME: parentHome, CODEX_HOME: undefined } },
  );

  const response = messages[0] as { result?: { structuredContent?: { runId?: string; result?: string } } };
  const summary = response.result?.structuredContent;
  assert.equal(summary?.runId, "offline-mcp-auth-probe");
  const workerEnv = JSON.parse(String(summary?.result));
  assert.deepEqual(workerEnv.codexHomeEntries, ["auth.json"]);
  assert.equal(workerEnv.authSha256, sha256(authJson));
  assert.equal(workerEnv.authMode, 0o600);
});

function callMcp(requests: unknown[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/src/mcp-server.js"], {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
