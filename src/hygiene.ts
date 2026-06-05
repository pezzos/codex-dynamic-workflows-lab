import { createHash } from "node:crypto";
import { redactText, redactValue } from "./redaction.js";
import { scanExportableText, scanExportableValue, type SafetyFinding } from "./safety.js";
import type {
  AuditCompleteness,
  EvidenceValidity,
  OutputAuditMode,
  ResolvedOutputAuditMode,
  WorkflowPolicy,
} from "./types.js";

export interface SanitizedText {
  text: string;
  findings: SafetyFinding[];
  secretFindingKinds: string[];
  suppressed: boolean;
}

export interface SanitizedValue {
  value: unknown;
  findings: SafetyFinding[];
  secretFindingKinds: string[];
  suppressed: boolean;
}

export interface ArtifactHygiene {
  sanitizeText(surface: string, value: string): SanitizedText;
  sanitizeValue(surface: string, value: unknown): SanitizedValue;
}

export function resolveOutputAuditMode(policy: WorkflowPolicy): ResolvedOutputAuditMode {
  if (policy.outputAuditMode === "auto") {
    return policy.secrets === "codex-auth-only" ? "metadata-only" : "full";
  }
  return policy.outputAuditMode;
}

export function auditCompletenessForMode(mode: ResolvedOutputAuditMode): AuditCompleteness {
  if (mode === "metadata-only") return "metadata_only";
  return mode;
}

export function createArtifactHygiene(policy: WorkflowPolicy): ArtifactHygiene {
  const resolved = resolveOutputAuditMode(policy);
  return {
    sanitizeText(surface, value) {
      return sanitizeText(surface, value, { suppressOnSecret: resolved !== "full" });
    },
    sanitizeValue(surface, value) {
      return sanitizeValue(surface, value, { suppressOnSecret: resolved !== "full" });
    },
  };
}

export function sanitizeText(
  surface: string,
  value: string,
  options: { suppressOnSecret?: boolean } = {},
): SanitizedText {
  const redacted = redactText(value);
  const findings = mergeFindings(scanExportableText(value, surface), scanExportableText(redacted, surface));
  const secretFindingKinds = findingKinds(findings);
  if (findings.length > 0 && options.suppressOnSecret) {
    return {
      text: JSON.stringify(secretSentinel(surface, findings), null, 2),
      findings,
      secretFindingKinds,
      suppressed: true,
    };
  }
  return {
    text: findings.length > 0 ? JSON.stringify(secretSentinel(surface, findings), null, 2) : redacted,
    findings,
    secretFindingKinds,
    suppressed: findings.length > 0,
  };
}

export function sanitizeValue(
  surface: string,
  value: unknown,
  options: { suppressOnSecret?: boolean } = {},
): SanitizedValue {
  const redacted = redactValue(value);
  const findings = mergeFindings(scanExportableValue(value), scanExportableValue(redacted)).map((finding) => ({
    ...finding,
    path: finding.path ?? surface,
  }));
  const secretFindingKinds = findingKinds(findings);
  if (findings.length > 0 && options.suppressOnSecret) {
    return {
      value: secretSentinel(surface, findings),
      findings,
      secretFindingKinds,
      suppressed: true,
    };
  }
  return {
    value: findings.length > 0 ? secretSentinel(surface, findings) : redacted,
    findings,
    secretFindingKinds,
    suppressed: findings.length > 0,
  };
}

export function sanitizeForReturn(value: unknown, surface = "return"): unknown {
  return sanitizeValue(surface, value, { suppressOnSecret: true }).value;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeText("error", message, { suppressOnSecret: true }).text;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function findingKinds(findings: SafetyFinding[]): string[] {
  return [...new Set(findings.map((finding) => finding.kind))].sort();
}

export function secretSentinel(surface: string, findings: SafetyFinding[]): Record<string, unknown> {
  return {
    suppressed: true,
    reason: "secret_like_content",
    surface,
    findingKinds: findingKinds(findings),
  };
}

export function mergeValidity(values: EvidenceValidity[]): EvidenceValidity {
  if (values.includes("invalid")) return "invalid";
  if (values.includes("diagnostic_only")) return "diagnostic_only";
  return "valid";
}

export function validityFromReasons(reasons: string[]): EvidenceValidity {
  if (reasons.some((reason) => reason.includes("secret-like"))) return "invalid";
  if (reasons.length > 0) return "diagnostic_only";
  return "valid";
}

function mergeFindings(...groups: SafetyFinding[][]): SafetyFinding[] {
  const seen = new Set<string>();
  const merged: SafetyFinding[] = [];
  for (const finding of groups.flat()) {
    const key = `${finding.kind}:${finding.path ?? ""}:${finding.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}
