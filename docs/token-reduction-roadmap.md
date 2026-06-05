# Token Reduction Roadmap

This roadmap focuses on reducing token consumption while preserving the lab's
current safety posture.

The goal is not to run fewer agents at all costs. The goal is to spend expensive
tokens only where they improve the result.

## Current Status

Version `0.1.8` implements the first measurable routing and compaction slice plus
artifact-output audit hardening:

- per-worker usage parsing from Codex JSONL events;
- run-level `aggregateUsage`, `usageUnavailableCount`, and budget status;
- policy-level soft `maxTokens`;
- `budget.spent()` and `budget.remaining()` inside workflow scripts;
- validated `reasoningEffort` routing through `codex exec -c
  model_reasoning_effort=...`;
- deterministic route profiles for `scout`, `reviewer`, `security`, and
  `synthesizer`;
- compact forwarding with closed schemas for scout maps, validation inventories,
  review findings, and final synthesis;
- artifact-visible `model`, `reasoningEffort`, and `profile` fields;
- benchmark preflight and manifest helpers.
- `outputAuditMode` and `capture-metadata.json` so authenticated worker output can be
  metadata-only by default;
- run and agent `validity` fields so contaminated or incomplete evidence is excluded
  from cost/performance claims.

The remaining problem is measurement quality across methods. Dynamic Workflow runs now
produce usage data when Codex emits usage events, but the single-prompt and manual-role
baselines still need the same timing and token instrumentation before strong cost claims
are publishable. The Hermes diagnostic campaign did not show a routed cost win and
surfaced an artifact hygiene failure, so any cost claim must be rerun after the `0.1.8`
output-audit changes.

## Original Problem

The lab has already shown that multi-agent workflows are expensive. The latest
campaigns used several manual agents, failed worker runs, real four-worker runs,
and follow-up fixes. Exact aggregate usage was not available because token usage
was not centrally instrumented.

Until every comparison method is measured per worker and per run, optimization claims
are still partly guesswork.

## Design Principles

1. Measure before optimizing.
2. Keep full artifacts for audit, but feed compact summaries forward.
3. Prefer cheap workers for narrow read-heavy tasks.
4. Escalate model and reasoning only when a step needs it.
5. Verify selectively, not blindly.
6. Reuse completed work when inputs have not changed.
7. Preserve read-only, no-network, no-connector defaults.

## Non-Negotiable Guardrails

Token reduction must not weaken the lab's execution boundary.

- Model and reasoning choices must be allowed by immutable policy before a run
  starts.
- A workflow may request a model or reasoning level only inside the policy
  allow-lists.
- Every selected model and reasoning level must be written to artifacts.
- No worker can introduce its own nested `policy`, tool list, connector access,
  network access, or write escalation.
- Cache and resume must never persist or reuse `HOME`, `CODEX_HOME`, plugins,
  connectors, history, or raw worker transcripts across trust boundaries.
- Redaction is not DLP. Any persisted cache or compressed context must pass a
  stronger artifact scan before it is reused.
- A run with secret-like artifact findings is invalid for benchmark comparison even if
  the worker process completed successfully.
- Metadata-only output is acceptable for authenticated measured runs when the result
  contract, usage data, and postflight artifact scan are clean. It reduces audit
  completeness and must be recorded in the comparison, but it is not diagnostic-only by
  itself.
- Budget controls must be described as implemented behavior only after tests
  prove runtime enforcement.

## Phase 1 - Usage Accounting

Status: implemented in `0.1.6` for Dynamic Workflow runs.

Implementation targets:

- parse `turn.completed.usage` from worker JSONL;
- normalize usage into a stable shape:
  - `inputTokens`;
  - `cachedInputTokens`;
  - `outputTokens`;
  - `reasoningOutputTokens`;
  - `totalTokens`;
- write per-worker usage into `agent-*/result.json`;
- write run-level `aggregateUsage` into `summary.json`;
- include usage in `workflow_status` and `workflow_result`.

Acceptance criteria:

- fake worker tests cover usage parsing;
- real run summaries show non-null usage when Codex emits usage;
- missing usage is represented as `null`, not guessed.

## Phase 2 - Token Budgets

Status: implemented in `0.1.6` as a soft pre-spawn gate.

Implementation targets:

- add `maxTokens` or `budgetTokens` to `WorkflowPolicy`;
- track spent tokens in runtime state;
- before launching a worker, skip it if budget is exhausted;
- record token-budget exhaustion in warnings and events;
- expose remaining budget to workflow scripts through `budget.remaining()`.

Important boundary:

This should start as a soft pre-spawn gate. It should not try to kill an
already-running worker mid-turn until cancellation semantics are better tested.

Acceptance criteria:

- budget exhaustion skips new workers deterministically;
- in-flight workers can finish and may push usage past the soft budget;
- docs clearly call this a soft budget.

## Phase 3 - Model And Reasoning Routing

Status: explicit reasoning routing implemented in `0.1.6`; deterministic route
profiles implemented in `0.1.7`.

Implementation targets:

- reintroduce `reasoningEffort` as a supported `agent()` option;
- validate it against `minimal | low | medium | high`;
- add policy allow-lists for models and reasoning levels;
- pass reasoning to Codex only through a verified Codex CLI/config surface;
- record model, reasoning, and profile in worker artifacts and events.

Policy boundary:

The route is not chosen freely by the worker. It is either declared by the
workflow and accepted by policy, or selected by a deterministic runtime profile
that is itself allowed by policy. Hidden fallbacks are not allowed.

