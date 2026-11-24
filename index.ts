import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PLUGIN_ID, askDecision, createScreen, resolveConfig } from "./src/screen.ts";

/** `agent:<id>:<rest>` -> `<id>`; undefined selects the global default. */
const agentIdOf = (key: string) => /^agent:([^:]+):/.exec(key)?.[1];

const DAY_MS = 24 * 60 * 60 * 1000;

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Notification screen",
  description:
    "Screens forwarded phone notifications with a local decision model before the main agent's model runs.",
  register(api: any) {
    const config = resolveConfig(api.pluginConfig);
    const screen = createScreen({
      config,
      log: (line) => api.logger.info(line),
      decide: (note, signal) =>
        askDecision((req, opts) => api.runtime.decisions.evaluate(req, opts), note, {
          agentId: agentIdOf(config.sessionKey),
          timeoutMs: config.decisionTimeoutMs,
          signal,
        }),
    });
    api.on("before_agent_run", (event: any, ctx: any) => screen.beforeAgentRun(event, ctx));
    api.on("message_sending", (event: any, ctx: any) => screen.messageSending(event, ctx));
    const timer = setInterval(() => api.logger.info(screen.dailyLine()), DAY_MS);
    timer.unref?.();
    api.logger.info(`notification-screen: registered mode=${config.mode}`);
  },
});
