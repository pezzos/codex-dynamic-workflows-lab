import { redactValue } from "./redaction.js";
import { assertExportableSafe } from "./safety.js";
const schemaNames = ["scout_map", "validation_inventory", "review_findings", "final_synthesis"];
export function compactSchemaNames() {
    return [...schemaNames];
}
export function compactValue(value, schemaName, maxBytes) {
    if (!schemaNames.includes(schemaName))
        throw new Error(`unsupported compact schema: ${schemaName}`);
    if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 64_000) {
        throw new Error("compact maxBytes must be an integer between 256 and 64000");
    }
    const redacted = redactValue(value);
    const normalized = normalizeBySchema(redacted, schemaName);
    assertExportableSafe(normalized);
    const byteLength = Buffer.byteLength(JSON.stringify(normalized));
    if (byteLength > maxBytes)
        throw new Error(`compact payload exceeds maxBytes (${byteLength} > ${maxBytes})`);
    return { schemaName, maxBytes, byteLength, value: normalized };
}
function normalizeBySchema(value, schemaName) {
    switch (schemaName) {
        case "scout_map":
            return normalizeScoutMap(value);
        case "validation_inventory":
            return normalizeValidationInventory(value);
        case "review_findings":
            return normalizeReviewFindings(value);
        case "final_synthesis":
            return normalizeFinalSynthesis(value);
    }
}
function normalizeScoutMap(value) {
    const object = requireObject(value, "scout_map");
    return {
        summary: shortString(object.summary, "summary", 600),
        files: arrayOf(object.files, "files", 20, (item) => {
            const file = requireObject(item, "files[]");
            return {
                path: safePath(file.path, "files[].path"),
                why: shortString(file.why, "files[].why", 300),
            };
        }),
        limits: optionalShortString(object.limits, "limits", 500) ?? "",
    };
}
function normalizeValidationInventory(value) {
    const object = requireObject(value, "validation_inventory");
    return {
        commands: arrayOf(object.commands, "commands", 20, (item) => {
            const command = requireObject(item, "commands[]");
            return {
                command: shortString(command.command, "commands[].command", 220),
                purpose: shortString(command.purpose, "commands[].purpose", 300),
                evidence: shortString(command.evidence, "commands[].evidence", 300),
            };
        }),
        gaps: arrayOf(object.gaps ?? [], "gaps", 10, (item) => shortString(item, "gaps[]", 300)),
    };
}
function normalizeReviewFindings(value) {
    const object = requireObject(value, "review_findings");
    return {
        findings: arrayOf(object.findings, "findings", 10, (item) => {
            const finding = requireObject(item, "findings[]");
            return {
                area: shortString(finding.area, "findings[].area", 80),
                severity: enumString(finding.severity, "findings[].severity", ["low", "medium", "high", "critical"]),
                confidence: enumString(finding.confidence, "findings[].confidence", ["low", "medium", "high"]),
                summary: shortString(finding.summary, "findings[].summary", 600),
                evidenceRefs: arrayOf(finding.evidenceRefs, "findings[].evidenceRefs", 5, (ref) => {
                    const evidence = requireObject(ref, "evidenceRefs[]");
                    return {
                        file: safePath(evidence.file, "evidenceRefs[].file"),
                        line: optionalInteger(evidence.line, "evidenceRefs[].line") ?? null,
                        note: optionalShortString(evidence.note, "evidenceRefs[].note", 220) ?? "",
                    };
                }),
                actionability: shortString(finding.actionability, "findings[].actionability", 300),
                needsVerification: Boolean(finding.needsVerification),
                weak: Boolean(finding.weak),
            };
        }),
    };
}
function normalizeFinalSynthesis(value) {
    const object = requireObject(value, "final_synthesis");
    return {
        summary: shortString(object.summary, "summary", 900),
        usefulFindings: arrayOf(object.usefulFindings, "usefulFindings", 10, (item) => shortString(item, "usefulFindings[]", 400)),
        weakFindings: arrayOf(object.weakFindings ?? [], "weakFindings", 10, (item) => shortString(item, "weakFindings[]", 300)),
        limits: optionalShortString(object.limits, "limits", 600) ?? "",
    };
}
function requireObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${name} must be an object`);
    return value;
}
function shortString(value, name, maxLength) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`${name} must be a non-empty string`);
    if (value.length > maxLength)
        throw new Error(`${name} exceeds ${maxLength} characters`);
    if (/raw_output|base64|BEGIN [A-Z ]*PRIVATE KEY/i.test(value))
        throw new Error(`${name} contains forbidden exportable content`);
    return value;
}
function optionalShortString(value, name, maxLength) {
    if (value === undefined || value === null)
        return undefined;
    return shortString(value, name, maxLength);
}
function safePath(value, name) {
    const path = shortString(value, name, 240);
    if (path.startsWith("/") || path.includes("..") || /(^|\/)(auth\.json|\.env)/i.test(path)) {
        throw new Error(`${name} must be a relative non-secret path`);
    }
    return path;
}
function optionalInteger(value, name) {
    if (value === undefined || value === null)
        return undefined;
    if (!Number.isInteger(value) || Number(value) < 1)
        throw new Error(`${name} must be a positive integer`);
    return Number(value);
}
function enumString(value, name, values) {
    if (typeof value !== "string" || !values.includes(value))
        throw new Error(`${name} must be one of ${values.join(", ")}`);
    return value;
}
function arrayOf(value, name, maxLength, mapper) {
    if (!Array.isArray(value))
        throw new Error(`${name} must be an array`);
    if (value.length > maxLength)
        throw new Error(`${name} exceeds ${maxLength} items`);
    return value.map(mapper);
}
