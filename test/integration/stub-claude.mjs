#!/usr/bin/env node
// Stand-in for the `claude` CLI that OpenClaw's claude-cli runtime starts. It logs every start,
// answers the housekeeping calls, and for a model turn (`--session-id`) speaks Claude Code's
// stream-json: a thinking block streamed in pieces, then a text block, then the result.
// Usage: STUB_LOG=<file> STUB_MODE=fail|stream. `fail` exits 1 like a CLI with no login.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, `started ${new Date().toTimeString().slice(0, 8)} ${args.join(" ")}\n`);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (args[0] === "--version") { console.log("2.1.0 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { out({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }); process.exit(0); }
if (process.env.STUB_MODE !== "stream" || !args.includes("--session-id")) { console.error("stub: no model"); process.exit(1); }
const sid = args[args.indexOf("--session-id") + 1];
let n = 0;
const turn = async () => {
  const id = `msg_${++n}`;
  out({ type: "stream_event", event: { type: "message_start", message: { id, type: "message", role: "assistant", content: [], model: "claude-opus-5-5" } } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } });
  for (const piece of ["Checking ", "the request, ", "weighing options, ", "settling on a short answer."]) {
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: piece } } });
    await sleep(1500);
  }
  out({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  out({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } });
  out({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Stub answer." } } });
  out({ type: "stream_event", event: { type: "content_block_stop", index: 1 } });
  const message = { id, type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Stub answer." }], usage: { input_tokens: 1, output_tokens: 1 } };
  out({ type: "stream_event", event: { type: "message_stop" } });
  out({ type: "assistant", message, session_id: sid });
  out({ type: "result", subtype: "success", is_error: false, result: "Stub answer.", session_id: sid, duration_ms: 6000, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } });
};
out({ type: "system", subtype: "init", session_id: sid, model: "claude-opus-5-5", tools: [], mcp_servers: [] });
createInterface({ input: process.stdin }).on("line", (l) => { if (process.env.STUB_TRACE) appendFileSync(process.env.STUB_TRACE, l.slice(0, 600) + "\n"); try { const m = JSON.parse(l); if (m.type === "control_request") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } }); else if (m.type === "user") turn(); } catch {} });
