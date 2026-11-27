// Connects to a throwaway gateway as a paired node and sends `notifications.changed` node events,
// the same RPC the Android app sends. Usage: node fake-phone.mjs notify '<json array of payloads>'
// Needs OPENCLAW_DIST (the openclaw package's dist directory) and OPENCLAW_STATE_DIR.
// OpenClaw's internal chunk names carry a hash that changes every release, so the two internal
// helpers are found by the export name they carry; the client comes from the public plugin SDK.
import { readdirSync, readFileSync } from "node:fs";
const DIST = process.env.OPENCLAW_DIST;
const findChunk = (prefix, exportName) => {
  const f = readdirSync(DIST).find((n) => n.startsWith(prefix) && n.endsWith(".mjs") &&
    new RegExp(`export\\{[^}]*(?<![\\w])${exportName}(?!\\s+as\\b)[^}]*\\}\\s*;?\\s*$`).test(readFileSync(`${DIST}/${n}`, "utf8").slice(-2000)));
  if (!f) throw new Error(`no ${prefix}* chunk exports ${exportName}`);
  return import(`file://${DIST}/${f}`);
};
const { GatewayClient } = await import(`file://${DIST}/plugin-sdk/gateway-runtime.js`);
const { loadOrCreateDeviceIdentityAsync } = await findChunk("device-identity-async-", "loadOrCreateDeviceIdentityAsync");
const { GATEWAY_CLIENT_NAMES: NAMES, GATEWAY_CLIENT_MODES: MODES } = await findChunk("client-info-", "GATEWAY_CLIENT_NAMES");
const [, , mode, ...rest] = process.argv;
const id = await loadOrCreateDeviceIdentityAsync();
const c = new GatewayClient({
  url: "ws://127.0.0.1:28789", token: "throwaway-test-token-123456",
  clientName: NAMES.NODE_HOST, clientDisplayName: "fake-phone", clientVersion: "2026.11.10",
  platform: "linux", mode: MODES.NODE, role: "node", scopes: [], caps: [], commands: ["notifications.list"],
  deviceIdentity: id,
  onHelloOk: async () => {
    if (mode === "notify") {
      for (const p of JSON.parse(rest[0])) {
        if (process.env.PHONE_SESSION_KEY) p.sessionKey = process.env.PHONE_SESSION_KEY; // the app's Route Session Key setting
        try { const r = await c.request("node.event", { event: "notifications.changed", payloadJSON: JSON.stringify(p) }); console.log("sent", p.key, JSON.stringify(r)); }
        catch (e) { console.log("err", p.key, String(e)); }
      }
    }
    setTimeout(() => { c.stop?.(); process.exit(0); }, Number(process.env.HOLD_MS ?? 3000));
  },
  onConnectError: (e) => console.log("connect error", e.message),
  onClose: (code, reason) => console.log("close", code, String(reason)),
});
c.start();
setTimeout(() => { console.log("timeout"); process.exit(2); }, 60000);
