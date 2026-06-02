import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ArtifactStore } from "../src/artifacts.js";
import { CodexExecRunner } from "../src/codex-runner.js";
import { defaultPolicy } from "../src/policy.js";

test("CodexExecRunner uses fake codex and parses noisy JSONL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
  const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
  await store.init({ name: "demo", description: "demo" }, defaultPolicy);
  const runner = new CodexExecRunner({
    cwd: dir,
    store,
    policy: defaultPolicy,
    codexBin: resolve("scripts/fake-codex.js"),
  });
  const result = await runner.run({
    prompt: "hello",
    label: "fake",
    options: {},
  });
  assert.equal(result.status, "completed");
  assert.match(String(result.result), /fake-result:hello/);
  assert.ok(result.warnings.some((warning) => warning.includes("non-json")));

  const command = JSON.parse(await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "command.json"), "utf8"));
  assert.deepEqual(command.args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
  assert.equal(command.args.includes("--ask-for-approval") && command.args.indexOf("--ask-for-approval") > command.args.indexOf("exec"), false);
  assert.equal(command.args[command.args.indexOf("--sandbox") + 1], "read-only");
});

test("CodexExecRunner keeps truncated logs when stdout exceeds policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
  const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
  await store.init({ name: "demo", description: "demo" }, { ...defaultPolicy, maxOutputBytesPerWorker: 16 });
  const runner = new CodexExecRunner({
    cwd: dir,
    store,
    policy: { ...defaultPolicy, maxOutputBytesPerWorker: 16 },
    codexBin: resolve("scripts/fake-codex.js"),
  });

  const result = await runner.run({
    prompt: "FAKE_LARGE_STDOUT",
    label: "large",
    options: {},
  });

  assert.equal(result.status, "completed");
  assert.match(String(result.result), /fake-large-result rt_\[REDACTED\]/);
  assert.ok(result.warnings.includes("worker stdout exceeded policy"));
  assert.ok(result.warnings.includes("used last-message fallback"));
  const stdout = await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "stdout.log"), "utf8");
  const stderr = await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "stderr.log"), "utf8");
  const lastMessage = await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "last-message.txt"), "utf8");
  const resultJson = await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "result.json"), "utf8").catch(() => "");
  assert.match(stdout, /truncated/);
  assert.doesNotMatch(stdout, /rt_stdout_secret/);
  assert.match(stderr, /fake large stdout/);
  assert.doesNotMatch(stderr, /rt_stderr_secret/);
  assert.doesNotMatch(lastMessage, /rt_large_secret/);
  assert.doesNotMatch(resultJson, /rt_large_secret/);
});

test("CodexExecRunner fails oversized stdout when last-message fallback is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
  const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
  await store.init({ name: "demo", description: "demo" }, { ...defaultPolicy, maxOutputBytesPerWorker: 16 });
  const runner = new CodexExecRunner({
    cwd: dir,
    store,
    policy: { ...defaultPolicy, maxOutputBytesPerWorker: 16 },
    codexBin: resolve("scripts/fake-codex.js"),
  });

  const result = await runner.run({
    prompt: "FAKE_LARGE_STDOUT_NO_LAST",
    label: "large",
    options: {},
  });

  assert.equal(result.status, "failed");
  assert.ok(result.warnings.includes("worker stdout exceeded policy"));
});
