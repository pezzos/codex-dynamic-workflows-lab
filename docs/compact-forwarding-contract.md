# Compact Forwarding Contract

Version `0.1.7` adds `compact(value, schemaName, maxBytes)` for workflows that need to
feed one worker's output into later workers without pasting raw transcripts forward.

The helper is intentionally small and closed:

- it accepts only known schemas;
- it redacts values before validation;
- it rejects secret-shaped export payloads;
- it rejects absolute paths, `..`, `.env`, and `auth.json` references in forwarded file
  paths;
- it writes `compact-###.json` artifacts and increments `summary.json.compactCount`;
- it returns the compact payload to the workflow script.

Supported schemas:

| Schema | Use |
| --- | --- |
| `scout_map` | Repository map and high-signal files for downstream reviewers |
| `validation_inventory` | Commands, purposes, evidence, and gaps |
| `review_findings` | Bounded finding list with severity, confidence, evidence refs, and actionability |
| `final_synthesis` | Final short summary, useful findings, weak findings, and limits |

Full worker logs still remain in per-agent artifacts. The compact payload is only the
forwarded context. This keeps auditability separate from prompt economy.

Example:

```js
const scoutContext = await compact({
  summary: "Repository map for reviewers.",
  files: [{ path: "README.md", why: "Usage and project shape evidence." }],
  limits: "Raw worker logs are not forwarded.",
}, "scout_map", 4000)

await agent(`Review with context:\n${JSON.stringify(scoutContext.value)}`, {
  label: "review-architecture",
  profile: "reviewer",
})
```

Current limits:

- this is not a complete DLP scanner;
- compact payloads are safe-to-export candidates, not proof that all artifacts are
  secret-free;
- schema size limits are conservative defaults and should be tuned after more measured
  campaigns.
