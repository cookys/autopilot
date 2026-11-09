#!/usr/bin/env bash
# profile-health.js: warns the PM 10 days or less before a Claude login profile expires. Against a STUB claude (canned JSON per CLAUDE_CONFIG_DIR,
# with an email sentinel) and a STUB fleet. Negative controls (sed_mutant, shown red before green): drop the dedup; record a failed send;
# move the threshold to 9 days; print the email.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.claude-profiles/a" "$HOME/.claude-profiles/b"
export XDG_STATE_HOME="$TEST_TMP/state" AUTOPILOT_NOW=2026-11-09T00:00:00.000Z
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID FLEET_FYI
S="$REPO_ROOT/scripts"; STUB="$TEST_TMP/stub"; mkdir -p "$STUB"; SENT="email-sentinel-7f3a@example.invalid"
cat > "$STUB/claude" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const D = process.env.STUB_DIR; const dir = process.env.CLAUDE_CONFIG_DIR || '';
const key = dir ? require('path').basename(dir) : 'home';
fs.appendFileSync(D + '/claude.log', JSON.stringify({ args: process.argv.slice(2), key, token: process.env.ANTHROPIC_API_KEY || null }) + '\n');
const f = D + '/claude-' + key + '.json'; const j = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '{"loggedIn":false,"loginExpiresAt":null}';
process.stdout.write(j.replace('SENT', process.env.SENT)); process.exit(JSON.parse(j).loggedIn === false ? 1 : 0);
JS
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const D = process.env.STUB_DIR; const a = process.argv.slice(2);
fs.appendFileSync(D + '/fleet.log', JSON.stringify({ args: a, fyi: process.env.FLEET_FYI || null }) + '\n');
process.exit(fs.existsSync(D + '/send-fails') ? 1 : 0);
JS
chmod +x "$STUB/claude" "$STUB/fleet"
export STUB_DIR="$STUB" SENT AUTOPILOT_CLAUDE_BIN="$STUB/claude" AUTOPILOT_FLEET_BIN="$STUB/fleet" ANTHROPIC_API_KEY=should-be-dropped
PH="$S/profile-health.js"; ST="$XDG_STATE_HOME/autopilot/profile-health.json"
prof() { # <name> <days from AUTOPILOT_NOW> : write a logged-in answer expiring that many days (plus 3h) ahead
  local ms=$(( $(node -e 'process.stdout.write(String(Date.parse(process.env.AUTOPILOT_NOW)))') + $2 * 86400000 + 10800000 ))
  printf '{"loggedIn":true,"email":"SENT","orgId":"o-1","loginExpiresAt":"%s","configDirectory":"x"}' "$(node -e 'process.stdout.write(new Date(+process.argv[1]).toISOString())' "$ms")" > "$STUB/claude-$1.json"
}
reset() { : > "$STUB/fleet.log"; : > "$STUB/claude.log"; rm -f "$STUB/send-fails" "$ST" "$STUB"/claude-*.json; }
sends() { grep -c '"args":\["send"' "$STUB/fleet.log" | tr -d ' '; }
run() { OUT="$(node "${1:-$PH}" notify < /dev/null 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
last() { tail -1 "$STUB/fleet.log" | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(l.args[2])'; }

# ---- 1. 11 days: ok, nothing sent ----
reset; prof home 11; prof a 11; prof b 11
run; assert_eq "$RC" 0 "11 days: exit 0"; assert_eq "$(sends)" 0 "11 days: no send"
assert_contains "$(node "$PH" check < /dev/null)" "ok" "11 days: check says ok"
assert_contains "$(node "$PH" check --json < /dev/null)" '"days_left": 11' "11 days: days_left 11"
# ---- 2. 10 days on a, home ok: one send with all fields ----
reset; prof home 30; prof a 10; prof b 40
run; assert_eq "$(sends)" 1 "10 days: one send"
M="$(last)"
assert_eq "$(echo "$M" | head -1)" "[操作員決定]" "message: first line is the decision marker"
assert_contains "$M" "$(node -e 'process.stdout.write(require("os").hostname())')" "message: machine"
assert_contains "$M" "$(node -e 'process.stdout.write(require("os").userInfo().username)')" "message: OS account"
assert_contains "$M" "profile a" "message: profile name"
assert_contains "$M" "2026-11-19 11:00 +08" "message: Taipei expiry"
assert_contains "$M" "剩 10 天" "message: days left"
assert_contains "$M" 'CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/a" claude auth login --claudeai' "message: login command for profile a"
assert_contains "$M" 'claude auth status --text' "message: check line"
assert_not_contains "$(tail -1 "$STUB/fleet.log")" '"fyi":"1"' "send is not FYI"
assert_contains "$(tail -1 "$STUB/fleet.log")" '"cookys/aimax395/pm--claude"' "send goes to the PM by default"
assert_contains "$(cat "$STUB/claude.log")" '"token":null' "claude ran without ANTHROPIC_API_KEY"
# ---- 3. home gets the plain command ----
reset; prof home 5; prof a 30; prof b 30
run; assert_eq "$(sends)" 1 "home: one send"; M="$(last)"
assert_contains "$M" "claude auth login --claudeai" "home: login command"
assert_not_contains "$M" "CLAUDE_CONFIG_DIR" "home: command has no CLAUDE_CONFIG_DIR"
# ---- 4. dedup and reset on a new expiry ----
run; assert_eq "$(sends)" 1 "second run: no second send"
prof home 4; run; assert_eq "$(sends)" 2 "changed loginExpiresAt: sends again"
# ---- 5. logged out ----
reset; prof home 30; prof a 30; rm -f "$STUB/claude-b.json"
run; assert_eq "$(sends)" 1 "logged out: one send"; assert_contains "$(last)" "已登出" "logged out: says so"
assert_contains "$(node "$PH" check < /dev/null)" "logged_out" "logged out: check says logged_out"
# ---- 6. expired ----
reset; prof home 30; prof a -2; prof b 30
run; assert_eq "$(sends)" 1 "expired: one send"; assert_contains "$(node "$PH" check < /dev/null)" "expired" "expired: check says expired"
# ---- 7. failed send is not recorded ----
reset; prof home 30; prof a 3; prof b 30; touch "$STUB/send-fails"
run; assert_eq "$RC" 1 "failed send: exit 1"; assert_eq "$(sends)" 1 "failed send: attempted once"
assert_not_contains "$(cat "$ST" 2>/dev/null)" '"a"' "failed send: nothing recorded"
rm "$STUB/send-fails"; run; assert_eq "$RC" 0 "retry: exit 0"; assert_eq "$(sends)" 2 "retry: next run sends"
# ---- 8. privacy + mode ----
reset; prof home 3; prof a 3; prof b 3
run; CHECK="$(node "$PH" check < /dev/null 2>&1)$(node "$PH" check --json < /dev/null 2>&1)"
assert_not_contains "$OUT$ERR$CHECK$(cat "$ST")$(cat "$STUB/fleet.log")" "$SENT" "email sentinel never appears in stdout, stderr, state or fleet text"
assert_not_contains "$OUT$CHECK$(cat "$ST")$(cat "$STUB/fleet.log")" "o-1" "orgId never appears"
assert_eq "$(stat -c %a "$ST")" "600" "state file mode 0600"
# ---- 9. directories with unsupported names are listed, never run, notified once each ----
reset; prof home 30; prof a 30; prof b 30
mkdir -p "$HOME/.claude-profiles/home" "$HOME/.claude-profiles/my profile" "$HOME/.claude-profiles/_x"
CHK="$(node "$PH" check < /dev/null)"; CJ="$(node "$PH" check --json < /dev/null)"
assert_eq "$(echo "$CHK" | grep -c 'unsupported_name')" 3 "unsupported names: three rows say unsupported_name in check"
assert_contains "$CJ" '"name": "my profile"' "unsupported names: json lists my profile"
assert_contains "$CJ" '"status": "unsupported_name"' "unsupported names: json status"
assert_eq "$(grep -c -E '"key":"(my profile|_x)"' "$STUB/claude.log")" 0 "unsupported names: claude never ran for my profile or _x"
assert_eq "$(grep -c '"key":"home"' "$STUB/claude.log")" 2 "unsupported names: claude ran only for the real home profile (two checks)"
run; assert_eq "$(sends)" 3 "unsupported names: one send each"
assert_contains "$(cat "$STUB/fleet.log")" 'my profile' "unsupported names: message carries the dir name"
assert_contains "$(cat "$STUB/fleet.log")" '_x' "unsupported names: message carries _x"
assert_not_contains "$(last)" "claude auth login" "unsupported names: no login command"
run; assert_eq "$(sends)" 3 "unsupported names: second run sends none"
rm -rf "$HOME/.claude-profiles/home" "$HOME/.claude-profiles/my profile" "$HOME/.claude-profiles/_x"
# ---- 10. expired sentence counts whole overdue days ----
reset; prof home 30; prof a 30; prof b 30
expat() { printf '{"loggedIn":true,"loginExpiresAt":"%s"}' "$(node -e 'process.stdout.write(new Date(Date.parse(process.env.AUTOPILOT_NOW)-3600000*process.argv[1]).toISOString())' "$2")" > "$STUB/claude-$1.json"; }
expat a 1; run; assert_contains "$(last)" "已過 0 天" "1h overdue: says 已過 0 天"
reset; prof home 30; prof b 30; expat a 25; run; assert_contains "$(last)" "已過 1 天" "25h overdue: says 已過 1 天"
# ---- negative controls ----
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"
mut() { sed_mutant "$PH" "$MUT/profile-health.js" "$1" || return 1; }
mut "s/state.sent\[row.name\] === key/false/" && { reset; prof home 30; prof a 3; prof b 30; run "$MUT/profile-health.js"; run "$MUT/profile-health.js"; assert_eq "$(sends)" 2 "mutant (no dedup): sends twice, so the dedup check is real"; }
mut "s/if (r.status !== 0) {/if (false) {/" && { reset; prof home 30; prof a 3; prof b 30; touch "$STUB/send-fails"; run "$MUT/profile-health.js"; assert_contains "$(cat "$ST")" '"a"' "mutant (failed send recorded): state holds a, so the retry check is real"; }
mut "s/<= THRESHOLD_DAYS/< 9/" && { reset; prof home 30; prof a 10; prof b 30; run "$MUT/profile-health.js"; assert_eq "$(sends)" 0 "mutant (threshold 9): no send at 10 days, so the 10-day check is real"; }
mut "s/row.loggedIn = j.loggedIn === true;/row.loggedIn = j.loggedIn === true; row.email = j.email;/" && { reset; prof home 30; prof a 10; prof b 30; assert_contains "$(node "$MUT/profile-health.js" check --json < /dev/null)" "$SENT" "mutant (email read): sentinel appears, so the privacy check is real"; }
finalize_test
