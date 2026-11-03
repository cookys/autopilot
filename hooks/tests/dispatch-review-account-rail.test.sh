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

# run_rail <scripts-dir> -> RC, OUT
run_rail() {
  : > "$FX_LOG"
  OUT="$(env HOME="$FX_HOME" PATH="$FX_BIN:$PATH" TMPDIR="$FX_TMP" XDG_RUNTIME_DIR="$FX_RUN" \
    AUTOPILOT_ACCOUNTS_DIR="$FX_ACC" AUTOPILOT_LIVE_DIR="$FX_LIVE" AUTOPILOT_STATE_DIR="$FX_STATE" AUTOPILOT_CONFIG="$FX_CFG" \
    "$1/dispatch-review.sh" --runner claude-native --model haiku --diff-file "$TEST_TMP/d.diff" --bin "$FX_BIN/claude" --timeout 30s 2>&1 < /dev/null)"
  RC=$?
  NSPAWN="$(grep -c . "$FX_LOG" 2>/dev/null || true)"
  SEEN_FP="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);console.log(l.length?JSON.parse(l[0]).fp:"")' "$FX_LOG")"
  SEEN_ACCT="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);console.log(l.length?JSON.parse(l[0]).account||"":"")' "$FX_LOG")"
  DECOY="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);console.log(l.some(x=>JSON.parse(x).decoy_read))' "$FX_LOG")"
}

# check_good <scripts-dir>: echo failures, return 1 on any
check_good() {
  run_rail "$1"
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
assert_eq "0" "$GRC" "good registry: shim sees alias a token fingerprint, no decoy, token not printed ($GOUT)"

# N9: broken registry (token mode 0644) -> exit 2, spawn 0, decoy untouched
chmod 0644 "$FX_ACC/a/token"
check_broken() {
  run_rail "$1"
  local bad=0
  [ "$RC" = 2 ] || { echo "rc=$RC;"; bad=1; }
  [ "$NSPAWN" = 0 ] || { echo "spawns=$NSPAWN;"; bad=1; }
  [ "$DECOY" != true ] || { echo "decoy read;"; bad=1; }
  return $bad
}
BOUT="$(check_broken "$SD")"; BRC=$?
assert_eq "0" "$BRC" "N9 broken registry: exit 2, shim spawned 0 times ($BOUT)"

# Negative control: force the registry branch off (old seeded-credentials path); the decoy home credentials get
# seeded and read, so both checks must be red.
OLD="$TEST_TMP/old-scripts"; cp -r "$SD" "$OLD"
sed_mutate "$OLD/dispatch-review.sh" 's/\*) _ACCT_ACTIVE=1 ;;/*) _ACCT_ACTIVE=0 ;;/'
chmod 0600 "$FX_ACC/a/token"
check_good "$OLD" >/dev/null; NG=$?
assert_neq "0" "$NG" "negative control: seeded-credentials path instead of claude-account.js run is detected (good registry)"
chmod 0644 "$FX_ACC/a/token"
sed_mutate "$OLD/dispatch-review.sh" 's/    || die_precondition "claude-native refused: the account registry is present but invalid[^"]*"/    || true/'
check_broken "$OLD" >/dev/null; NB=$?
assert_neq "0" "$NB" "negative control: ignoring env-check failure is detected (broken registry)"

rm -rf "$FX_ROOT"
finalize_test
