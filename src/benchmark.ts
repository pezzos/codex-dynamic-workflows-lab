import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { routeProfiles } from "./profiles.js";
import { scanArtifactRootForSecretLike, scanTargetForSecretLike, type SafetyFinding } from "./safety.js";
import type { AuditCompleteness, OutputAuditMode, RouteProfileId, TokenUsage } from "./types.js";

export type BenchmarkMethod = "single" | "manual" | "workflow-classic" | "workflow-routed";
export type BenchmarkTargetMode = "real_repo" | "include_list" | "sanitized_fixture";
export type BenchmarkValidity = "valid" | "diagnostic_only" | "invalid";

export interface BenchmarkManifestInput {
  campaignId: string;
  campaignFamilyId?: string;
  cohortId?: string;
  repeatIndex?: number;
  fixtureId?: string;
  sanitizedFixtureHash?: string;
  targetStateHash?: string;
  preflightStatus?: "pass" | "failed" | "not_run";
  target: string;
  targetMode: BenchmarkTargetMode;
  method: BenchmarkMethod;
  profiles?: RouteProfileId[];
  notes?: string[];
}

export interface BenchmarkManifest {
  schemaVersion: "benchmark_manifest_v1";
  campaignId: string;
  campaignFamilyId: string | null;
  cohortId: string | null;
  repeatIndex: number | null;
  fixtureId: string | null;
  sanitizedFixtureHash: string | null;
  targetStateHash: string | null;
  preflightStatus: "pass" | "failed" | "not_run";
  target: string;
  targetMode: BenchmarkTargetMode;
  method: BenchmarkMethod;
  createdAt: string;
  profileHash: string | null;
  profiles: Array<{
    id: RouteProfileId;
    reasoningEffort: string;
    description: string;
  }>;
  notes: string[];
}

export interface RunValidityInput {
  requiredRoles: string[];
  executedRoles: string[];
  usageUnavailableCount?: number;
  stdoutFallbackUsed?: boolean;
  secretFindingCount?: number;
  artifactLeakDetected?: boolean;
  outputAuditMode?: OutputAuditMode;
  auditCompleteness?: AuditCompleteness;
  modelDrift?: boolean;
  asymmetricOperatorIntervention?: boolean;
  contractReconstructedFromFreeform?: boolean;
}

export interface RunValidityResult {
  validity: BenchmarkValidity;
  reasons: string[];
}

export type BenchmarkPreflightResult =
  | { ok: true; findings: []; warnings: SafetyFinding[]; blockers: [] }
  | { ok: false; findings: SafetyFinding[]; warnings: SafetyFinding[]; blockers: SafetyFinding[] };

export function nonCachedTotal(usage: TokenUsage): number {
  return Math.max(0, usage.totalTokens - usage.cachedInputTokens);
}

export function createBenchmarkManifest(input: BenchmarkManifestInput): BenchmarkManifest {
  const profiles = (input.profiles ?? []).map((id) => {
    const profile = routeProfiles[id];
    if (!profile) throw new Error(`unsupported benchmark route profile: ${id}`);
    return {
      id,
      reasoningEffort: profile.reasoningEffort,
      description: profile.description,
    };
  });
  return {
    schemaVersion: "benchmark_manifest_v1",
    campaignId: requireSafeName(input.campaignId, "campaignId"),
    campaignFamilyId: input.campaignFamilyId ? requireSafeName(input.campaignFamilyId, "campaignFamilyId") : null,
    cohortId: input.cohortId ? requireSafeName(input.cohortId, "cohortId") : null,
    repeatIndex: Number.isInteger(input.repeatIndex) ? input.repeatIndex! : null,
    fixtureId: input.fixtureId ? requireSafeName(input.fixtureId, "fixtureId") : null,
    sanitizedFixtureHash: input.sanitizedFixtureHash ?? null,
    targetStateHash: input.targetStateHash ?? null,
    preflightStatus: input.preflightStatus ?? "not_run",
    target: resolve(input.target),
    targetMode: input.targetMode,
    method: input.method,
    createdAt: new Date().toISOString(),
    profileHash: profiles.length > 0 ? hashJson(profiles) : null,
    profiles,
    notes: input.notes ?? [],
  };
}

export function classifyRunValidity(input: RunValidityInput): RunValidityResult {
  const reasons: string[] = [];
  const missingRoles = input.requiredRoles.filter((role) => !input.executedRoles.includes(role));
  if (missingRoles.length > 0) reasons.push(`missing required roles: ${missingRoles.join(", ")}`);
  if (input.modelDrift) reasons.push("model or reasoning route drifted from manifest");
  if (input.asymmetricOperatorIntervention) reasons.push("operator intervention was asymmetric across methods");
  if (input.contractReconstructedFromFreeform) reasons.push("output contract was reconstructed from freeform text");
  if ((input.usageUnavailableCount ?? 0) > 0) reasons.push("token usage unavailable for at least one worker");
  if (input.stdoutFallbackUsed) reasons.push("stdout exceeded policy and last-message fallback was used");
  if ((input.secretFindingCount ?? 0) > 0) reasons.push("secret-like artifact finding invalidated evidence");
  if (input.artifactLeakDetected) reasons.push("artifact leak detected");
  if (input.outputAuditMode === "none") reasons.push("outputAuditMode none excludes measured comparison");
  if (input.auditCompleteness === "none") reasons.push("audit completeness is none");

  if (
    missingRoles.length > 0 ||
    input.modelDrift ||
    input.asymmetricOperatorIntervention ||
    (input.secretFindingCount ?? 0) > 0 ||
    input.artifactLeakDetected
  ) {
    return { validity: "invalid", reasons };
  }
  if (
    input.contractReconstructedFromFreeform ||
    (input.usageUnavailableCount ?? 0) > 0 ||
    input.stdoutFallbackUsed ||
    input.outputAuditMode === "none" ||
    input.auditCompleteness === "none"
  ) {
    return { validity: "diagnostic_only", reasons };
  }
  return { validity: "valid", reasons };
}

export async function preflightBenchmarkTarget(
  target: string,
  targetMode: BenchmarkTargetMode,
): Promise<BenchmarkPreflightResult> {
  const findings = await scanTargetForSecretLike(resolve(target));
  const blockers = findings.filter((finding) => finding.severity !== "warning");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  if (blockers.length === 0) return { ok: true, findings: [], warnings, blockers: [] };

  return { ok: false, findings: blockers, warnings, blockers };
}

export async function postflightBenchmarkArtifacts(
  artifactRoot: string,
): Promise<{ ok: true; findings: [] } | { ok: false; findings: SafetyFinding[]; validity: "invalid" }> {
  const findings = await scanArtifactRootForSecretLike(resolve(artifactRoot));
  if (findings.length === 0) return { ok: true, findings: [] };
  return { ok: false, findings, validity: "invalid" };
}

function requireSafeName(value: string, name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`${name} contains unsafe characters`);
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
