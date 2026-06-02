#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = join(root, "plugins", "codex-dynamic-workflows-lab");

const copiedDirectories = [".codex-plugin", "dist", "examples", "skills"];
const copiedFiles = [".mcp.json", "LICENSE", "README.md", "RESULTATS.md", "package.json"];

await rm(pluginRoot, { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });

for (const directory of copiedDirectories) {
  await cp(join(root, directory), join(pluginRoot, directory), { recursive: true });
}

for (const file of copiedFiles) {
  await cp(join(root, file), join(pluginRoot, file));
}

console.log(`Synced marketplace plugin to ${pluginRoot}`);
