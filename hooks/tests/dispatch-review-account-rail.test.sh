#!/usr/bin/env bash
# G37 W1 (plan 8): dispatch-review.sh claude-native arm goes through claude-account.js run when the account
# registry exists. Fake tokens + Node claude shim only; the real ~/.claude and ~/.config/autopilot are never read.
#  - good registry: shim sees the alias token fingerprint and AUTOPILOT_ACCOUNT, never the decoy credentials
#  - broken registry (N9): dispatch dies with exit 2 and the shim is spawned 0 times, decoy never read
#  - negative control: with the registry branch forced off (old seeded path), the same assertions go red
. "$(dirname "$0")/lib.sh"

FIX_JS="$REPO_ROOT/scripts/lib/account-fixtures/shim-install.js"
mk_fixture() {
  FX="$(node -e '
    const { makeFixture } = require(process.argv[1]);
    const f = makeFixture({ aliases: [{ alias: "a" }, { alias: "b" }] });
    const crypto = require("crypto");
    const fp = (t) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 8);
    const q = (s) => "\x27" + s + "\x27";
    const out = { FX_ROOT: f.root, FX_HOME: f.realHome, FX_BIN: f.shim.binDir, FX_LOG: f.shim.log,
      FX_ACC: f.accountsDir, FX_LIVE: f.liveDir, FX_STATE: f.stateDir, FX_RUN: f.env.XDG_RUNTIME_DIR,
      FX_TMP: f.env.TMPDIR, FX_CFG: f.configFile, FX_FP_A: fp(f.tokens.a), FX_FP_B: fp(f.tokens.b),
      FX_TOK_A: f.tokens.a };
    for (const [k, v] of Object.entries(out)) console.log(k + "=" + q(v));
  ' "$FIX_JS")"
  eval "$FX"
}
mk_fixture
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n' > "$TEST_TMP/d.diff"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR

# run_rail <scripts-dir> [VAR=val ...] -> RC, OUT, NSPAWN (shim spawns + stub `run` calls)
run_rail() {
  local sd="$1"; shift
  : > "$FX_LOG"; : > "$TEST_TMP/stub.log"
  OUT="$(env HOME="$FX_HOME" PATH="$FX_BIN:$PATH" TMPDIR="$FX_TMP" XDG_RUNTIME_DIR="$FX_RUN" G37_STUB_LOG="$TEST_TMP/stub.log" "$@" \
    AUTOPILOT_ACCOUNTS_DIR="$FX_ACC" AUTOPILOT_LIVE_DIR="$FX_LIVE" AUTOPILOT_STATE_DIR="$FX_STATE" AUTOPILOT_CONFIG="$FX_CFG" \
    "$sd/dispatch-review.sh" --runner claude-native --model haiku --diff-file "$TEST_TMP/d.diff" --bin "$FX_BIN/claude" --timeout 30s 2>&1 < /dev/null)"
  RC=$?
  NSPAWN="$(( $(grep -c . "$FX_LOG" 2>/dev/null || true) + $(grep -c . "$TEST_TMP/stub.log" 2>/dev/null || true) ))"
  SEEN_FP="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);console.log(l.length?JSON.parse(l[0]).fp:"")' "$FX_LOG")"
  SEEN_ACCT="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);console.log(l.length?JSON.parse(l[0]).account||"":"")' "$FX_LOG")"
  DECOY="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);console.log(l.some(x=>JSON.parse(x).decoy_read))' "$FX_LOG")"
}

# check_good <scripts-dir>: echo failures, return 1 on any
check_good() {
  run_rail "$1" "${@:2}"
  local bad=0
  [ "$NSPAWN" = 1 ] || { echo "spawns=$NSPAWN;"; bad=1; }
  [ "$SEEN_FP" = "$FX_FP_A" ] || { echo "token fingerprint [$SEEN_FP] != alias a;"; bad=1; }
  [ "$SEEN_ACCT" = a ] || { echo "AUTOPILOT_ACCOUNT [$SEEN_ACCT];"; bad=1; }
  [ "$DECOY" = false ] || { echo "decoy credentials read;"; bad=1; }
  case "$OUT" in *"$FX_TOK_A"*) echo "token printed;"; bad=1 ;; esac
  return $bad
}

SD="$REPO_ROOT/scripts"
GOUT="$(check_good "$SD")"; GRC=$?
assert_eq "0" "$GRC" "N9 good: registry: shim sees alias a token fingerprint, no decoy, token not printed ($GOUT)"

# N9: broken registry (token mode 0644) -> exit 2, spawn 0, decoy untouched
chmod 0644 "$FX_ACC/a/token"
check_broken() {
  run_rail "$1" "${@:2}"
  local bad=0
  [ "$RC" = 2 ] || { echo "rc=$RC;"; bad=1; }
  [ "$NSPAWN" = 0 ] || { echo "spawns=$NSPAWN;"; bad=1; }
  [ "$DECOY" != true ] || { echo "decoy read;"; bad=1; }
  return $bad
}
BOUT="$(check_broken "$SD")"; BRC=$?
assert_eq "0" "$BRC" "N9 broken: registry exit 2, shim spawned 0 times ($BOUT)"

