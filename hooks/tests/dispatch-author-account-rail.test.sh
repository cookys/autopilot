#!/usr/bin/env bash
# G37 W2 (plan 8): dispatch-author.sh claude-native arm goes through claude-account.js run when an
# account registry exists. Node shim only, FAKE- tokens, tempdirs only. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s\n' 'Return a small JSON object.' > "$PROMPT"

# Build a fixture world and print the facts as JSON.
FIX_HELPER="$TEST_TMP/fix.js"
cat > "$FIX_HELPER" <<'EOF'
const path = require('path');
const { makeFixture } = require(path.join(process.argv[2], 'scripts/lib/account-fixtures/shim-install.js'));
const f = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }] });
process.stdout.write(JSON.stringify({ root: f.root, regFile: f.regFile, decoy: f.decoy, realHome: f.realHome,
  accountsDir: f.accountsDir, env: f.env, tokens: f.tokens, log: f.shim.log }));
EOF
fx() { node "$TEST_TMP/fix.js" "$REPO_ROOT"; }
jget() { node -e 'const o=JSON.parse(process.argv[1]);const v=process.argv[2].split(".").reduce((a,k)=>a&&a[k],o);process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }
shim_calls() { [ -f "$1" ] && grep -c . "$1" || echo 0; }

run_author() { # $1 = fixture json; extra env via ENVX array
  local F="$1" ; shift
  env -i HOME="$(jget "$F" realHome)" PATH="$(jget "$F" env.PATH)" LANG=C TMPDIR="$(jget "$F" env.TMPDIR)" \
    XDG_RUNTIME_DIR="$(jget "$F" env.XDG_RUNTIME_DIR)" \
    AUTOPILOT_ACCOUNTS_DIR="$(jget "$F" env.AUTOPILOT_ACCOUNTS_DIR)" AUTOPILOT_LIVE_DIR="$(jget "$F" env.AUTOPILOT_LIVE_DIR)" \
    AUTOPILOT_STATE_DIR="$(jget "$F" env.AUTOPILOT_STATE_DIR)" AUTOPILOT_CONFIG="$(jget "$F" env.AUTOPILOT_CONFIG)" \
    "$@" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 \
    "$SCRIPT" --runner claude-native --model claude-fable-5 --prompt-file "$PROMPT" --bin claude --timeout 20s
}

# 1. registry present and valid: shim sees an alias token fingerprint, never the decoy.
F1="$(fx)"
OUT1="$(run_author "$F1" 2>"$TEST_TMP/err1")"; EX1=$?; true
LOG1="$(jget "$F1" log)"
assert_contains "$OUT1" "\"runner\": \"claude-native\"" "account arm: result produced"
assert_not_contains "$OUT1" "precondition_failed" "account arm: no precondition failure"
assert_eq "1" "$(shim_calls "$LOG1")" "account arm: exactly one spawn"
CALL1="$(head -1 "$LOG1")"
assert_neq "" "$(jget "$CALL1" fp)" "account arm: shim saw a token fingerprint"
assert_contains "$(jget "$CALL1" account)" "" "account arm: AUTOPILOT_ACCOUNT recorded"
case "$(jget "$CALL1" account)" in a|b) PASS_ALIAS=1 ;; *) PASS_ALIAS=0 ;; esac
assert_eq "1" "$PASS_ALIAS" "account arm: child ran under a registry alias"
assert_eq "false" "$(jget "$CALL1" decoy_read)" "account arm: decoy credentials never read"
assert_neq "$(jget "$F1" realHome)" "$(jget "$CALL1" home)" "account arm: child HOME is not the caller HOME"
assert_not_contains "$OUT1$(cat "$TEST_TMP/err1")" "FAKE-token" "account arm: no token in dispatch output"

# 2. N9: broken registry -> die before any spawn, decoy untouched, no fallback to seeding.
F2="$(fx)"
printf '%s' '{not json' > "$(jget "$F2" regFile)"
OUT2="$(run_author "$F2" 2>"$TEST_TMP/err2")"; EX2=$?
assert_neq "0" "$EX2" "N9: broken registry fails the rail"
assert_eq "0" "$(shim_calls "$(jget "$F2" log)")" "N9: broken registry spawns nothing"
assert_not_contains "$(cat "$TEST_TMP/err2")$OUT2" "FAKE-token" "N9: no token in output"
assert_contains "$(cat "$TEST_TMP/err2")$OUT2" "registry check failed" "N9: precondition names the registry check"

# 3. mode off: explicit legacy path is still taken (seeded credentials-only dir, no account vars).
F3="$(fx)"
mkdir -p "$TEST_TMP/legacy-cfg"; seed_fake_claude_credentials "$TEST_TMP/legacy-cfg"
OUT3="$(run_author "$F3" AUTOPILOT_ACCOUNT_MODE=off CLAUDE_CONFIG_DIR="$TEST_TMP/legacy-cfg" 2>"$TEST_TMP/err3")"; EX3=$?
assert_not_contains "$OUT3" "precondition_failed" "mode off: legacy path ran"
assert_eq "" "$(jget "$(head -1 "$(jget "$F3" log)")" account | sed 's/^null$//')" "mode off: no account alias used"

# 4. unconfigured (no registry): legacy path, byte-equivalent to today.
F4="$(fx)"
rm -f "$(jget "$F4" regFile)"
OUT4="$(run_author "$F4" CLAUDE_CONFIG_DIR="$TEST_TMP/legacy-cfg" 2>"$TEST_TMP/err4")"; EX4=$?
assert_not_contains "$OUT4" "precondition_failed" "unconfigured: legacy path ran"
assert_eq "" "$(jget "$(head -1 "$(jget "$F4" log)")" account | sed 's/^null$//')" "unconfigured: no account alias used"

finalize_test
