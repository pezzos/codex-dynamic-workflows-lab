import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseWorkflowScript, runWorkflow } from "../src/workflow.js";
import type { AgentRunner } from "../src/types.js";

const fakeRunner: AgentRunner = {
  async run(input) {
    return {
      agentId: input.label,
      label: input.label,
      status: "completed",
      result: `result:${input.prompt}`,
      durationMs: 1,
      warnings: [],
      artifacts: {},
    };
  },
};

test("parseWorkflowScript accepts literal metadata", () => {
  const parsed = parseWorkflowScript(`
export const meta = { name: "demo", description: "Demo workflow" }
return true
`);
  assert.equal(parsed.meta.name, "demo");
  assert.match(parsed.body, /return true/);
});

test("parseWorkflowScript rejects nondeterministic and escape APIs", () => {
  for (const expression of [
    "Date.now()",
    "Math.random()",
    "new Date()",
    "require('node:fs')",
    "eval('1')",
    "Function('return 1')()",
    "import('node:fs')",
    "globalThis",
    "Buffer",
    "({}).constructor",
  ]) {
    assert.throws(
      () => parseWorkflowScript(`export const meta = { name: "bad", description: "bad" }\nreturn ${expression}`),
      /forbidden|deterministic/,
      expression,
    );
  }
});

test("runWorkflow executes phases and parallel agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
  const result = await runWorkflow(
    `
export const meta = { name: "demo", description: "Demo workflow" }
phase("Scan")
const results = await parallel([
  () => agent("a", { label: "a" }),
  () => agent("b", { label: "b" }),
])
return { results }
`,
    {
      cwd: dir,
      artifactRoot: join(dir, "artifacts"),
      runner: fakeRunner,
      policy: { maxAgents: 2, concurrency: 2 },
    },
  );
  assert.equal(result.agentCount, 2);
  assert.deepEqual(result.phases, ["Scan"]);
  assert.deepEqual((result.result as any).results, ["result:a", "result:b"]);
});

test("runWorkflow rejects policy widening to workspace-write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
  await assert.rejects(
    () =>
      runWorkflow(
        `
export const meta = { name: "demo", description: "Demo workflow" }
const value = await agent("write", { label: "write", sandbox: "workspace-write" })
return { value }
`,
        {
          cwd: dir,
          artifactRoot: join(dir, "artifacts"),
          runner: fakeRunner,
          policy: { mode: "read-only" },
        },
      ),
    /requested writes/,
  );
});
