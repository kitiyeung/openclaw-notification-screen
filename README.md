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
  (default `agent:main:notifications`) whose prompt starts with `Notification posted (node=` or
  `Notification removed (node=`. Everything else gets `{ outcome: "pass" }` synchronously.
- A posting asks `api.runtime.decisions.evaluate` one Boolean question with the package and the
  notification text as state. A probability below `threshold` is noise. A removal carries no news
  and is screened in live mode without asking the model.
- A block ends the turn as failed and OpenClaw writes `Your message could not be sent: … (blocked by
  notification-screen)` to the session's route. The notifications session has no chat route, so
  nothing is sent anywhere. The plugin registers no `message_sending` hook: Telegram turns off live
  previews (the draft, the self-updating progress line and `/reasoning stream`) for every chat while
  any plugin has one.
- Fails open. A decision error, an `unavailable` result, a malformed answer or a decision slower
  than `decisionTimeoutMs` passes the turn. The gate itself fails closed in OpenClaw (a handler
  that throws blocks every turn of the session), so the handler never throws or rejects.
- Logs carry package, verdict, probability and duration, never the title or text, plus a daily
  line: `notification-screen: handled=<n> declined=<m> errors=<e>`.

A screened notification leaves two short records in the notifications session's transcript (the
block text and a `run-failed-before-reply` record) and a `notification event not delivered …
failed` log line, never in the owner's main session. The notification text is not kept.

## The notifications session

Screening works on a session of the main agent that has no chat route, so the owner's chat and its
live previews are untouched:

1. In the OpenClaw Android app, set **Route Session Key** (Notification forwarding) to
   `agent:main:notifications`. Forwarded notifications then land in that session instead of
   `agent:main:main`.
2. The plugin screens that session by default. Set `sessionKey` only to use another one.
3. A notification the screen passes runs as an ordinary main-agent turn in that session. Its reply
   has no chat route, so the agent tells the owner with its `message` tool when the notification
   needs them; its instructions say so.

Passed notifications no longer share the main chat's history.

Keeping `sessionKey` on a session that has a chat route is unsupported: the block notice would reach
that chat, because the plugin no longer cancels it.

## Requirements

- OpenClaw 2026.11.10 or later.
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
| `question` | built in | The Boolean question put to the decision model: `instructions`, and `criteria.true` and `criteria.false` describing what is needed and what is noise. Omitted parts use the built-in wording; tune it here, no code change. |
| `sessionKey` | `agent:main:notifications` | The session whose notification turns are screened. It must be the session the phone app routes notifications to. |

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
