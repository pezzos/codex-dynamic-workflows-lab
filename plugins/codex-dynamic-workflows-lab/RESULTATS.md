# RESULTATS

## Run 2026-06-02 - Local MVP

- `plan_id`: codex-dynamic-workflows-lab
- `plan_version`: 0.1
- `status`: partial
- `public_resources`: GitHub repo `https://github.com/pezzos/codex-dynamic-workflows-lab`
- `external_resources`: none

### Public Repo Review Gate

- `review_status`: approved
- `reviewer`: operator-manual-review
- `review_timestamp`: 2026-06-02T11:45:23+0200
- `review_reason`: public repo creation after local MVP validation
- `reviewed_plan_summary`: publish the local lab at
  `pezzos/codex-dynamic-workflows-lab` with an initial Git commit, create the public
  GitHub repository with `gh repo create pezzos/codex-dynamic-workflows-lab --public`,
  and push `main`. Scope is limited to README, `RESULTATS.md`, TypeScript source,
  tests, example workflow, skill, plugin manifest, and package metadata. No tunnel, DNS,
  Cloudflare, paid service, customer data, production deploy, or durable non-GitHub
  resource is created.
- `rollback`: archive with `gh repo archive pezzos/codex-dynamic-workflows-lab --yes`,
  or delete with `gh repo delete pezzos/codex-dynamic-workflows-lab --yes`, only after
  explicit operator approval.
- `claude_review_status`: blocked; local Claude CLI exists, but organization access to
  Claude Code subscription is disabled.
- `operator_identity`: Pezzos request in Codex thread.
- `material_findings`: publish only as an experimental lab; keep README and article
  caveats that real authenticated Codex workers, write mode, full MCP client execution,
  process-tree kill, and `codex-auth-only` remain unverified.
- `handling`: README and article frame the repo as an experimental evidence artifact,
  not as a production plugin or safe autonomous workflow tool.

### Evidence To Capture

- Runtime parser rejects unsafe workflow shapes.
- Offline fake Codex runner produces deterministic artifacts.
- CLI validates and runs the reference workflow.
- MCP server exposes the expected tools.
- Package builds and test suite passes.
- Security limits remain visible in README and skill.

### Commands

- `npm install`: installed TypeScript, Acorn, and Node types; audit found 0
  vulnerabilities.
- `npm run check`: passed. This ran `tsc`, syntax checks for CLI/MCP outputs, and 10
  offline Node tests.
- `node dist/src/cli.js validate examples/repo-review.workflow.js`: passed and returned
  parsed workflow metadata.
- `node dist/src/cli.js run examples/repo-review.workflow.js --fake`: passed with run
  `repo_review-20260602093411`, 3 fake workers, artifact root
  `.codex-workflows/runs/repo_review-20260602093411`, and expected noisy JSONL warnings.
- `npm run pack:dry`: passed and confirmed tarball includes `dist/`, README,
  `RESULTATS.md`, skill, plugin manifest, and example workflow.
- JSON-RPC smoke with `node dist/src/mcp-server.js`: passed `initialize` and
  `tools/list`; listed `workflow_validate`, `workflow_submit`, `workflow_status`,
  `workflow_result`, `workflow_cancel`, and `workflow_artifacts`.
- `gh repo create pezzos/codex-dynamic-workflows-lab --public --description "Local lab
  prototype for Codex-compatible dynamic workflows" --source=. --remote=origin`: created
  the public GitHub repository.
- `git push -u origin main`: pushed initial commit `1c095f1`.
- `gh repo view pezzos/codex-dynamic-workflows-lab --json nameWithOwner,url,visibility,defaultBranchRef`:
  verified `visibility: PUBLIC` and default branch `main`.

### Verified

- Runtime parser accepts literal metadata and rejects nondeterminism plus common escape
  APIs.