The command-line transport uses Codex config overrides:
`codex exec -c model_reasoning_effort="low" ...`. The repo verifies that
`codex exec` accepts `-c/--config` and unit tests the generated command arguments.
A fresh real multi-worker rerun should still confirm usage behavior against the
currently installed Codex CLI before publishing cost claims.

Initial routing profiles:

| Role | Model | Reasoning | Use |
| --- | --- | --- | --- |
| `scout` | caller-provided mini/cheap model | `low` | file mapping, grep-style exploration, simple summaries |
| `reviewer` | caller-provided default review model | `medium` | bounded read-only review |
| `security` | caller-provided stronger model | `high` | security or correctness-sensitive findings |
| `synthesizer` | caller-provided stronger model | `high` | final synthesis and tradeoffs |

Acceptance criteria:

- routing is explicit and visible in artifacts;
- unsupported reasoning settings are rejected before execution;
- no workflow can bypass policy allow-lists.

## Phase 4 - Structured Output And Compression

Status: first compact forwarding slice implemented in `0.1.7`.

Reduce downstream context by separating audit artifacts from forwarded context.

Implementation targets:

- define compact default schemas for common roles;
- store full logs in artifacts;
- forward only compact JSON summaries to synthesis steps;
- add max summary length per worker;
- add `compact(value, schemaName, maxBytes)` helper with closed schemas.

Acceptance criteria:

- synthesis prompts do not include raw stdout/stderr;
- worker summaries stay under a documented byte/token target;
- full artifacts remain available for audit.

## Phase 5 - Selective Verification

Avoid verifying every raw finding.

Implementation targets:

- add a simple finding schema with `severity`, `confidence`, `evidence`, and
  `needsVerification`;
- deduplicate findings before verification;
- verify only medium/high-risk findings or low-confidence findings;
- run verifiers on cheaper models by default unless the finding is critical.

Acceptance criteria:

- verification worker count is bounded by policy;
- skipped verification is explicit in summary;
- critical findings can escalate to stronger model/reasoning settings.

## Phase 6 - Resume And Cache

Avoid paying twice for identical worker calls.

Implementation targets:

- compute cache keys from prompt, options, workflow source hash, policy hash, and
  relevant repo state;
- reuse completed worker results when keys match;
- add `resumeFromRunId` for workflow scripts;
- record cached workers distinctly from live workers.

Guardrails:

- never cache across different policy hashes;
- never cache if auth mode or writable mode changes;
- make cache hits visible in artifacts;
- prefer opt-in cache at first.
- never persist raw `CODEX_HOME`, raw auth material, connector state, or full
  worker transcripts as cache payloads;
- include repo state in the key, such as `HEAD`, dirty status, or an explicit
  caller-provided input hash;
- treat cache entries as untrusted model output when reusing them.

Acceptance criteria:

- re-running an unchanged workflow can reuse completed workers;
- changed prompts or model/reasoning settings force a live run;
- cached results do not hide prior failures.

## Phase 7 - Warm Context

Evaluate `codex exec resume` only after usage accounting and cache are stable.

Potential value:

- fewer repeated instructions across multi-turn worker stages;
- lower prompt payload in pipelines;
- better continuity for staged investigation.

Risks:

- weaker isolation story;
- inherited session state may surprise users;
- schema handling is harder on resume turns;
- cache keys become less obvious.

Recommendation:

Keep warm context optional and off by default. The lab's default should remain
cold, isolated workers until warm-context behavior is measured.

Warm context must not reuse the parent Codex home or inherit parent config. It
should be treated as an optimization within one trusted run, not as a cross-run
memory system.

## Phase 8 - Measurement Protocol

Status: benchmark preflight, manifest, validity helpers, and postflight artifact
scanning are implemented by `0.1.8`; automated four-method execution remains future
work.

Update the fresh-session test protocol to compare:

- single prompt;
- manual subagents;
- Dynamic Workflow without routing;
- Dynamic Workflow with routing;
- Dynamic Workflow with routing plus budgets/cache.

Required metrics:

- wall-clock duration;
- total tokens;
- reasoning tokens;
- output tokens;
- number of workers launched;
- number of workers skipped by budget;
- number of cached workers;
- process status versus evidence validity;
- audit completeness and secret-suppression counts;
- useful findings;
- weak findings;
- evidence count;
- target repo cleanliness.

Comparison runs should also record the workflow shape used by each method:

- single prompt baseline;
- manual subagents;
- fixed-role Dynamic Workflow;
- routed Dynamic Workflow;
- routed Dynamic Workflow with budget/cache.

## Recommended First Implementation Slice

Start with the smallest slice that makes future decisions measurable:

1. usage parsing and `aggregateUsage` - implemented in `0.1.6`;
2. soft `maxTokens` - implemented in `0.1.6`;
3. validated `reasoningEffort` - implemented in `0.1.6`;
4. artifact-visible model/reasoning settings - implemented in `0.1.6`;
5. deterministic route profiles - implemented in `0.1.7`;
6. compact forwarding - implemented in `0.1.7`;
7. benchmark preflight/manifest/validity helpers - implemented in `0.1.7`;
8. output audit mode, capture metadata, and postflight artifact scan - implemented in
   `0.1.8`;
9. one routed example workflow - implemented in `examples/routed-repo-review.workflow.js`.

Do not start with UI, warm context, or worktree writes. Those are useful, but
they do not solve the current measurement gap first.
