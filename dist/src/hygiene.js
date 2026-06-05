import { createHash } from "node:crypto";
import { redactText, redactValue } from "./redaction.js";
import { scanExportableText, scanExportableValue } from "./safety.js";
export function resolveOutputAuditMode(policy) {
    if (policy.outputAuditMode === "auto") {
        return policy.secrets === "codex-auth-only" ? "metadata-only" : "full";
    }
    return policy.outputAuditMode;
}
export function auditCompletenessForMode(mode) {
    if (mode === "metadata-only")
        return "metadata_only";
    return mode;
}
export function createArtifactHygiene(policy) {
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
export function sanitizeText(surface, value, options = {}) {
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
export function sanitizeValue(surface, value, options = {}) {
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
export function sanitizeForReturn(value, surface = "return") {
    return sanitizeValue(surface, value, { suppressOnSecret: true }).value;
}
export function safeErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    return sanitizeText("error", message, { suppressOnSecret: true }).text;
}
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function findingKinds(findings) {
    return [...new Set(findings.map((finding) => finding.kind))].sort();
}
export function secretSentinel(surface, findings) {
    return {
        suppressed: true,
        reason: "secret_like_content",
        surface,
        findingKinds: findingKinds(findings),
    };
}
export function mergeValidity(values) {
    if (values.includes("invalid"))
        return "invalid";
    if (values.includes("diagnostic_only"))
        return "diagnostic_only";
    return "valid";
}
export function validityFromReasons(reasons) {
    if (reasons.some((reason) => reason.includes("secret-like")))
        return "invalid";
    if (reasons.length > 0)
        return "diagnostic_only";
    return "valid";
}
function mergeFindings(...groups) {
    const seen = new Set();
    const merged = [];
    for (const finding of groups.flat()) {
        const key = `${finding.kind}:${finding.path ?? ""}:${finding.detail}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(finding);
    }
    return merged;
}
