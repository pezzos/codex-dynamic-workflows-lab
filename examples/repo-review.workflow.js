export const meta = {
  name: "repo_review",
  description: "Run a bounded read-only repository review with structured compact Codex workers",
  phases: [{ title: "Review" }, { title: "Synthesize" }],
}

const targetRepo = String(args?.targetRepo ?? cwd)
const testId = String(args?.testId ?? "repo_review")
const scope = String(args?.scope ?? "architecture, validation, security, and secret-surface risk")

const findingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agent_id", "role", "target_repo", "test_id", "findings", "limits"],
  properties: {
    agent_id: { type: "string" },
    role: { type: "string" },
    target_repo: { type: "string" },
    test_id: { type: "string" },
    findings: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "file", "line", "claim", "evidence", "confidence"],
        properties: {
          category: { type: "string", enum: ["architecture", "validation", "security", "docs", "unknown"] },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          file: { type: "string" },
          line: { type: ["integer", "null"] },
          claim: { type: "string", maxLength: 220 },
          evidence: { type: "string", maxLength: 240 },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    limits: { type: "string", maxLength: 240 },
  },
}

function promptFor(agentId, role, focus) {
  return `AGENT_ID: ${agentId}
ROLE: ${role}
TARGET_REPO: ${targetRepo}
TEST_ID: ${testId}

Review this repository read-only.
Focus: ${focus}.
Shared scope: ${scope}.

Output rules:
- Return only JSON matching the provided schema.
- Maximum 5 findings.
- Use file paths and optional line numbers only.
- Do not quote source code.
- Do not include environment values, tokens, keys, cookies, credential-shaped strings, or assignment right-hand-side values.
- If a finding involves secrets, describe the class of risk without copying the literal value or token shape.
- Keep every claim evidence-backed and concise.`
}

phase("Review")
const findings = await parallel([
  () => agent(promptFor("classic-architecture", "architecture reviewer", "architecture boundaries, large coordination modules, adapter drift"), {
    label: "architecture",
    schema: findingSchema,
  }),
  () => agent(promptFor("classic-validation", "validation reviewer", "test commands, validation gaps, and untested flows"), {
    label: "validation",
    schema: findingSchema,
  }),
  () => agent(promptFor("classic-security", "security reviewer", "secret handling, auth, logging, redaction, and permissions"), {
    label: "security",
    schema: findingSchema,
  }),
])

phase("Synthesize")
return {
  ok: true,
  method: "C Classic Dynamic Workflow",
  testId,
  targetRepo,
  findings,
  usage: {
    spentTokens: budget.spent(),
    remainingTokens: budget.total === null ? null : budget.remaining(),
  },
}
