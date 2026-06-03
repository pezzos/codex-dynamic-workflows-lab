export const meta = {
  name: "routed_repo_review",
  description: "Run a bounded read-only repository review with explicit low-cost routing controls",
  phases: [
    { title: "Scout", detail: "Cheap narrow workers map the repo and gather evidence" },
    { title: "Review", detail: "Focused workers review higher-risk areas" },
    { title: "Synthesize", detail: "Return compact synthesis and budget state" },
  ],
}

const scoutOptions = {
  model: args?.scoutModel,
  reasoningEffort: "low",
}

const reviewerOptions = {
  model: args?.reviewerModel,
  reasoningEffort: "medium",
}

phase("Scout")
const scout = await parallel([
  () => agent("Map the repository structure. Return only the highest-signal files and directories.", { ...scoutOptions, label: "scout-structure" }),
  () => agent("Find validation commands and test entrypoints. Return concise evidence.", { ...scoutOptions, label: "scout-tests" }),
])

phase("Review")
const reviews = await parallel([
  () => agent("Review architecture risks using the scout context. Return concise evidence-backed findings.", { ...reviewerOptions, label: "review-architecture" }),
  () => agent("Review security and secret-surface risks. Return concise evidence-backed findings.", { ...reviewerOptions, label: "review-security" }),
])

phase("Synthesize")
return {
  ok: true,
  scout,
  reviews,
  usage: {
    spentTokens: budget.spent(),
    remainingTokens: budget.total === null ? null : budget.remaining(),
  },
}
