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
export type RouteProfileId = "scout" | "reviewer" | "security" | "synthesizer";
export type CompactSchemaName = "scout_map" | "validation_inventory" | "review_findings" | "final_synthesis";
export type OutputAuditMode = "auto" | "full" | "metadata-only" | "none";
export type ResolvedOutputAuditMode = "full" | "metadata-only" | "none";
export type EvidenceValidity = "valid" | "diagnostic_only" | "invalid";
export type AuditCompleteness = "full" | "metadata_only" | "none";
export type ResultSource = "last_message" | "events" | "none";
export type UsageSource = "jsonl" | "none";

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

export interface CompactPayload {
  schemaName: CompactSchemaName;
  maxBytes: number;
  byteLength: number;
  value: JsonValue;
}

export interface AgentOptions {
  label?: string;
  phase?: string;
  schema?: JsonSchema;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  profile?: RouteProfileId;
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
  allowedRouteProfiles: RouteProfileId[];
  secrets: "none" | "codex-auth-only";
  outputAuditMode: OutputAuditMode;
}

export interface AuditMetadata {
  outputAuditMode: OutputAuditMode;
  resolvedOutputAuditMode: ResolvedOutputAuditMode;
  auditCompleteness: AuditCompleteness;
  resultSource: ResultSource;
  usageSource: UsageSource;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutPersisted: boolean;
  stderrPersisted: boolean;
  lastMessagePersisted: boolean;
  eventsPersisted: boolean;
  stdoutOverflowed: boolean;
  stdoutFallbackUsed: boolean;
  stdoutSuppressedForSecrets: boolean;
  secretFindingKinds: string[];
  eventsParsed: number;
  validity: EvidenceValidity;
  validityReasons: string[];
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
  profile?: RouteProfileId;
  usage?: TokenUsage | null;
  validity?: EvidenceValidity;
  validityReasons?: string[];
  auditCompleteness?: AuditCompleteness;
  resultSource?: ResultSource;
  stdoutOverflowed?: boolean;
  stdoutFallbackUsed?: boolean;
  stdoutSuppressedForSecrets?: boolean;
  secretFindingKinds?: string[];
  auditMetadata?: AuditMetadata;
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
  compactCount?: number;
  validity?: EvidenceValidity;
  validityReasons?: string[];
  stdoutFallbackUsedCount?: number;
  secretSafeSuppressionCount?: number;
  metadataOnlyAuditCount?: number;
  artifactSecretFindingCount?: number;
  invalidAgentCount?: number;
  diagnosticAgentCount?: number;
  targetGitStatusBefore?: string | null;
  targetGitStatusAfter?: string | null;
  targetGitStatusChanged?: boolean;
  targetGitStatusGuardActive?: boolean;
}
