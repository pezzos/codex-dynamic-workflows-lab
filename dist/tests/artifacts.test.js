import assert from "node:assert/strict";
import { symlink, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ArtifactStore, assertSafeId, assertInsideRoot } from "../src/artifacts.js";
import { defaultPolicy } from "../src/policy.js";
test("ArtifactStore rejects unsafe ids", () => {
    assert.throws(() => assertSafeId("../x", "runId"), /unsafe/);
    assert.throws(() => new ArtifactStore({ root: "/tmp/x", runId: "../x" }), /unsafe/);
});
test("assertInsideRoot rejects symlink escapes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-flow-artifact-"));
    const outside = join(dir, "outside.txt");
    const link = join(dir, "root", "link.txt");
    await writeFile(outside, "secret", "utf8");
    const store = new ArtifactStore({ root: join(dir, "root"), runId: "run" });
    await store.init({ name: "demo", description: "demo" }, defaultPolicy);
    await symlink(outside, link);
    await assert.rejects(() => assertInsideRoot(link, join(dir, "root")), /symlink|escapes/);
});
