#!/usr/bin/env node
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
  if (stdin.includes("FAKE_LARGE_STDOUT")) {
    process.stderr.write("fake large stdout\n");
    console.log("x".repeat(4096));
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
