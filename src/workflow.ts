import vm from "node:vm";
import { parse } from "acorn";
import type { Node } from "acorn";
import { ArtifactStore } from "./artifacts.js";
import { normalizePolicy, reasoningEfforts } from "./policy.js";
import { redactText, redactValue } from "./redaction.js";
import type {
  AgentOptions,
  AgentRunInput,
  AgentRunner,
  WorkflowMeta,
  WorkflowPolicy,
  WorkflowRunResult,
} from "./types.js";
import { addUsage, emptyUsage } from "./usage.js";

type AnyNode = Node & { [key: string]: any; start: number; end: number };

const agentOptionKeys = new Set([
  "label",
  "phase",
  "schema",
  "model",
  "reasoningEffort",
  "sandbox",
  "writeScope",
  "timeoutMs",
]);

export interface RunWorkflowOptions {
  cwd: string;
  artifactRoot?: string;
  runId?: string;
  args?: unknown;
  policy?: Partial<WorkflowPolicy>;
  runner: AgentRunner;
  signal?: AbortSignal;
}

interface RuntimeState {
  currentPhase?: string;
  logs: string[];
  phases: string[];
  agentCount: number;
  warnings: string[];
  aggregateUsage: ReturnType<typeof emptyUsage>;
  usageUnavailableCount: number;
}

export function parseWorkflowScript(script: string): { meta: WorkflowMeta; body: string } {
  const ast = parse(script, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  }) as AnyNode;

  assertDeterministicAst(ast);

  const first = ast.body?.[0] as AnyNode | undefined;
  if (first?.type !== "ExportNamedDeclaration") {
    throw new Error("`export const meta = { name, description }` must be the first statement");
  }

  const declaration = first.declaration as AnyNode | null;
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") {
    throw new Error("meta export must be `export const meta = ...`");
  }

  const declarator = declaration.declarations?.[0] as AnyNode | undefined;
  if (!declarator || declaration.declarations.length !== 1) {
    throw new Error("meta export must declare only `meta`");
  }
  if (declarator.id?.type !== "Identifier" || declarator.id.name !== "meta") {
    throw new Error("meta export must declare `meta`");
  }

  const meta = evaluateLiteral(declarator.init, "meta");
  validateMeta(meta);
  return { meta, body: script.slice(0, first.start) + script.slice(first.end) };
}

