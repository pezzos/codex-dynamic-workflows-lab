# Ultracode Gap Map

This document records the main capabilities that `codex-dynamic-workflows-lab`
does not currently have when compared with
[`just-every/plugin-ultracode`](https://github.com/just-every/plugin-ultracode).

It is not a commitment to copy every feature. Some gaps are useful future work;
others are intentionally outside this lab's current safety posture.

## Current Position

`codex-dynamic-workflows-lab` is a bounded, MCP-first lab for read-only Codex
worker orchestration. It prioritizes explicit policy, isolated worker auth,
local artifacts, deterministic validation, and conservative claims.

Ultracode is a broader interactive orchestration product. It provides a larger
CLI surface, a live dashboard, richer workflow primitives, automatic routing,
resume paths, and workflow libraries.

## Comparison Methodology

This comparison should stay normalized across the same dimensions:

- runtime surface: CLI, MCP, plugin skill, dashboard, or app-server transport;
- workflow shape: task fan-out, worker panel, DAG, imperative script, pipeline,
  saved workflow, or compatibility layer;
- worker contract: sandbox, auth, model, reasoning, schema, timeout, and output
  limits;
- lifecycle: submit, status, cancel, resume, retry, cache, update, and cleanup;
- evidence: prompts, commands, logs, usage, policy hash, artifacts, and summary;
- cost controls: usage accounting, budget gates, routing, compression, and cache;
- safety posture: policy widening, secret handling, DLP, write mode, and
  connector/network boundaries.

Without those dimensions, it is too easy to compare a product feature in one
repo against a safety boundary in the other and draw the wrong conclusion.

## Missing Or Not Yet Implemented

### 1. Token And Usage Accounting

Basic Dynamic Workflow usage accounting is implemented in `0.1.6`. The lab parses
Codex JSONL `turn.completed.usage` events, writes per-worker `usage`, and writes
run-level `aggregateUsage`, `usageUnavailableCount`, and `budget` fields.

Remaining gaps:

- comparison reports that show cost by method, role, phase, and model.
- real reruns proving the usage contract across current Codex CLI versions.

### 2. Budget Gates

Basic budget gates are implemented in `0.1.6`. The top-level policy supports
`maxTokens`; the runtime exposes `budget.spent()` and `budget.remaining()`; new
workers are skipped once the soft budget is exhausted.

Remaining gaps:

- hard cancellation of already-running workers;
- richer budget display and method-level comparison reports.

### 3. Model And Reasoning Routing

The lab supports a per-worker `model` option and an `allowedModels` policy list.
Version `0.1.6` adds per-worker `reasoningEffort`, policy allow-lists, and
artifact-visible routing fields.

Remaining gaps:

- built-in role profiles such as scout, verifier, security reviewer, and
  synthesizer;
- simple routing rules that prefer cheaper models for narrow workers and reserve
  expensive models for hard reasoning or synthesis;
- run artifacts that explain why a model/reasoning pair was selected, not only
  what was selected.

### 4. Warm Context, Resume, And Cache

The lab intentionally runs isolated Codex workers. It does not yet reuse Codex
sessions or cache previous worker results.

Missing pieces:

- `codex exec resume` support;
- deterministic cache keys for prompt + options + repo state;
- stage-level resume after partial failure;
- cache invalidation rules;
- explicit distinction between cold isolated execution and warm-context
  optimization.

### 5. Rich Workflow Primitives

The lab currently exposes `agent`, `parallel`, `pipeline`, `phase`, `log`, and a
small runtime context.

Missing pieces:

- declarative `steps[]` DAGs;
- built-in `fanout`;
- built-in `dag`;
- `loopUntilDry`;
- adversarial verification;
- judge panels;
- completeness critics;
- multi-modal sweeps;
- saved workflow definitions.

### 6. Live UI

The lab has durable artifact files and MCP polling, but no live dashboard.

Missing pieces:

- run list;
- worker graph;
- phase visualization;
- live stdout/stderr tail;
- worker detail panel;
- model/reasoning display;
- failure and retry visibility;
- artifact browser.

This is not a near-term priority for the lab, but it is a real product gap
compared with Ultracode.

### 6.1 Observability Detail

Even without a full UI, the lab could improve status readability.

Missing pieces:

- concise run timeline;
- phase-level progress;
- worker count by status;
- model/reasoning display;
- usage totals once implemented;
- warnings grouped by cause;
- direct links or paths to key artifacts.

### 7. Worktree Write Mode

The lab has a `write-worktree` policy shape, but write mode is not validated for
production use.

Missing pieces:

- isolated git worktree creation;
- patch collection per worker;
- merge/review flow;
- cleanup and rollback;
- tests proving target repo cleanliness after worker failures.

### 8. App-Server Transport

The lab uses `codex exec` workers and an MCP server. It does not implement an
optional `codex app-server` worker transport.

Missing pieces:

- app-server JSON-RPC client;
- usage normalization from app-server events;
- fallback from app-server to exec;
- explicit transport policy.

### 9. Workflow Library And Claude Compatibility

The lab can validate and run workflow scripts, but it does not provide a
workflow library or Claude workflow compatibility layer.

Missing pieces:

- `workflow list/show/save/update/delete`;
- saved project or user workflow definitions;
- `.claude/workflows` import/compatibility;
- compatibility checks for unsupported Claude APIs.

### 10. Auto-Update Flow

The lab can be installed through a Codex marketplace, but it does not
auto-refresh itself from the marketplace before commands.

Missing pieces:

- throttled plugin marketplace upgrade;
- safe no-op behavior when offline;
- clear current-session versus future-session update semantics.

## Boundaries

Not every gap should be closed immediately. The lab's strongest current value is
not feature breadth. It is a controlled execution boundary:

- read-only first;
- no network;
- no connectors;
- isolated auth;
- explicit artifacts;
- deterministic workflow validation;
- documented evidence and limitations.

Any parity feature should preserve that boundary before it is accepted.
