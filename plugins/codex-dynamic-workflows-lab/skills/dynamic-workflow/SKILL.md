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
3. Poll `workflow_status` or read `workflow_result`.
4. Use `workflow_artifacts` only for local artifact metadata.

## Minimal Script

```js
export const meta = {
  name: "repo_review",
  description: "Run bounded repository review",
}

phase("Review")
const findings = await parallel([
  () => agent("Review architecture.", { label: "architecture" }),
  () => agent("Review tests.", { label: "tests" }),
  () => agent("Review security.", { label: "security" }),
])

phase("Synthesize")
return { ok: true, findings }
```
