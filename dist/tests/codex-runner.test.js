import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, symlink, writeFile, mkdtemp } from "node:fs/promises";
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
    assert.equal(result.usage?.inputTokens, 10);
    assert.equal(result.usage?.outputTokens, 4);
    assert.equal(result.usage?.totalTokens, 14);
    const command = JSON.parse(await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "command.json"), "utf8"));
    assert.deepEqual(command.args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
    assert.equal(command.args.includes("--ask-for-approval") && command.args.indexOf("--ask-for-approval") > command.args.indexOf("exec"), false);
    assert.ok(command.args.includes("--ignore-user-config"));
    assert.equal(command.args[command.args.indexOf("--sandbox") + 1], "read-only");
});
test("CodexExecRunner records model and reasoning effort routing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
    const policy = { ...defaultPolicy, allowedModels: ["gpt-5.1-codex-mini"], allowedReasoningEfforts: ["low"] };
    const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, policy);
    const runner = new CodexExecRunner({
        cwd: dir,
        store,
        policy,
        codexBin: resolve("scripts/fake-codex.js"),
    });
    const result = await runner.run({
        prompt: "hello",
        label: "routed",
        options: { model: "gpt-5.1-codex-mini", reasoningEffort: "low" },
    });
    assert.equal(result.model, "gpt-5.1-codex-mini");
    assert.equal(result.reasoningEffort, "low");
    const command = JSON.parse(await readFile(join(dir, "artifacts", "runs", "run", "agents", "codex-001", "command.json"), "utf8"));
    assert.equal(command.model, "gpt-5.1-codex-mini");
    assert.equal(command.reasoningEffort, "low");
    assert.equal(command.args[command.args.indexOf("--model") + 1], "gpt-5.1-codex-mini");
    assert.equal(command.args[command.args.indexOf("-c") + 1], 'model_reasoning_effort="low"');
});
test("CodexExecRunner isolates CODEX_HOME by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
    const parentHome = await mkdtemp(join(tmpdir(), "codex-flow-parent-home-"));
    const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, defaultPolicy);
    const runner = new CodexExecRunner({
        cwd: dir,
        store,
        policy: defaultPolicy,
        codexBin: resolve("scripts/fake-codex.js"),
        env: { PATH: process.env.PATH, HOME: parentHome },
    });
    const result = await runner.run({
        prompt: "FAKE_ENV_PROBE",
        label: "env",
        options: {},
    });
    const env = JSON.parse(String(result.result));
    assert.equal(env.hasWorkerMarker, true);
    assert.notEqual(env.home, parentHome);
    assert.notEqual(env.codexHome, join(parentHome, ".codex"));
    assert.deepEqual(env.codexHomeEntries, []);
    assert.equal(env.authSha256, null);
    await assert.rejects(() => readdir(env.home), /ENOENT/);
    await assert.rejects(() => readdir(env.codexHome), /ENOENT/);
});
test("CodexExecRunner copies only auth.json for codex-auth-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
    const parentHome = await mkdtemp(join(tmpdir(), "codex-flow-parent-home-"));
    const parentCodexHome = join(parentHome, ".codex");
    const authJson = JSON.stringify({ token: "test-auth" });
    await mkdir(join(parentCodexHome, "plugins"), { recursive: true });
    await writeFile(join(parentCodexHome, "auth.json"), authJson, "utf8");
    await writeFile(join(parentCodexHome, "config.toml"), "model = \"test\"\n", "utf8");
    await writeFile(join(parentCodexHome, "plugins", "plugin.txt"), "plugin", "utf8");
    const policy = { ...defaultPolicy, secrets: "codex-auth-only" };
    const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, policy);
    const runner = new CodexExecRunner({
        cwd: dir,
        store,
        policy,
        codexBin: resolve("scripts/fake-codex.js"),
        env: { PATH: process.env.PATH, HOME: parentHome },
    });
    const result = await runner.run({
        prompt: "FAKE_ENV_PROBE",
        label: "env",
        options: {},
    });
    const env = JSON.parse(String(result.result));
    assert.notEqual(env.codexHome, parentCodexHome);
    assert.deepEqual(env.codexHomeEntries, ["auth.json"]);
    assert.equal(env.authSha256, sha256(authJson));
    assert.equal(env.authMode, 0o600);
    await assert.rejects(() => readdir(env.home), /ENOENT/);
    await assert.rejects(() => readdir(env.codexHome), /ENOENT/);
});
test("CodexExecRunner reads auth from explicit CODEX_HOME for codex-auth-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
    const parentHome = await mkdtemp(join(tmpdir(), "codex-flow-parent-home-"));
    const explicitCodexHome = await mkdtemp(join(tmpdir(), "codex-flow-explicit-codex-home-"));
    const authJson = JSON.stringify({ token: "explicit-auth" });
    await writeFile(join(explicitCodexHome, "auth.json"), authJson, "utf8");
    const policy = { ...defaultPolicy, secrets: "codex-auth-only" };
    const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, policy);
    const runner = new CodexExecRunner({
        cwd: dir,
        store,
        policy,
        codexBin: resolve("scripts/fake-codex.js"),
        env: { PATH: process.env.PATH, HOME: parentHome, CODEX_HOME: explicitCodexHome },
    });
    const result = await runner.run({
        prompt: "FAKE_ENV_PROBE",
        label: "env",
        options: {},
    });
    const env = JSON.parse(String(result.result));
    assert.notEqual(env.home, parentHome);
    assert.notEqual(env.codexHome, explicitCodexHome);
    assert.deepEqual(env.codexHomeEntries, ["auth.json"]);
    assert.equal(env.authSha256, sha256(authJson));
    await assert.rejects(() => readdir(env.home), /ENOENT/);
    await assert.rejects(() => readdir(env.codexHome), /ENOENT/);
});
test("CodexExecRunner rejects symlinked codex-auth-only auth files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
    const parentHome = await mkdtemp(join(tmpdir(), "codex-flow-parent-home-"));
    const parentCodexHome = join(parentHome, ".codex");
    const targetDir = await mkdtemp(join(tmpdir(), "codex-flow-auth-target-"));
    await mkdir(parentCodexHome, { recursive: true });
    await writeFile(join(targetDir, "auth.json"), JSON.stringify({ token: "symlink-auth" }), "utf8");
    await symlink(join(targetDir, "auth.json"), join(parentCodexHome, "auth.json"));
    const policy = { ...defaultPolicy, secrets: "codex-auth-only" };
    const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, policy);
    const runner = new CodexExecRunner({
        cwd: dir,
        store,
        policy,
        codexBin: resolve("scripts/fake-codex.js"),
        env: { PATH: process.env.PATH, HOME: parentHome },
    });
    await assert.rejects(() => runner.run({
        prompt: "FAKE_ENV_PROBE",
        label: "env",
        options: {},
    }), /auth\.json must not be a symlink/);
});
test("CodexExecRunner fails early when codex-auth-only auth file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-runner-"));
    const parentHome = await mkdtemp(join(tmpdir(), "codex-flow-parent-home-"));
    const policy = { ...defaultPolicy, secrets: "codex-auth-only" };
    const store = new ArtifactStore({ root: join(dir, "artifacts"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, policy);
    const runner = new CodexExecRunner({
        cwd: dir,
        store,
        policy,
        codexBin: resolve("scripts/fake-codex.js"),
        env: { PATH: process.env.PATH, HOME: parentHome },
    });
    await assert.rejects(() => runner.run({
        prompt: "FAKE_ENV_PROBE",
        label: "env",
        options: {},
    }), /codex-auth-only requires file-based Codex auth/);
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
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