export async function runWorkflow<T = unknown>(
  script: string,
  options: RunWorkflowOptions,
): Promise<WorkflowRunResult<T>> {
  const started = Date.now();
  const { meta, body } = parseWorkflowScript(script);
  const runId = options.runId ?? `${meta.name}-${Date.now()}`;
  const policy = normalizePolicy(options.policy);
  const store = new ArtifactStore({
    root: options.artifactRoot ?? `${options.cwd}/.codex-workflows`,
    runId,
  });
  await store.init(meta, policy);

  const state: RuntimeState = {
    logs: [],
    phases: [],
    agentCount: 0,
    warnings: [],
    aggregateUsage: emptyUsage(),
    usageUnavailableCount: 0,
  };
  const limiter = createLimiter(policy.concurrency);
  const pending = new Set<Promise<unknown>>();

  const throwIfAborted = () => {
    if (options.signal?.aborted) throw new Error("workflow aborted");
    if (Date.now() - started > policy.maxRunDurationMs) throw new Error("workflow duration budget exhausted");
  };

  const phase = (value: unknown) => {
    const title = requireString(value, "phase title");
    state.currentPhase = title;
    if (!state.phases.includes(title)) state.phases.push(title);
    void store.appendEvent({ type: "phase", runId, title });
  };

  const log = (value: unknown) => {
    const message = redactText(String(value));
    state.logs.push(message);
    void store.appendEvent({ type: "log", runId, message });
  };

  const budgetStatus = () => {
    const totalTokens = policy.maxTokens;
    const spentTokens = state.aggregateUsage.totalTokens;
    return {
      totalTokens,
      spentTokens,
      remainingTokens: totalTokens === null ? null : Math.max(0, totalTokens - spentTokens),
      exhausted: totalTokens !== null && spentTokens >= totalTokens,
    };
  };

  const agent = async (prompt: unknown, rawOptions: unknown = {}) => {
    throwIfAborted();
    const agentPrompt = requireString(prompt, "agent prompt");
    const agentOptions = normalizeAgentOptions(rawOptions);
    if (agentOptions.sandbox === "workspace-write" && policy.mode !== "write-worktree") {
      throw new Error("worker requested writes but workflow policy is read-only");
    }
    if (
      agentOptions.reasoningEffort &&
      policy.allowedReasoningEfforts.length > 0 &&
      !policy.allowedReasoningEfforts.includes(agentOptions.reasoningEffort)
    ) {
      throw new Error(`reasoning effort not allowed by policy: ${agentOptions.reasoningEffort}`);
    }

    const assignedPhase = agentOptions.phase ?? state.currentPhase;
    const taskNumber = state.agentCount + 1;
    const label = agentOptions.label?.trim() || (assignedPhase ? `${assignedPhase} ${taskNumber}` : `agent ${taskNumber}`);
    const currentBudget = budgetStatus();
    if (currentBudget.exhausted) {
      const warning = `agent ${label} skipped: token budget exhausted`;
      state.warnings.push(warning);
      await store.appendEvent({ type: "agent.skipped", runId, label, phase: assignedPhase, reason: "token_budget_exhausted" });
      return null;
    }
    if (state.agentCount >= policy.maxAgents) throw new Error("workflow maxAgents exhausted");
    const agentId = `agent-${String(taskNumber).padStart(3, "0")}`;
    state.agentCount++;

    const run = limiter(async () => {
      throwIfAborted();
      await store.initAgent(agentId, label, agentPrompt);
      await store.appendEvent({ type: "agent.started", runId, agentId, label, phase: assignedPhase });
      try {
        const result = await options.runner.run({
          agentId,
          prompt: agentPrompt,
          label,
          phase: assignedPhase,
          schema: agentOptions.schema,
          options: { ...agentOptions, timeoutMs: agentOptions.timeoutMs ?? policy.maxWorkerDurationMs },
        } satisfies AgentRunInput);
        const safeResult = redactValue(result);
        if (result.usage) {
          state.aggregateUsage = addUsage(state.aggregateUsage, result.usage);
        } else {
          state.usageUnavailableCount++;
        }
        await store.writeAgentJson(agentId, "result.json", safeResult);
        await store.appendEvent({
          type: "agent.completed",
          runId,
          agentId,
          label,
          status: safeResult.status,
          usage: result.usage ?? null,
        });
        state.warnings.push(...safeResult.warnings.map((warning) => redactText(warning)));
        return safeResult.result;
      } catch (error) {
        const message = redactText(error instanceof Error ? error.message : String(error));
        await store.appendEvent({ type: "agent.failed", runId, agentId, label, error: message });
        state.warnings.push(`agent ${label} failed: ${message}`);
        return null;
      }
    });
    pending.add(run);
    run.finally(() => pending.delete(run));
    return run;
  };

  const parallel = async (thunks: Array<() => Promise<unknown>>) => {
    throwIfAborted();
    if (!Array.isArray(thunks) || thunks.some((thunk) => typeof thunk !== "function")) {
      throw new TypeError("parallel() expects an array of functions");
    }
    return Promise.all(thunks.map((thunk) => thunk()));
  };

  const pipeline = async (
    items: unknown[],
    ...stages: Array<(previous: unknown, original: unknown, index: number) => unknown>
  ) => {
    if (!Array.isArray(items)) throw new TypeError("pipeline() expects an array");
    if (stages.some((stage) => typeof stage !== "function")) throw new TypeError("pipeline stages must be functions");
    return Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item;
        for (const stage of stages) value = await stage(value, item, index);
        return value;
      }),
    );
  };

  const context = vm.createContext(
    {
      agent,
      parallel,
      pipeline,
      phase,
      log,
      args: options.args,
      cwd: options.cwd,
      process: Object.freeze({ cwd: () => options.cwd }),
      budget: Object.freeze({
        total: policy.maxTokens,
        spent: () => state.aggregateUsage.totalTokens,
        remaining: () => budgetStatus().remainingTokens ?? Number.POSITIVE_INFINITY,
      }),
      JSON,
      Math,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Map,
      Promise,
      console: Object.freeze({ log, info: log, warn: log, error: log }),
      globalThis: undefined,
      eval: undefined,
      Function: undefined,
      Buffer: undefined,
    },
    { codeGeneration: { strings: false, wasm: false } },
  );

  const result = await new vm.Script(`(async () => {\n${body}\n})()`, {
    filename: `${meta.name}.workflow.js`,
  }).runInContext(context, { timeout: 1_000 });
  await Promise.allSettled([...pending]);
  const safeWorkflowResult = redactValue(result);
  assertStructuredCloneable(safeWorkflowResult);
  const durationMs = Date.now() - started;
  const budget = budgetStatus();
  await store.writeJson("summary.json", {
    runId,
    meta,
    phases: state.phases,
    logs: state.logs,
    agentCount: state.agentCount,
    durationMs,
    warnings: state.warnings,
    aggregateUsage: state.aggregateUsage,
    usageUnavailableCount: state.usageUnavailableCount,
    budget,
    result: safeWorkflowResult,
  });

  return {
    runId,
    meta,
    result: safeWorkflowResult as T,
    logs: state.logs,
    phases: state.phases,
    agentCount: state.agentCount,
    durationMs,
    artifactRoot: store.runRoot,
    warnings: state.warnings,
    aggregateUsage: state.aggregateUsage,
    usageUnavailableCount: state.usageUnavailableCount,
    budget,
  };
}

