# Codex Dynamic Workflows Lab

Experimental Codex plugin for bounded local dynamic workflows.

The prototype turns a deterministic JavaScript workflow into bounded `codex exec`
workers, then records local artifacts for review. It is inspired by Claude Code Dynamic
Workflows and by `Michaelliv/pi-dynamic-workflows`, but it does not recreate Claude Code
internals.

## Status

- Current version: `0.1.12`
- Plugin: Codex marketplace-ready experimental lab
- Public-safety status: published as an experimental reader-facing lab artifact
- Project activity: paused after the `0.1.12` Hermes diagnostic because real
  multi-agent campaigns are currently too token-heavy for blind iteration
- Real workers: authenticated read-only `codex exec` smoke and one four-worker
  comparative campaign have completed
- Writes: read-only by default; write mode is not validated for production use
- Network/connectors: disabled in policy
- Token/cost status: multi-agent campaigns are expensive; per-worker usage,
  run-level `aggregateUsage`, soft `maxTokens`, deterministic route profiles,
  compact context forwarding, and benchmark preflight/manifest helpers are now
  implemented, but the latest measured diagnostic campaign did not prove a routed
  token-cost win
- Artifact hygiene: worker stdout/stderr/events/last-message outputs are now audited
  before persistence or return; secret-like worker output is replaced by metadata and
  invalidates evidence validity

## Install

```bash
npm install
npm run build
npm run plugin:validate
```

## Install from a local Codex marketplace

This repository includes a repo-local marketplace catalog at
`.agents/plugins/marketplace.json`. From the parent directory, add this folder as a
local marketplace:

```bash
codex plugin marketplace add ./codex-dynamic-workflows-lab
```

Then restart Codex, open the plugin directory, select the
`codex-dynamic-workflows-lab` marketplace, and install **Codex Dynamic Workflows Lab**.

The marketplace entry points at the bundled plugin directory with
`source.path: "./plugins/codex-dynamic-workflows-lab"`. The plugin manifest lives at
`plugins/codex-dynamic-workflows-lab/.codex-plugin/plugin.json` and declares:

- the `dynamic-workflow` skill under `skills/`;
- the local stdio MCP server in `.mcp.json`;
- marketplace interface metadata for Codex plugin browsers.

## Publish through a Git-backed marketplace

Push this folder to the public repository, then add it as a marketplace source:

```bash
codex plugin marketplace add pezzos/codex-dynamic-workflows-lab --ref main
```

If the marketplace lives in a larger repository, use a sparse path that contains this
folder:

```bash
codex plugin marketplace add owner/plugins-repo --ref main --sparse path/to/marketplace-root
```

Run the validation suite before publishing updates:

```bash
npm run check
npm run plugin:validate
npm run pack:dry
```

`dist/` is intentionally tracked for Git marketplace distribution. The plugin MCP server
uses the bundled `dist/plugin/mcp-server.js`, so a Codex marketplace clone can start the
server without running `npm install` first.

## Run offline with fake Codex

```bash
npm test
node dist/src/cli.js validate examples/repo-review.workflow.js
node dist/src/cli.js run examples/repo-review.workflow.js --fake
node dist/src/cli.js validate examples/routed-repo-review.workflow.js
```

Artifacts are written under `.codex-workflows/runs/<run-id>/`.

## Test campaigns

Use `docs/fresh-session-test-protocol.md` to delegate a full validation campaign to a
fresh Codex session. The protocol includes deterministic function tests, comparative
prompts for normal Codex versus manual multi-agent versus Dynamic Workflow runs, and
read-only safety probes for article evidence.

Current campaign evidence:

- Wave 2 deterministic validation passes for CLI validation, fake runs,
  `npm run plugin:validate`, deterministic-guard probes, policy rejection, and strict
  worker option validation.
- A real four-worker Dynamic Workflow review of `BannerGenerator` completed in
  185,635 ms and wrote 27 local artifact files under the lab artifact root while leaving
  the target repo clean.
- In that campaign, Dynamic Workflow produced the strongest traceability and
  reproducibility evidence. Manual multi-agent review remains a strong quality baseline,
  so the current claim is traceability/repeatability, not general analysis superiority.
- The campaign surfaced practical findings in the target repo: tracked
  `.codex-browser/auth.json` risk, local ignored `.env` files, incomplete `make` test
  coverage for frontend/backend suites, large coordination modules, and documentation
  drift.
- Token use was high across failed campaigns, manual comparison agents, real multi-worker
  runs, and fixes. Version `0.1.7` adds route profiles, compact forwarding, and
  benchmark helpers, but the single-prompt, manual-role, classic workflow, and routed
  workflow baselines still need centrally instrumented reruns before publishing
  comparative cost claims.