- Fake Codex offline runner produces deterministic artifacts and tolerates noisy JSONL.
- Policy rejects unsupported network and `danger-full-access`.
- Runtime rejects worker attempts to widen read-only policy into `workspace-write`.
- Artifact ids reject path traversal; symlink artifact reads are rejected.
- CLI validates and runs the reference workflow with fake workers.
- MCP stdio server exposes expected tools.
- Package dry run includes code, skill, plugin manifest, README, evidence, and example.
- GitHub repo is public under `pezzos/codex-dynamic-workflows-lab` with default branch
  `main`.

### Not Yet Verified

- Real `codex exec` worker run with local auth.
- Write-mode worktree smoke.
- Full MCP `workflow_submit` call through an actual Codex MCP client.
- Process-tree kill for child and grandchild processes.
- `codex-auth-only` minimum auth copy strategy.

### Article Impact

`needs-more-test`: enough evidence exists for a draft article about the local MVP and
its limits, but not for a strong claim that this is a production-ready Codex Dynamic
Workflows replacement.

## Fix 2026-06-02 - Git marketplace manifest

- `status`: done
- `issue`: `codex plugin marketplace add pezzos/codex-dynamic-workflows-lab` failed
  because the public repository was a plugin folder, but did not yet contain a supported
  marketplace manifest.
- `root_cause`: Codex expects a marketplace catalog such as
  `.agents/plugins/marketplace.json` at the marketplace root. The previous public repo
  had `.codex-plugin/plugin.json`, but no marketplace catalog to discover it.
- `fix`: add `.agents/plugins/marketplace.json` pointing to `source.path: "./"`, enrich
  `.codex-plugin/plugin.json` with plugin-browser metadata and `.mcp.json`, add
  `.mcp.json` for the stdio MCP server, and add `npm run plugin:validate`.
- `validation`: `npm run check` passed; `npm run plugin:validate` passed;
  `npm run pack:dry` included the marketplace and MCP files; local marketplace add with
  temporary `CODEX_HOME` passed; after pushing commit `d82d891`, `CODEX_HOME=$(mktemp
  -d) codex plugin marketplace add pezzos/codex-dynamic-workflows-lab --ref main`
  passed and `codex plugin marketplace list` showed `codex-dynamic-workflows-lab`.
- `follow_up_runtime_fix`: the first marketplace fix made the repo discoverable, but a
  Git marketplace clone still could not start the MCP server because `dist/` was not in
  Git and dependencies were not installed in the marketplace cache. The runtime fix adds
  a bundled MCP server at `dist/plugin/mcp-server.js`, points `.mcp.json` at it, tracks
  `dist/` intentionally, and extends `npm run plugin:validate` with a JSON-RPC
  `initialize` plus `tools/list` smoke.
- `runtime_validation`: after pushing commit `ccbf126`, `CODEX_HOME=$(mktemp -d) codex
  plugin marketplace add pezzos/codex-dynamic-workflows-lab --ref main` passed from
  GitHub, the cloned marketplace contained `dist/plugin/mcp-server.js`, and running
  that bundled server from the clone returned `initialize` and `tools/list` responses
  with `workflow_validate`, `workflow_submit`, `workflow_status`, `workflow_result`,
  `workflow_cancel`, and `workflow_artifacts`.
- `discovery_follow_up`: `ccbf126` fixed Git marketplace add and runtime availability,
  but `codex plugin list` still returned no installable plugins because the marketplace
  entry used `source.path: "./"`. Codex accepts that catalog as a marketplace root, but
  the plugin discovery/install path expects a plugin subdirectory under the marketplace
  root.
- `discovery_fix`: move the marketplace entry to
  `source.path: "./plugins/codex-dynamic-workflows-lab"` and add a build-time sync step
  that publishes the plugin manifest, skill, docs, and bundled MCP server into that
  directory.
- `discovery_validation`: local temporary `CODEX_HOME` validation passed
  `codex plugin marketplace add .`, `codex plugin list`, and
  `codex plugin add codex-dynamic-workflows-lab --marketplace
  codex-dynamic-workflows-lab`. `npm run check`, `npm run plugin:validate`, and
  `npm run pack:dry` also passed with the nested marketplace plugin included.
