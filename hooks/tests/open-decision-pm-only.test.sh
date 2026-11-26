#!/usr/bin/env bash
# lib.sh owns TEST_TMP and the EXIT trap (cleanup_test_tmp). Do not replace that trap.
. "$(dirname "$0")/lib.sh"
set -eu
ROOT=$(git rev-parse --show-toplevel)
# After lib.sh, TMPDIR is under TEST_TMP, so this directory is removed with it.
T=$(mktemp -d)
export AUTOPILOT_LIVE_DIR="$T/live" HOME="$T/home" AUTOPILOT_CARD_NOTIFY=off AUTOPILOT_FLEET_BIN="$T/fleet" FLEET_LOG="$T/send" FLEET_ADDRESS=lane/host/member
mkdir -p "$HOME" "$T/repo"
git -C "$T/repo" init -q
cat > "$T/fleet" <<'FLEET'
#!/usr/bin/env bash
if [ "$1" = whoami ]; then [ "${FLEET_FAIL_WHO:-0}" = 0 ] || exit 1; printf '%s\n' "$FLEET_SEAT"; exit; fi
if [ "$1" = send ]; then printf '%s\n' "$2" "$3" > "$FLEET_LOG"; [ "${FLEET_FAIL_SEND:-0}" = 0 ] || { echo failed >&2; exit 1; }; echo '{"ok":true,"message_id":"msg-1"}'; fi
FLEET
chmod +x "$T/fleet"
open() { node "$ROOT/scripts/open-decision.js" open --cwd "$T/repo" --category goal --executor lane/host/member --not-authorized external --title "Choice?" --question "$1?" --option 'A::first' --option 'B::second' --recommendation A --why reason --json; }
open lane-question > "$T/out" 2> "$T/err"
node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1])); if(!x.forwarded_to_pm) process.exit(1)' "$T/out"
test "$(sed -n '2p' "$FLEET_LOG")" = '[操作員決定]'
test "$(node "$ROOT/scripts/open-decision.js" list --cwd "$T/repo" --json 2>/dev/null | grep -c lane-question || :)" = 0
node "$ROOT/scripts/open-decision.js" open --cwd "$T/repo" --category goal --executor lane/host/member --kind step --question 'Do the step' --json > "$T/step" 2> "$T/err"
node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1])); if(!x.forwarded_to_pm) process.exit(1)' "$T/step"
grep -q 'kind: step' "$FLEET_LOG"
export FLEET_ADDRESS=cookys/aimax395/pm--claude
rm "$FLEET_LOG"
open pm-question > "$T/out" 2> "$T/err"
test ! -e "$FLEET_LOG"
mv "$T/repo" "$T/repo-pm"
mkdir "$T/repo"
git -C "$T/repo" init -q
export AUTOPILOT_LIVE_DIR="$T/live2"
unset FLEET_ADDRESS
rm -f "$FLEET_LOG"
open unknown-question > "$T/out" 2> "$T/err" || test "$?" = 5
test ! -e "$FLEET_LOG"
export FLEET_ADDRESS=lane/host/member FLEET_FAIL_SEND=1
set +e
open fail-question > "$T/out" 2> "$T/err"
rc=$?
set -e
test "$rc" = 8
test "$(node "$ROOT/scripts/open-decision.js" list --cwd "$T/repo" --json 2>/dev/null | grep -c fail-question || :)" = 0
node - "$T/repo" <<'NODE'
const fs = require('fs'); const path = require('path');
const dir = path.join(process.argv[2], '.git/autopilot/decisions');
const file = fs.readdirSync(dir).find(x => x.endsWith('.json'));
const p = path.join(dir, file); const data = JSON.parse(fs.readFileSync(p));
data.decisions[0].asker = 'lane/host/member'; fs.writeFileSync(p, JSON.stringify(data));
NODE
(cd "$T/repo" && node "$ROOT/scripts/list-lane-cards.js" --json) > "$T/list"
node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1])); if(!x.some(c=>c.opener === "lane/host/member")) process.exit(1)' "$T/list"
printf 'PASS pm-only\n'
finalize_test
