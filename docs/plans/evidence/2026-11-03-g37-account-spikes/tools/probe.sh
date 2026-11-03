#!/bin/bash
# Usage: bash probe.sh <401|429|429-usage|429-hdr> <label> <decoy 0|1> <env-token 0|1>; FMT=stream-json EXTRA=--verbose for S4. Everything runs against a local synthetic API; nothing is forwarded.
# usage: run.sh <mode> <label> <withdecoy:0|1> <withenvtoken:0|1> [extra claude args...]
set -u
mode=$1; label=$2; decoy=$3; envtok=$4; shift 4
D=$(mktemp -d); mkdir -p "$D/home" "$D/cfg" "$D/bin"
if [ "$decoy" = 1 ]; then
 node -e 'const f=process.argv[1];require("fs").writeFileSync(f,JSON.stringify({claudeAiOauth:{accessToken:"DECOY-CREDSTOKEN-"+"x".repeat(20),refreshToken:"DECOY-REFRESH-xxxxxxxx",expiresAt:Date.now()+86400000*30,scopes:["user:inference","user:profile"],subscriptionType:"max"}}),{mode:0o600})' "$D/cfg/.credentials.json"
fi
node "$(dirname "$0")/local-synthetic-api.js" "$mode" "$D/port" "$D/proxy.log" & PP=$!
for i in $(seq 50); do [ -s "$D/port" ] && break; sleep 0.1; done
PORT=$(cat "$D/port")
ENVARGS=(PATH="$PATH" HOME="$D/home" CLAUDE_CONFIG_DIR="$D/cfg" ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" CLAUDE_CODE_MAX_RETRIES=0 DISABLE_TELEMETRY=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 NO_PROXY=127.0.0.1)
[ "$envtok" = 1 ] && ENVARGS+=(CLAUDE_CODE_OAUTH_TOKEN="FAKE-ENVTOKEN-0123456789")
env -i "${ENVARGS[@]}" timeout 60 claude -p "say OK" --model haiku --output-format "${FMT:-json}" ${EXTRA:-} --tools "" --strict-mcp-config < /dev/null > "$D/out" 2> "$D/err"
rc=$?
kill $PP 2>/dev/null
echo "== $label rc=$rc"; echo "-- proxy.log"; cat "$D/proxy.log"; echo "-- out (head)"; head -c 3000 "$D/out"; echo; echo "-- err"; head -c 600 "$D/err"
echo "$D" > last_dir