# --- legacy arms: unconfigured (no registry) and mode_off both keep the seeded path: one spawn, no alias, no token
check_legacy() {
  run_rail "$1" "${@:2}"
  local bad=0
  [ "$NSPAWN" = 1 ] || { echo "spawns=$NSPAWN;"; bad=1; }
  [ -z "$SEEN_ACCT" ] || { echo "alias [$SEEN_ACCT] reached the legacy path;"; bad=1; }
  [ -z "$SEEN_FP" ] || { echo "token fingerprint [$SEEN_FP] reached the legacy path;"; bad=1; }
  return $bad
}
chmod 0600 "$FX_ACC/a/token"
LOUT="$(check_legacy "$SD" AUTOPILOT_ACCOUNT_MODE=off)"; LRC=$?
assert_eq "0" "$LRC" "mode_off: legacy seeded path, one spawn, no alias/token ($LOUT)"
mv "$FX_ACC/registry.json" "$FX_ACC/registry.json.away"
UOUT="$(check_legacy "$SD")"; URC=$?
assert_eq "0" "$URC" "unconfigured (no registry): legacy seeded path, one spawn, no alias/token ($UOUT)"
mv "$FX_ACC/registry.json.away" "$FX_ACC/registry.json"

# --- unrecognised env-check output (rc 0 but not unconfigured|mode_off|ok): invalid, spawn 0.
# A stub claude-account.js stands in for the real one in a copy of scripts/: env-check prints $G37_STUB_OUT.
STUBD="$TEST_TMP/stub-scripts"; cp -r "$SD" "$STUBD"
cat > "$STUBD/claude-account.js" <<'STUBEOF'
const fs = require('fs'); const a = process.argv[2];
if (a === 'env-check') { process.stdout.write(process.env.G37_STUB_OUT || ''); process.exit(Number(process.env.G37_STUB_RC || 0)); }
fs.appendFileSync(process.env.G37_STUB_LOG, a + '\n'); process.exit(0);
STUBEOF
# positive control: the stub itself works (reporting `unconfigured` reaches the legacy spawn), so the spawn-0
# results below cannot come from a stub that crashes (a crash also reads as invalid).
SOUT="$(check_legacy "$STUBD" G37_STUB_OUT=unconfigured)"; SRC=$?
assert_eq "0" "$SRC" "stub positive control: unconfigured through the stub is the legacy path, one spawn ($SOUT)"
check_unrecognised() {
  run_rail "$1" "${@:2}"
  local bad=0
  [ "$RC" != 0 ] || { echo "rc=0;"; bad=1; }
  [ "$NSPAWN" = 0 ] || { echo "spawns=$NSPAWN;"; bad=1; }
  return $bad
}
for STUB_OUT in 'garbage' '' 'okay alias=a' 'Unconfigured' ' ok alias=a'; do
  XOUT="$(check_unrecognised "$STUBD" "G37_STUB_OUT=$STUB_OUT")"; XRC=$?
  assert_eq "0" "$XRC" "unrecognised env-check output [$STUB_OUT]: invalid, nothing spawned ($XOUT)"
done

# --- negative controls. Each mutation must turn the matching check red, for the stated reason.
OLD="$TEST_TMP/old-scripts"; cp -r "$SD" "$OLD"
sed_mutate "$OLD/dispatch-review.sh" 's/^    active) _ACCT_ACTIVE=1 ;;/    active) _ACCT_ACTIVE=0 ;;/'
chmod 0600 "$FX_ACC/a/token"
check_good "$OLD" >/dev/null; NG=$?
assert_neq "0" "$NG" "N9 mutation: negative control: seeded-credentials path instead of claude-account.js run is detected (good registry)"
chmod 0644 "$FX_ACC/a/token"
OLD2="$TEST_TMP/old2-scripts"; cp -r "$SD" "$OLD2"
sed_mutate "$OLD2/dispatch-review.sh" 's/^    \*) die_precondition "claude-native refused: the account registry is present[^"]*"/    *) _ACCT_ACTIVE=0/'
check_broken "$OLD2" >/dev/null; NB=$?
assert_neq "0" "$NB" "N9 mutation: negative control: invalid registry treated as legacy is detected (broken registry)"
# ...and it is red because the OLD claude path really ran: one spawn, no alias, no token
assert_eq "1" "$NSPAWN" "negative control (broken registry fail-open): the old claude path spawned the shim"
assert_eq "" "$SEEN_FP$SEEN_ACCT" "negative control (broken registry fail-open): the spawn carried no alias token"
# same fail-open against unrecognised output
cp "$STUBD/claude-account.js" "$OLD2/claude-account.js"
check_unrecognised "$OLD2" "G37_STUB_OUT=garbage" >/dev/null; NU=$?
assert_neq "0" "$NU" "N9 mutation: negative control: unrecognised output treated as legacy is detected"
assert_eq "1" "$NSPAWN" "negative control (unrecognised fail-open): the old claude path spawned the shim"
# the shared reading rule: unknown word treated as active/legacy in account-state.sh is detected too
OLD3="$TEST_TMP/old3-scripts"; cp -r "$SD" "$OLD3"; cp "$STUBD/claude-account.js" "$OLD3/claude-account.js"
sed_mutate "$OLD3/lib/account-state.sh" 's/^    \*) echo invalid ;;/    *) echo legacy ;;/'
check_unrecognised "$OLD3" "G37_STUB_OUT=garbage" >/dev/null; NR=$?
assert_neq "0" "$NR" "N9 mutation: negative control: account-state.sh default arm legacy instead of invalid is detected"

case "$FX_LIVE" in
  /dev/shm/g37-fix-live-*)
    if [ -d "$FX_LIVE" ] && [ ! -L "$FX_LIVE" ]; then rm -rf -- "$FX_LIVE"; fi
    ;;
esac
rm -rf "$FX_ROOT"
finalize_test
