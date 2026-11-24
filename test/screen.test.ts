import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_MESSAGE, PLUGIN_ID, askDecision, createScreen, parseNotification, resolveConfig,
} from "../src/screen.ts";

// Made-up notifications in the shape OpenClaw forwards.
const posted = (pkg: string, body = "Order shipped - Your parcel is on the way") =>
  `Notification posted (node=n1 key=k1 package=${pkg}): ${body}\n\nRuntime: agent=main host=h`;
const removed = (pkg: string) => `Notification removed (node=n1 key=k1 package=${pkg})\n\nRuntime: x`;
const EVENT = { trigger: "event", sessionKey: "agent:main:main" };

function build(overrides: Record<string, unknown>, decide: (...a: any[]) => Promise<{ probability: number }>) {
  const lines: string[] = [];
  const screen = createScreen({ config: resolveConfig(overrides), decide: decide as any, log: (l) => lines.push(l) });
  return { screen, lines };
}
const p = (v: number) => async () => ({ probability: v });

test("parse: posted extracts package and text, drops runtime footer", () => {
  assert.deepEqual(parseNotification(posted("com.example.shop")), {
    kind: "posted", pkg: "com.example.shop", text: "Order shipped - Your parcel is on the way",
  });
});
test("parse: removed, and non-notification inputs are undefined", () => {
  assert.deepEqual(parseNotification(removed("com.example.maps")), { kind: "removed", pkg: "com.example.maps" });
  for (const v of ["hello", "", undefined, null, 42, {}, "Notification posted (node=" + "x".repeat(0)]) {
    if (v === "Notification posted (node=") continue;
    assert.equal(parseNotification(v), undefined);
  }
});
test("parse: malformed notification prompt still parses without throwing", () => {
  assert.deepEqual(parseNotification("Notification posted (node=n1"), { kind: "posted", pkg: "unknown", text: "" });
});

test("scope: out-of-scope turns pass synchronously (no promise)", () => {
  const { screen } = build({ mode: "live" }, p(0));
  const cases: [any, any][] = [
    [{ prompt: "hi there" }, EVENT],
    [{ prompt: posted("a.b") }, { trigger: "user", sessionKey: "agent:main:main" }],
    [{ prompt: posted("a.b") }, { trigger: "cron", sessionKey: "agent:main:main" }],
    [{ prompt: posted("a.b") }, { trigger: "event", sessionKey: "agent:other:main" }],
    [{ prompt: "Restarted" }, EVENT],
    [undefined, undefined],
    [{ prompt: 5 }, EVENT],
  ];
  for (const [e, c] of cases) {
    const r = screen.beforeAgentRun(e, c);
    assert.ok(!(r instanceof Promise));
    assert.deepEqual(r, { outcome: "pass" });
  }
  assert.equal(screen.counts.handled, 0);
});

test("live: low probability blocks with the plugin message", async () => {
  const { screen, lines } = build({ mode: "live" }, p(0.1));
  const r = await screen.beforeAgentRun({ prompt: posted("com.example.vpn", "Connected - tap to disconnect") }, EVENT);
  assert.equal((r as any).outcome, "block");
  assert.equal((r as any).message, BLOCK_MESSAGE);
  assert.deepEqual(screen.counts, { handled: 1, declined: 1, errors: 0 });
  assert.match(lines[0]!, /package=com\.example\.vpn verdict=no p=0\.100/);
});
test("live: high probability passes; threshold is honoured", async () => {
  const { screen } = build({ mode: "live", threshold: 0.7 }, p(0.6));
  assert.equal(((await screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT)) as any).outcome, "block");
  const hi = build({ mode: "live" }, p(0.9));
  assert.deepEqual(await hi.screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT), { outcome: "pass" });
  assert.deepEqual(hi.screen.counts, { handled: 1, declined: 0, errors: 0 });
});
test("live: removal blocks without asking the model", () => {
  let asked = 0;
  const { screen } = build({ mode: "live" }, async () => { asked++; return { probability: 1 }; });
  const r = screen.beforeAgentRun({ prompt: removed("a.b") }, EVENT);
  assert.equal((r as any).outcome, "block");
  assert.equal(asked, 0);
});
test("shadow (default): always passes but counts and logs the would-be verdict", async () => {
  const { screen, lines } = build({}, p(0.01));
  assert.deepEqual(await screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT), { outcome: "pass" });
  assert.deepEqual(screen.beforeAgentRun({ prompt: removed("a.b") }, EVENT), { outcome: "pass" });
  assert.deepEqual(screen.counts, { handled: 2, declined: 2, errors: 0 });
  assert.match(lines[0]!, /verdict=no .*mode=shadow/);
});

