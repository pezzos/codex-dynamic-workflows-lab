# Routed Quality Equivalence

The token-reduction work should not be judged only by lower token count. A routed run is
useful only if it preserves enough review quality for the task.

For now, use this as a pilot rubric, not a fixed benchmark threshold.

## Candidate Success Signal

A routed Dynamic Workflow run is a quality-equivalence candidate when it:

- completes the required roles;
- produces the common review output contract directly;
- keeps concrete file evidence close to the manual-role baseline;
- avoids a large increase in weak or unsupported findings;
- keeps traceability and reproducibility at least as strong as the classic workflow;
- records model, reasoning, profile, usage, and validity metadata.

## Non-Equivalence Signals

Treat the run as not equivalent when:

- security or correctness roles are skipped;
- findings lose file and line evidence;
- compact forwarding removes context needed for synthesis;
- stdout fallback becomes the main result path;
- lower-reasoning scouts produce misleading maps that reviewers trust blindly;
- operator intervention is needed to repair outputs.

## Pilot Method

Run the same target in separate cohorts:

1. single prompt;
2. manual roles;
3. classic Dynamic Workflow;
4. routed Dynamic Workflow with `profile` and `compact`.

Classify each run with the benchmark validity rules before comparing quality. Only
compare `valid` runs for cost claims. Keep `diagnostic_only` runs for failure analysis.

## Current State

`0.1.8` provides the primitives, harness contracts, and evidence-validity metadata. It
does not yet provide evidence that routed workflows are quality-equivalent or cheaper in
practice. The Hermes diagnostic campaign did not show a routed cost win and was invalid
for ranking because of an artifact hygiene incident. That requires a new clean measured
campaign.
