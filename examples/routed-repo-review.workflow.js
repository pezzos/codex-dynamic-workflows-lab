export const meta = {
  name: "routed_repo_review",
  description: "Run a bounded read-only repository review with explicit low-cost routing controls and structured outputs",
  phases: [
    { title: "Scout", detail: "Cheap narrow worker maps high-signal target areas" },
    { title: "Review", detail: "Focused workers review higher-risk areas" },
    { title: "Synthesize", detail: "Return compact synthesis and budget state" },
  ],
}

const targetRepo = String(args?.targetRepo ?? cwd)
const testId = String(args?.testId ?? "routed_repo_review")
const scope = String(args?.scope ?? "architecture, validation, security, and secret-surface risk")
const scopePaths = Array.isArray(args?.scopePaths) ? args.scopePaths.map(String).slice(0, 8) : []

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

const scoutSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agent_id", "role", "target_repo", "test_id", "files", "limits"],
  properties: {
    agent_id: { type: "string" },
    role: { type: "string" },
    target_repo: { type: "string" },
    test_id: { type: "string" },
    files: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "why"],
        properties: {
          path: { type: "string", maxLength: 160 },
          why: { type: "string", maxLength: 180 },
        },
      },
    },
    limits: { type: "string", maxLength: 220 },
  },
}

function identity(agentId, role) {
  return `AGENT_ID: ${agentId}
ROLE: ${role}
TARGET_REPO: ${targetRepo}
TEST_ID: ${testId}`
}

function outputRules() {
  return `Output rules:
- Return only JSON matching the provided schema.
- Maximum 5 findings.
- Use file paths and optional line numbers only.
- Do not quote source code.
- Do not include environment values, tokens, keys, cookies, credential-shaped strings, or assignment right-hand-side values.
- If a finding involves secrets, describe the class of risk without copying the literal value or token shape.
- Keep every claim evidence-backed and concise.`
}

const scopedContext = await compact({
  summary: "Bounded routed review context. Scout raw output is intentionally not forwarded.",
  files: scopePaths.map((path) => ({ path, why: "Operator-provided high-signal scope path." })),
  limits: "Downstream reviewers should inspect only the bounded scope and avoid source excerpts.",
}, "scout_map", 2048)

phase("Scout")
const scout = await agent(`${identity("routed-scout", "scout")}

Map only the highest-signal files and directories for this scope:
${scope}

Prefer the provided scope paths when they exist:
${scopePaths.join("\n")}

Return only JSON matching the provided schema.
Do not include code excerpts, literals, env values, tokens, keys, or credential-shaped strings.`, {
  label: "scout",
  profile: "scout",
  schema: scoutSchema,
})

phase("Review")
const reviews = await parallel([
  () => agent(`${identity("routed-architecture", "architecture-maintainability reviewer")}

Review architecture and maintainability risks using this bounded context:
${JSON.stringify(scopedContext.value)}

Shared scope: ${scope}.
${outputRules()}`, {
    label: "review-architecture",
    profile: "reviewer",
    schema: findingSchema,
  }),
  () => agent(`${identity("routed-security", "security reviewer")}

Review security and secret-surface risks using this bounded context:
${JSON.stringify(scopedContext.value)}

Shared scope: ${scope}.
${outputRules()}`, {
    label: "review-security",
    profile: "security",
    schema: findingSchema,
  }),
])

const synthesis = await compact({
  summary: "Routed repo review completed with structured outputs and no raw scout forwarding.",
  usefulFindings: reviews.map((_, index) => `Structured reviewer ${index + 1} completed; inspect agent result JSON for bounded evidence.`),
  weakFindings: [],
  limits: "Use per-agent structured result artifacts for evidence; raw worker stdout is not required for comparison.",
}, "final_synthesis", 2048)

phase("Synthesize")
return {
  ok: true,
  method: "D Routed Dynamic Workflow",
  testId,
  targetRepo,
  scout,
  reviews,
  synthesis,
  usage: {
    spentTokens: budget.spent(),
    remainingTokens: budget.total === null ? null : budget.remaining(),
  },
}
