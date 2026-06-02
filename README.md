# Codex Dynamic Workflows Lab

Experimental Codex plugin for bounded local dynamic workflows.

The prototype turns a deterministic JavaScript workflow into bounded `codex exec`
workers, then records local artifacts for review. It is inspired by Claude Code Dynamic
Workflows and by `Michaelliv/pi-dynamic-workflows`, but it does not recreate Claude Code
internals.

## Status

- Plugin: local marketplace-ready experimental MVP
- Public-safety status: published as an experimental reader-facing lab artifact
- Writes: read-only by default; write mode is not validated for production use
- Network/connectors: disabled in policy

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
```

Artifacts are written under `.codex-workflows/runs/<run-id>/`.

## Test campaigns

Use `docs/fresh-session-test-protocol.md` to delegate a full validation campaign to a
fresh Codex session. The protocol includes deterministic function tests, comparative
prompts for normal Codex versus manual multi-agent versus Dynamic Workflow runs, and
read-only safety probes for article evidence.

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

Workflow validation rejects unknown `agent()` option keys, including worker-level
`policy` objects. Per-worker policy widening is unsupported; use the top-level workflow
policy and the supported `sandbox`, `writeScope`, `model`, and `timeoutMs` options only.

`codex-auth-only` resolves the parent Codex home from `CODEX_HOME` when set, otherwise
from `$HOME/.codex`. It rejects symlinked or non-regular `auth.json` files, copies only
that file into the worker's temporary `CODEX_HOME`, sets the copied file to `0600`, and
removes the worker temp homes after the run. It does not copy parent Codex config,
plugins, connectors, caches, or history.

This is config-minimal, not secret-safe. A malicious workflow or prompt-injected worker
that can read its own `CODEX_HOME` could still try to print credentials into artifacts.
Use `codex-auth-only` only for trusted local workflows and treat the copied `auth.json`
as a password-equivalent secret.

This is still a lab. Do not use it for autonomous write-heavy workflows or public
resource actions.

## Unverified paths

These branches are not validated yet:

- a successful comparative multi-worker campaign after the auth and async-submit fixes;
- write mode in isolated worktrees;
- full detached `workflow_submit` plus polling from an actual Codex MCP client;
- process-tree termination for worker children and grandchildren;

## Related article

This repository is the evidence artifact for a Project Pezzos draft article about
adapting Claude Code-style Dynamic Workflows to Codex surfaces. The article remains a
draft until comparative real-worker runs, write-mode, full MCP client path,
process-tree kill, and authenticated campaign paths are validated.

## What this plugin is not

- Not a production-ready autonomous workflow system.
- Not an official OpenAI tool.
- Not a safe replacement for human review.
- Not a reason to expose local Codex resources publicly.
