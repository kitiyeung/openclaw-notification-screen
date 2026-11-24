#!/usr/bin/env bash
# Integration run on a throwaway gateway. See README.md. Never point this at a real gateway.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
: "${OPENCLAW_BIN_DIR:?dir with node 24 and the openclaw CLI}" "${OPENCLAW_DIST:?openclaw package dist dir}"
W="$(mktemp -d)"; export PATH="$OPENCLAW_BIN_DIR:$W/stubbin:$PATH"
export OPENCLAW_STATE_DIR="$W/state" OPENCLAW_CONFIG_PATH="$W/state/openclaw.json" HOME="$W/home" OPENCLAW_DIST
mkdir -p "$W/state" "$W/home" "$W/stubbin"
FAIL=0; PIDS=()
check() { echo -n "[$(date +%T)] "; if [ "$2" = ok ]; then echo "PASS $1"; else echo "FAIL $1 ($2)"; FAIL=1; fi; }
cleanup() { kill "${PIDS[@]}" 2>/dev/null; [ -n "${KEEP:-}" ] || rm -rf "$W"; [ -z "${KEEP:-}" ] || echo "kept $W"; }; trap cleanup EXIT

cat > "$W/stubbin/claude" <<STUB
#!/bin/sh
echo "started \$(date +%T) \$*" >> "$W/claude-starts.log"
echo "stub: no model" >&2
exit 1
STUB
chmod +x "$W/stubbin/claude"
# a model turn is the stub run with --session-id; auth probes, --version and warm-ups are housekeeping
starts() { grep -c "^started.*--session-id" "$W/claude-starts.log" 2>/dev/null; true; }
: > "$W/claude-starts.log"

node "$HERE/mock-telegram.mjs" "$W/tg.log" "$W/trigger" >/dev/null 2>&1 & PIDS+=($!)

config() { # $1 = plugin load path
cat > "$OPENCLAW_CONFIG_PATH" <<JSON
{ "gateway": { "mode": "local", "port": 28789, "bind": "loopback", "auth": { "mode": "token", "token": "throwaway-test-token-123456" } },
  "agents": { "defaults": { "model": "anthropic/claude-opus-5-5", "models": { "anthropic/claude-opus-5-5": { "agentRuntime": { "id": "claude-cli" } } } } },
  "channels": { "telegram": { "enabled": true, "botToken": "123456:TEST", "apiRoot": "http://127.0.0.1:28790", "dmPolicy": "allowlist", "allowFrom": ["4242"] } },
  "plugins": { "load": { "paths": ["$1"] }, "entries": { "notification-screen": { "enabled": true,
    "hooks": { "allowConversationAccess": true, "timeouts": { "before_agent_run": 12000 } },
    "config": { "mode": "live", "decisionTimeoutMs": 1000 } } } } }
JSON
}
start_gateway() {
  openclaw gateway run --port 28789 > "$W/gateway.log" 2>&1 & GW=$!; PIDS+=($GW)
  for _ in $(seq 60); do grep -q "gateway.*ready" "$W/gateway.log" && break; sleep 1; done
  touch "$W/trigger"; sleep 30   # owner DM sets the delivery route to the mock Telegram; let its failing turn settle
}
stop_gateway() { kill "$GW"; wait "$GW" 2>/dev/null; sleep 2; }
phone() { node "$HERE/fake-phone.mjs" notify "$1" > /dev/null 2>&1; }
logs() { cat "$W"/state/logs/*.log 2>/dev/null | python3 -c "
import sys,json
for l in sys.stdin:
    try: print(json.loads(l)['message'])
    except Exception: pass"; }
notice_count() { grep -c "blocked by notification-screen" "$W/tg.log" 2>/dev/null; true; }
burst() { python3 -c "
import json
print(json.dumps([{'change':'posted','key':f'b{i}','packageName':'com.example.charge','title':'Charging','text':f'Charging, {i}%'} for i in range(25)]))"; }

echo "== phase 1: real plugin, no decision model (fail open)"
# A passed turn runs the stub model, which fails and is retried by the gateway, and the retries hold
# the session's lane. So each phase sends the events that start no model first, the passing one last.
config "$REPO"; start_gateway
S0=$(starts)
phone '[{"change":"removed","key":"p0","packageName":"com.example.chat"}]'; sleep 6
[ "$(starts)" -eq "$S0" ] && check "removal in live mode starts no model" ok || check "removal in live mode starts no model" "started"
logs | grep -q "package=com.example.chat verdict=removal" && check "removal verdict logged" ok || check "removal verdict logged" missing
phone '[{"change":"posted","key":"p1","packageName":"com.example.chat","title":"Sam","text":"Are you free tonight?"}]'; sleep 8
[ "$(starts)" -gt "$S0" ] && check "unavailable decision passes: the model starts" ok || check "unavailable decision passes: the model starts" "no start"
logs | grep -q "package=com.example.chat verdict=error" && check "error verdict logged" ok || check "error verdict logged" missing
[ "$(notice_count)" -eq 0 ] && check "no block notice reaches Telegram" ok || check "no block notice reaches Telegram" "$(notice_count)"
stop_gateway

echo "== phase 2: stub decision"
mkdir -p "$W/stub-plugin" && cp -r "$HERE/stub-decision/." "$W/stub-plugin/" && cp -r "$REPO/src" "$W/stub-plugin/src"
config "$W/stub-plugin"; start_gateway
S0=$(starts)
phone '[{"change":"posted","key":"n1","packageName":"com.example.charge","title":"Charging","text":"Charging, 80%"}]'; sleep 6
[ "$(starts)" -eq "$S0" ] && check "a no starts no model" ok || check "a no starts no model" "started"
logs | grep -q "package=com.example.charge verdict=no" && check "no verdict logged" ok || check "no verdict logged" missing
logs | grep "notification-screen:" | grep -q "Charging" && check "logs carry no title or text" "leak" || check "logs carry no title or text" ok
N0=$(logs | grep -c "verdict=no"); S1=$(starts)
phone "$(burst)"; sleep 20
[ "$(starts)" -eq "$S1" ] && check "burst of 25 noes starts no model" ok || check "burst of 25 noes starts no model" "started"
N=$(( $(logs | grep -c "verdict=no") - N0 )); [ "$N" -ge 20 ] && check "burst: $N of 25 settled as blocks" ok || check "burst settled" "$N"
[ "$(notice_count)" -eq 0 ] && check "no block notice reaches Telegram after the burst" ok || check "no block notice reaches Telegram after the burst" "$(notice_count)"
phone '[{"change":"posted","key":"y1","packageName":"com.example.chat","title":"Sam","text":"Are you free tonight?"}]'; sleep 8
[ "$(starts)" -gt "$S0" ] && check "a yes runs a turn" ok || check "a yes runs a turn" "no start"
logs | grep -q "package=com.example.chat verdict=yes" && check "yes verdict logged" ok || check "yes verdict logged" missing
stop_gateway
exit $FAIL
