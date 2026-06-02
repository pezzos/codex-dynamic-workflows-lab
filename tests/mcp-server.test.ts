import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const submit = response.result?.structuredContent as { runId?: string; status?: string };
  assert.equal(submit?.runId, "offline-mcp-auth-probe");
  assert.equal(submit?.status, "submitted");
  const summary = await waitForSummary(artifacts, "offline-mcp-auth-probe");
  const workerEnv = JSON.parse(String(summary.result));
  assert.deepEqual(workerEnv.codexHomeEntries, ["auth.json"]);
  assert.equal(workerEnv.authSha256, sha256(authJson));
  assert.equal(workerEnv.authMode, 0o600);
});

test("MCP workflow_submit returns before long workers finish", async () => {
  const artifacts = await mkdtemp(join(tmpdir(), "codex-flow-mcp-artifacts-"));
  const script = [
    'export const meta = { name: "slow_submit", description: "slow submit" }',
    'return await agent("FAKE_HANG", { label: "slow" })',
  ].join("\n");
  const probe = await callMcpFirstResponse({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "workflow_submit",
      arguments: {
        script,
        cwd: process.cwd(),
        artifacts,
        policy: { maxAgents: 1, concurrency: 1, maxWorkerDurationMs: 1000 },
        runId: "slow-submit-probe",
        codexBin: resolve("scripts/fake-codex.js"),
      },
    },
  });

  assert.ok(probe.durationMs < 750, `submit response took ${probe.durationMs}ms`);
  const response = probe.message as { result?: { structuredContent?: { runId?: string; status?: string } } };
  assert.equal(response.result?.structuredContent?.runId, "slow-submit-probe");
  assert.equal(response.result?.structuredContent?.status, "submitted");
  await probe.closed;

  const statusMessages = await callMcp([
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "workflow_status", arguments: { artifacts, runId: "slow-submit-probe" } },
    },
  ]);
  const status = statusMessages[0] as { result?: { structuredContent?: { status?: string; runId?: string } } };
  assert.equal(status.result?.structuredContent?.runId, "slow-submit-probe");
  assert.ok(["submitted", "running", "completed"].includes(String(status.result?.structuredContent?.status)));

  const summary = await waitForSummary(artifacts, "slow-submit-probe");
  assert.equal(summary.runId, "slow-submit-probe");
  assert.equal(summary.agentCount, 1);
  const agentResult = JSON.parse(await readFile(join(artifacts, "runs", "slow-submit-probe", "agents", "agent-001", "result.json"), "utf8"));
  assert.equal(agentResult.status, "timed_out");

  const resultMessages = await callMcp([
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "workflow_result", arguments: { artifacts, runId: "slow-submit-probe" } },
    },
  ]);
  const result = resultMessages[0] as { result?: { structuredContent?: { runId?: string; agentCount?: number } } };
  assert.equal(result.result?.structuredContent?.runId, "slow-submit-probe");
  assert.equal(result.result?.structuredContent?.agentCount, 1);
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

function callMcpFirstResponse(request: unknown): Promise<{ message: unknown; durationMs: number; closed: Promise<void> }> {
  const started = Date.now();
  const child = spawn("node", ["dist/src/mcp-server.js"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let resolved = false;
  let resolveClosed!: () => void;
  let rejectClosed!: (error: Error) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MCP first response timed out: ${stderr}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (!resolved && newline >= 0) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          message: JSON.parse(stdout.slice(0, newline)),
          durationMs: Date.now() - started,
          closed,
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolveClosed();
      else rejectClosed(new Error(`MCP process exited ${code}: ${stderr}`));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function waitForSummary(artifacts: string, runId: string): Promise<any> {
  const summaryPath = join(artifacts, "runs", runId, "summary.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(summaryPath, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`summary not written for ${runId}`);
}