- A later Hermes diagnostic campaign found a P0 artifact hygiene issue: a worker stdout
  log contained a local API-key-shaped value. Version `0.1.8` changes worker output
  capture so raw stdout/stderr/events/last-message data is kept in memory until audited;
  suspicious output is suppressed, a `capture-metadata.json` sidecar is written, and
  the run is marked `invalid` rather than comparable. This Hermes run is
  failure-analysis evidence, not benchmark evidence; do not publish a routed cost claim
  or rerun Hermes for comparison until the incident has been handled and the rerun
  yields `valid` evidence.

## Token Controls

Version `0.1.8` includes the first two token-reduction slices plus output-audit
hardening:

- per-worker `usage` is parsed from Codex JSONL `turn.completed.usage` events when
  Codex emits it;
- run-level `aggregateUsage`, `usageUnavailableCount`, and `budget` are written to
  `summary.json` and returned by workflow results;
- `policy.maxTokens` acts as a soft pre-spawn budget gate. It skips new workers after
  the budget is exhausted, but lets already-running workers finish;
- `agent(..., { reasoningEffort })` supports `minimal`, `low`, `medium`, and `high`;
- `policy.allowedReasoningEfforts` can restrict which reasoning levels a workflow may
  request;
- `agent(..., { profile })` supports deterministic `scout`, `reviewer`, `security`,
  and `synthesizer` profiles;
- `policy.allowedRouteProfiles` can restrict which profiles a workflow may request;
- `compact(value, schemaName, maxBytes)` writes bounded compact payloads for
  `scout_map`, `validation_inventory`, `review_findings`, and `final_synthesis`;
- `benchmark-preflight` fails closed on secret-like target paths or values before a
  measured campaign;
- target preflight distinguishes blocking secret surfaces from informational warnings,
  so auth-heavy repos can still be benchmarked when they only contain examples,
  redaction patterns, or OAuth-related code;
- `benchmark-manifest` records method, target mode, and route-profile identity for
  comparable runs;
- `benchmark-artifact-scan` performs a post-run scan of generated artifact trees and
  fails closed on secret-like persisted values;
- selected `model` and `reasoningEffort` are recorded in `command.json` and
  `result.json`; selected `profile` is recorded in runner artifacts and events.
- `policy.outputAuditMode` supports `auto`, `full`, `metadata-only`, and `none`.
  `auto` resolves to `metadata-only` when `secrets: "codex-auth-only"` is used, so
  authenticated worker free-form output is not persisted by default.
- `capture-metadata.json` records byte counts, SHA-256 digests, parsed-event counts,
  usage source, result source, audit completeness, validity, and suppression reasons.
- Codex `-o` last-message output is written to a temporary directory outside the
  artifact tree, then copied into artifacts only after audit.
- `metadata_only` audit completeness is benchmark-eligible when result contract, usage
  data, validity, and postflight artifact scan are clean. It must be reported as a
  reduced audit surface, but it is not diagnostic-only by itself.
- `summary.json` now separates process completion from evidence validity through
  `validity`, `validityReasons`, `invalidAgentCount`, `diagnosticAgentCount`,
  `metadataOnlyAuditCount`, and secret-suppression counters.
- when workflow artifacts are stored outside the target repository, `summary.json`
  records `targetGitStatusBefore`, `targetGitStatusAfter`,
  `targetGitStatusChanged`, and `targetGitStatusGuardActive` so benchmark runs can
  detect unexpected target worktree drift.
- the stock classic and routed examples now pass JSON schemas to workers and forbid
  source excerpts, literal secret values, and assignment right-hand-side values in
  worker findings.

The routed example is validation-friendly and accepts model names through `args`, so
users can choose the Codex models available in their own environment:

```bash
node dist/src/cli.js run examples/routed-repo-review.workflow.js --fake
```

For measured real-repo comparisons, pass a bounded scope through `--args` and keep the
artifact root outside the target repository. A run is not benchmark evidence unless
`validity` is `valid`, usage is complete, no stdout fallback was used, postflight
artifact scan is clean, and `targetGitStatusChanged` is false. The next campaign should
also set an explicit token budget and stop as soon as the run becomes invalid.

Useful benchmark helpers:

```bash
node dist/src/cli.js benchmark-preflight /path/to/repo --target-mode real_repo
node dist/src/cli.js benchmark-manifest /path/to/repo --campaign-id dwave-pilot --method workflow-routed --profile scout --profile reviewer
```

## Comparison And Roadmap

- [`docs/ultracode-gap-map.md`](docs/ultracode-gap-map.md) records what this lab
  currently lacks compared with Ultracode.
