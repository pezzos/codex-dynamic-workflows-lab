---
name: dynamic-workflow
description: Use when the user explicitly asks for bounded Codex workflow orchestration, fan-out, parallel review, or multi-agent workflow scripts.
---

# Dynamic Workflow

Use this skill to author bounded workflow scripts for `codex-flow`.

## Use When

- The user explicitly asks for a workflow, fan-out, parallel agents, or multi-agent
  orchestration.
- The work is decomposable into independent read-heavy tasks.

Do not use for small single-file fixes or ordinary sequential work.

## Workflow Rules

- Write plain JavaScript.
- First statement must be literal `export const meta = { name, description }`.
- Use `phase(title)` for runtime groups.
- Use `parallel()` with thunks: `() => agent(...)`, not already-created promises.
- Give every `agent()` a short unique `label`.
- Include enough context in every worker prompt.
- Prefer structured output schemas for machine-readable findings.
- Add a final synthesis step.
- Keep read-only as the default.
- Do not request connectors, network, recursive workflow calls, or `danger-full-access`.

## MCP Flow

1. Call `workflow_validate` with the script.
2. If validation succeeds, call `workflow_submit` with an immutable read-only policy.
   Submit returns immediately with `status: "submitted"`, `runId`, and `artifactRoot`.
3. Poll `workflow_status` until the run is no longer `submitted` or `running`, then read
   `workflow_result`.
4. Use `workflow_artifacts` only for local artifact metadata.

Unknown `agent()` option keys are rejected. Do not pass worker-level `policy` objects,
`allowedTools`, or per-worker output limits.

Supported low-cost routing options:

- `model`: optional Codex model name, restricted by `policy.allowedModels` when set.
- `reasoningEffort`: optional `minimal`, `low`, `medium`, or `high`, restricted by
  `policy.allowedReasoningEfforts` when set.
- `profile`: optional `scout`, `reviewer`, `security`, or `synthesizer`, restricted by
  `policy.allowedRouteProfiles` when set. Profiles fill a default reasoning effort
  unless the workflow explicitly provides one.
- `compact(value, schemaName, maxBytes)`: compact forwarded context using
  `scout_map`, `validation_inventory`, `review_findings`, or `final_synthesis`.
- `budget.remaining()` and `budget.spent()` are available inside the workflow. The
  `maxTokens` policy is a soft pre-spawn gate: it skips new workers after the budget is
  exhausted, but does not cancel workers already running.
- `policy.outputAuditMode` supports `auto`, `full`, `metadata-only`, and `none`.
  Prefer `auto`; it resolves to `metadata-only` when `secrets: "codex-auth-only"` is
  used. Treat `none` as diagnostic-only and unsuitable for benchmark claims.
- Read `validity`, `validityReasons`, `auditCompleteness`, `stdoutFallbackUsed`, and
  `secretFindingKinds` before using a result in an article or comparison. Process
  completion is not the same thing as evidence validity.
- When a run has secret-like findings, do not quote raw artifacts. Report only finding
  kinds and rotate any credential if the value may have been real.
- Before using a run in a benchmark or article claim, run the artifact postflight scan
  (`benchmark-artifact-scan` in the CLI) and require clean, valid evidence.

## Minimal Script

```js
export const meta = {
  name: "repo_review",
  description: "Run bounded repository review",
}

phase("Review")
const findings = await parallel([
  () => agent("Review architecture.", { label: "architecture", profile: "reviewer" }),
  () => agent("Review tests.", { label: "tests", profile: "reviewer" }),
  () => agent("Review security.", { label: "security", profile: "security" }),
])

phase("Synthesize")
const synthesis = await compact({
  summary: "Review complete.",
  usefulFindings: findings.map((finding) => String(finding).slice(0, 300)),
  weakFindings: [],
  limits: "Inspect per-agent artifacts for full logs.",
}, "final_synthesis", 4000)
return { ok: true, synthesis }
```
