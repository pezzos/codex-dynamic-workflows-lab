import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseWorkflowScript, runWorkflow } from "../src/workflow.js";
const execFileAsync = promisify(execFile);
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
test("parseWorkflowScript accepts supported reasoning effort routing", () => {
    const parsed = parseWorkflowScript(`
export const meta = { name: "reasoning_worker", description: "Demo workflow" }
return agent("read", { label: "read", reasoningEffort: "low" })
`);
    assert.match(parsed.body, /reasoningEffort/);
});
test("parseWorkflowScript accepts supported route profiles", () => {
    const parsed = parseWorkflowScript(`
export const meta = { name: "profile_worker", description: "Demo workflow" }
return agent("read", { label: "read", profile: "scout" })
`);
    assert.match(parsed.body, /profile/);
});
test("parseWorkflowScript rejects unsupported reasoning effort values", () => {
    assert.throws(() => parseWorkflowScript(`
export const meta = { name: "bad_reasoning", description: "bad" }
return agent("probe", { label: "probe", reasoningEffort: "xhigh" })
`), /unsupported reasoningEffort/);
});
test("parseWorkflowScript rejects unsupported route profiles", () => {
    assert.throws(() => parseWorkflowScript(`
export const meta = { name: "bad_profile", description: "bad" }
return agent("probe", { label: "probe", profile: "director" })
`), /unsupported route profile/);
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
test("runWorkflow aggregates token usage and exposes budget helpers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    const usageRunner = {
        async run(input) {
            return {
                agentId: input.label,
                label: input.label,
                status: "completed",
                result: {
                    prompt: input.prompt,
                    spent: 0,
                },
                durationMs: 1,
                warnings: [],
                artifacts: {},
                usage: { inputTokens: 7, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 11 },
            };
        },
    };
    const result = await runWorkflow(`
export const meta = { name: "usage_demo", description: "Demo workflow" }
const first = await agent("a", { label: "a", reasoningEffort: "low" })
const afterFirst = { spent: budget.spent(), remaining: budget.remaining() }
const second = await agent("b", { label: "b", reasoningEffort: "low" })
return { first, second, afterFirst, finalSpent: budget.spent() }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: usageRunner,
        policy: { maxAgents: 2, concurrency: 1, maxTokens: 30, allowedReasoningEfforts: ["low"] },
    });
    assert.equal(result.agentCount, 2);
    assert.equal(result.aggregateUsage.totalTokens, 22);
    assert.equal(result.budget.totalTokens, 30);
    assert.equal(result.budget.remainingTokens, 8);
    assert.equal(result.result.afterFirst.spent, 11);
    assert.equal(result.result.afterFirst.remaining, 19);
    const summary = JSON.parse(await readFile(join(dir, "artifacts", "runs", result.runId, "summary.json"), "utf8"));
    assert.equal(summary.aggregateUsage.totalTokens, 22);
    assert.equal(summary.budget.remainingTokens, 8);
});
test("runWorkflow aggregates agent evidence validity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    const validityRunner = {
        async run(input) {
            return {
                agentId: input.label,
                label: input.label,
                status: "completed",
                result: `result:${input.prompt}`,
                durationMs: 1,
                warnings: [],
                artifacts: {},
                validity: input.label === "a" ? "diagnostic_only" : "valid",
                validityReasons: input.label === "a" ? ["stdout exceeded policy and last-message fallback was used"] : [],
                auditCompleteness: input.label === "a" ? "metadata_only" : "full",
                stdoutFallbackUsed: input.label === "a",
            };
        },
    };
    const result = await runWorkflow(`
export const meta = { name: "validity_demo", description: "Demo workflow" }
await agent("a", { label: "a" })
await agent("b", { label: "b" })
return true
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: validityRunner,
        policy: { maxAgents: 2, concurrency: 1 },
    });
    assert.equal(result.validity, "diagnostic_only");
    assert.equal(result.stdoutFallbackUsedCount, 1);
    assert.equal(result.metadataOnlyAuditCount, 1);
    assert.equal(result.diagnosticAgentCount, 1);
    const summary = JSON.parse(await readFile(join(dir, "artifacts", "runs", result.runId, "summary.json"), "utf8"));
    assert.equal(summary.validity, "diagnostic_only");
    assert.equal(summary.stdoutFallbackUsedCount, 1);
});
test("runWorkflow resolves route profiles without changing legacy agent result shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    const observed = [];
    const routeRunner = {
        async run(input) {
            observed.push({
                label: input.label,
                profile: input.options.profile,
                reasoningEffort: input.options.reasoningEffort,
            });
            return {
                agentId: input.label,
                label: input.label,
                status: "completed",
                result: `result:${input.label}`,
                durationMs: 1,
                warnings: [],
                artifacts: {},
            };
        },
    };
    const result = await runWorkflow(`
export const meta = { name: "profile_demo", description: "Demo workflow" }
const legacy = await agent("legacy", { label: "legacy" })
const routed = await agent("routed", { label: "routed", profile: "scout" })
const explicit = await agent("explicit", { label: "explicit", profile: "reviewer", reasoningEffort: "low" })
return { legacy, routed, explicit }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: routeRunner,
        policy: { maxAgents: 3, concurrency: 1, allowedRouteProfiles: ["scout", "reviewer"], allowedReasoningEfforts: ["low"] },
    });
    assert.deepEqual(result.result, {
        legacy: "result:legacy",
        routed: "result:routed",
        explicit: "result:explicit",
    });
    assert.deepEqual(observed, [
        { label: "legacy", profile: undefined, reasoningEffort: undefined },
        { label: "routed", profile: "scout", reasoningEffort: "low" },
        { label: "explicit", profile: "reviewer", reasoningEffort: "low" },
    ]);
    const events = await readFile(join(dir, "artifacts", "runs", result.runId, "events.jsonl"), "utf8");
    assert.match(events, /"type":"agent\.profile"/);
});
test("runWorkflow writes compact payloads under byte caps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    const result = await runWorkflow(`
export const meta = { name: "compact_demo", description: "Demo workflow" }
const scout = await compact({
  summary: "Small repository map.",
  files: [{ path: "README.md", why: "Entry point for usage evidence." }],
  limits: "No live workers were run."
}, "scout_map", 1024)
return { scout }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: fakeRunner,
        policy: { maxAgents: 1, concurrency: 1 },
    });
    assert.equal(result.compactCount, 1);
    assert.equal(result.result.scout.schemaName, "scout_map");
    assert.ok(result.result.scout.byteLength <= 1024);
    const compact = JSON.parse(await readFile(join(dir, "artifacts", "runs", result.runId, "compact-001.json"), "utf8"));
    assert.equal(compact.value.files[0].path, "README.md");
    const summary = JSON.parse(await readFile(join(dir, "artifacts", "runs", result.runId, "summary.json"), "utf8"));
    assert.equal(summary.compactCount, 1);
});
test("runWorkflow rejects unsafe compact export payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    await assert.rejects(() => runWorkflow(`
export const meta = { name: "compact_bad", description: "Demo workflow" }
return compact({
  summary: "Unsafe map.",
  files: [{ path: ".env", why: "Should not be exported." }],
  limits: "none"
}, "scout_map", 1024)
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: fakeRunner,
        policy: { maxAgents: 1, concurrency: 1 },
    }), /relative non-secret path/);
});
test("runWorkflow skips new workers after token budget is exhausted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-test-"));
    let calls = 0;
    const usageRunner = {
        async run(input) {
            calls++;
            return {
                agentId: input.label,
                label: input.label,
                status: "completed",
                result: `result:${input.prompt}`,
                durationMs: 1,
                warnings: [],
                artifacts: {},
                usage: { inputTokens: 6, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 6 },
            };
        },
    };
    const result = await runWorkflow(`
export const meta = { name: "budget_demo", description: "Demo workflow" }
const first = await agent("a", { label: "a" })
const second = await agent("b", { label: "b" })
return { first, second }
`, {
        cwd: dir,
        artifactRoot: join(dir, "artifacts"),
        runner: usageRunner,
        policy: { maxAgents: 2, concurrency: 1, maxTokens: 5 },
    });
    assert.equal(calls, 1);
    assert.equal(result.agentCount, 1);
    assert.equal(result.result.second, null);
    assert.equal(result.budget.exhausted, true);
    assert.ok(result.warnings.some((warning) => warning.includes("token budget exhausted")));
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
test("runWorkflow invalidates benchmark evidence when target git status changes", async () => {
    const target = await mkdtemp(join(tmpdir(), "codex-flow-target-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "codex-flow-artifacts-"));
    await execFileAsync("git", ["init"], { cwd: target });
    const writingRunner = {
        async run() {
            await writeFile(join(target, "unexpected.txt"), "changed", "utf8");
            return {
                agentId: "probe",
                label: "probe",
                status: "completed",
                result: "ok",
                durationMs: 1,
                warnings: [],
                artifacts: {},
            };
        },
    };
    const result = await runWorkflow(`
export const meta = { name: "git_guard", description: "Demo workflow" }
const value = await agent("probe", { label: "probe" })
return { value }
`, {
        cwd: target,
        artifactRoot,
        runner: writingRunner,
        policy: { maxAgents: 1, concurrency: 1 },
    });
    assert.equal(result.targetGitStatusGuardActive, true);
    assert.equal(result.targetGitStatusChanged, true);
    assert.equal(result.validity, "invalid");
    assert.ok(result.validityReasons?.includes("target git status changed during workflow"));
    const summary = JSON.parse(await readFile(join(artifactRoot, "runs", result.runId, "summary.json"), "utf8"));
    assert.equal(summary.targetGitStatusChanged, true);
});
