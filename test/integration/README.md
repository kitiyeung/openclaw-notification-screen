# Integration run

Runs the plugin on a throwaway OpenClaw 2026.11.10 gateway: its own state directory, a stub `claude`
CLI (`stub-claude.mjs`) that logs every start and either fails or streams a reply, a fake phone
node and a mock Telegram Bot API. It never touches a real gateway. Needs Node 24
(`>=24.16 <25`) and `npm i openclaw@2026.11.10` somewhere.

```bash
OPENCLAW_BIN_DIR=<dir with node 24 and openclaw on PATH> \
OPENCLAW_DIST=<openclaw package>/dist \
bash test/integration/run.sh
```

`PLUGIN_DIR=<other checkout>` runs the same checks against another copy of the plugin, to show a
check fails before a change and passes after it. `KEEP=1` keeps the temporary directory.

The fake phone sends every event with `sessionKey: "agent:main:notifications"`, the app's Route
Session Key setting. It prints PASS or FAIL per check, in three phases:

1. Real plugin, no decision model configured: every evaluation is `unavailable`, so the plugin
   fails open. The plugin registers `before_agent_run` and no `message_sending` or
   `reply_payload_sending` hook (`openclaw plugins inspect --runtime`). A posting starts the model;
   a removal in live mode is blocked.
2. Stub decision: the real `index.ts` with only the decision replaced. A "no" posting starts no
   model; 10 "no" postings leave block records in the notifications session, start no model, send
   nothing to the mock Telegram and add nothing to `agent:main:main`; a "yes" posting runs a turn.
3. Owner DM with `/reasoning stream` and a streaming stub model: the mock Telegram sees a
   `sendMessage` draft, at least one `editMessageText`, then the final reply, while a "no" posting is
   still dropped.

The fake phone finds OpenClaw's internal modules by the export they carry, because their file names
carry a hash that changes every release; it needs the 2026.11 client API.
