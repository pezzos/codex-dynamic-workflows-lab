# codex-dynamic-workflows-lab

Local lab prototype for Codex-compatible dynamic workflows.

The prototype turns a deterministic JavaScript workflow into bounded `codex exec`
workers, then records local artifacts for review. It is inspired by Claude Code Dynamic
Workflows and by `Michaelliv/pi-dynamic-workflows`, but it does not recreate Claude Code
internals.

## Status

- Prototype: public lab MVP
- Public-safety status: published as an experimental reader-facing lab artifact
- Writes: read-only by default; write mode is not validated for production use
- Network/connectors: disabled in policy

## Install

```bash
npm install
npm run build
```

## Run offline with fake Codex

```bash
npm test
node dist/src/cli.js validate examples/repo-review.workflow.js
node dist/src/cli.js run examples/repo-review.workflow.js --fake
```

Artifacts are written under `.codex-workflows/runs/<run-id>/`.

## MCP server

The package exposes a stdio MCP server:

```bash
node dist/src/cli.js server
```

Current tools:

- `workflow_validate`
- `workflow_submit`
- `workflow_status`
- `workflow_result`
- `workflow_cancel`
- `workflow_artifacts`

## Safety model

The runtime enforces an immutable policy outside the worker. The MVP defaults to:

- read-only sandbox;
- no network;
- no connectors;
- no `danger-full-access`;
- scrubbed worker environment;
- temporary `HOME`;
- isolated `CODEX_HOME` unless explicitly configured otherwise;
- bounded max agents, concurrency, duration, and output size.

This is still a lab. Do not use it for autonomous write-heavy workflows or public
resource actions.

## Unverified paths

These branches are not validated yet:

- real authenticated `codex exec` workers;
- write mode in isolated worktrees;
- full `workflow_submit` calls from an actual Codex MCP client;
- process-tree termination for worker children and grandchildren;
- a minimal `codex-auth-only` strategy that exposes authentication without leaking
  unrelated Codex config, plugins, connectors, caches, or history.

## Related article

This repository is the evidence artifact for a Project Pezzos draft article about
adapting Claude Code-style Dynamic Workflows to Codex surfaces. The article remains a
draft until the real Codex worker, write-mode, full MCP path, process-tree kill, and
`codex-auth-only` paths are validated.

## What this repo is not

- Not a production Codex plugin.
- Not an official OpenAI tool.
- Not a safe replacement for human review.
- Not a reason to expose local Codex resources publicly.
