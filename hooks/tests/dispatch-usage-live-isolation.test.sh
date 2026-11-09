#!/usr/bin/env bash
# dispatch-usage-live-isolation.test.sh — no test may append a dispatch_usage row to the real live dir.
#
# The rails (dispatch-hetero / -review / -author / -consult) append one ledger row per finished dispatch via
# `node .../lib/dispatch-usage.js append` into resolveLiveDir(). lib.sh gives every *.test.sh its own
# AUTOPILOT_LIVE_DIR, but a test that builds a clean child env (`env -i ...`, `spawnSync(..., { env: {...} })`)
# drops it, and the rail then resolves the REAL /run/user/<uid>/autopilot (2026-11-09: gpt-fixture / test /
# grok-4.5 exam/case-1 / gemini-3.7-flash-high / opencode-go/x test rows in the real ledger).
#
# Detector: a `node` shim first on PATH (every leaking path inherits PATH). When it is asked to run
# lib/dispatch-usage.js and the env it received carries no AUTOPILOT_LIVE_DIR, it records one line in a
# sentinel log and does NOT write; otherwise it runs the real node. A representative set of tests that drive
# the rails with a clean env is run under the shim; the sentinel log must stay empty.
# Negative control (below): the shim sees a clean-env writer call and logs it, so a red guard is possible.
. "$(dirname "$0")/lib.sh"

REAL_NODE="$(command -v node)"
SHIM="$TEST_TMP/shim"; mkdir -p "$SHIM"
LOG="$TEST_TMP/sentinel.log"; : > "$LOG"
cat > "$SHIM/node" <<SH
#!/usr/bin/env bash
for a in "\$@"; do
  case "\$a" in
    */lib/dispatch-usage.js)
      if [ -z "\${AUTOPILOT_LIVE_DIR:-}" ]; then
        printf 'LEAK %s\n' "\$*" >> "$LOG"
        cat >/dev/null 2>&1 || true
        exit 0
      fi ;;
  esac
done
exec "$REAL_NODE" "\$@"
SH
chmod +x "$SHIM/node"

nleaks() { grep -c '^LEAK' "$LOG" 2>/dev/null || true; }

# --- negative control: the detector fires on a clean-env writer call and stays quiet with a live dir ---
FAKE_RESULT='{"status":"committed","runner":"codex","model":"gpt-fixture"}'
printf '%s' "$FAKE_RESULT" | env -i PATH="$SHIM:$PATH" HOME="$TEST_TMP" node "$REPO_ROOT/scripts/lib/dispatch-usage.js" append --from-result - --role reviewer >/dev/null 2>&1
assert_eq "$(nleaks)" "1" "negative control: a clean-env writer call is logged by the shim (and not written)"
printf '%s' "$FAKE_RESULT" | env -i PATH="$SHIM:$PATH" HOME="$TEST_TMP" AUTOPILOT_LIVE_DIR="$AUTOPILOT_LIVE_DIR" node "$REPO_ROOT/scripts/lib/dispatch-usage.js" append --from-result - --role reviewer >/dev/null 2>&1
assert_eq "$(nleaks)" "1" "negative control: the same call with a live dir passes through, no new leak line"
: > "$LOG"

# --- the class: tests that build a clean env and reach a rail ---
for t in hooks/tests/agy-bind-symlink.test.sh \
         scripts/lib/opencode-containment.test.js scripts/engine-qualify-impl-hardening.test.js; do
  case "$t" in
    *.sh) ( cd "$REPO_ROOT" && env -u AUTOPILOT_LIVE_DIR PATH="$SHIM:$PATH" bash "$t" </dev/null >"$TEST_TMP/out.txt" 2>&1 ) ;;
    *)    ( cd "$REPO_ROOT" && env -u AUTOPILOT_LIVE_DIR PATH="$SHIM:$PATH" node --test "$t" </dev/null >"$TEST_TMP/out.txt" 2>&1 ) ;;
  esac
  assert_eq "$?" "0" "$t still passes under the shim"
  assert_eq "$(nleaks)" "0" "$t: no dispatch_usage row aimed at the real live dir ($(grep '^LEAK' "$LOG" | head -1 | cut -c1-120))"
  : > "$LOG"
done

finalize_test
