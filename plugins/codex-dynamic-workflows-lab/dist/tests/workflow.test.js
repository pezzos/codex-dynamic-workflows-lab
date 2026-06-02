import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseWorkflowScript, runWorkflow } from "../src/workflow.js";
const fakeRunner = {
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
        "process.env",
        'process["env"]',
        "({}).constructor",
    ]) {
        assert.throws(() => parseWorkflowScript(`export const meta = { name: "bad", description: "bad" }\nreturn ${expression}`), /forbidden|deterministic/, expression);
    }
});
test("parseWorkflowScript allows process.cwd helper", () => {
    const parsed = parseWorkflowScript(`
export const meta = { name: "cwd_demo", description: "Demo workflow" }
return process.cwd()
`);
    assert.match(parsed.body, /process\.cwd/);
});
test("parseWorkflowScript rejects worker write requests during validation", () => {
    for (const options of [
        '{ label: "write", sandbox: "workspace-write" }',
        '{ label: "write", writeScope: "worktree" }',
        '{ label: "write", policy: { sandbox: "workspace-write" } }',
    ]) {
        assert.throws(() => parseWorkflowScript(`
export const meta = { name: "bad_write", description: "bad" }
return agent("write", ${options})
`), /forbids worker write requests|unsupported agent option/, options);
    }
});
test("parseWorkflowScript rejects unsupported literal agent options", () => {
    for (const options of [
        '{ label: "probe", unexpected: true }',
        '{ label: "probe", allowedTools: ["shell"] }',
        '{ label: "probe", maxOutputBytes: 1024 }',
        '{ label: "probe", reasoningEffort: "high" }',
    ]) {
        assert.throws(() => parseWorkflowScript(`
export const meta = { name: "bad_option", description: "bad" }
return agent("probe", ${options})
`), /unsupported agent option/, options);
    }
});
test("parseWorkflowScript accepts explicit read-only worker requests", () => {
    const parsed = parseWorkflowScript(`
export const meta = { name: "read_worker", description: "Demo workflow" }
return agent("read", { label: "read", sandbox: "read-only" })
`);
    assert.match(parsed.body, /sandbox/);
});
test("runWorkflow executes phases and parallel agents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    const result = await runWorkflow(`
export const meta = { name: "demo", description: "Demo workflow" }
phase("Scan")
const results = await parallel([
  () => agent("a", { label: "a" }),
  () => agent("b", { label: "b" }),
])
return { results }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: fakeRunner,
        policy: { maxAgents: 2, concurrency: 2 },
    });
    assert.equal(result.agentCount, 2);
    assert.deepEqual(result.phases, ["Scan"]);
    assert.deepEqual(result.result.results, ["result:a", "result:b"]);
});
test("runWorkflow rejects policy widening to workspace-write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    await assert.rejects(() => runWorkflow(`
export const meta = { name: "demo", description: "Demo workflow" }
const value = await agent("write", { label: "write", sandbox: "workspace-write" })
return { value }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: fakeRunner,
        policy: { mode: "read-only" },
    }), /forbids worker write requests/);
});
test("runWorkflow rejects dynamic unsupported agent options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    await assert.rejects(() => runWorkflow(`
export const meta = { name: "dynamic_bad_option", description: "Demo workflow" }
const options = { label: "probe" }
options.policy = { sandbox: "workspace-write" }
const value = await agent("probe", options)
return { value }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: fakeRunner,
        policy: { maxAgents: 1, concurrency: 1 },
    }), /unsupported agent option: policy/);
});
test("runWorkflow redacts runner results in agent and summary artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    const secretRunner = {
        async run(input) {
            return {
                agentId: input.label,
                label: input.label,
                status: "completed",
                result: "finding rt_summary_secret_token_123456789",
                durationMs: 1,
                warnings: ["warning rt_warning_secret_token_123456789"],
                artifacts: {},
            };
        },
    };
    const result = await runWorkflow(`
export const meta = { name: "redaction_demo", description: "Demo workflow" }
log("log rt_log_secret_token_123456789")
const value = await agent("probe", { label: "probe" })
return { value }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: secretRunner,
        policy: { maxAgents: 1, concurrency: 1 },
    });
    assert.doesNotMatch(JSON.stringify(result), /rt_summary_secret/);
    const summary = await readFile(join(dir, "artifacts", "runs", result.runId, "summary.json"), "utf8");
    const agentResult = await readFile(join(dir, "artifacts", "runs", result.runId, "agents", "agent-001", "result.json"), "utf8");
    assert.doesNotMatch(summary, /rt_(summary|warning|log)_secret/);
    assert.doesNotMatch(agentResult, /rt_summary_secret/);
});
