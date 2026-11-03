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
shim_calls() { local n=0; [ -f "$1" ] && n="$(grep -c . "$1")" || true; echo "${n:-0}"; }

SCRIPT_UNDER_TEST="$SCRIPT"
run_author() { # $1 = fixture json; extra VAR=val args are passed to env
  local F="$1" ; shift
  env -i HOME="$(jget "$F" realHome)" PATH="$(jget "$F" env.PATH)" LANG=C TMPDIR="$(jget "$F" env.TMPDIR)" \
    XDG_RUNTIME_DIR="$(jget "$F" env.XDG_RUNTIME_DIR)" \
    AUTOPILOT_ACCOUNTS_DIR="$(jget "$F" env.AUTOPILOT_ACCOUNTS_DIR)" AUTOPILOT_LIVE_DIR="$(jget "$F" env.AUTOPILOT_LIVE_DIR)" \
    AUTOPILOT_STATE_DIR="$(jget "$F" env.AUTOPILOT_STATE_DIR)" AUTOPILOT_CONFIG="$(jget "$F" env.AUTOPILOT_CONFIG)" \
    DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=10 \
    G37_STUB_LOG="$TEST_TMP/stub.log" "$@" "$SCRIPT_UNDER_TEST" --runner claude-native --model claude-fable-5 --prompt-file "$PROMPT" --bin claude --timeout 20s
}

# Count shim spawns plus stub `run` calls (a stub claude-account.js stands in where noted).
spawns_of() { echo $(( $(shim_calls "$(jget "$1" log)") + $(shim_calls "$TEST_TMP/stub.log") )); }
first_call() { head -1 "$(jget "$1" log)" 2>/dev/null; }

# Predicates: print the failures, return 1 on any. Used by the real assertions AND by the mutations below.
good_holds() { # $1 = script under test
  SCRIPT_UNDER_TEST="$1"; : > "$TEST_TMP/stub.log"
  local F OUT EX bad=0 C; F="$(fx)"; GF="$F"
  OUT="$(run_author "$F" 2>"$TEST_TMP/errg")"; EX=$?; GEX=$EX; GOUT="$OUT"
  [ "$(spawns_of "$F")" = 1 ] || { echo "spawns=$(spawns_of "$F");"; bad=1; }
  C="$(first_call "$F")"
  [ -n "$C" ] || { echo "no shim call;"; return 1; }
  [ -n "$(jget "$C" fp)" ] || { echo "no token fingerprint;"; bad=1; }
  case "$(jget "$C" account)" in a|b) ;; *) echo "no registry alias;"; bad=1 ;; esac
  [ "$(jget "$C" decoy_read)" = false ] || { echo "decoy read;"; bad=1; }
  return $bad
}
broken_holds() { # $1 = script under test
  SCRIPT_UNDER_TEST="$1"; : > "$TEST_TMP/stub.log"
  local F OUT EX bad=0; F="$(fx)"; BF="$F"
  printf '%s' '{not json' > "$(jget "$F" regFile)"
  OUT="$(run_author "$F" 2>"$TEST_TMP/errb")"; EX=$?; BEX=$EX; BOUT="$OUT"
  [ "$EX" != 0 ] || { echo "rc=0;"; bad=1; }
  [ "$(spawns_of "$F")" = 0 ] || { echo "spawns=$(spawns_of "$F");"; bad=1; }
  return $bad
}
legacy_holds() { # $1 = script, $2 = unconfigured|mode_off
  SCRIPT_UNDER_TEST="$1"; : > "$TEST_TMP/stub.log"
  local F OUT EX bad=0 C; F="$(fx)"; LF="$F"
  mkdir -p "$TEST_TMP/legacy-cfg"; seed_fake_claude_credentials "$TEST_TMP/legacy-cfg"
  if [ "$2" = mode_off ]; then
    OUT="$(run_author "$F" AUTOPILOT_ACCOUNT_MODE=off CLAUDE_CONFIG_DIR="$TEST_TMP/legacy-cfg" 2>"$TEST_TMP/errl")"; EX=$?
  else
    rm -f "$(jget "$F" regFile)"
    OUT="$(run_author "$F" G37_STUB_OUT=unconfigured CLAUDE_CONFIG_DIR="$TEST_TMP/legacy-cfg" 2>"$TEST_TMP/errl")"; EX=$?
  fi
  LEX=$EX; LOUT="$OUT"
  [ "$(spawns_of "$F")" = 1 ] || { echo "spawns=$(spawns_of "$F");"; bad=1; }
  C="$(first_call "$F")"
  [ -n "$C" ] || { echo "no shim call;"; return 1; }
  [ -z "$(jget "$C" fp | sed 's/^null$//')" ] || { echo "token reached the legacy path;"; bad=1; }
  [ -z "$(jget "$C" account | sed 's/^null$//')" ] || { echo "alias reached the legacy path;"; bad=1; }
  return $bad
}

