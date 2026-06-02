export const meta = {
  name: "repo_review",
  description: "Run a bounded read-only repository review with parallel Codex workers",
  phases: [{ title: "Review" }, { title: "Synthesize" }],
}

phase("Review")
const findings = await parallel([
  () => agent("Review repository architecture. Return concise findings.", { label: "architecture" }),
  () => agent("Review test coverage and validation gaps. Return concise findings.", { label: "tests" }),
  () => agent("Review security and permission risks. Return concise findings.", { label: "security" }),
])

phase("Synthesize")
return {
  ok: true,
  findings,
  summary: "Three bounded workers completed and returned evidence for synthesis.",
}
