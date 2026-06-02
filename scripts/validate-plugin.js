#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
assert(plugin.name === "codex-dynamic-workflows-lab", "plugin name must be stable");
assert(plugin.version === "0.1.0", "plugin version must match package version");
assert(plugin.skills === "./skills/", "plugin skills path must point to ./skills/");
assert(plugin.mcpServers === "./.mcp.json", "plugin must declare .mcp.json");
assert(plugin.interface?.displayName, "plugin interface.displayName is required");

await assertExists(join(root, "skills", "dynamic-workflow", "SKILL.md"));
await assertExists(join(root, "dist", "src", "mcp-server.js"));
await assertExists(join(root, "dist", "plugin", "mcp-server.js"));

const mcp = await readJson(join(root, ".mcp.json"));
const server = mcp.mcpServers?.["codex-dynamic-workflows"];
assert(server?.type === "stdio", "MCP server must use stdio");
assert(server?.command === "node", "MCP server command must be node");
assert(server?.args?.[0] === "./dist/plugin/mcp-server.js", "MCP server must launch bundled dist/plugin/mcp-server.js");

const marketplace = await readJson(join(root, ".agents", "plugins", "marketplace.json"));
const entry = marketplace.plugins?.find((candidate) => candidate.name === plugin.name);
assert(entry, "marketplace must include this plugin");
assert(entry.source?.source === "local", "marketplace source must be local");
assert(entry.source?.path === "./", "marketplace path must point at the plugin root");
assert(entry.interface?.displayName === plugin.interface.displayName, "marketplace displayName must match plugin");

const smoke = await runMcpSmoke(server.command, server.args);
assert(smoke.includes("workflow_validate"), "MCP smoke must list workflow_validate");

console.log(JSON.stringify({ ok: true, plugin: plugin.name, marketplace: marketplace.name }, null, 2));

function runMcpSmoke(command, args) {
  return new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
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
        "",
      ].join("\n"),
    );
  });
}
