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
