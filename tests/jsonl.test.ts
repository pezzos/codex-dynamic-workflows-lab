import assert from "node:assert/strict";
import test from "node:test";
import { parseNoisyJsonl } from "../src/jsonl.js";

test("parseNoisyJsonl tolerates noisy lines", () => {
  const parsed = parseNoisyJsonl('{"type":"a"}\nnot json\n{"type":"b"}');
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.warnings.length, 1);
});