- `github_validation`: after pushing commit `89b4e77`, temporary `CODEX_HOME`
  validation passed `codex plugin marketplace add
  pezzos/codex-dynamic-workflows-lab --ref main`, `codex plugin list`,
  `codex plugin add codex-dynamic-workflows-lab --marketplace
  codex-dynamic-workflows-lab`, and a JSON-RPC `initialize` plus `tools/list` smoke
  from the installed plugin cache.

## Update 2026-06-02 - Marketplace presentation metadata

- `status`: done
- `issue`: the Codex app marketplace row rendered the plugin with a generic file icon
  and terse, clipped text.
- `fix`: add `assets/workflow-logo.svg` plus a PNG render at
  `assets/workflow-logo.png`, declare the PNG as both `interface.logo` and
  `interface.composerIcon`, update the plugin and marketplace short descriptions, and
  keep the marketplace plugin copy synchronized with `assets/`.
- `validation`: `npm run check`, `npm run plugin:validate`, and `npm run pack:dry`
  passed. A temporary `CODEX_HOME` local marketplace install confirmed that the
  installed plugin cache includes the workflow logo assets and that the bundled MCP
  server still responds to JSON-RPC `initialize` plus `tools/list`.
- `version`: bumped the plugin package and manifest to `0.1.1` so existing installs can
  pick up the presentation metadata as a new plugin version.

## Update 2026-06-02 - Fresh session validation protocol

- `status`: done
- `issue`: article evidence needs a repeatable way to ask a fresh Codex session to run
  deterministic function tests, comparative value tests, and safety probes without
  losing agent identity in the outputs.
- `fix`: add `docs/fresh-session-test-protocol.md` with preconditions, output contract,
  Wave 2 deterministic tests, Wave 3 comparison prompts, Wave 4 safety probes, and a
  master prompt for a fresh Codex session.
- `packaging`: include `docs/` in `package.json` and in the marketplace plugin sync so
  the protocol is present in the repo and installable plugin copy.

## Fix 2026-06-02 - Campaign feedback hardening

- `status`: done
- `input_reports`: campaign `#1` on `BannerGenerator` and `AuditTool`.
- `normal_findings`: Dynamic Workflow already produced useful forensic artifacts even
  when worker execution failed. Manual multi-agent review still produced stronger repo
  findings in these two campaigns, so the current article claim should stay focused on
  traceability and repeatability, not analysis superiority.
- `root_causes`: current Codex CLI accepts `--ask-for-approval never` only before the
  `exec` subcommand; static workflow validation did not reject `process.env` or literal
  worker write requests; stdout-over-policy failures returned stdout/stderr artifact
  paths before writing those files.
- `fixes`: move the approval flag before `exec`, reject `process.env` and
  `process["env"]` while still allowing `process.cwd()`, reject literal
  `agent(..., { sandbox: "workspace-write" })` and `writeScope: "worktree"` at
  validation time, and always write stderr plus truncated stdout when stdout exceeds
  the worker output policy.
- `protocol_update`: fresh-session campaigns now define `ARTIFACT_ROOT` outside the
  target repository and require Dynamic Workflow artifacts to be written there.
- `version`: bumped plugin package and manifest to `0.1.2`.

## Fix 2026-06-02 - Artifact hygiene and MCP artifact root

- `status`: done
- `input_report`: campaign `dwave-2026-06-02-bannergen` on `BannerGenerator`.
- `normal_findings`: Wave 2 now passes after the previous hardening. Dynamic Workflow
  produces the strongest trace package, but manual roles still produce stronger
  analysis quality. The article claim should stay focused on traceability and
  repeatability until successful live-worker summaries are stable.
- `root_causes`: `workflow_artifacts` appended `runs/undefined` when called without a
  `runId`; MCP tools allowed default artifacts under the target repo; raw stdout/stderr
  and parsed events were written without local redaction; stdout-over-policy failures
  discarded useful `last-message.txt` output and propagated `null` findings into
  `summary.json`.
