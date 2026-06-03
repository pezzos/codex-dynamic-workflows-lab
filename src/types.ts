export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: JsonValue[];
  const?: JsonValue;
  description?: string;
  [key: string]: unknown;
}

export interface WorkflowMetaPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowMetaPhase[];
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface TokenBudgetStatus {
  totalTokens: number | null;
  spentTokens: number;
  remainingTokens: number | null;
  exhausted: boolean;
}

export interface AgentOptions {
  label?: string;
  phase?: string;
  schema?: JsonSchema;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sandbox?: "read-only" | "workspace-write";
  writeScope?: "none" | "worktree";
  timeoutMs?: number;
}

export interface WorkflowPolicy {
  mode: "read-only" | "write-worktree";
  maxAgents: number;
  concurrency: number;
  maxDepth: 1;
  maxRetries: number;
  maxRunDurationMs: number;
  maxWorkerDurationMs: number;
  maxOutputBytesPerWorker: number;
  maxArtifactBytes: number;
  maxToolCallsPerWorker?: number;
  maxEstimatedUsd?: number;
  maxTokens: number | null;
  allowNetwork: false;
  allowConnectors: false;
  allowDangerFullAccess: false;
  writableRoots: string[];
  allowedCommands: string[];
  allowedModels: string[];
  allowedReasoningEfforts: ReasoningEffort[];
  secrets: "none" | "codex-auth-only";
}

export interface AgentRunInput {
  agentId?: string;
  prompt: string;
  label: string;
  phase?: string;
  schema?: JsonSchema;
  options: AgentOptions;
}

export interface AgentRunOutput {
  agentId: string;
  label: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  result: unknown;
  durationMs: number;
  warnings: string[];
  artifacts: Record<string, string>;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  usage?: TokenUsage | null;
}

export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunOutput>;
}

export interface WorkflowRunResult<T = unknown> {
  runId: string;
  meta: WorkflowMeta;
  result: T;
  logs: string[];
  phases: string[];
  agentCount: number;
  durationMs: number;
  artifactRoot: string;
  warnings: string[];
  aggregateUsage: TokenUsage;
  usageUnavailableCount: number;
  budget: TokenBudgetStatus;
}