function normalizeAgentOptions(value: unknown): AgentOptions {
  if (!value || typeof value !== "object") return {};
  const options = value as AgentOptions & Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (!agentOptionKeys.has(key)) throw new Error(`unsupported agent option: ${key}`);
  }
  if (options.sandbox !== undefined && !["read-only", "workspace-write"].includes(String(options.sandbox))) {
    throw new Error("agent sandbox must be read-only or workspace-write");
  }
  if (options.writeScope !== undefined && !["none", "worktree"].includes(String(options.writeScope))) {
    throw new Error("agent writeScope must be none or worktree");
  }
  if (options.reasoningEffort !== undefined && !reasoningEfforts.includes(String(options.reasoningEffort) as any)) {
    throw new Error("agent reasoningEffort must be minimal, low, medium, or high");
  }
  if (options.timeoutMs !== undefined && (typeof options.timeoutMs !== "number" || !Number.isFinite(options.timeoutMs))) {
    throw new Error("agent timeoutMs must be a finite number");
  }
  return {
    ...options,
    label: optionalString(options.label, "agent label"),
    phase: optionalString(options.phase, "agent phase"),
    model: optionalString(options.model, "agent model"),
    reasoningEffort: options.reasoningEffort,
    sandbox: options.sandbox,
    writeScope: options.writeScope,
  };
}

function evaluateLiteral(node: AnyNode | undefined, path: string): unknown {
  if (!node) throw new Error(`${path} must have a literal value`);
  switch (node.type) {
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as AnyNode[]) {
        if (prop.type === "SpreadElement") throw new Error(`spread not allowed in ${path}`);
        if (prop.type !== "Property" || prop.computed || prop.kind !== "init" || prop.method) {
          throw new Error(`only plain properties allowed in ${path}`);
        }
        const key = propertyKey(prop.key as AnyNode, path);
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`reserved key in ${path}`);
        out[key] = evaluateLiteral(prop.value as AnyNode, `${path}.${key}`);
      }
      return out;
    }
    case "ArrayExpression":
      return (node.elements as Array<AnyNode | null>).map((element, index) => {
        if (!element) throw new Error(`sparse arrays not allowed in ${path}`);
        if (element.type === "SpreadElement") throw new Error(`spread not allowed in ${path}`);
        return evaluateLiteral(element, `${path}[${index}]`);
      });
    case "Literal":
      return node.value;
    case "TemplateLiteral":
      if (node.expressions.length > 0) throw new Error(`template interpolation not allowed in ${path}`);
      return node.quasis.map((quasi: AnyNode) => quasi.value.cooked ?? quasi.value.raw).join("");
    default:
      throw new Error(`non-literal node type in ${path}: ${node.type}`);
  }
}

function validateMeta(meta: unknown): asserts meta is WorkflowMeta {
  if (!meta || typeof meta !== "object") throw new Error("meta must be an object");
  const value = meta as WorkflowMeta;
  if (typeof value.name !== "string" || !/^[a-z0-9_/-]+$/i.test(value.name)) {
    throw new Error("meta.name must be a non-empty safe string");
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("meta.description must be a non-empty string");
  }
  if (value.phases !== undefined && !Array.isArray(value.phases)) throw new Error("meta.phases must be an array");
}