- `fixes`: require explicit `artifacts` and `runId` for MCP artifact/status/result
  reads; require explicit `artifacts` for MCP submits; add MCP input schemas; redact
  secret-shaped tokens in stdout, stderr, events, runner results, workflow logs,
  warnings, agent `result.json`, and `summary.json`; use scrubbed `last-message.txt` as
  the worker result when stdout exceeds policy but the process exits successfully.
- `validation`: added MCP artifact contract tests, runner redaction and
  last-message-fallback tests, and workflow summary redaction tests.
- `version`: bumped plugin package and manifest to `0.1.3`.

## Fix 2026-06-02 - Worker auth propagation

- `status`: done
- `input_report`: campaign `dwave-2026-06-02-bg` on `BannerGenerator`.
- `normal_findings`: Wave 2 validation, fake runs, plugin validation, static unsafe
  rejection, and artifact placement now pass. Method C still failed before repository
  analysis because real `codex exec` workers returned `401 Unauthorized: Missing bearer
  or basic authentication`.
- `root_cause`: worker execution intentionally used a temporary `HOME` and temporary
  `CODEX_HOME`, but the auth propagation path only worked when the parent process had
  an explicit `CODEX_HOME`. In the local Codex desktop case, `CODEX_HOME` is unset and
  file-based auth lives under `$HOME/.codex/auth.json`, so workers started with an empty
  Codex home. External auth wrappers could not fix this once the runner set its own
  isolated `CODEX_HOME`.
- `fixes`: when policy `secrets` is `codex-auth-only`, resolve the parent Codex home
  from `CODEX_HOME` or `$HOME/.codex`, reject symlinked or non-regular `auth.json`
  files, copy only `auth.json` into the worker's temporary `CODEX_HOME`, set copied auth
  permissions to `0600`, keep worker `HOME` temporary, clean up worker temp homes after
  execution, and pass `--ignore-user-config` so parent Codex
  config/plugins/connectors/caches are not inherited. Unknown `policy.secrets` values
  are rejected during normalization.
- `tests`: added offline runner tests for default isolated `CODEX_HOME`, `$HOME/.codex`
  auth fallback, explicit `CODEX_HOME` auth source, symlinked-auth rejection,
  copied-file permissions, temp-home cleanup, missing-auth failure, and MCP
  `workflow_submit` propagation of `codex-auth-only`.
- `live_smoke`: a one-worker real `codex exec` smoke using policy
  `secrets: "codex-auth-only"` completed in 5190 ms with result `AUTH_SMOKE_OK`.
  Artifact scan found only the expected prompt/result text and command flags, with no
  `auth.json`, bearer/basic auth marker, token pattern, or `401` evidence.
- `security_note`: `codex-auth-only` is config-minimal, not secret-safe. It remains for
  trusted local workflows only because a malicious worker could still attempt to read
  its temporary copied auth file and print it into artifacts.
- `article_claim`: keep the article claim conservative until a fresh campaign proves a
  successful authenticated Method C run. The current supported claim is that
  `codex-auth-only` is implemented, unit-tested, and live-smoke-tested, while live
  multi-agent performance still needs to be rerun.
- `version`: bumped plugin package, manifests, and MCP server version to `0.1.4`.

## Fix 2026-06-02 - Async MCP submit and strict agent options

- `status`: done
- `input_report`: campaign `dwave-2026-06-02-bannergen` on `BannerGenerator`.
- `normal_findings`: Wave 2 passes, real Dynamic Workflow workers now complete, target
  repo stays clean, and Dynamic Workflow produces the strongest traceability evidence.
  The remaining product issues are submit ergonomics and validation clarity.
- `root_causes`: `workflow_submit` blocked until full workflow completion, which can
  exceed the Codex app MCP/tool timeout even though artifacts are later written. The
  validator also accepted nested `agent(..., { policy: { sandbox: "workspace-write" } })`
  because runtime sandboxing only reads top-level `sandbox`; this was confusing ignored
  input, not an effective workspace-write escape.
