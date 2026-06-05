import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyRunValidity, createBenchmarkManifest, nonCachedTotal, postflightBenchmarkArtifacts, preflightBenchmarkTarget, } from "../src/benchmark.js";
test("nonCachedTotal subtracts cached input tokens", () => {
    assert.equal(nonCachedTotal({
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 30,
        reasoningOutputTokens: 10,
        totalTokens: 130,
    }), 90);
});
test("classifyRunValidity separates invalid and diagnostic runs", () => {
    assert.deepEqual(classifyRunValidity({
        requiredRoles: ["scout", "review"],
        executedRoles: ["scout"],
    }), { validity: "invalid", reasons: ["missing required roles: review"] });
    assert.deepEqual(classifyRunValidity({
        requiredRoles: ["scout"],
        executedRoles: ["scout"],
        stdoutFallbackUsed: true,
    }), { validity: "diagnostic_only", reasons: ["stdout exceeded policy and last-message fallback was used"] });
    assert.deepEqual(classifyRunValidity({
        requiredRoles: ["scout"],
        executedRoles: ["scout"],
        secretFindingCount: 1,
    }), { validity: "invalid", reasons: ["secret-like artifact finding invalidated evidence"] });
    assert.deepEqual(classifyRunValidity({
        requiredRoles: ["scout"],
        executedRoles: ["scout"],
        outputAuditMode: "none",
        auditCompleteness: "none",
    }), { validity: "diagnostic_only", reasons: ["outputAuditMode none excludes measured comparison", "audit completeness is none"] });
    assert.deepEqual(classifyRunValidity({
        requiredRoles: ["scout"],
        executedRoles: ["scout"],
        outputAuditMode: "auto",
        auditCompleteness: "metadata_only",
    }), { validity: "valid", reasons: [] });
    assert.deepEqual(classifyRunValidity({
        requiredRoles: ["scout"],
        executedRoles: ["scout"],
    }), { validity: "valid", reasons: [] });
});
test("createBenchmarkManifest records route profile identity", () => {
    const manifest = createBenchmarkManifest({
        campaignId: "campaign-1",
        campaignFamilyId: "family-1",
        cohortId: "cohort-a",
        repeatIndex: 2,
        fixtureId: "fixture-1",
        sanitizedFixtureHash: "hash-a",
        targetStateHash: "state-a",
        preflightStatus: "pass",
        target: ".",
        targetMode: "real_repo",
        method: "workflow-routed",
        profiles: ["scout", "reviewer"],
        notes: ["cold run"],
    });
    assert.equal(manifest.schemaVersion, "benchmark_manifest_v1");
    assert.equal(manifest.campaignFamilyId, "family-1");
    assert.equal(manifest.cohortId, "cohort-a");
    assert.equal(manifest.repeatIndex, 2);
    assert.equal(manifest.fixtureId, "fixture-1");
    assert.equal(manifest.sanitizedFixtureHash, "hash-a");
    assert.equal(manifest.targetStateHash, "state-a");
    assert.equal(manifest.preflightStatus, "pass");
    assert.equal(manifest.profiles[0].id, "scout");
    assert.equal(manifest.profiles[0].reasoningEffort, "low");
    assert.ok(manifest.profileHash);
    assert.deepEqual(manifest.notes, ["cold run"]);
});
test("preflightBenchmarkTarget fails closed on secret-like target files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-benchmark-"));
    await mkdir(join(dir, "backend"), { recursive: true });
    await writeFile(join(dir, "backend", ".env"), "LOCAL_PLACEHOLDER=value\n", "utf8");
    const result = await preflightBenchmarkTarget(dir, "real_repo");
    assert.equal(result.ok, false);
    if (!result.ok)
        assert.ok(result.blockers.some((finding) => finding.kind === "env_file"));
});
test("preflightBenchmarkTarget passes on clean fixtures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-benchmark-"));
    await writeFile(join(dir, "README.md"), "Clean fixture.\n", "utf8");
    const result = await preflightBenchmarkTarget(dir, "sanitized_fixture");
    assert.deepEqual(result, { ok: true, findings: [], warnings: [], blockers: [] });
});
test("preflightBenchmarkTarget warns but does not block common auth code surfaces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-benchmark-"));
    await mkdir(join(dir, "app", "agent", "__pycache__"), { recursive: true });
    await writeFile(join(dir, "app", ".env.example"), `${["API", "KEY"].join("_")}=replace-me\n`, "utf8");
    await writeFile(join(dir, "app", ".envrc"), "export PROJECT=demo\n", "utf8");
    await writeFile(join(dir, "app", "agent", "__pycache__", "redact.cpython-311.pyc"), `${"s"}k-compiled-cache-placeholder\n`, "utf8");
    await writeFile(join(dir, "app", "agent", "redact.py"), `OPENAI_PATTERN = '${"s"}k-${"a".repeat(24)}'\n`, "utf8");
    await writeFile(join(dir, "app", "agent", "oauth.py"), "client_secret = read_from_env('CLIENT_SECRET')\n", "utf8");
    const result = await preflightBenchmarkTarget(dir, "real_repo");
    assert.equal(result.ok, true);
    assert.equal(result.blockers.length, 0);
    assert.ok(result.warnings.some((finding) => finding.kind === "env_example"));
    assert.ok(result.warnings.some((finding) => finding.kind === "envrc"));
    assert.ok(result.warnings.some((finding) => finding.kind === "openai_key"));
    assert.equal(result.findings.length, 0);
    assert.equal(result.warnings.some((finding) => finding.path?.includes("__pycache__")), false);
});
test("postflightBenchmarkArtifacts fails closed on secret-like artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-artifacts-"));
    await mkdir(join(dir, "agents", "agent-001"), { recursive: true });
    await writeFile(join(dir, "agents", "agent-001", "stdout.log"), "local_api_key_1234567890abcdef\n", "utf8");
    const result = await postflightBenchmarkArtifacts(dir);
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.validity, "invalid");
        assert.ok(result.findings.some((finding) => finding.kind === "local_api_key"));
    }
});