# 1. registry present and valid: shim sees an alias token fingerprint, never the decoy.
good_holds "$SCRIPT" > "$TEST_TMP/pred.out"; GRC=$?; GPRED="$(cat "$TEST_TMP/pred.out")"
assert_eq "0" "$GRC" "N9 good: account arm: one spawn, alias token fingerprint, no decoy ($GPRED)"
assert_contains "$GOUT" "\"runner\": \"claude-native\"" "account arm: result produced"
assert_not_contains "$GOUT" "precondition_failed" "account arm: no precondition failure"
CALL1="$(first_call "$GF")"
assert_neq "$(jget "$GF" realHome)" "$(jget "$CALL1" home)" "account arm: child HOME is not the caller HOME"
assert_not_contains "$GOUT$(cat "$TEST_TMP/errg")" "FAKE-token" "account arm: no token in dispatch output"

# 2. N9: broken registry -> die before any spawn, decoy untouched, no fallback to seeding.
broken_holds "$SCRIPT" > "$TEST_TMP/pred.out"; BRC=$?; BPRED="$(cat "$TEST_TMP/pred.out")"
assert_eq "0" "$BRC" "N9 broken: registry fails the rail with zero spawns ($BPRED)"
assert_not_contains "$(cat "$TEST_TMP/errb")$BOUT" "FAKE-token" "N9: no token in output"
assert_contains "$(cat "$TEST_TMP/errb")$BOUT" "registry check failed" "N9: precondition names the registry check"

# 3. mode off and 4. unconfigured: legacy seeded path, EXACTLY one spawn, no alias, no token.
legacy_holds "$SCRIPT" mode_off > "$TEST_TMP/pred.out"; MRC=$?; MPRED="$(cat "$TEST_TMP/pred.out")"
assert_eq "0" "$MRC" "mode off: legacy path, one spawn, no alias/token ($MPRED)"
assert_not_contains "$LOUT" "precondition_failed" "mode off: legacy path ran"
legacy_holds "$SCRIPT" unconfigured > "$TEST_TMP/pred.out"; URC=$?; UPRED="$(cat "$TEST_TMP/pred.out")"
assert_eq "0" "$URC" "unconfigured: legacy path, one spawn, no alias/token ($UPRED)"
assert_not_contains "$LOUT" "precondition_failed" "unconfigured: legacy path ran"