- `fixes`: make MCP `workflow_submit` write durable `status.json` and `mcp-job.json`,
  start the workflow in a detached local job process, and return immediately with
  `status: "submitted"`, `runId`, and `artifactRoot`. `workflow_status` now returns
  submitted/running state before `summary.json` exists, and `workflow_result` reports
  not-ready until completion. Workflow validation now rejects unknown `agent()` option
  keys and accepted-but-unimplemented options such as worker-level `policy`,
  `allowedTools`, `reasoningEffort`, and per-worker output limits.
- `tests`: added MCP regression coverage for immediate submit response, status polling
  from a fresh MCP server, final result polling, detached long-worker completion, and
  strict agent option validation for literal and dynamic workflow options.
- `security_note`: generic artifact DLP remains a documented limitation and test-plan
  item. The current code avoids overclaiming broad DLP guarantees.
- `version`: bumped plugin package, manifests, and MCP server version to `0.1.5`.

## Update 2026-06-02 - Current project state after comparative campaign

- `status`: experimental but materially stronger than the first MVP.
- `input_report`: campaign `dwave-2026-06-02-bannergen` on
  `/Users/alexandrepezzotta/repos/BannerGenerator`.
- `current_validated_state`: the lab validates deterministic workflows, rejects common
  unsafe constructs and policy widening, installs through a Codex marketplace, exposes
  MCP tools, propagates local Codex auth through `codex-auth-only`, and can complete real
  authenticated read-only workers.
- `campaign_result`: a real four-worker Dynamic Workflow review completed in
  `185635` ms, wrote 27 local artifact files under the lab artifact root, kept the target
  repo clean, and produced repo findings comparable to the manual multi-agent baseline.
- `comparison_result`: Dynamic Workflow was strongest for reproducibility and
  traceability because it preserved prompts, commands, stdout/stderr logs, last-message
  fallbacks, worker result JSON, policy hash, events, and summary in one run tree. Manual
  multi-agent review remains a strong analysis-quality baseline and should still be used
  to challenge claims.
- `target_findings_observed`: the comparison surfaced a tracked
  `.codex-browser/auth.json` credential-surface risk, ignored local `.env` files inside
  the worktree, `make` targets that do not cover the main frontend/backend test suites,
  large coordination modules, and documentation drift.
- `token_cost_note`: this lab consumed a large number of tokens across failed worker
  campaigns, manual comparison agents, successful multi-worker runs, and follow-up fixes.
  At campaign time, exact aggregate token usage was not available because the
  single-agent and manual-role baselines were not centrally instrumented, and some
  worker stdout exceeded policy. Version `0.1.6` adds Dynamic Workflow usage
  instrumentation, but any future performance article claim must still capture token
  usage per method and per worker.
- `remaining_limits`: write-mode worktrees, process-tree termination, formal artifact DLP,
  lower-noise worker output capture, repeat campaigns through the detached submit/poll
  contract, and strict timing/token accounting across all comparison methods.
- `article_claim`: the defensible claim is now that Codex Dynamic Workflows Lab improves
  traceability and repeatability for bounded read-only multi-agent runs. Do not claim
  production-ready safety, lower cost, or general analysis superiority.

## Update 2026-06-03 - Token reduction controls

- `status`: done
- `issue`: the comparative campaigns showed high token consumption, but the lab could
  not centrally report per-worker or run-level token usage, enforce even a soft token
  budget, or route workers by reasoning level.
- `fixes`: add stable `TokenUsage` normalization for Codex JSONL usage events; write
  per-worker `usage`, `model`, and `reasoningEffort` into results; write run-level
  `aggregateUsage`, `usageUnavailableCount`, and `budget` into `summary.json`; add
  policy `maxTokens` as a soft pre-spawn gate; expose `budget.spent()` and
  `budget.remaining()` to workflow scripts; support validated `agent()` option
  `reasoningEffort` with policy `allowedReasoningEfforts`; pass reasoning to Codex via
  `codex exec -c model_reasoning_effort="..."`; add a routed repo-review example.
