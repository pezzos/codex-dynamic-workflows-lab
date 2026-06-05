import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const exportablePatterns = [
    ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
    ["bearer_token", /bearer\s+[a-z0-9._~+/-]{20,}/i],
    ["openai_key", /\bsk-[a-zA-Z0-9_-]{20,}\b/],
    ["local_api_key", /\blocal_api_key_[a-zA-Z0-9_-]{12,}\b/i],
    ["jwt", /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/],
    [
        "auth_json_token",
        /"(access_token|refresh_token|id_token|api_key|token|secret)"\s*:\s*"[a-zA-Z0-9._~+/=-]{16,}"/i,
    ],
    ["long_secret_assignment", /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[a-z0-9._~+/-]{16,}/i],
];
const repoPathPatterns = [
    { kind: "env_file", pattern: /(^|\/)\.env($|\.(local|dev|development|prod|production|stage|staging|test)$)/i, severity: "blocker" },
    { kind: "env_example", pattern: /(^|\/)\.env\.(example|sample|template)$/i, severity: "warning" },
    { kind: "envrc", pattern: /(^|\/)\.envrc$/i, severity: "warning" },
    { kind: "auth_json", pattern: /(^|\/)auth\.json$/i, severity: "blocker" },
    { kind: "private_key_file", pattern: /\.(pem|p12|pfx|key)$/i, severity: "blocker" },
];
const ignoredTargetDirs = new Set([
    ".cache",
    ".git",
    ".mypy_cache",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "htmlcov",
    "node_modules",
    "out",
    "playwright-report",
    "venv",
]);
const ignoredTargetExtensions = new Set([
    ".class",
    ".dll",
    ".dylib",
    ".gif",
    ".ico",
    ".jpg",
    ".jpeg",
    ".o",
    ".pdf",
    ".png",
    ".pyc",
    ".pyo",
    ".so",
    ".webp",
]);
export function scanExportableValue(value) {
    return scanExportableText(JSON.stringify(value));
}
export function scanExportableText(text, path) {
    const findings = [];
    for (const [kind, pattern] of exportablePatterns) {
        if (pattern.test(text))
            findings.push({ kind, path, detail: `secret-like ${kind} pattern` });
    }
    return findings;
}
export function assertExportableSafe(value) {
    const findings = scanExportableValue(value);
    if (findings.length > 0) {
        throw new Error(`exportable payload failed secret preflight: ${findings.map((finding) => finding.kind).join(", ")}`);
    }
}
export async function scanTargetForSecretLike(root, options = {}) {
    const maxFiles = options.maxFiles ?? 2_000;
    const maxBytesPerFile = options.maxBytesPerFile ?? 128_000;
    const findings = [];
    let visited = 0;
    async function walk(dir) {
        if (visited >= maxFiles)
            return;
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (visited >= maxFiles)
                return;
            if (ignoredTargetDirs.has(entry.name))
                continue;
            const path = join(dir, entry.name);
            const rel = path.slice(root.length + 1);
            if (entry.isSymbolicLink()) {
                findings.push({ kind: "symlink", path: rel, detail: "symlink in benchmark target" });
                continue;
            }
            if (entry.isDirectory()) {
                await walk(path);
                continue;
            }
            if (!entry.isFile())
                continue;
            if (ignoredTargetExtensions.has(fileExtension(entry.name)))
                continue;
            visited++;
            for (const { kind, pattern, severity } of repoPathPatterns) {
                if (pattern.test(rel))
                    findings.push({ kind, path: rel, detail: `secret-like file path: ${rel}`, severity });
            }
            const stat = await lstat(path).catch(() => undefined);
            if (!stat || stat.size > maxBytesPerFile)
                continue;
            const text = await readFile(path, "utf8").catch(() => "");
            findings.push(...scanExportableText(text, rel).map((finding) => ({
                ...finding,
                severity: "warning",
                detail: `${finding.detail}; target preflight content finding is informational`,
            })));
        }
    }
    await walk(root);
    return findings;
}
function fileExtension(name) {
    const index = name.lastIndexOf(".");
    return index >= 0 ? name.slice(index).toLowerCase() : "";
}
export async function scanArtifactRootForSecretLike(root, options = {}) {
    const maxFiles = options.maxFiles ?? 5_000;
    const maxBytesPerFile = options.maxBytesPerFile ?? 512_000;
    const findings = [];
    let visited = 0;
    async function walk(dir) {
        if (visited >= maxFiles)
            return;
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (visited >= maxFiles)
                return;
            const path = join(dir, entry.name);
            const rel = path.slice(root.length + 1);
            if (entry.isSymbolicLink()) {
                findings.push({ kind: "symlink", path: rel, detail: "symlink in artifact root" });
                continue;
            }
            if (entry.isDirectory()) {
                await walk(path);
                continue;
            }
            if (!entry.isFile())
                continue;
            visited++;
            const stat = await lstat(path).catch(() => undefined);
            if (!stat || stat.size > maxBytesPerFile)
                continue;
            const text = await readFile(path, "utf8").catch(() => "");
            findings.push(...scanExportableText(text, rel));
        }
    }
    await walk(root);
    return findings;
}
