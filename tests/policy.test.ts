import assert from "node:assert/strict";
import test from "node:test";
import { normalizePolicy, stablePolicyHash } from "../src/policy.js";

test("normalizePolicy rejects unsupported permissions", () => {
  assert.throws(() => normalizePolicy({ allowNetwork: true as false }), /network/);
  assert.throws(() => normalizePolicy({ allowDangerFullAccess: true as false }), /danger/);
  assert.throws(() => normalizePolicy({ secrets: "everything" as "none" }), /policy\.secrets/);
  assert.throws(() => normalizePolicy({ maxTokens: -1 }), /policy\.maxTokens/);
  assert.throws(() => normalizePolicy({ allowedReasoningEfforts: ["xhigh" as "high"] }), /allowedReasoningEfforts/);
});

test("stablePolicyHash is canonical", () => {
  const a = normalizePolicy({ concurrency: 2, maxAgents: 4 });
  const b = normalizePolicy({ maxAgents: 4, concurrency: 2 });
  assert.equal(stablePolicyHash(a), stablePolicyHash(b));
});
