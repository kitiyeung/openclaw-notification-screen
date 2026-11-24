// Same wiring as ../../index.ts, but the decision is a stub: notifications that mention
// "Charging" score 0.05 (noise), everything else 0.9. Registered under the real plugin id so the
// block notice text matches. run.sh copies this folder and ../../src into a temp dir first, because
// the gateway loads a plugin only from inside its own root. Used only by the integration run.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PLUGIN_ID, createScreen, resolveConfig } from "./src/screen.ts";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Notification screen (stub decision)",
  description: "Integration run only.",
  register(api: any) {
    const config = resolveConfig(api.pluginConfig);
    const screen = createScreen({
      config,
      log: (l) => api.logger.info(l),
      decide: async (note) => ({ probability: note.text.includes("Charging") ? 0.05 : 0.9 }),
    });
    api.on("before_agent_run", (e: any, c: any) => screen.beforeAgentRun(e, c));
    api.on("message_sending", (e: any, c: any) => screen.messageSending(e, c));
  },
});
