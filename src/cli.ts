#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ArtifactStore } from "./artifacts.js";
import {
  createBenchmarkManifest,
  postflightBenchmarkArtifacts,
  preflightBenchmarkTarget,
  type BenchmarkMethod,
  type BenchmarkTargetMode,
} from "./benchmark.js";
import { CodexExecRunner } from "./codex-runner.js";
import { safeErrorMessage, sanitizeForReturn } from "./hygiene.js";
import { normalizePolicy } from "./policy.js";
import { parseWorkflowScript, runWorkflow } from "./workflow.js";
import type { RouteProfileId } from "./types.js";

interface CliOptions {
  cwd: string;
  artifacts: string;
  policyPath?: string;
  argsPath?: string;
  fake?: boolean;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || ["-h", "--help", "help"].includes(command)) {
    printHelp();
    return;
  }

  if (command === "validate") {
    const { workflowPath } = parseWorkflowPath(rest);
    const script = await readFile(workflowPath, "utf8");
    const parsed = parseWorkflowScript(script);
    printJson({ ok: true, meta: parsed.meta });
    return;
  }

  if (command === "run" || command === "submit") {
    const { workflowPath, options } = parseRunArgs(rest);
    const script = await readFile(workflowPath, "utf8");
    const cwd = resolve(options.cwd);
    const artifactRoot = resolve(options.artifacts);
    const policy = normalizePolicy(options.policyPath ? JSON.parse(await readFile(options.policyPath, "utf8")) : {});
    const args = options.argsPath ? JSON.parse(await readFile(options.argsPath, "utf8")) : undefined;
    const parsed = parseWorkflowScript(script);
    const runId = `${parsed.meta.name}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
    const store = new ArtifactStore({ root: artifactRoot, runId });
    const runner = new CodexExecRunner({
      cwd,
      store,
      policy,
      codexBin: options.fake ? join(process.cwd(), "scripts", "fake-codex.js") : undefined,
    });
    const result = await runWorkflow(script, { cwd, artifactRoot, runId, args, policy, runner });
    printJson(result);
    return;
  }

  if (command === "status" || command === "result") {
    const runId = rest[0];
    if (!runId) throw new Error(`${command} requires runId`);
    const options = parseOptions(rest.slice(1));
    const summary = JSON.parse(await readFile(join(resolve(options.artifacts), "runs", runId, "summary.json"), "utf8"));
    printJson(summary);
    return;
  }

  if (command === "artifacts") {
    const runId = rest[0];
    if (!runId) throw new Error("artifacts requires runId");
    const options = parseOptions(rest.slice(1));
    printJson({ runId, artifactRoot: join(resolve(options.artifacts), "runs", runId) });
    return;
  }

  if (command === "benchmark-preflight") {
    const target = rest[0];
    if (!target) throw new Error("benchmark-preflight requires target directory");
    const options = parseBenchmarkOptions(rest.slice(1));
    const result = await preflightBenchmarkTarget(target, options.targetMode);
    printJson({ target: resolve(target), targetMode: options.targetMode, ...result });
    if (!result.ok) process.exitCode = 2;
    return;
  }

  if (command === "benchmark-manifest") {
    const target = rest[0];
    if (!target) throw new Error("benchmark-manifest requires target directory");
    const options = parseBenchmarkOptions(rest.slice(1));
    printJson(
        createBenchmarkManifest({
          campaignId: options.campaignId,
          campaignFamilyId: options.campaignFamilyId,
          cohortId: options.cohortId,
          repeatIndex: options.repeatIndex,
          fixtureId: options.fixtureId,
          sanitizedFixtureHash: options.sanitizedFixtureHash,
          targetStateHash: options.targetStateHash,
          preflightStatus: options.preflightStatus,
          target,
          targetMode: options.targetMode,
          method: options.method,
          profiles: options.profiles,
          notes: options.notes,
        }),
    );
    return;
  }

  if (command === "benchmark-artifact-scan") {
    const artifactRoot = rest[0];
    if (!artifactRoot) throw new Error("benchmark-artifact-scan requires artifact root directory");
    const result = await postflightBenchmarkArtifacts(artifactRoot);
    printJson({ artifactRoot: resolve(artifactRoot), ...result });
    if (!result.ok) process.exitCode = 2;
    return;
  }

  if (command === "cancel") {
    const runId = rest[0];
    if (!runId) throw new Error("cancel requires runId");
    const options = parseOptions(rest.slice(1));
    const root = join(resolve(options.artifacts), "runs", runId);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "cancelled.json"), JSON.stringify({ runId, cancelledAt: new Date().toISOString() }, null, 2));
    printJson({ runId, status: "cancel_requested" });
    return;
  }

  if (command === "server") {
    const { startMcpServer } = await import("./mcp-server.js");
    await startMcpServer();
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

function parseWorkflowPath(args: string[]): { workflowPath: string } {
  const workflowPath = args.find((arg) => !arg.startsWith("--"));
  if (!workflowPath) throw new Error("workflow file path required");
  return { workflowPath: resolve(workflowPath) };
}

function parseRunArgs(args: string[]): { workflowPath: string; options: CliOptions } {
  const { workflowPath } = parseWorkflowPath(args);
  return { workflowPath, options: parseOptions(args.filter((arg) => arg !== workflowPath)) };
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    artifacts: join(process.cwd(), ".codex-workflows"),
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--cwd") options.cwd = args[++index];
    else if (arg === "--artifacts") options.artifacts = args[++index];
    else if (arg === "--policy") options.policyPath = resolve(args[++index]);
    else if (arg === "--args") options.argsPath = resolve(args[++index]);
    else if (arg === "--fake") options.fake = true;
  }
  return options;
}

function parseBenchmarkOptions(args: string[]): {
  campaignId: string;
  campaignFamilyId?: string;
  cohortId?: string;
  repeatIndex?: number;
  fixtureId?: string;
  sanitizedFixtureHash?: string;
  targetStateHash?: string;
  preflightStatus?: "pass" | "failed" | "not_run";
  targetMode: BenchmarkTargetMode;
  method: BenchmarkMethod;
  profiles: RouteProfileId[];
  notes: string[];
} {
  const options = {
    campaignId: "benchmark",
    campaignFamilyId: undefined as string | undefined,
    cohortId: undefined as string | undefined,
    repeatIndex: undefined as number | undefined,
    fixtureId: undefined as string | undefined,
    sanitizedFixtureHash: undefined as string | undefined,
    targetStateHash: undefined as string | undefined,
    preflightStatus: undefined as "pass" | "failed" | "not_run" | undefined,
    targetMode: "real_repo" as BenchmarkTargetMode,
    method: "workflow-routed" as BenchmarkMethod,
    profiles: [] as RouteProfileId[],
    notes: [] as string[],
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--campaign-id") options.campaignId = args[++index];
    else if (arg === "--campaign-family-id") options.campaignFamilyId = args[++index];
    else if (arg === "--cohort-id") options.cohortId = args[++index];
    else if (arg === "--repeat-index") options.repeatIndex = Number(args[++index]);
    else if (arg === "--fixture-id") options.fixtureId = args[++index];
    else if (arg === "--sanitized-fixture-hash") options.sanitizedFixtureHash = args[++index];
    else if (arg === "--target-state-hash") options.targetStateHash = args[++index];
    else if (arg === "--preflight-status") options.preflightStatus = args[++index] as "pass" | "failed" | "not_run";
    else if (arg === "--target-mode") options.targetMode = args[++index] as BenchmarkTargetMode;
    else if (arg === "--method") options.method = args[++index] as BenchmarkMethod;
    else if (arg === "--profile") options.profiles.push(args[++index] as RouteProfileId);
    else if (arg === "--note") options.notes.push(args[++index]);
    else throw new Error(`unsupported benchmark option: ${arg}`);
  }
  if (!["real_repo", "include_list", "sanitized_fixture"].includes(options.targetMode)) {
    throw new Error("benchmark target mode must be real_repo, include_list, or sanitized_fixture");
  }
  if (!["single", "manual", "workflow-classic", "workflow-routed"].includes(options.method)) {
    throw new Error("benchmark method must be single, manual, workflow-classic, or workflow-routed");
  }
  if (options.repeatIndex !== undefined && (!Number.isInteger(options.repeatIndex) || options.repeatIndex < 0)) {
    throw new Error("benchmark repeat index must be a non-negative integer");
  }
  if (options.preflightStatus !== undefined && !["pass", "failed", "not_run"].includes(options.preflightStatus)) {
    throw new Error("benchmark preflight status must be pass, failed, or not_run");
  }
  return options;
}

function printHelp(): void {
  console.log(`codex-flow

Usage:
  codex-flow validate <workflow.js>
  codex-flow run <workflow.js> [--cwd DIR] [--artifacts DIR] [--policy FILE] [--args FILE] [--fake]
  codex-flow status <runId> [--artifacts DIR]
  codex-flow result <runId> [--artifacts DIR]
  codex-flow artifacts <runId> [--artifacts DIR]
  codex-flow benchmark-preflight <target-dir> [--target-mode real_repo|include_list|sanitized_fixture]
  codex-flow benchmark-manifest <target-dir> [--campaign-id ID] [--campaign-family-id ID] [--cohort-id ID] [--repeat-index N] [--method single|manual|workflow-classic|workflow-routed] [--target-mode MODE] [--profile scout]
  codex-flow benchmark-artifact-scan <artifact-run-dir>
  codex-flow cancel <runId> [--artifacts DIR]
  codex-flow server
`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(sanitizeForReturn(value, "cli.stdout"), null, 2));
}

main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
