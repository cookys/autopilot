#!/usr/bin/env bash
# dispatch-usage-live-isolation.test.sh — no test may append a dispatch_usage row to the real live dir.
#
# The rails (dispatch-hetero / -review / -author / -consult) append one ledger row per finished dispatch via
# `node .../lib/dispatch-usage.js append` into resolveLiveDir(). lib.sh gives every *.test.sh its own
# AUTOPILOT_LIVE_DIR, but a test that builds a clean child env (`env -i ...`, `spawnSync(..., { env: {...} })`)
# drops it, and the rail then resolves the REAL /run/user/<uid>/autopilot (2026-11-09: gpt-fixture / test /
# grok-4.5 exam/case-1 / gemini-3.7-flash-high / opencode-go/x test rows in the real ledger).
#
# Detector: a `node` shim first on PATH (every leaking path inherits PATH). For every lib/dispatch-usage.js
# call it records the destination the writer would resolve (AUTOPILOT_LIVE_DIR, or UNSET). A destination that
# is UNSET or outside the guard's own temp tree (TMPDIR for the child tests, or the lib.sh /dev/shm/autopilot-test-live-* dir) is a LEAK: the shim logs it and
# runs the real writer with AUTOPILOT_LIVE_DIR forced to a SENTINEL directory that stands in for the real
# live dir, so the leak is real, observable evidence (rows land in the sentinel, never in the real ledger).
# Pass criteria: no LEAK line, every recorded destination inside the temp tree, and the sentinel directory
# is byte-identical before and after (snapshot diff) a representative set of rail-driving tests.
# Negative controls: a clean-env call and an outside-temp call both log a LEAK and add a row to the sentinel
# (red); a call with a temp live dir does neither (green).
. "$(dirname "$0")/lib.sh"

REAL_NODE="$(command -v node)"
SHIM="$TEST_TMP/shim"; mkdir -p "$SHIM"
CHILD_TMP="$TEST_TMP/child-tmp"; mkdir -p "$CHILD_TMP"
SENTINEL="$TEST_TMP/sentinel-live"; mkdir -p "$SENTINEL"
LOG="$TEST_TMP/sentinel.log"; : > "$LOG"
cat > "$SHIM/node" <<SH
#!/usr/bin/env bash
for a in "\$@"; do
  case "\$a" in
    */lib/dispatch-usage.js)
      dest="\${AUTOPILOT_LIVE_DIR:-UNSET}"
      case "\$dest" in
        "$CHILD_TMP"/*|"$TEST_TMP"/ctl-*|/dev/shm/autopilot-test-live-*) printf 'DEST %s\n' "\$dest" >> "$LOG" ;;
        *) printf 'LEAK %s\n' "\$dest" >> "$LOG"
           AUTOPILOT_LIVE_DIR="$SENTINEL" exec "$REAL_NODE" "\$@" ;;
      esac ;;
  esac
done
exec "$REAL_NODE" "\$@"
SH
chmod +x "$SHIM/node"

nleaks() { grep -c '^LEAK' "$LOG" 2>/dev/null || true; }
snap() { ( cd "$SENTINEL" && find . -type f -exec sha256sum {} + 2>/dev/null | sort ); }

# --- negative controls ---
FAKE_RESULT='{"status":"committed","runner":"codex","model":"gpt-fixture"}'
w() { printf '%s' "$FAKE_RESULT" | env -i PATH="$SHIM:$PATH" HOME="$TEST_TMP" "$@" node "$REPO_ROOT/scripts/lib/dispatch-usage.js" append --from-result - --role reviewer --run-id ctl-run >/dev/null 2>&1; }
S0="$(snap)"
w
assert_eq "$(nleaks)" "1" "control: a clean-env writer call (destination unset) is logged as a leak"
assert_neq "$(snap)" "$S0" "control: the clean-env call put a row in the sentinel (sentinel diff is non-empty)"
S1="$(snap)"; : > "$LOG"
w AUTOPILOT_LIVE_DIR="$SENTINEL/elsewhere"
assert_eq "$(nleaks)" "1" "control: a nonempty live dir outside the temp tree is a leak too"
assert_neq "$(snap)" "$S1" "control: the outside-temp call also wrote into the sentinel"
S2="$(snap)"; : > "$LOG"
mkdir -p "$TEST_TMP/ctl-live"
w AUTOPILOT_LIVE_DIR="$TEST_TMP/ctl-live"
assert_eq "$(nleaks)" "0" "control: a temp live dir is not a leak"
assert_eq "$(snap)" "$S2" "control: a temp live dir leaves the sentinel untouched"
assert_eq "$(grep -c '^DEST' "$LOG")" "1" "control: the shim recorded the resolved destination"
: > "$LOG"; S3="$(snap)"

# --- the class: tests that build a clean env and reach a rail ---
for t in hooks/tests/agy-bind-symlink.test.sh \
         scripts/lib/opencode-containment.test.js scripts/engine-qualify-impl-hardening.test.js; do
  case "$t" in
    *.sh) ( cd "$REPO_ROOT" && env -u AUTOPILOT_LIVE_DIR TMPDIR="$CHILD_TMP" PATH="$SHIM:$PATH" bash "$t" </dev/null >"$TEST_TMP/out.txt" 2>&1 ) ;;
    *)    ( cd "$REPO_ROOT" && env -u AUTOPILOT_LIVE_DIR TMPDIR="$CHILD_TMP" PATH="$SHIM:$PATH" node --test "$t" </dev/null >"$TEST_TMP/out.txt" 2>&1 ) ;;
  esac
  assert_eq "$?" "0" "$t still passes under the shim"
  assert_eq "$(nleaks)" "0" "$t: every dispatch_usage destination is inside its temp tree ($(grep '^LEAK' "$LOG" | head -1 | cut -c1-120))"
  assert_eq "$(snap)" "$S3" "$t: sentinel (would-be real live dir) unchanged"
  : > "$LOG"
done

finalize_test
