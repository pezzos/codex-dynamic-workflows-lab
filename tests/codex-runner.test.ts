import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
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
});
