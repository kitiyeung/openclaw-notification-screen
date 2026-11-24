// Core logic. No OpenClaw imports, so it runs under plain `node --test`.

export const PLUGIN_ID = "notification-screen";
export const BLOCK_MESSAGE = "Phone notification screened";

export type Mode = "shadow" | "live";

export interface ScreenConfig {
  mode: Mode;
  decisionTimeoutMs: number;
  threshold: number;
  sessionKey: string;
}

export const DEFAULT_CONFIG: ScreenConfig = {
  mode: "shadow",
  decisionTimeoutMs: 4000,
  threshold: 0.5,
  sessionKey: "agent:main:main",
};

/** Invalid or missing values fall back to the defaults, never throw. */
export function resolveConfig(raw: unknown): ScreenConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : d;
  return {
    mode: r.mode === "live" ? "live" : "shadow",
    decisionTimeoutMs: num(r.decisionTimeoutMs, 100, 10000, DEFAULT_CONFIG.decisionTimeoutMs),
    threshold: num(r.threshold, 0, 1, DEFAULT_CONFIG.threshold),
    sessionKey:
      typeof r.sessionKey === "string" && r.sessionKey ? r.sessionKey : DEFAULT_CONFIG.sessionKey,
  };
}

export type ParsedNotification =
  | { kind: "posted"; pkg: string; text: string }
  | { kind: "removed"; pkg: string };

const POSTED = "Notification posted (node=";
const REMOVED = "Notification removed (node=";

/** Returns undefined for anything that is not a forwarded notification prompt. */
export function parseNotification(prompt: unknown): ParsedNotification | undefined {
  if (typeof prompt !== "string") return undefined;
  const posted = prompt.startsWith(POSTED);
  if (!posted && !prompt.startsWith(REMOVED)) return undefined;
  const headEnd = prompt.indexOf("):");
  const head = headEnd === -1 ? prompt.split("\n", 1)[0]! : prompt.slice(0, headEnd);
  const pkg = /\bpackage=([^\s)]+)/.exec(head)?.[1] ?? "unknown";
  if (!posted) return { kind: "removed", pkg };
  let text = headEnd === -1 ? "" : prompt.slice(headEnd + 2).trim();
  const runtime = text.indexOf("\n\nRuntime:");
  if (runtime !== -1) text = text.slice(0, runtime).trim();
  return { kind: "posted", pkg, text };
}

export interface Verdict {
  probability: number;
}

export type Evaluate = (
  request: unknown,
  options: Record<string, unknown>,
) => Promise<{ status: string; result?: { answers?: Record<string, any> } } | undefined>;

export const QUESTION = {
  type: "boolean",
  instructions:
    "Does the owner or their assistant need to know about this phone notification right now?",
  criteria: {
    true: "A message, alert, delivery, security or account event, or anything time-sensitive that a person should act on or know about",
    false: "Routine noise: an ongoing status, a progress bar, charging or connection state, a repeated update, promotion or app chatter",
  },
};

/** Ask the decision model one Boolean question. Throws on anything but an ok outcome. */
export async function askDecision(
  evaluate: Evaluate,
  note: { pkg: string; text: string },
  opts: { agentId?: string; timeoutMs: number; signal?: AbortSignal },
): Promise<Verdict> {
  const outcome = await evaluate(
    { state: { package: note.pkg, notification: note.text }, questions: { needed: QUESTION } },
    {
      agentId: opts.agentId,
      purpose: "notification.screen",
      rubricVersion: "1",
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    },
  );
  if (!outcome || outcome.status !== "ok") {
    throw new Error(`decision ${outcome?.status ?? "missing"}`);
  }
  const answer = outcome.result?.answers?.needed;
  const p = answer?.probabilityTrue;
  if (answer?.type !== "boolean" || typeof p !== "number" || !Number.isFinite(p)) {
    throw new Error("decision answer malformed");
  }
  return { probability: p };
}

export interface Counts {
  handled: number;
  declined: number;
  errors: number;
}

export interface Deps {
  config: ScreenConfig;
  decide: (note: { pkg: string; text: string }, signal: AbortSignal) => Promise<Verdict>;
  log: (line: string) => void;
}

type RunDecision = { outcome: "pass" } | { outcome: "block"; reason: string; message: string };

export function createScreen(deps: Deps) {
  const { config, decide, log } = deps;
  const counts: Counts = { handled: 0, declined: 0, errors: 0 };
  const pass: RunDecision = { outcome: "pass" };
  const block: RunDecision = {
    outcome: "block",
    reason: "notification screened by local decision model",
    message: BLOCK_MESSAGE,
  };
  const notice = `${BLOCK_MESSAGE} (blocked by ${PLUGIN_ID})`;

  async function screenPosted(note: { pkg: string; text: string }): Promise<RunDecision> {
    const started = Date.now();
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ctl.abort();
          rej(new Error("decision timeout"));
        }, config.decisionTimeoutMs);
      });
      const verdict = await Promise.race([decide(note, ctl.signal), timeout]);
      const noise = verdict.probability < config.threshold;
      const ms = Date.now() - started;
      counts.handled++;
      if (noise) counts.declined++;
      log(
        `notification-screen: package=${note.pkg} verdict=${noise ? "no" : "yes"} ` +
          `p=${verdict.probability.toFixed(3)} ms=${ms} mode=${config.mode}`,
      );
      return noise && config.mode === "live" ? block : pass;
    } catch (e) {
      counts.errors++;
      log(
        `notification-screen: package=${note.pkg} verdict=error ms=${Date.now() - started} ` +
          `reason=${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`,
      );
      return pass;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * The gate fails closed in OpenClaw, so this returns a plain object, synchronously,
   * for every turn out of scope, and never rejects.
   */
  function beforeAgentRun(
    event: { prompt?: unknown } | undefined,
    ctx: { trigger?: unknown; sessionKey?: unknown } | undefined,
  ): RunDecision | Promise<RunDecision> {
    try {
      if (ctx?.trigger !== "event" || ctx?.sessionKey !== config.sessionKey) return pass;
      const note = parseNotification(event?.prompt);
      if (!note) return pass;
      if (note.kind === "removed") {
        counts.handled++;
        counts.declined++;
        log(`notification-screen: package=${note.pkg} verdict=removal mode=${config.mode}`);
        return config.mode === "live" ? block : pass;
      }
      return screenPosted(note).catch(() => pass);
    } catch {
      return pass;
    }
  }

  /** Cancels exactly this plugin's own block notice on the configured session. */
  function messageSending(
    event: { content?: unknown; text?: unknown } | undefined,
    ctx: { sessionKey?: unknown } | undefined,
  ): { cancel: true; cancelReason: string } | undefined {
    try {
      if (ctx?.sessionKey !== config.sessionKey) return undefined;
      const text = event?.content ?? event?.text;
      if (typeof text === "string" && text.includes(notice)) {
        return { cancel: true, cancelReason: "notification screen block notice" };
      }
    } catch {
      /* fall through: send the message */
    }
    return undefined;
  }

  function dailyLine(): string {
    const line = `notification-screen: handled=${counts.handled} declined=${counts.declined} errors=${counts.errors}`;
    counts.handled = counts.declined = counts.errors = 0;
    return line;
  }

  return { beforeAgentRun, messageSending, dailyLine, counts };
}
