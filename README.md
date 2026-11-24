# openclaw-notification-screen

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that screens forwarded Android phone
notifications with a local decision model before the main agent's model runs. Noise is blocked
with no model call (about half a second); anything else runs as a normal turn.

## Why

Each notification the OpenClaw Android app forwards becomes a system event on the main session and
a full model turn. A busy phone costs hundreds of turns a day, most for charging state, progress
bars and repeated updates. OpenClaw has no gateway-side screen for these turns, and
`before_agent_reply` does not run for them (their trigger is `event`), so this plugin uses the
documented `before_agent_run` gate instead.

## How it works

- `before_agent_run` is in scope only for `trigger: "event"` on the configured session
  (default `agent:main:main`) whose prompt starts with `Notification posted (node=` or
  `Notification removed (node=`. Everything else gets `{ outcome: "pass" }` synchronously.
- A posting asks `api.runtime.decisions.evaluate` one Boolean question with the package and the
  notification text as state. A probability below `threshold` is noise. A removal carries no news
  and is screened in live mode without asking the model.
- A block ends the turn as failed and OpenClaw sends `Your message could not be sent: … (blocked by
  notification-screen)` to the session's route. The plugin's `message_sending` hook cancels exactly
  that text on that session, and nothing else.
- Fails open. A decision error, an `unavailable` result, a malformed answer or a decision slower
  than `decisionTimeoutMs` passes the turn. The gate itself fails closed in OpenClaw (a handler
  that throws blocks every turn of the session), so the handler never throws or rejects.
- Logs carry package, verdict, probability and duration, never the title or text, plus a daily
  line: `notification-screen: handled=<n> declined=<m> errors=<e>`.

A screened notification leaves two short records in the session transcript (the block text and a
`run-failed-before-reply` record) and a `notification event not delivered … failed` log line. The
notification text is not kept.

## Requirements

- OpenClaw 2026.11.8 or later.
- A decision model, such as `@openclaw/onnx` with `gliclass-edge-v3.0`, selected for the agent.
  Without one every evaluation is `unavailable` and the plugin passes everything.
- `plugins.entries.notification-screen.hooks.allowConversationAccess: true`.

## Install and configure

OpenClaw loads the compiled `dist/index.js` from an installed package (`openclaw.runtimeExtensions`),
so build before packing. `npm pack` runs the build through `prepack`, and `dist/` is committed so a
checkout installs too.

```bash
npm install && npm pack          # builds dist/ and writes openclaw-notification-screen-<version>.tgz
openclaw plugins install npm-pack:./openclaw-notification-screen-<version>.tgz
openclaw plugins enable notification-screen
```

```json
{
  "plugins": {
    "entries": {
      "notification-screen": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true,
          "timeouts": { "before_agent_run": 12000 }
        },
        "config": { "mode": "shadow", "decisionTimeoutMs": 4000, "threshold": 0.5 }
      }
    }
  }
}
```

| Setting | Default | Meaning |
|---|---|---|
| `mode` | `shadow` | `shadow` evaluates and logs but always passes. `live` blocks noise. |
| `decisionTimeoutMs` | `4000` | The plugin's own limit on one decision, well under the hook budget. |
| `threshold` | `0.5` | Probability of "needed" below which a posting is noise. |
| `sessionKey` | `agent:main:main` | The session whose notification turns are screened. |

Run in `shadow` mode first and compare the logged verdicts with what you would have wanted. Undo
at any point by disabling the plugin.

## Tests

```bash
npm test                      # unit tests, Node 22.18+ (runs TypeScript directly)
```

`test/integration/` runs the plugin on a throwaway OpenClaw gateway with its own state directory, a
fake phone node and a mock Telegram Bot API; see its README. It never touches a real gateway.
Fixtures are made up.

## Licence

MIT
