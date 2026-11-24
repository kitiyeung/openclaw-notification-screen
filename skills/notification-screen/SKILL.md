---
name: notification-screen
description: Learn what your owner considers phone-notification noise and what they need, and set the notification-screen plugin to match. Use when the owner talks about notification noise, a missed or unwanted notification, or the screen's settings.
---

# Notification screen

The `notification-screen` plugin decides, before your model runs, whether a forwarded phone
notification is worth a turn. It puts one yes/no question to a local decision model. What counts
as noise is the owner's call, so the question is yours to keep in line with what they tell you.

## What it does

- `shadow` mode (the default) asks and logs, and every notification still reaches you.
- `live` mode blocks a notification the model scores below `threshold` as noise. A blocked one
  starts no turn and its text is not kept.
- It fails open: if the decision fails or is slow, the notification reaches you.
- The gateway log has one line per notification, with no title or text:
  `notification-screen: package=<app> verdict=<yes|no|error|removal> p=<0..1> mode=<mode>`.
  A daily line sums them: `handled=<n> declined=<m> errors=<e>`.

## Learn the owner's rules

Start from the built-in wording, which is deliberately generic. Then learn from the owner, not
from guesses:

1. Ask what they want to hear about right away, and what they never want a turn spent on. One
   short question at a time, in their own words.
2. Treat each correction as a rule: "that one didn't need me" is noise, "why didn't you tell me
   about that" is needed. Use the log's `package` and `p` to see which apps the screen got wrong.
3. Keep the owner's examples in plain words, not app names alone, so the model can generalise.

## Apply it

When you have a change worth making, say it back in one or two sentences and wait for the owner's
yes. Then set `plugins.entries.notification-screen.config` through the normal validated config
route with a read-back, never by editing a file:

- `question.criteria.true`: what the owner needs. `question.criteria.false`: what they consider
  noise. `question.instructions`: the question itself. Each is at most 1000 characters, and an
  omitted part keeps the built-in wording.
- Change one thing at a time, then check the next day's log lines. A wrong score near 0.5 means the
  wording does not separate that kind of notification yet.
- `threshold` (default 0.5) and `mode` are the owner's too: confirm before moving to `live`, and
  before raising the threshold.

## Roll back

Set `mode` to `shadow` and every notification reaches you again. If a normal chat turn is ever
refused with "blocked by before_agent_run", the plugin itself is broken: disable it, then
investigate.
