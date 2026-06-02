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
