#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  if (stdin.includes("FAKE_HANG")) {
    setTimeout(() => {}, 60_000);
    return;
  }
  if (stdin.includes("FAKE_FAIL")) {
    console.log("warning: non json line");
    process.stderr.write("fake failure\n");
    process.exit(2);
  }
  if (stdin.includes("FAKE_ENV_PROBE")) {
    const authPath = process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "auth.json") : undefined;
    const authBytes = authPath ? readOptionalFile(authPath) : undefined;
    console.log(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({
            home: process.env.HOME,
            codexHome: process.env.CODEX_HOME,
            codexHomeEntries: process.env.CODEX_HOME ? readdirOptional(process.env.CODEX_HOME) : [],
            authSha256: authBytes ? createHash("sha256").update(authBytes).digest("hex") : null,
            authMode: authPath ? modeOptional(authPath) : null,
            hasWorkerMarker: process.env.CODEX_FLOW_WORKER === "1",
          }),
        },
      }),
    );
    return;
  }
  if (stdin.includes("FAKE_LARGE_STDOUT_NO_LAST")) {
    process.stderr.write("fake large stdout without last message\n");
    console.log("x".repeat(4096));
    return;
  }
  if (stdin.includes("FAKE_LARGE_STDOUT")) {
    writeLastMessage("fake-large-result rt_large_secret_token_123456789");
    process.stderr.write("fake large stdout rt_stderr_secret_token_123456789\n");
    console.log(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "event-result rt_event_secret_token_123456789",
        },
      }),
    );
    console.log(`rt_stdout_secret_token_123456789 ${"x".repeat(4096)}`);
    return;
  }
  console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-thread" }));
  console.log("not json but tolerated");
  console.log(
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: `fake-result:${stdin.slice(0, 80)}`,
      },
    }),
  );
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }));
});

function writeLastMessage(value) {
  const outputFlag = process.argv.indexOf("-o");
  const outputPath = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
  if (outputPath) writeFileSync(outputPath, value, "utf8");
}

function readdirOptional(path) {
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

function readOptionalFile(path) {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

function modeOptional(path) {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}
