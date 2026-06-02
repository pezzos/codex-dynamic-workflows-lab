#!/usr/bin/env node
import { build } from "esbuild";

await build({
  entryPoints: ["src/mcp-server.ts"],
  outfile: "dist/plugin/mcp-server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  external: [],
});
