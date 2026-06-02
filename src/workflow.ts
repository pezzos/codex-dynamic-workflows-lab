import vm from "node:vm";
import { parse } from "acorn";
import type { Node } from "acorn";
import { ArtifactStore } from "./artifacts.js";
import { normalizePolicy } from "./policy.js";
import type {
  AgentOptions,
  AgentRunInput,
  AgentRunner,
  WorkflowMeta,
  WorkflowPolicy,
  WorkflowRunResult,
} from "./types.js";

type AnyNode = Node & { [key: string]: any; start: number; end: number };

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

  const state: RuntimeState = { logs: [], phases: [], agentCount: 0, warnings: [] };
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
    const message = String(value);
    state.logs.push(message);
    void store.appendEvent({ type: "log", runId, message });
  };

  const agent = async (prompt: unknown, rawOptions: unknown = {}) => {
    throwIfAborted();
    if (state.agentCount >= policy.maxAgents) throw new Error("workflow maxAgents exhausted");
    const agentPrompt = requireString(prompt, "agent prompt");
    const agentOptions = normalizeAgentOptions(rawOptions);
    if (agentOptions.sandbox === "workspace-write" && policy.mode !== "write-worktree") {
      throw new Error("worker requested writes but workflow policy is read-only");
    }

    const assignedPhase = agentOptions.phase ?? state.currentPhase;
    const taskNumber = state.agentCount + 1;
    const label = agentOptions.label?.trim() || (assignedPhase ? `${assignedPhase} ${taskNumber}` : `agent ${taskNumber}`);
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
        await store.writeAgentJson(agentId, "result.json", result);
        await store.appendEvent({ type: "agent.completed", runId, agentId, label, status: result.status });
        state.warnings.push(...result.warnings);
        return result.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
        total: null,
        spent: () => 0,
        remaining: () => Number.POSITIVE_INFINITY,
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
  assertStructuredCloneable(result);
  const durationMs = Date.now() - started;
  await store.writeJson("summary.json", {
    runId,
    meta,
    phases: state.phases,
    logs: state.logs,
    agentCount: state.agentCount,
    durationMs,
    warnings: state.warnings,
    result,
  });

  return {
    runId,
    meta,
    result: result as T,
    logs: state.logs,
    phases: state.phases,
    agentCount: state.agentCount,
    durationMs,
    artifactRoot: store.runRoot,
    warnings: state.warnings,
  };
}

function normalizeAgentOptions(value: unknown): AgentOptions {
  if (!value || typeof value !== "object") return {};
  const options = value as AgentOptions;
  return {
    ...options,
    label: optionalString(options.label, "agent label"),
    phase: optionalString(options.phase, "agent phase"),
    model: optionalString(options.model, "agent model"),
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
