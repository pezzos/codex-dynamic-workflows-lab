import type { TokenUsage } from "./types.js";

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export function normalizeUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const inputTokens = readCount(raw, "inputTokens", "input_tokens");
  const cachedInputTokens = readCount(raw, "cachedInputTokens", "cached_input_tokens");
  const outputTokens = readCount(raw, "outputTokens", "output_tokens");
  const reasoningOutputTokens = readCount(raw, "reasoningOutputTokens", "reasoning_output_tokens");
  const explicitTotal = readOptionalCount(raw, "totalTokens", "total_tokens");
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: explicitTotal ?? inputTokens + outputTokens + reasoningOutputTokens,
  };
}

export function latestUsageFromEvents(events: unknown[]): TokenUsage | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as Record<string, unknown> | undefined;
    const usage = normalizeUsage(event?.usage);
    if (usage) return usage;
  }
  return null;
}

function readCount(raw: Record<string, unknown>, camelKey: string, snakeKey: string): number {
  return readOptionalCount(raw, camelKey, snakeKey) ?? 0;
}

function readOptionalCount(raw: Record<string, unknown>, camelKey: string, snakeKey: string): number | null {
  const value = raw[camelKey] ?? raw[snakeKey];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
