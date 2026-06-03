export const reasoningEfforts = ["minimal", "low", "medium", "high"];
export const defaultPolicy = Object.freeze({
    mode: "read-only",
    maxAgents: 16,
    concurrency: 4,
    maxDepth: 1,
    maxRetries: 0,
    maxRunDurationMs: 1_800_000,
    maxWorkerDurationMs: 600_000,
    maxOutputBytesPerWorker: 200_000,
    maxArtifactBytes: 20_000_000,
    maxTokens: null,
    allowNetwork: false,
    allowConnectors: false,
    allowDangerFullAccess: false,
    writableRoots: [],
    allowedCommands: ["codex"],
    allowedModels: [],
    allowedReasoningEfforts: [],
    secrets: "none",
});
export function normalizePolicy(input = {}) {
    const policy = { ...defaultPolicy, ...input };
    validatePolicy(policy);
    return Object.freeze(policy);
}
export function validatePolicy(policy) {
    if (policy.maxDepth !== 1)
        throw new Error("policy.maxDepth must be 1");
    if (policy.allowNetwork !== false)
        throw new Error("network is not supported in MVP");
    if (policy.allowConnectors !== false)
        throw new Error("connectors are not supported in MVP");
    if (policy.allowDangerFullAccess !== false)
        throw new Error("danger-full-access is forbidden");
    if (policy.maxAgents < 1 || policy.maxAgents > 16)
        throw new Error("policy.maxAgents must be 1..16");
    if (policy.concurrency < 1 || policy.concurrency > policy.maxAgents) {
        throw new Error("policy.concurrency must be 1..maxAgents");
    }
    if (policy.maxTokens !== null && (!Number.isInteger(policy.maxTokens) || policy.maxTokens < 0)) {
        throw new Error("policy.maxTokens must be a non-negative integer or null");
    }
    if (!Array.isArray(policy.allowedReasoningEfforts)) {
        throw new Error("policy.allowedReasoningEfforts must be an array");
    }
    for (const effort of policy.allowedReasoningEfforts) {
        if (!reasoningEfforts.includes(effort)) {
            throw new Error(`policy.allowedReasoningEfforts contains unsupported value: ${effort}`);
        }
    }
    if (policy.mode === "read-only" && policy.writableRoots.length > 0) {
        throw new Error("read-only policy cannot define writableRoots");
    }
    if (policy.mode === "write-worktree" && policy.writableRoots.length === 0) {
        throw new Error("write-worktree policy requires writableRoots");
    }
    if (!["none", "codex-auth-only"].includes(policy.secrets)) {
        throw new Error("policy.secrets must be none or codex-auth-only");
    }
}
export function stablePolicyHash(policy) {
    return Buffer.from(JSON.stringify(sortObject(policy))).toString("base64url");
}
function sortObject(value) {
    if (Array.isArray(value))
        return value.map(sortObject);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, sortObject(val)]));
}
