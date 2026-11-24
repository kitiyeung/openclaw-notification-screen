// Connects to a throwaway gateway as a paired node and sends `notifications.changed` node events,
// the same RPC the Android app sends. Usage: node fake-phone.mjs notify '<json array of payloads>'
// Needs OPENCLAW_DIST (the openclaw 2026.11.8 package's dist directory) and OPENCLAW_STATE_DIR.
const DIST = "file://" + process.env.OPENCLAW_DIST;
const { t: GatewayClient } = await import(`${DIST}/client-cXg8kULv.mjs`);
const { r: loadOrCreateDeviceIdentityAsync } = await import(`${DIST}/device-identity-async-B1EfjFkw.mjs`);
const { i: NAMES, r: MODES } = await import(`${DIST}/client-info-Cm1BcrMm.mjs`);
const [, , mode, ...rest] = process.argv;
const id = await loadOrCreateDeviceIdentityAsync();
const c = new GatewayClient({
  url: "ws://127.0.0.1:28789", token: "throwaway-test-token-123456",
  clientName: NAMES.NODE_HOST, clientDisplayName: "fake-phone", clientVersion: "2026.11.8",
  platform: "linux", mode: MODES.NODE, role: "node", scopes: [], caps: [], commands: ["notifications.list"],
  deviceIdentity: id,
  onHelloOk: async () => {
    if (mode === "notify") {
      for (const p of JSON.parse(rest[0])) {
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
