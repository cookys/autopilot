#!/usr/bin/env bash
# BL-0290: the claude-native branches of dispatch-review.sh and dispatch-author.sh hand the claude child a
# seeded CLAUDE_CONFIG_DIR holding ONLY .credentials.json, never the real config dir, and remove it on every
# exit path (success, child failure, TERM). Fake HOME + fake real config dir: the real ~/.claude is never touched.
# Negative control: the same checker run against copies of the scripts with the CLAUDE_CONFIG_DIR hand-off
# removed (the old behaviour) must be red.
. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.claude"
REAL="$TEST_TMP/real-claude-config"; mkdir -p "$REAL/projects"
printf '{"claudeAiOauth":{"accessToken":"stub"}}\n' > "$REAL/.credentials.json"
printf '{"hooks":{}}\n' > "$REAL/settings.json"
printf '{}\n' > "$REAL/.claude.json"
export CLAUDE_CONFIG_DIR="$REAL"
export TMPDIR="$TEST_TMP/tmproot"; mkdir -p "$TMPDIR"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID

REC="$TEST_TMP/rec"
STUB="$TEST_TMP/claude-stub"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
cat >/dev/null
{
  echo "CFG=${CLAUDE_CONFIG_DIR-UNSET}"
  echo "HOME=$HOME"
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -d "$CLAUDE_CONFIG_DIR" ]; then
    echo "LS=$(ls -A "$CLAUDE_CONFIG_DIR" | tr '\n' ' ')"
  fi
} > "$STUB_REC"
case "${STUB_MODE:-ok}" in
  fail) exit 3 ;;
  hang) echo ready > "$STUB_REC.ready"; sleep 60; exit 0 ;;
esac
echo '{"verdict":"READY","findings":[]}'
STUBEOF
chmod +x "$STUB"
export STUB_REC="$REC"

printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n' > "$TEST_TMP/d.diff"
printf 'Return a small JSON object.\n' > "$TEST_TMP/p.txt"