- `scope_note`: this does not prove lower cost yet. It creates the instrumentation and
  controls needed to rerun the comparison with token metrics. The budget is soft and
  does not cancel in-flight workers.
- `tests`: `npm test` passed with 35 tests covering usage parsing, routing command
  arguments, policy validation, runtime aggregation, budget skip behavior, strict
  worker option validation, auth isolation, redaction, MCP submit, and artifact
  contracts.
- `validation`: `npm run build` passed and synchronized the marketplace plugin bundle.
- `version`: bumped package and plugin manifest to `0.1.6`.

## Update 2026-06-04 - Routed profiles, compact forwarding, and benchmark harness

- `status`: done
- `issue`: the first token-control slice measured Dynamic Workflow usage and allowed
  explicit reasoning settings, but it did not yet provide deterministic role profiles,
  compact context forwarding, or a benchmark preflight/manifest contract for the next
  measured campaign.
- `fixes`: add deterministic route profiles `scout`, `reviewer`, `security`, and
  `synthesizer`; expose `agent(..., { profile })`; resolve profile defaults before
  worker launch; record profile metadata in events, command artifacts, and runner
  results; add `compact(value, schemaName, maxBytes)` with closed schemas
  `scout_map`, `validation_inventory`, `review_findings`, and `final_synthesis`; add a
  fail-closed benchmark target preflight; add a benchmark manifest and run-validity
  helpers; update the routed repo-review example to forward compact scout context into
  reviewers.
- `docs`: add compact forwarding, route profile, benchmark harness, common review
  output contract, and routed quality-equivalence docs; update README, skill guidance,
  fresh-session protocol, token roadmap, and Ultracode gap map.
- `scope_note`: this still does not prove lower token cost or quality-equivalent routed
  reviews. It creates the runtime primitives and campaign contracts needed to run that
  proof.
- `validation`: `npm run build` passed and synchronized the marketplace plugin bundle;
  `node --test dist/tests/*.test.js` passed with 46 tests; `node scripts/validate-plugin.js`
  passed; `node dist/src/cli.js validate examples/routed-repo-review.workflow.js`
  passed; `node dist/src/cli.js run examples/routed-repo-review.workflow.js --fake
  --artifacts /tmp/codex-flow-routed-smoke` passed with 4 fake workers, 2 compact
  payloads, `aggregateUsage.totalTokens: 56`, and `usageUnavailableCount: 0`;
  `node dist/src/cli.js benchmark-manifest . --campaign-id dwave-smoke --method
  workflow-routed --profile scout --profile reviewer --profile security --profile
  synthesizer` produced a manifest with profile hash
  `d4c4e0257e186ed8c7f42705089197272fc28ce044e5cbf6bab7050c5c50de74`;
  `node dist/src/cli.js benchmark-preflight . --target-mode real_repo` passed with
  `ok: true`; `npm run pack:dry` passed for package `0.1.7`; root-vs-bundle diffs for
  skills, docs, examples, assets, README, RESULTATS, package, plugin manifest, and MCP
  config were clean.
- `version`: bumped package, plugin manifest, and MCP server version to `0.1.7`.

## Fix 2026-06-05 - Output audit hardening after Hermes diagnostic campaign

- `status`: done
- `input_report`: measured diagnostic campaign `dwave-2026-06-04-hermes` on
  `/Users/alexandrepezzotta/repos/Hermes`.
- `normal_findings`: routed workflows were traceable, but the diagnostic campaign did
  not prove lower token cost. Method C classic and Method D routed were both very
  expensive, and the routed retry was not a valid performance comparison because output
  capture failed and a worker artifact contained a local API-key-shaped value.
- `p0_incident`: one worker stdout artifact contained an exact local API-key-shaped
  value. The value was observed in `agents/agent-007/stdout.log`, not in the summary,
  compact payload, result JSON, or last-message fallback. This invalidated the run
  family for timing/token rankings.
