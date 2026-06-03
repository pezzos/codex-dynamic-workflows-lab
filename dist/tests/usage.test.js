import assert from "node:assert/strict";
import test from "node:test";
import { addUsage, emptyUsage, latestUsageFromEvents, normalizeUsage } from "../src/usage.js";
test("normalizeUsage accepts snake_case and computes total tokens", () => {
    assert.deepEqual(normalizeUsage({
        input_tokens: 10,
        cached_input_tokens: 3,
        output_tokens: 4,
        reasoning_output_tokens: 2,
    }), {
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 4,
        reasoningOutputTokens: 2,
        totalTokens: 16,
    });
});
test("latestUsageFromEvents reads the last usage event", () => {
    const usage = latestUsageFromEvents([
        { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
        { type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2, total_tokens: 9 } },
    ]);
    assert.equal(usage?.totalTokens, 9);
});
test("addUsage sums normalized counters", () => {
    assert.deepEqual(addUsage(emptyUsage(), { inputTokens: 2, cachedInputTokens: 1, outputTokens: 3, reasoningOutputTokens: 4, totalTokens: 9 }), {
        inputTokens: 2,
        cachedInputTokens: 1,
        outputTokens: 3,
        reasoningOutputTokens: 4,
        totalTokens: 9,
    });
});
