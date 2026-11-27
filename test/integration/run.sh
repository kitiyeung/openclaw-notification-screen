#!/usr/bin/env bash
# Integration run on a throwaway gateway. See README.md. Never point this at a real gateway.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${PLUGIN_DIR:-$(cd "$HERE/../.." && pwd)}"   # PLUGIN_DIR: run the same checks against another checkout
: "${OPENCLAW_BIN_DIR:?dir with node 24 and the openclaw CLI}" "${OPENCLAW_DIST:?openclaw package dist dir}"
W="$(mktemp -d)"; export PATH="$OPENCLAW_BIN_DIR:$W/stubbin:$PATH"
export OPENCLAW_STATE_DIR="$W/state" OPENCLAW_CONFIG_PATH="$W/state/openclaw.json" HOME="$W/home" OPENCLAW_DIST
export STUB_LOG="$W/claude-starts.log" PHONE_SESSION_KEY="agent:main:notifications"
TOKEN=throwaway-test-token-123456; NOTES=agent:main:notifications; MAIN=agent:main:main
mkdir -p "$W/state" "$W/home" "$W/stubbin"
FAIL=0; PIDS=()
check() { if [ "$2" = ok ]; then echo "PASS: $1"; else echo "FAIL: $1 ($2)"; FAIL=1; fi; }
cleanup() { kill "${PIDS[@]}" 2>/dev/null; [ -n "${KEEP:-}" ] || rm -rf "$W"; [ -z "${KEEP:-}" ] || echo "kept $W"; }; trap cleanup EXIT

# The stub `claude` logs every start; STUB_MODE=fail exits like a CLI with no login, stream answers with
# a streamed thinking block and a reply. A model turn is the stub run with --session-id; auth probes,
# --version and warm-ups are housekeeping.
printf '#!/bin/sh\nexec node "%s/stub-claude.mjs" "$@"\n' "$HERE" > "$W/stubbin/claude"; chmod +x "$W/stubbin/claude"
starts() { grep -c "^started.*--session-id" "$W/claude-starts.log" 2>/dev/null; true; }
: > "$W/claude-starts.log"

node "$HERE/mock-telegram.mjs" "$W/tg.log" "$W/trigger" >/dev/null 2>&1 & PIDS+=($!)

