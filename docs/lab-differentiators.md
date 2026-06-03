# What This Lab Adds

This document records what `codex-dynamic-workflows-lab` contributes beyond a
general Ultracode-style workflow engine.

It is useful material for README updates, article revisions, and short Reddit
replies where the distinction needs to stay clear and non-promotional.

## Core Difference

Ultracode is broader and more productized. This lab is narrower and more
conservative.

The lab is not trying to win on UI, scale, or workflow richness today. It is
trying to answer a smaller question:

Can Codex run bounded local dynamic workflows through public surfaces while
keeping policy, auth, artifacts, and evidence explicit?

## What The Lab Adds

### 1. MCP-First Job Boundary

The lab exposes a stdio MCP server with:

- `workflow_validate`;
- `workflow_submit`;
- `workflow_status`;
- `workflow_result`;
- `workflow_cancel`;
- `workflow_artifacts`.

`workflow_submit` is intentionally detached. It returns a `runId` quickly and
lets the caller poll status/result later. This fits Codex app tool-call limits
better than a single blocking command for long multi-worker runs.

### 2. Explicit Artifact Root

MCP submits require an explicit artifact root outside the target repository.

That makes the run easier to audit and avoids writing `.codex-workflows` into
the repo being reviewed. The target repo should stay clean during read-only
campaigns.

### 3. Immutable External Policy

The workflow script is not the authority. It is an execution request under a
normalized policy.

The default policy rejects:

- network access;
- connectors;
- `danger-full-access`;
- writable roots under read-only mode;
- worker-level policy widening;
- unsupported worker options.

This is intentionally stricter than a general-purpose workflow tool.

### 4. Isolated Worker Auth

The `codex-auth-only` mode copies only `auth.json` into a temporary worker
`CODEX_HOME`.

It does not copy:

- parent Codex config;
- plugins;
- MCP configs;
- connector settings;
- caches;
- history.

The copied `auth.json` is set to `0600`, symlinked auth files are rejected, and
temporary worker homes are removed after execution.

This is still not secret-safe against a malicious worker that can read its own
temporary `CODEX_HOME`, but it is config-minimal by design.

### 5. Artifact Redaction

The lab redacts secret-shaped values in worker stdout, stderr, parsed events,
runner results, workflow logs, warnings, agent result files, and summary output.

This is not a formal DLP guarantee, but it is already part of the runtime rather
than only a reporting convention.

### 6. Deterministic Script Validation

The workflow parser rejects nondeterministic or unsafe constructs before
execution, including common escape hatches and unsupported agent options.

This helps make a workflow script reviewable before it launches workers.

### 7. Evidence Ledger

`RESULTATS.md` records:

- what was tested;
- what failed;
- what was fixed;
- what remains unverified;
- what can be claimed publicly;
- where the evidence is weak.

This is less polished than a dashboard, but it is useful for public lab work
where claims should stay tied to observed runs.

### 8. Conservative Published Claim

The lab does not currently claim:

- production readiness;
- general analysis superiority;
- lower token cost;
- safe autonomous writes;
- connector-safe execution;
- complete DLP protection.

The defensible claim is narrower: traceability and repeatability for bounded
read-only multi-agent Codex workflows.

## Short Reddit Reply Material

Possible reply shape:

> Your project is much more complete on the workflow/product side: dashboard,
> DAGs, budgets, resume, model/reasoning knobs, and richer verification
> patterns. Mine is much smaller and more conservative. The part I focused on
> was the MCP/job boundary and safety model: detached `workflow_submit`, explicit
> artifact roots outside the target repo, no network/connectors, isolated
> `CODEX_HOME`, `codex-auth-only`, redacted artifacts, and a public evidence
> ledger. I think the useful next step for my lab is to borrow the cost-control
> ideas: usage accounting, token budgets, model/reasoning routing, output
> compression, and resume/cache, while keeping the stricter policy boundary.

## Product Positioning

If both projects continue, they do not need to be framed as duplicates.

Ultracode is closer to an interactive workflow product.

This lab is closer to a policy-first, MCP-callable experiment for auditable
local Codex worker runs.