- [`docs/lab-differentiators.md`](docs/lab-differentiators.md) records what this lab
  adds through its MCP-first, policy-first boundary.
- [`docs/token-reduction-roadmap.md`](docs/token-reduction-roadmap.md) outlines the
  proposed path for reducing token consumption without dropping the safety posture.
- [`docs/route-profiles.md`](docs/route-profiles.md) documents deterministic route
  profiles.
- [`docs/compact-forwarding-contract.md`](docs/compact-forwarding-contract.md)
  documents compact context forwarding.
- [`docs/benchmark-harness.md`](docs/benchmark-harness.md) documents the preflight,
  manifest, and run-validity rules.
- [`docs/common-review-output-contract.md`](docs/common-review-output-contract.md)
  documents the normalized review contract for comparisons.
- [`docs/routed-quality-equivalence.md`](docs/routed-quality-equivalence.md) documents
  how routed runs should be judged before making cost claims.

## MCP server

The package exposes a stdio MCP server:

```bash
node dist/src/cli.js server
```

The plugin manifest also exposes this server through `.mcp.json` as
`codex-dynamic-workflows`. The marketplace path uses the bundled server at
`dist/plugin/mcp-server.js`.

Current tools:

- `workflow_validate`
- `workflow_submit`
- `workflow_status`
- `workflow_result`
- `workflow_cancel`
- `workflow_artifacts`

`workflow_submit` is intentionally non-blocking. It writes a durable run status and
starts the workflow in a detached local job, then returns `runId`, `status: "submitted"`,
and `artifactRoot`. Use `workflow_status` while the run is active and
`workflow_result` once `summary.json` exists. This avoids Codex app tool-call timeouts
on long multi-worker runs.

## Safety model

The runtime enforces an immutable policy outside the worker. The MVP defaults to:

- read-only sandbox;
- no network;
- no connectors;
- no `danger-full-access`;
- scrubbed worker environment;
- temporary `HOME`;
- isolated `CODEX_HOME`;
- optional `secrets: "codex-auth-only"` mode that copies only `auth.json` from the
  parent Codex home into the temporary worker `CODEX_HOME`;
- bounded max agents, concurrency, duration, and output size.
- output auditing before worker free-form data is persisted or returned.

Workflow validation rejects unknown `agent()` option keys, including worker-level
`policy` objects. Per-worker policy widening is unsupported; use the top-level workflow
policy and the supported `sandbox`, `writeScope`, `model`, and `timeoutMs` options only.

`codex-auth-only` resolves the parent Codex home from `CODEX_HOME` when set, otherwise
from `$HOME/.codex`. It rejects symlinked or non-regular `auth.json` files, copies only
that file into the worker's temporary `CODEX_HOME`, sets the copied file to `0600`, and
removes the worker temp homes after the run. It does not copy parent Codex config,
plugins, connectors, caches, or history.

This is config-minimal, not a guarantee that secrets cannot be exposed. Version `0.1.8`
adds a fail-closed artifact hygiene layer for common secret-shaped output patterns, but
that is not a formal DLP system. A malicious workflow or prompt-injected worker that can
read its own `CODEX_HOME` could still try to print credentials; suspicious output should
make the evidence invalid and should trigger credential rotation if the value was real.
Use `codex-auth-only` only for trusted local workflows and treat the copied `auth.json`
as a password-equivalent secret.

This is still a lab. Do not use it for autonomous write-heavy workflows or public
resource actions.

Target preflight is intentionally practical rather than exhaustive. It blocks likely
real secret files such as `.env`, `auth.json`, and private-key files; it reports
`.env.example`, `.envrc`, code-level auth/token patterns, and redaction fixtures as
warnings. Generated artifact scans remain strict and fail closed.

## Unverified paths

These branches are not validated yet:

- write mode in isolated worktrees;
- repeat comparative multi-worker campaigns through the detached
  `workflow_submit` plus polling contract;
- process-tree termination for worker children and grandchildren;
- exhaustive formal DLP beyond the implemented secret-pattern suppression layer;
- strict duration and token accounting across single prompt, manual roles, and Dynamic
  Workflow comparison runs;
- measured cost and quality comparison for routed workflows using `profile` and
  `compact`;

## Related article

This repository is the evidence artifact for the Project Pezzos article about adapting
Claude Code-style Dynamic Workflows to Codex surfaces:
https://project-pezzos.com/journal/codex-dynamic-workflows-plugin-lab/

The article is intentionally conservative: the lab has real read-only worker evidence and
strong traceability evidence, but it is not presented as production-ready automation.

## What this plugin is not

- Not a production-ready autonomous workflow system.
- Not an official OpenAI tool.
- Not a safe replacement for human review.
- Not a reason to expose local Codex resources publicly.
