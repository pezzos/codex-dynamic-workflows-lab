#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function assertExists(path) {
  await access(path);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const plugin = await readJson(join(root, ".codex-plugin", "plugin.json"));
const packageJson = await readJson(join(root, "package.json"));
validatePluginManifest(plugin, packageJson.version);

await assertExists(join(root, "dist", "src", "mcp-server.js"));

const marketplace = await readJson(join(root, ".agents", "plugins", "marketplace.json"));
const entry = marketplace.plugins?.find((candidate) => candidate.name === plugin.name);
assert(entry, "marketplace must include this plugin");
assert(marketplace.interface?.displayName === plugin.interface.displayName, "marketplace displayName must match plugin");
assert(entry.source?.source === "local", "marketplace source must be local");
assert(entry.source?.path === "./plugins/codex-dynamic-workflows-lab", "marketplace path must point at the bundled plugin directory");
assert(entry.interface?.displayName === plugin.interface.displayName, "marketplace plugin displayName must match plugin");
assert(entry.interface?.shortDescription === plugin.interface.shortDescription, "marketplace plugin shortDescription must match plugin");

const marketplacePluginRoot = resolve(root, entry.source.path);
assert(normalize(marketplacePluginRoot).startsWith(normalize(join(root, "plugins"))), "marketplace plugin path must stay under plugins/");

const marketplacePlugin = await readJson(join(marketplacePluginRoot, ".codex-plugin", "plugin.json"));
validatePluginManifest(marketplacePlugin, packageJson.version);
assert(marketplacePlugin.name === plugin.name, "marketplace plugin name must match root plugin name");
assert(marketplacePlugin.version === plugin.version, "marketplace plugin version must match root plugin version");

await assertExists(join(marketplacePluginRoot, "skills", "dynamic-workflow", "SKILL.md"));
await assertExists(join(marketplacePluginRoot, "assets", "workflow-logo.svg"));
await assertExists(join(marketplacePluginRoot, "assets", "workflow-logo.png"));
await assertExists(join(marketplacePluginRoot, "dist", "plugin", "mcp-server.js"));

const mcp = await readJson(join(marketplacePluginRoot, ".mcp.json"));
const server = mcp.mcpServers?.["codex-dynamic-workflows"];
assert(server?.type === "stdio", "MCP server must use stdio");
assert(server?.command === "node", "MCP server command must be node");
assert(server?.args?.[0] === "./dist/plugin/mcp-server.js", "MCP server must launch bundled dist/plugin/mcp-server.js");

const smoke = await runMcpSmoke(server.command, server.args, marketplacePluginRoot);
assert(smoke.includes("workflow_validate"), "MCP smoke must list workflow_validate");
assert(smoke.includes(".codex-workflows-smoke"), "MCP smoke must resolve explicit artifact roots");

console.log(JSON.stringify({ ok: true, plugin: plugin.name, marketplace: marketplace.name }, null, 2));

function validatePluginManifest(candidate, expectedVersion) {
  assert(candidate.name === "codex-dynamic-workflows-lab", "plugin name must be stable");
  assert(candidate.version === expectedVersion, "plugin version must match package version");
  assert(candidate.skills === "./skills/", "plugin skills path must point to ./skills/");
assert(candidate.mcpServers === "./.mcp.json", "plugin must declare .mcp.json");
assert(candidate.interface?.displayName, "plugin interface.displayName is required");
assert(candidate.interface?.shortDescription?.length <= 80, "plugin shortDescription must stay compact");
assert(candidate.interface?.logo === "./assets/workflow-logo.png", "plugin must declare workflow logo");
assert(candidate.interface?.composerIcon === "./assets/workflow-logo.png", "plugin must declare workflow composer icon");
}

function runMcpSmoke(command, args, cwd) {
  return new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectSmoke(new Error("MCP smoke timed out"));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectSmoke(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) rejectSmoke(new Error(`MCP smoke exited ${code}: ${stderr}`));
      else resolveSmoke(stdout);
    });
    child.stdin.end(
      [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "validate-plugin", version: "0" } },
        }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "workflow_artifacts",
            arguments: { artifacts: join(cwd, ".codex-workflows-smoke"), runId: "smoke-run" },
          },
        }),
        "",
      ].join("\n"),
    );
  });
}
