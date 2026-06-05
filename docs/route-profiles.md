# Route Profiles

Version `0.1.7` adds deterministic route profiles for common workflow roles.

Profiles are not worker-chosen. The workflow requests a profile, the runtime resolves
it before spawning the worker, and the policy can allow or reject it through
`allowedRouteProfiles`.

| Profile | Default reasoning | Intended use |
| --- | --- | --- |
| `scout` | `low` | Cheap read-only mapping, inventory, grep-style discovery |
| `reviewer` | `medium` | Focused bounded review of normal-risk areas |
| `security` | `high` | Security or correctness-sensitive review |
| `synthesizer` | `high` | Final synthesis and tradeoff explanation |

Example:

```js
await agent("Map the repo.", { label: "scout-structure", profile: "scout" })
await agent("Review security risks.", { label: "review-security", profile: "security" })
```

If a workflow also sets `reasoningEffort`, the explicit value wins. This lets a campaign
lower or raise a profile for a specific experiment while keeping the selected route
visible in artifacts.

Artifacts record:

- requested `profile`;
- selected `model`, when provided;
- resolved `reasoningEffort`;
- an `agent.profile` event before worker start.

Policy knobs:

```json
{
  "allowedRouteProfiles": ["scout", "reviewer", "security", "synthesizer"],
  "allowedReasoningEfforts": ["low", "medium", "high"]
}
```

An empty allow-list means "allow supported profiles". A non-empty list is restrictive.
