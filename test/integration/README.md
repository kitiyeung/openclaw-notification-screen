# Integration run

Runs the plugin on a throwaway OpenClaw 2026.11.8 gateway: its own state directory, a stub `claude`
CLI that logs every start and exits, a fake phone node and a mock Telegram Bot API. It never
touches a real gateway. Needs Node 24 and `npm i openclaw@2026.11.8` somewhere.

```bash
OPENCLAW_BIN_DIR=<dir with node 24 and openclaw on PATH> \
OPENCLAW_DIST=<openclaw package>/dist \
bash test/integration/run.sh
```

It runs two phases and prints PASS or FAIL per check:

1. Real plugin, no decision model configured: every evaluation is `unavailable`, so the plugin
   fails open. A posting starts the model; a removal in live mode is blocked.
2. Stub decision (`stub-decision/`): a "no" posting starts no model; a "yes" posting runs a turn;
   25 "no" postings in a burst all settle with no model start; nothing reaches the mock Telegram.

The fake phone and the hashed `dist` module names match OpenClaw 2026.11.8 only.
