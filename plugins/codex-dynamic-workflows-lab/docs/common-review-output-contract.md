# Common Review Output Contract

Measured comparisons should not score free-form prose directly. Each method should be
adapted into the same review contract before comparing quality or cost.

For repository review campaigns, use this normalized shape:

```json
{
  "agent_id": "review-security",
  "method": "workflow-routed",
  "findings": [
    {
      "area": "security",
      "severity": "high",
      "confidence": "medium",
      "summary": "Short evidence-backed finding.",
      "evidenceRefs": [
        { "file": "src/example.ts", "line": 42, "note": "Why this line matters." }
      ],
      "actionability": "Concrete next step.",
      "needsVerification": true,
      "weak": false
    }
  ],
  "limits": "What was not checked."
}
```

Scoring fields:

- concrete file evidence count;
- useful findings count;
- weak or unproven findings count;
- duplicated findings count;
- unsupported claim count;
- operator intervention count;
- traceability score;
- reproducibility score.

Important rule:

If a method's result has to be reconstructed from broad free-form text, mark that run
`diagnostic_only` for quality scoring. It can still teach us something, but it is not a
clean comparison against methods that produced the contract directly.