# 5. unrecognised env-check output: invalid, nothing spawned (stub claude-account.js in a copy of scripts/).
STUBD="$TEST_TMP/stub-scripts"; cp -r "$REPO_ROOT/scripts" "$STUBD"
cat > "$STUBD/claude-account.js" <<'STUBEOF'
const fs = require('fs'); const a = process.argv[2];
if (a === 'env-check') { process.stdout.write(process.env.G37_STUB_OUT || ''); process.exit(Number(process.env.G37_STUB_RC || 0)); }
fs.appendFileSync(process.env.G37_STUB_LOG, a + '\n'); process.exit(0);
STUBEOF
# positive control: the stub itself works (reporting `unconfigured` reaches the legacy spawn), so the spawn-0
# results below cannot come from a stub that crashes (a crash also reads as invalid).
legacy_holds "$STUBD/dispatch-author.sh" unconfigured > "$TEST_TMP/pred.out"; SRC=$?
assert_eq "0" "$SRC" "stub positive control: unconfigured through the stub is the legacy path, one spawn ($(cat "$TEST_TMP/pred.out"))"
unrecognised_holds() { # $1 = script dir containing the stub, $2 = stub output
  SCRIPT_UNDER_TEST="$1/dispatch-author.sh"; : > "$TEST_TMP/stub.log"
  local F OUT EX bad=0; F="$(fx)"; XF="$F"
  OUT="$(run_author "$F" "G37_STUB_OUT=$2" 2>"$TEST_TMP/errx")"; EX=$?; XEX=$EX
  [ "$EX" != 0 ] || { echo "rc=0;"; bad=1; }
  [ "$(spawns_of "$F")" = 0 ] || { echo "spawns=$(spawns_of "$F");"; bad=1; }
  return $bad
}
for STUB_OUT in 'garbage' '' 'okay alias=a' 'Unconfigured' ' ok alias=a'; do
  unrecognised_holds "$STUBD" "$STUB_OUT" > "$TEST_TMP/pred.out"; XRC=$?; XPRED="$(cat "$TEST_TMP/pred.out")"
  assert_eq "0" "$XRC" "unrecognised env-check output [$STUB_OUT]: invalid, nothing spawned ($XPRED)"
done

# 6. negative controls: each mutation must turn its predicate red, for the stated reason.
MUT="$TEST_TMP/mut1"; cp -r "$REPO_ROOT/scripts" "$MUT"
sed_mutate "$MUT/dispatch-author.sh" 's/^    active) CNATIVE_ACCOUNT=1 ;;/    active) CNATIVE_ACCOUNT=0 ;;/'
good_holds "$MUT/dispatch-author.sh" >/dev/null; NG=$?
assert_neq "0" "$NG" "N9 mutation: negative control: account branch forced to the old seeded path turns the good-registry case red"
assert_eq "" "$(jget "$(first_call "$GF")" fp | sed 's/^null$//')" "negative control: ...because the shim saw no alias token (old path)"

MUT2="$TEST_TMP/mut2"; cp -r "$REPO_ROOT/scripts" "$MUT2"
sed_mutate "$MUT2/dispatch-author.sh" 's/^    \*) die_precondition "claude-native refused: account registry check failed[^"]*"/    *) CNATIVE_ACCOUNT=0/'
broken_holds "$MUT2/dispatch-author.sh" >/dev/null; NB=$?
assert_neq "0" "$NB" "N9 mutation: negative control: invalid registry treated as legacy turns the N9 case red"
assert_eq "1" "$(spawns_of "$BF")" "negative control: ...because the old claude path spawned the shim"
assert_eq "" "$(jget "$(first_call "$BF")" fp | sed 's/^null$//')" "negative control: ...and that spawn carried no alias token"

cp "$STUBD/claude-account.js" "$MUT2/claude-account.js"
unrecognised_holds "$MUT2" "garbage" >/dev/null; NU=$?
assert_neq "0" "$NU" "N9 mutation: negative control: unrecognised output treated as legacy turns the unrecognised case red"
assert_eq "1" "$(spawns_of "$XF")" "negative control: ...because the old claude path spawned the shim"

MUT3="$TEST_TMP/mut3"; cp -r "$REPO_ROOT/scripts" "$MUT3"; cp "$STUBD/claude-account.js" "$MUT3/claude-account.js"
sed_mutate "$MUT3/lib/account-state.sh" 's/^    \*) echo invalid ;;/    *) echo legacy ;;/'
unrecognised_holds "$MUT3" "garbage" >/dev/null; NR=$?
assert_neq "0" "$NR" "N9 mutation: negative control: account-state.sh default arm legacy instead of invalid turns the unrecognised case red"

# 7. the child-session scrub rides the account arm too (CHILD_SESSION_UNSET present on the env line)
assert_contains "$(grep -n 'node "\$_CNATIVE_ACCT_JS" run' -B3 "$SCRIPT" | head -20)" 'CHILD_SESSION_UNSET' "account arm: env line carries CHILD_SESSION_UNSET"

finalize_test