- `fixes`: add `policy.outputAuditMode` with `auto`, `full`, `metadata-only`, and
  `none`; resolve `auto` to `metadata-only` when `secrets: "codex-auth-only"` is used;
  keep worker stdout/stderr/events in memory until audited; write Codex `-o`
  last-message output to a temporary directory outside the artifact tree, then persist
  only the audited copy when allowed; suppress secret-like worker output instead of
  persisting it; write `capture-metadata.json` with byte counts, SHA-256 digests,
  parsed-event count, usage source, result source, audit completeness, validity, and
  finding kinds; sanitize MCP and CLI return envelopes; aggregate evidence validity in
  workflow summaries.
- `benchmark_update`: benchmark validity now treats secret-like artifact findings and
  artifact leaks as `invalid`; `outputAuditMode: "none"` is diagnostic-only for
  measured comparison; metadata-only evidence is allowed when result contract, usage
  data, and postflight artifact scan are clean; manifests can record campaign family,
  cohort, repeat index, fixture id, sanitized fixture hash, target state hash, and
  preflight status; `benchmark-artifact-scan` provides a postflight scan for generated
  artifact trees and fails closed on secret-like persisted values.
- `tests`: added fake-worker regression coverage for secret-like stdout/stderr/events
  and last-message output, temporary `-o` output outside artifact roots,
  metadata-only authenticated capture, usage parsing under suppression, workflow
  validity aggregation, postflight artifact scanning, and benchmark invalid/diagnostic
  classification.
- `validation`: `npm run check` passed with 49 tests and synchronized the marketplace
  plugin bundle.
- `article_claim`: the supported claim is traceability, repeatability, and now stronger
  artifact-output hygiene. Do not claim lower token cost, production-ready secret
  safety, or quality-equivalent routed performance until a clean same-cohort campaign
  reruns after the incident response.
- `operator_follow_up`: if the leaked Hermes value was real, rotate it and quarantine or
  delete the affected artifact tree before running another public-facing campaign.
- `version`: bumped package, plugin manifest, and MCP server version to `0.1.8`.

## Fix 2026-06-05 - Practical preflight for real auth-heavy repositories

- `status`: done
- `issue`: after the `0.1.8` hardening, `benchmark-preflight` became too strict for
  normal repositories such as Hermes. It blocked on `.env.example`, `.envrc`,
  compiled Python cache files, redaction-pattern source code, and OAuth/API-key related
  variable names even when those were code surfaces rather than leaked secrets.
- `fixes`: target preflight now ignores common generated/cache directories and binary
  cache extensions such as `__pycache__` and `.pyc`; `.env.example` and `.envrc` are
  warnings, not blockers; source-level secret-pattern matches are informational
  warnings; likely real secret-bearing paths such as `.env`, `.env.local`, `auth.json`,
  and private-key files remain blockers.
- `safety_boundary`: generated artifact scanning remains strict and fail-closed. The
  relaxed behavior applies only to target preflight, where warnings are used to keep
  real repos testable while still documenting sensitive surfaces.
- `hermes_smoke`: `node dist/src/cli.js benchmark-preflight
  /Users/alexandrepezzotta/repos/Hermes --target-mode real_repo` now returns
  `ok: true`, `blockerCount: 0`, and warnings for the expected auth/redaction surfaces.
- `tests`: added regression coverage for `.env` blockers, clean fixtures, auth-code
  warnings, ignored `__pycache__`, and strict postflight artifact scanning.
- `validation`: `npm run check` passed with 50 tests and synchronized the marketplace
  plugin bundle.
- `version`: bumped package, plugin manifest, and MCP server version to `0.1.9`.

## Fix 2026-06-05 - Metadata-only benchmark classification

- `status`: done
- `issue`: reduced campaigns using `secrets: "codex-auth-only"` and
  `outputAuditMode: "auto"` resolved to `metadata_only` audit completeness, then the
  benchmark classifier marked the run `diagnostic_only` even when the workflow result
  was valid, usage data was complete, and artifact postflight was clean.
