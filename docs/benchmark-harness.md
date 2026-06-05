# Benchmark Harness

Version `0.1.8` keeps the deterministic benchmark harness and adds evidence-validity
rules for output audit results. It does not prove lower token cost by itself. It
provides the guardrails needed before running another measured campaign.

## CLI

Preflight a target repository before a benchmark:

```bash
node dist/src/cli.js benchmark-preflight /path/to/repo --target-mode real_repo
```

The target preflight now separates blockers from warnings. It fails closed on likely
real secret-bearing files such as `.env`, `auth.json`, and private-key files. It treats
`.env.example`, `.envrc`, code-level auth/token patterns, redaction fixtures, and
similar auth-heavy source files as warnings so real repositories can still be tested.
Generated artifact scans remain strict and fail closed.

Create a manifest for a comparable run:

```bash
node dist/src/cli.js benchmark-manifest /path/to/repo \
  --campaign-id dwave-2026-06-04 \
  --method workflow-routed \
  --target-mode real_repo \
  --profile scout \
  --profile reviewer \
  --profile security \
  --profile synthesizer
```

Scan generated artifacts after a run:

```bash
node dist/src/cli.js benchmark-artifact-scan /path/to/artifacts/runs/<run-id>
```

The manifest records:

- campaign family id, cohort id, repeat index, fixture id, sanitized fixture hash,
  target state hash, and preflight status when provided;
- method: `single`, `manual`, `workflow-classic`, or `workflow-routed`;
- target mode: `real_repo`, `include_list`, or `sanitized_fixture`;
- route profiles and profile hash;
- absolute target path;
- campaign id and notes.

The postflight artifact scan fails closed on secret-like values in generated artifacts.
Run it before using any workflow result in a benchmark table.

Preflight `warnings` should be copied into the final report, but they do not block a
run when `ok: true` and `blockers` is empty.

## Validity Rules

Benchmark results should be classified before they are used in the article.

A run may complete successfully at the process level and still be `diagnostic_only` or
`invalid` for benchmark use. Benchmark tables and cost claims must gate on evidence
validity, not on `completed` or `submitted` status.

`valid`:

- required roles completed;
- no model or reasoning drift;
- no asymmetric operator intervention;
- usage data is available;
- no stdout fallback was needed;
- no secret-like artifact finding was recorded;
- output audit completeness is not `none`; `metadata_only` is allowed when the result
  contract, usage data, and postflight artifact scan are clean;
- output contract was produced directly.

`diagnostic_only`:

- usage is missing;
- stdout exceeded policy and used `last-message` fallback;
- output audit mode was `none`;
- output audit completeness was `none`;
- the common contract was reconstructed from free-form output.

`invalid`:

- required roles are missing;
- model or reasoning route drifted from the manifest;
- operator intervention differs across methods.
- a secret-like artifact finding was recorded;
- an artifact leak was detected.

An `invalid` run family must not be used for token/timing rankings. A
`diagnostic_only` run can be quoted for failure analysis or ergonomics, but not as proof
that one method is cheaper or better.

The Hermes diagnostic run is failure-analysis evidence only. It must not be used for
token rankings, and no real Hermes rerun should be treated as comparable until the
artifact-hygiene incident is handled and the rerun has valid postflight evidence.

## Cohort Rule

Do not mix target cohorts in a single comparison table. A `real_repo` run should compare
only with other `real_repo` runs on the same target state. `include_list` and
`sanitized_fixture` runs are separate cohorts.

Cost claims require same-cohort repeats, complete usage data, a frozen output contract,
and an explicit quality-equivalence review. A routed run that saves tokens but misses
material findings is not a successful optimization.

## What Is Still Missing

- automated execution of all four methods;
- automated scoring from the common output contract;
- exhaustive DLP beyond the implemented secret-pattern output audit;
- measured variance across repeated cold runs;
- cache and warm-context measurements.