test("fail open: decide rejects, throws synchronously, or returns junk", async () => {
  for (const decide of [
    async () => { throw new Error("boom"); },
    () => { throw new Error("sync boom"); },
    async () => ({ probability: Number.NaN }),
  ]) {
    const { screen } = build({ mode: "live" }, decide as any);
    // NaN < threshold is false, so it passes too
    assert.deepEqual(await screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT), { outcome: "pass" });
  }
  const { screen } = build({ mode: "live" }, async () => { throw new Error("boom"); });
  await screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT);
  assert.equal(screen.counts.errors, 1);
});
test("fail open: a decision slower than decisionTimeoutMs passes and aborts the call", async () => {
  let aborted = false;
  const { screen } = build({ mode: "live", decisionTimeoutMs: 100 }, (_n: any, signal: AbortSignal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return new Promise(() => {});
  });
  const t0 = Date.now();
  const r = await screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT);
  assert.deepEqual(r, { outcome: "pass" });
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(aborted);
  assert.equal(screen.counts.errors, 1);
});

test("logs never carry title or text", async () => {
  const { screen, lines } = build({ mode: "live" }, p(0.2));
  await screen.beforeAgentRun({ prompt: posted("a.b", "Alice - secret meeting at 5pm") }, EVENT);
  assert.ok(lines.length > 0);
  for (const l of lines) assert.doesNotMatch(l, /Alice|secret|meeting/);
  assert.ok(!screen.dailyLine().includes("Alice"));
});
test("daily line format and reset", async () => {
  const { screen } = build({ mode: "live" }, p(0.2));
  await screen.beforeAgentRun({ prompt: posted("a.b") }, EVENT);
  assert.equal(screen.dailyLine(), "notification-screen: handled=1 declined=1 errors=0");
  assert.equal(screen.dailyLine(), "notification-screen: handled=0 declined=0 errors=0");
});

test("message_sending cancels only the plugin's own notice on the session", () => {
  const { screen } = build({}, p(1));
  const own = `Your message could not be sent: ${BLOCK_MESSAGE} (blocked by ${PLUGIN_ID})`;
  assert.deepEqual(screen.messageSending({ content: own }, { sessionKey: "agent:main:main" }), {
    cancel: true, cancelReason: "notification screen block notice",
  });
  for (const [e, c] of [
    [{ content: own }, { sessionKey: "agent:other:main" }],
    [{ content: "Your message could not be sent: x (blocked by before_agent_run)" }, { sessionKey: "agent:main:main" }],
    [{ content: "Your message could not be sent: x (blocked by other-plugin)" }, { sessionKey: "agent:main:main" }],
    [{ content: "normal reply" }, { sessionKey: "agent:main:main" }],
    [{ content: 5 }, { sessionKey: "agent:main:main" }],
    [undefined, undefined],
  ] as any[]) {
    assert.equal(screen.messageSending(e, c), undefined);
  }
});

test("config: invalid values fall back to defaults", () => {
  assert.deepEqual(resolveConfig({ mode: "bogus", decisionTimeoutMs: -1, threshold: 7, sessionKey: "" }), resolveConfig(undefined));
  assert.equal(resolveConfig({ mode: "live" }).mode, "live");
});

test("askDecision: ok boolean answer returns probabilityTrue; builds one boolean question", async () => {
  let seen: any;
  const v = await askDecision(async (req, opts) => {
    seen = { req, opts };
    return { status: "ok", result: { answers: { needed: { type: "boolean", probabilityTrue: 0.8 } } } };
  }, { pkg: "a.b", text: "t" }, { timeoutMs: 1234 });
  assert.equal(v.probability, 0.8);
  assert.equal(seen.req.questions.needed.type, "boolean");
  assert.deepEqual(seen.req.state, { package: "a.b", notification: "t" });
  assert.equal(seen.opts.timeoutMs, 1234);
});
test("askDecision: unavailable, missing and malformed answers throw", async () => {
  for (const out of [
    { status: "unavailable" }, undefined, { status: "ok", result: { answers: {} } },
    { status: "ok", result: { answers: { needed: { type: "score", score: 1 } } } },
  ]) {
    await assert.rejects(askDecision(async () => out as any, { pkg: "a", text: "b" }, { timeoutMs: 1 }));
  }
});