- `fix`: `metadata_only` audit completeness is no longer diagnostic-only by itself.
  It remains a reduced audit-surface caveat that must be reported. `outputAuditMode:
  "none"`, missing usage, stdout fallback, reconstructed contracts, secret findings,
  and artifact leaks still downgrade or invalidate the comparison.
- `tests`: added benchmark classifier coverage showing metadata-only with otherwise
  clean evidence remains `valid`.
- `validation`: pending final `npm run check`, `npm run plugin:validate`, and
  `npm run pack:dry` for package `0.1.10`.
- `version`: bumped package, plugin manifest, and MCP server version to `0.1.10`.

## Fix 2026-06-05 - Reduced campaign prompt stop rule

- `status`: done
- `issue`: the reduced campaign prompt still allowed an agent to treat target preflight
  warnings as a hard stop. Hermes returned `ok: true`, `findings: []`, and
  `blockers: []`, but the agent stopped because warnings contained env-like and
  auth-pattern surfaces.
- `fix`: update the fresh-session protocol hard rules: preflight warnings are not a stop
  condition. Real worker execution stops only when `benchmark-preflight` returns
  `ok: false` or a non-empty `blockers` array. Warnings must be copied into the final
  report but must not force diagnostic-only status by themselves.
- `scope_note`: this is a prompt/protocol fix, not a runtime change. The runtime
  behavior from `0.1.10` remains correct.
- `version`: bumped package, plugin manifest, and MCP server version to `0.1.11`.

## Fix 2026-06-05 - Hermes reduced campaign output invalidation

- `status`: done
- `issue`: Hermes reduced campaign `dwave-2026-06-05-hermes-reduced-02` passed
  preflight (`ok: true`, `blockers: []`) and completed both Method C and Method D, but
  both workflow summaries were `invalid`. Every worker exceeded stdout policy, used the
  last-message fallback, and had result/output suppressed by artifact hygiene. Method D
  also used more tokens than Method C in this diagnostic run, so no token-reduction
  claim is valid.
- `target_drift`: the operator report also detected a target worktree change during the
  campaign. The workflow commands were read-only, but benchmark evidence still needs a
  harness-level pre/post git-status guard because external or unexpected target drift
  invalidates comparison.
- `fixes`: add workflow-level `targetGitStatusBefore`, `targetGitStatusAfter`,
  `targetGitStatusChanged`, and `targetGitStatusGuardActive` fields when artifacts are
  stored outside the target repository; mark evidence `invalid` when the target git
  status changes during the run; harden the stock classic and routed examples with
  JSON schemas, bounded findings, identity fields, no source excerpts, and no literal
  secret or assignment-value output.
- `scope_note`: this does not relax artifact hygiene. Secret-like worker output still
  invalidates the run. The fix makes future campaigns fail for clearer reasons and
  reduces the chance of oversized free-form outputs.
- `version`: bumped package, plugin manifest, and MCP server version to `0.1.12`.

## Pause 2026-06-05 - Token budget stop

- `status`: paused
- `reason`: the lab is now useful as an experimental artifact, but the latest real
  campaigns are too expensive to keep iterating without a narrower protocol. The
  Hermes reduced run consumed more than 3M tokens per measured method and still produced
  invalid benchmark evidence.
- `current_supported_claim`: Codex Dynamic Workflows Lab can orchestrate bounded
  read-only Codex workers, preserve traceable artifacts, enforce policy and artifact
  hygiene, and expose benchmark validity metadata. It does not yet prove routed
  workflows reduce token use or preserve finding quality.
- `resume_condition`: resume only with a smaller target scope, explicit `maxTokens`,
  structured worker output, artifact root outside the target repo, stable target git
  status, clean postflight scan, and a stop rule that aborts comparison once validity is
  no longer `valid`.
- `article_update`: the Project Pezzos article was updated to reflect version `0.1.12`,
  the invalid Hermes diagnostic, the token cost, and the pause.
