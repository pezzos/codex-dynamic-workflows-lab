import { mkdir, readFile, writeFile, appendFile, lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorkflowMeta, WorkflowPolicy } from "./types.js";
import { stablePolicyHash } from "./policy.js";

export interface ArtifactStoreOptions {
  root: string;
  runId: string;
}

export class ArtifactStore {
  readonly root: string;
  readonly runId: string;
  readonly runRoot: string;
  readonly agentsRoot: string;

  constructor(options: ArtifactStoreOptions) {
    this.root = resolve(options.root);
    this.runId = options.runId;
    assertSafeId(options.runId, "runId");
    this.runRoot = join(this.root, "runs", options.runId);
    this.agentsRoot = join(this.runRoot, "agents");
  }

  async init(meta: WorkflowMeta, policy: WorkflowPolicy): Promise<void> {
    await mkdir(this.agentsRoot, { recursive: true });
    await this.writeJson("workflow.json", {
      runId: this.runId,
      meta,
      policy,
      policyHash: stablePolicyHash(policy),
      createdAt: new Date().toISOString(),
    });
    await this.appendEvent({ type: "run.created", runId: this.runId, policyHash: stablePolicyHash(policy) });
  }

  agentDir(agentId: string): string {
    assertSafeId(agentId, "agentId");
    return join(this.agentsRoot, agentId);
  }

  async initAgent(agentId: string, label: string, prompt: string): Promise<string> {
    const dir = this.agentDir(agentId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "prompt.md"), prompt, "utf8");
    await this.appendEvent({ type: "agent.created", runId: this.runId, agentId, label });
    return dir;
  }

  async writeAgentJson(agentId: string, file: string, value: unknown): Promise<string> {
    assertSafeFilename(file);
    const dir = this.agentDir(agentId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, file);
    await writeFile(path, JSON.stringify(value, null, 2), "utf8");
    return path;
  }

  async writeAgentText(agentId: string, file: string, value: string): Promise<string> {
    assertSafeFilename(file);
    const dir = this.agentDir(agentId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, file);
    await writeFile(path, value, "utf8");
    return path;
  }

  async appendEvent(event: Record<string, unknown>): Promise<void> {
    await mkdir(this.runRoot, { recursive: true });
    await appendFile(join(this.runRoot, "events.jsonl"), `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  }

  async writeJson(file: string, value: unknown): Promise<string> {
    assertSafeFilename(file);
    await mkdir(this.runRoot, { recursive: true });
    const path = join(this.runRoot, file);
    await writeFile(path, JSON.stringify(value, null, 2), "utf8");
    return path;
  }

  async readJson<T>(file: string): Promise<T> {
    assertSafeFilename(file);
    const path = join(this.runRoot, file);
    await assertInsideRoot(path, this.runRoot);
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
}

export function assertSafeId(value: string, name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${name} contains unsafe characters`);
  }
}

export function assertSafeFilename(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`unsafe artifact filename: ${value}`);
  }
}

export async function assertInsideRoot(path: string, root: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!resolvedPath.startsWith(`${resolvedRoot}/`) && resolvedPath !== resolvedRoot) {
    throw new Error(`path escapes artifact root: ${path}`);
  }
  try {
    const stat = await lstat(resolvedPath);
    if (stat.isSymbolicLink()) throw new Error(`symlink artifacts are forbidden: ${path}`);
    const actual = await realpath(resolvedPath);
    if (!actual.startsWith(`${resolvedRoot}/`) && actual !== resolvedRoot) {
      throw new Error(`real path escapes artifact root: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as any).code === "ENOENT") return;
    throw error;
  }
}