config() { # $1 = plugin load path
cat > "$OPENCLAW_CONFIG_PATH" <<JSON
{ "gateway": { "mode": "local", "port": 28789, "bind": "loopback", "auth": { "mode": "token", "token": "$TOKEN" } },
  "agents": { "defaults": { "model": "anthropic/claude-opus-5-5", "models": { "anthropic/claude-opus-5-5": { "agentRuntime": { "id": "claude-cli" } } } } },
  "channels": { "telegram": { "enabled": true, "botToken": "123456:TEST", "apiRoot": "http://127.0.0.1:28790", "dmPolicy": "allowlist", "allowFrom": ["4242"] } },
  "plugins": { "load": { "paths": ["$1"] }, "entries": { "notification-screen": { "enabled": true,
    "hooks": { "allowConversationAccess": true, "timeouts": { "before_agent_run": 12000 } },
    "config": { "mode": "live", "decisionTimeoutMs": 1000, "sessionKey": "$NOTES" } } } } }
JSON
}
start_gateway() { # $1 = stub mode
  export STUB_MODE="$1"
  openclaw gateway run --port 28789 > "$W/gateway.log" 2>&1 & GW=$!; PIDS+=($GW)
  for _ in $(seq 90); do grep -q "gateway.*ready" "$W/gateway.log" && break; sleep 1; done
  touch "$W/trigger"; sleep 30   # owner DM sets the delivery route to the mock Telegram; let its turn settle
}
stop_gateway() { kill "$GW"; wait "$GW" 2>/dev/null; sleep 2; }
phone() { node "$HERE/fake-phone.mjs" notify "$1" > /dev/null 2>&1; }
logs() { cat "$W"/state/logs/*.log 2>/dev/null | python3 -c "
import sys,json
for l in sys.stdin:
    try: print(json.loads(l)['message'])
    except Exception: pass"; }
history() { openclaw gateway call chat.history --token "$TOKEN" --params "{\"sessionKey\":\"$1\"}" 2>/dev/null | sed 1d; }
msgs() { history "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalMessages', 0))"; }
blocked_records() { history "$1" | grep -c '"beforeAgentRunBlocked"'; true; }
tg_lines() { wc -l < "$W/tg.log"; }
notice_count() { grep -c "could not be sent" "$W/tg.log" 2>/dev/null; true; }
owner_says() { echo "$1" > "$W/trigger"; }
burst() { python3 -c "
import json
print(json.dumps([{'change':'posted','key':f'b{i}','packageName':'com.example.charge','title':'Charging','text':f'Charging, {i}%'} for i in range($1)]))"; }
# the plugin as a throwaway gateway loads it, with the decision model replaced by a stub: notifications
# that mention "Charging" score 0.05 (noise), everything else 0.9. Everything else is the real index.ts.
stub_plugin() {
  mkdir -p "$W/stub-plugin" && cp -r "$HERE/stub-decision/." "$W/stub-plugin/" && cp -r "$REPO/src" "$REPO/openclaw.plugin.json" "$W/stub-plugin/" && cp -r "$REPO/skills" "$W/stub-plugin/"
  python3 - "$REPO/index.ts" "$W/stub-plugin/index.ts" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
out, n = re.subn(r"decide: \(note, signal\) =>.*?\n    \}\);",
  'decide: async (note: any) => ({ probability: note.text.includes("Charging") ? 0.05 : 0.9 }),\n    });', src, flags=re.S)
if n != 1: sys.exit("index.ts no longer has the decide block the harness replaces")
open(sys.argv[2], "w").write(out)
PY
}

echo "== phase 1: real plugin, no decision model (fail open)"
config "$REPO"; start_gateway fail
openclaw plugins inspect notification-screen --runtime --json > "$W/inspect.json" 2>/dev/null
HOOKS="$(python3 -c "import json; print(' '.join(h['name'] for h in json.load(open('$W/inspect.json')).get('typedHooks', [])))")"
case " $HOOKS " in *" before_agent_run "*) ;; *) check "plugin registers before_agent_run" "hooks: $HOOKS" ;; esac
case " $HOOKS " in *" message_sending "*|*" reply_payload_sending "*) check "no message_sending or reply_payload_sending hook registered" "hooks: $HOOKS" ;;
  *) check "no message_sending or reply_payload_sending hook registered" ok ;; esac
S0=$(starts)
phone '[{"change":"removed","key":"p0","packageName":"com.example.chat"}]'; sleep 6
[ "$(starts)" -eq "$S0" ] && check "removal in live mode starts no model" ok || check "removal in live mode starts no model" "started"
logs | grep -q "package=com.example.chat verdict=removal" && check "removal verdict logged" ok || check "removal verdict logged" missing
phone '[{"change":"posted","key":"p1","packageName":"com.example.chat","title":"Sam","text":"Are you free tonight?"}]'; sleep 8
[ "$(starts)" -gt "$S0" ] && check "unavailable decision passes: the model starts" ok || check "unavailable decision passes: the model starts" "no start"
logs | grep -q "package=com.example.chat verdict=error" && check "error verdict logged" ok || check "error verdict logged" missing
stop_gateway

echo "== phase 2: stub decision, notifications session"
stub_plugin; config "$W/stub-plugin"; start_gateway fail
S0=$(starts); M0=$(msgs $MAIN); T0=$(tg_lines)
phone '[{"change":"posted","key":"n1","packageName":"com.example.charge","title":"Charging","text":"Charging, 80%"}]'; sleep 6
[ "$(starts)" -eq "$S0" ] && check "a no starts no model" ok || check "a no starts no model" "started"
logs | grep -q "package=com.example.charge verdict=no" && check "no verdict logged" ok || check "no verdict logged" missing
logs | grep "notification-screen:" | grep -q "Charging" && check "logs carry no title or text" "leak" || check "logs carry no title or text" ok
B0=$(blocked_records $NOTES); S1=$(starts); T1=$(tg_lines); M1=$(msgs $MAIN)
phone "$(burst 10)"; sleep 20
B=$(( $(blocked_records $NOTES) - B0 ))
[ "$(starts)" -eq "$S1" ] && [ "$B" -ge 10 ] && [ "$(tg_lines)" -eq "$T1" ] && [ "$(notice_count)" -eq 0 ] \
  && check "10 screened notifications, 0 mock Telegram sends" ok \
  || check "10 screened notifications, 0 mock Telegram sends" "blocked=$B model starts=$(( $(starts) - S1 )) telegram calls=$(( $(tg_lines) - T1 )) notices=$(notice_count)"
M2=$(msgs $MAIN)
[ "$M2" -eq "$M1" ] && check "0 records added to $MAIN" ok || check "0 records added to $MAIN" "$((M2 - M1)) added"
phone '[{"change":"posted","key":"y1","packageName":"com.example.chat","title":"Sam","text":"Are you free tonight?"}]'; sleep 8
[ "$(starts)" -gt "$S0" ] && check "a yes runs a turn" ok || check "a yes runs a turn" "no start"
logs | grep -q "package=com.example.chat verdict=yes" && check "yes verdict logged" ok || check "yes verdict logged" missing
stop_gateway

echo "== phase 3: owner DM with /reasoning stream, screening on"
config "$W/stub-plugin"; start_gateway stream
owner_says "/reasoning stream"; sleep 20
T0=$(tg_lines); owner_says "hello"; sleep 35
python3 - "$W/tg.log" "$T0" <<'PY' && check "owner DM with /reasoning stream shows a live draft" ok || check "owner DM with /reasoning stream shows a live draft" "see tg.log (KEEP=1)"
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])][int(sys.argv[2]):]
calls = [(r["m"], r["body"]) for r in rows if r["m"] in ("sendMessage", "editMessageText")]
ms = [m for m, _ in calls]
ok = ms[:1] == ["sendMessage"] and "editMessageText" in ms and "Stub answer." in calls[-1][1] and ms[-1] == "sendMessage"
print("owner DM calls:", ms, file=sys.stderr)
sys.exit(0 if ok else 1)
PY
S0=$(starts)
phone '[{"change":"posted","key":"n9","packageName":"com.example.charge","title":"Charging","text":"Charging, 90%"}]'; sleep 8
[ "$(starts)" -eq "$S0" ] && check "screening still drops a notification while live drafts are on" ok || check "screening still drops a notification while live drafts are on" "started"
stop_gateway
exit $FAIL
