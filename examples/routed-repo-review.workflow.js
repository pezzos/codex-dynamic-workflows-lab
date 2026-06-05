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
  profile: "scout",
}

const reviewerOptions = {
  model: args?.reviewerModel,
  profile: "reviewer",
}

phase("Scout")
const scout = await parallel([
  () => agent("Map the repository structure. Return only the highest-signal files and directories.", { ...scoutOptions, label: "scout-structure" }),
  () => agent("Find validation commands and test entrypoints. Return concise evidence.", { ...scoutOptions, label: "scout-tests" }),
])
const scoutContext = await compact({
  summary: "Repository scout context for downstream reviewers.",
  files: [
    { path: "README.md", why: `Usage and project shape evidence. Scout note: ${String(scout[0]).slice(0, 160)}` },
    { path: "package.json", why: `Validation and script inventory evidence. Scout note: ${String(scout[1]).slice(0, 160)}` },
  ],
  limits: "This compact context intentionally omits raw worker logs; inspect worker artifacts for full evidence.",
}, "scout_map", 4000)

phase("Review")
const reviews = await parallel([
  () => agent(`Review architecture risks using this compact scout context:\n${JSON.stringify(scoutContext.value)}\nReturn concise evidence-backed findings.`, { ...reviewerOptions, label: "review-architecture" }),
  () => agent(`Review security and secret-surface risks using this compact scout context:\n${JSON.stringify(scoutContext.value)}\nReturn concise evidence-backed findings.`, { ...reviewerOptions, profile: "security", label: "review-security" }),
])

const synthesis = await compact({
  summary: "Routed repo review completed with compact scout forwarding.",
  usefulFindings: reviews.map((review) => String(review).slice(0, 300)),
  weakFindings: [],
  limits: "Use per-agent artifacts for full stdout, stderr, command, and result evidence.",
}, "final_synthesis", 6000)

phase("Synthesize")
return {
  ok: true,
  scoutContext,
  reviews,
  synthesis,
  usage: {
    spentTokens: budget.spent(),
    remainingTokens: budget.total === null ? null : budget.remaining(),
  },
}
