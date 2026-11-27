import http from "node:http"; import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
const LOG = process.argv[2], TRIGGER = process.argv[3]; let uid = 100; let sentDm = false;
const reply = (res, result) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, result })); };
http.createServer((req, res) => {
  let body = ""; req.on("data", d => body += d); req.on("end", () => {
    const m = req.url.split("/").pop().split("?")[0];
    if (m !== "getUpdates") appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), m, body: body.slice(0, 400) }) + "\n");
    if (m === "getMe") return reply(res, { id: 999, is_bot: true, first_name: "TestBot", username: "test_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false });
    if (m === "getUpdates") {
      if (existsSync(TRIGGER)) { const said = readFileSync(TRIGGER, "utf8").trim() || "hello from owner"; unlinkSync(TRIGGER); const now = Math.floor(Date.now()/1000);
        return reply(res, [{ update_id: ++uid, message: { message_id: uid, date: now, chat: { id: 4242, type: "private", first_name: "Owner" }, from: { id: 4242, is_bot: false, first_name: "Owner" }, text: said } }]); }
      return setTimeout(() => reply(res, []), 1500);
    }
    if (m === "sendMessage" || m === "editMessageText" || m === "sendChatAction") return reply(res, { message_id: ++uid, date: Math.floor(Date.now()/1000), chat: { id: 4242, type: "private" }, text: "x" });
    return reply(res, true);
  });
}).listen(28790, "127.0.0.1", () => console.log("mock telegram on 28790"));