# run_case <scripts-dir> <review|author> <ok|fail|term>  -> sets RC, SEEN_CFG, SEEN_LS, LEFT
run_case() {
  local sd="$1" kind="$2" mode="$3"
  rm -f "$REC" "$REC.ready"; rm -rf "$TMPDIR"; mkdir -p "$TMPDIR"
  local -a cmd
  local runner=claude-native; [ "${CASE_RUNNER:-}" = cc-shim ] && runner=cc-shim
  if [ "$kind" = review ]; then
    cmd=("$sd/dispatch-review.sh" --runner "$runner" ${CASE_RUNNER:+--endpoint TESTEP} --model m --diff-file "$TEST_TMP/d.diff" --bin "$STUB" --timeout 20s)
  else
    cmd=("$sd/dispatch-author.sh" --runner "$runner" --model m --prompt-file "$TEST_TMP/p.txt" --bin "$STUB" --timeout 20s)
  fi
  if [ "$mode" = term ]; then
    # short-lived helper child of this test; waited below
    STUB_MODE=hang "${cmd[@]}" >/dev/null 2>&1 < /dev/null &
    local pid=$! i=0
    while [ ! -e "$REC.ready" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
    kill -TERM "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null; RC=$?
    pkill -f "$STUB" 2>/dev/null || true
    sleep 0.3
  else
    STUB_MODE="$mode" "${cmd[@]}" >/dev/null 2>&1 < /dev/null; RC=$?
  fi
  SEEN_CFG="$(sed -n 's/^CFG=//p' "$REC" 2>/dev/null)"
  SEEN_LS="$(sed -n 's/^LS=//p' "$REC" 2>/dev/null)"
  LEFT="$(ls -A "$TMPDIR" 2>/dev/null | grep -c '^claude-config-' || true)"
}

# check_case <scripts-dir> <kind> <mode>: prints failures, returns 0 when the contract holds
check_case() {
  run_case "$1" "$2" "$3"
  local bad=0
  [ -n "$SEEN_CFG" ] && [ "$SEEN_CFG" != UNSET ] || { echo "no CLAUDE_CONFIG_DIR seen;"; bad=1; }
  [ "$SEEN_CFG" != "$REAL" ] && [ "$SEEN_CFG" != "$HOME/.claude" ] || { echo "child got the real config dir;"; bad=1; }
  [ "$SEEN_LS" = ".credentials.json " ] || { echo "dir content is not only .credentials.json: [$SEEN_LS];"; bad=1; }
  [ "$LEFT" = 0 ] || { echo "seeded config dir left behind ($LEFT);"; bad=1; }
  return $bad
}

SD="$REPO_ROOT/scripts"
for kind in review author; do
  for mode in ok fail term; do
    OUTC="$(check_case "$SD" "$kind" "$mode")"; CRC=$?
    assert_eq "0" "$CRC" "$kind claude-native/$mode: seeded credentials-only config dir, removed after ($OUTC)"
  done
  run_case "$SD" "$kind" fail
  assert_neq "0" "$RC" "$kind claude-native: child failure is not reported as success"
done

# Missing source credentials fail closed, child never launched.
mv "$REAL/.credentials.json" "$REAL/.credentials.json.off"
for kind in review author; do
  run_case "$SD" "$kind" ok
  assert_eq "2" "$RC" "$kind claude-native without credentials exits 2 (fail closed)"
  assert_file_absent "$REC" "$kind claude-native without credentials never launches claude"
done
mv "$REAL/.credentials.json.off" "$REAL/.credentials.json"

# Negative control: old behaviour (no CLAUDE_CONFIG_DIR hand-off) must be caught as red.
OLD="$TEST_TMP/old-scripts"; cp -r "$SD" "$OLD"
for f in dispatch-review.sh dispatch-author.sh; do sed_mutate "$OLD/$f" 's/ CLAUDE_CONFIG_DIR="\$CNATIVE_CFG"//'; done
for kind in review author; do
  check_case "$OLD" "$kind" ok >/dev/null; NRC=$?
  assert_neq "0" "$NRC" "negative control: $kind with the old hand-off removed is detected"
done

# cc-shim authenticates with its own bearer token under a scratch HOME: it must NOT inherit the operator's
# CLAUDE_CONFIG_DIR (the fake real dir here carries a settings.json). Old behaviour (no -u) is caught.
export ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=tok
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
ccshim_ok() { CASE_RUNNER=cc-shim run_case "$1" "$2" ok; [ "$SEEN_CFG" = UNSET ]; }
for f in dispatch-review.sh dispatch-author.sh; do sed_mutate "$OLD/$f" 's/ -u CLAUDE_CONFIG_DIR//'; done
for kind in review author; do
  ccshim_ok "$SD" "$kind"; assert_eq "0" "$?" "$kind cc-shim child does not inherit CLAUDE_CONFIG_DIR (saw: $SEEN_CFG)"
  ccshim_ok "$OLD" "$kind"; assert_neq "0" "$?" "negative control: $kind cc-shim without the unset is detected"
done

# An EXTERNAL CLAUDE_CONFIG_DIR (fake "operator" dir with credentials and a settings.json) exported before a
# suite sources lib.sh must be dropped by lib.sh: a native case that never called the helper fails closed
# (exit 2, stub never launched) instead of seeding from the external dir. Negative control: lib.sh without
# its unset lets the external dir through (exit 0, stub launched).
EXT="$TEST_TMP/external-config"; mkdir -p "$EXT"
printf '{"claudeAiOauth":{"accessToken":"ext"}}\n' > "$EXT/.credentials.json"; printf '{}\n' > "$EXT/settings.json"
LEAK_INNER="$TEST_TMP/leak-inner.sh"
cat > "$LEAK_INNER" <<'INNER'
. "$1"
export TMPDIR="$OUTER_TMP/leak-tmp"; mkdir -p "$TMPDIR"
rm -f "$STUB_REC"
"$2/dispatch-author.sh" --runner claude-native --model m --prompt-file "$OUTER_TMP/p.txt" --bin "$STUB" --timeout 20s >/dev/null 2>&1 < /dev/null
echo $?
INNER
LIB_ORIG="$REPO_ROOT/hooks/tests/lib.sh"
LIB_NOUNSET="$REPO_ROOT/hooks/tests/lib-nounset-tmp.sh"
grep -v '^unset CLAUDE_CONFIG_DIR$' "$LIB_ORIG" > "$LIB_NOUNSET"
LEAK_RC_OK="$(env -i PATH="$PATH" HOME="$HOME" CLAUDE_CONFIG_DIR="$EXT" OUTER_TMP="$TEST_TMP" STUB="$STUB" STUB_REC="$REC" bash "$LEAK_INNER" "$LIB_ORIG" "$SD" 2>/dev/null | tail -1)"
assert_eq "2" "$LEAK_RC_OK" "external CLAUDE_CONFIG_DIR is dropped by lib.sh: uncalled-helper native case fails closed"
assert_file_absent "$REC" "fail closed: stub never launched"
LEAK_RC_OLD="$(env -i PATH="$PATH" HOME="$HOME" CLAUDE_CONFIG_DIR="$EXT" OUTER_TMP="$TEST_TMP" STUB="$STUB" STUB_REC="$REC" bash "$LEAK_INNER" "$LIB_NOUNSET" "$SD" 2>/dev/null | tail -1)"
rm -f "$LIB_NOUNSET"
assert_neq "2" "$LEAK_RC_OLD" "negative control: lib.sh without the unset is not fail-closed (rc $LEAK_RC_OLD)"
assert_file_exists "$REC" "negative control: without the unset the stub is launched from the external dir"

finalize_test