function assertDeterministicAst(node: AnyNode): void {
  assertForbiddenAst(node);
  if (isDateNowCall(node) || isMathRandomCall(node) || isNewDateExpression(node)) {
    throw new Error("Workflow scripts must be deterministic");
  }
  for (const child of astChildren(node)) assertDeterministicAst(child);
}

function assertForbiddenAst(node: AnyNode): void {
  if (node.type === "ImportExpression") throw new Error("dynamic import is forbidden");
  if (isForbiddenProcessAccess(node)) throw new Error("process access is forbidden except process.cwd()");
  assertAgentOptionsAst(node);
  if (node.type === "CallExpression" && node.callee?.type === "Identifier" && ["eval", "require", "Function"].includes(node.callee.name)) {
    throw new Error(`${node.callee.name} is forbidden`);
  }
  if (node.type === "NewExpression" && node.callee?.type === "Identifier" && node.callee.name === "Function") {
    throw new Error("Function constructor is forbidden");
  }
  if (node.type === "Identifier" && ["globalThis", "Buffer"].includes(node.name)) {
    throw new Error(`${node.name} is forbidden`);
  }
  if (node.type === "MemberExpression" && propertyName(node.property) === "constructor") {
    throw new Error("constructor property access is forbidden");
  }
}

function astChildren(node: AnyNode): AnyNode[] {
  const children: AnyNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) children.push(...value.filter(isAstNode));
    else if (isAstNode(value)) children.push(value);
  }
  return children;
}

function isAstNode(value: unknown): value is AnyNode {
  return !!value && typeof value === "object" && typeof (value as AnyNode).type === "string";
}

function isDateNowCall(node: AnyNode): boolean {
  return node.type === "CallExpression" && isMemberExpression(node.callee, "Date", "now");
}

function isMathRandomCall(node: AnyNode): boolean {
  return node.type === "CallExpression" && isMemberExpression(node.callee, "Math", "random");
}

function isNewDateExpression(node: AnyNode): boolean {
  return node.type === "NewExpression" && node.callee?.type === "Identifier" && node.callee.name === "Date";
}

function isForbiddenProcessAccess(node: AnyNode): boolean {
  if (node.type !== "MemberExpression" || node.object?.type !== "Identifier" || node.object.name !== "process") return false;
  return propertyName(node.property) !== "cwd";
}

function assertAgentOptionsAst(node: AnyNode): void {
  if (node.type !== "CallExpression" || node.callee?.type !== "Identifier" || node.callee.name !== "agent") return;
  const options = node.arguments?.[1] as AnyNode | undefined;
  if (options?.type !== "ObjectExpression") return;
  for (const prop of options.properties as AnyNode[]) {
    if (prop.type !== "Property" || prop.computed || prop.kind !== "init" || prop.method) continue;
    const key = propertyName(prop.key as AnyNode);
    const value = prop.value as AnyNode;
    if (!key || !agentOptionKeys.has(key)) throw new Error(`workflow validation forbids unsupported agent option: ${key ?? "unknown"}`);
    if (key === "sandbox" && value.type === "Literal" && value.value === "workspace-write") {
      throw new Error("workflow validation forbids worker write requests in MVP");
    }
    if (key === "writeScope" && value.type === "Literal" && value.value === "worktree") {
      throw new Error("workflow validation forbids worker write requests in MVP");
    }
    if (key === "reasoningEffort" && value.type === "Literal" && !reasoningEfforts.includes(String(value.value) as any)) {
      throw new Error("workflow validation forbids unsupported reasoningEffort");
    }
  }
}

function isMemberExpression(node: AnyNode | undefined, objectName: string, propertyName: string): boolean {
  return (
    node?.type === "MemberExpression" &&
    node.object?.type === "Identifier" &&
    node.object.name === objectName &&
    ((node.property?.type === "Identifier" && node.property.name === propertyName) ||
      (node.property?.type === "Literal" && node.property.value === propertyName))
  );
}

function propertyName(node: AnyNode | undefined): string | undefined {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

function propertyKey(node: AnyNode, path: string): string {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) {
    return String(node.value);
  }
  throw new Error(`unsupported key type in ${path}`);
}

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, name);
}

function assertStructuredCloneable(value: unknown): void {
  try {
    structuredClone(value);
  } catch {
    throw new Error("workflow result must be structured-cloneable; did you forget to await a promise?");
  }
}
