#!/usr/bin/env bash
# codeforge usage collect after a throwaway claude config dir.
# A recording fake `codeforge` is first on PATH. This file never invokes a real
# codeforge or a real model. Unit cases restrict PATH to the fake plus /usr/bin:/bin.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_CODEFORGE_COLLECT
HELPER="$REPO_ROOT/scripts/lib/codeforge-collect.sh"

CF_BIN="$TEST_TMP/cf-bin"
mkdir -p "$CF_BIN"
CF_ARGV="$TEST_TMP/cf-argv"
CF_DIR_STATE="$TEST_TMP/cf-dir-state"
export CF_ARGV CF_DIR_STATE CF_RC=0
cat > "$CF_BIN/codeforge" <<'EOF'
#!/bin/sh
# Record the argv the helper actually passed. Refuse to look like a successful
# collect when the directory is already gone.
printf '%s\n' "$*" >> "$CF_ARGV"
dir=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--claude-dir" ]; then dir="$a"; fi
  prev="$a"
done
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
  printf 'DIR_GONE %s\n' "$dir" >> "$CF_DIR_STATE"
else
  resolved="$(realpath "$dir" 2>/dev/null || true)"
  if [ "$dir" != "$resolved" ]; then
    printf 'NOT_REAL %s %s\n' "$dir" "$resolved" >> "$CF_DIR_STATE"
  else
    printf 'DIR_OK %s\n' "$dir" >> "$CF_DIR_STATE"
  fi
fi
exit "${CF_RC:-0}"
EOF
chmod +x "$CF_BIN/codeforge"

reset_cf() {
  : > "$CF_ARGV"
  : > "$CF_DIR_STATE"
  CF_RC=0
}

# call_helper <dir> — sources the helper under set -e and exits 7.
# UNIT_RC / UNIT_ERR are the caller's status and stderr.
call_helper() {
  local errf="$TEST_TMP/unit-err"
  : > "$errf"
  PATH="$CF_BIN:/usr/bin:/bin" bash -c '
    set -euo pipefail
    . "$1"
    codeforge_collect_claude_dir "$2"
    exit 7
  ' _ "$HELPER" "$1" 2>"$errf"
  UNIT_RC=$?
  UNIT_ERR="$(cat "$errf")"
}

assert_no_call() {
  local label="$1"
  assert_eq "7" "$UNIT_RC" "$label: caller rc stays 7"
  assert_eq "" "$UNIT_ERR" "$label: no stderr"
  assert_file_absent_content "$label"
}

assert_file_absent_content() {
  if [ ! -s "$CF_ARGV" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$1: expected no codeforge call, got [$(cat "$CF_ARGV")]"
  fi
}

assert_one_collect() {
  local label="$1" expect="$2"
  local n got
  assert_eq "7" "$UNIT_RC" "$label: caller rc stays 7"
  assert_eq "" "$UNIT_ERR" "$label: success is silent"
  n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
  assert_eq "1" "$n" "$label: exactly one call"
  got="$(sed -n '1p' "$CF_ARGV")"
  assert_eq "$expect" "$got" "$label: argv is usage collect --claude-dir <realpath>"
  assert_not_contains "$got" "--quiet" "$label: no --quiet"
  assert_not_contains "$(cat "$CF_DIR_STATE")" "DIR_GONE" "$label: dir still existed"
  assert_not_contains "$(cat "$CF_DIR_STATE")" "NOT_REAL" "$label: argv path is symlink-free"
  assert_contains "$(cat "$CF_DIR_STATE")" "DIR_OK ${expect#usage collect --claude-dir }" "$label: fake saw the real dir"
}

# (1) sandbox dir -> one call, realpath, no --quiet
reset_cf
SANDBOX="$TEST_TMP/case1-sandbox"
mkdir -p "$SANDBOX"
call_helper "$SANDBOX"
assert_one_collect "1 sandbox" "usage collect --claude-dir $(realpath "$SANDBOX")"

# (2) path given through a symlink -> argv carries the resolved real path
reset_cf
mkdir -p "$TEST_TMP/case2/real"
ln -s "$TEST_TMP/case2/real" "$TEST_TMP/case2/link"
call_helper "$TEST_TMP/case2/link"
assert_one_collect "2 symlink" "usage collect --claude-dir $(realpath "$TEST_TMP/case2/real")"
assert_neq "$(realpath "$TEST_TMP/case2/link")" "$TEST_TMP/case2/link" "2 symlink: link path differs from its realpath"
assert_not_contains "$(sed -n '1p' "$CF_ARGV" 2>/dev/null || true)" "$TEST_TMP/case2/link" "2 symlink: argv does not carry the symlink path"

# (3) dir resolves to the real ~/.claude (fake HOME), including via a symlink -> no call
reset_cf
FAKE_HOME="$TEST_TMP/case3-home"
mkdir -p "$FAKE_HOME/.claude"
ln -s "$FAKE_HOME/.claude" "$TEST_TMP/case3-link"
HOME="$FAKE_HOME" call_helper "$FAKE_HOME/.claude"
assert_no_call "3 real ~/.claude"
HOME="$FAKE_HOME" call_helper "$TEST_TMP/case3-link"
assert_no_call "3 symlink to ~/.claude"

# (4) codeforge absent from PATH -> one log line, caller rc unchanged
reset_cf
mkdir -p "$TEST_TMP/case4"
errf="$TEST_TMP/unit-err"
: > "$errf"
PATH="/usr/bin:/bin" bash -c '
  set -euo pipefail
  . "$1"
  codeforge_collect_claude_dir "$2"
  exit 7
' _ "$HELPER" "$TEST_TMP/case4" 2>"$errf"
UNIT_RC=$?
UNIT_ERR="$(cat "$errf")"
assert_eq "7" "$UNIT_RC" "4 absent: caller rc stays 7"
assert_eq "codeforge-collect: codeforge not on PATH" "$UNIT_ERR" "4 absent: one log line"
assert_file_absent_content "4 absent"

# (5) codeforge exits 1 -> one log line, caller rc unchanged, and it was invoked once
reset_cf
mkdir -p "$TEST_TMP/case5"
CF_RC=1
call_helper "$TEST_TMP/case5"
CF_RC=0
assert_eq "7" "$UNIT_RC" "5 exit 1: caller rc stays 7"
assert_eq "codeforge-collect: usage collect failed" "$UNIT_ERR" "5 exit 1: one log line"
n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
assert_eq "1" "$n" "5 exit 1: exactly one call"
assert_not_contains "$(cat "$CF_ARGV")" "--quiet" "5 exit 1: no --quiet"

# (6) AUTOPILOT_CODEFORGE_COLLECT=off -> no call
reset_cf
mkdir -p "$TEST_TMP/case6"
AUTOPILOT_CODEFORGE_COLLECT=off call_helper "$TEST_TMP/case6"
unset AUTOPILOT_CODEFORGE_COLLECT
assert_no_call "6 knob off"

# (7) end-to-end: dispatch-review fake claude. Collect fires while the dir still exists,
# and the dir is gone afterwards. cc-shim (shell rm) and claude-native (--exec rm).
export PATH="$CF_BIN:$PATH"
export AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset CLAUDE_CONFIG_DIR

DIFF="$TEST_TMP/d.diff"
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n' > "$DIFF"
STUB="$TEST_TMP/claude-stub"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
mkdir -p "$HOME/.claude"
printf 'marker\n' > "$HOME/.claude/usage-marker"
PROMPT="$(cat)"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=fixture; evidence=slice traced; conclusion=no blocking discrepancy observed"
echo "$end"
STUBEOF
chmod +x "$STUB"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"

e2e_one() {
  local label="$1"
  shift
  reset_cf
  local out="$TEST_TMP/e2e-out"
  "$@" >"$out" 2>&1
  local rc=$?
  assert_eq "0" "$rc" "$label: dispatch exit 0 (collect must not change it) [$(tail -c 400 "$out" | tr '\n' ' ')]"
  local n got dir
  n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
  assert_eq "1" "$n" "$label: exactly one collect [$(cat "$CF_ARGV" 2>/dev/null | tr '\n' ' ')]"
  got="$(sed -n '1p' "$CF_ARGV")"
  assert_not_contains "$got" "--quiet" "$label: no --quiet"
  assert_contains "$got" "usage collect --claude-dir /" "$label: argv starts with usage collect --claude-dir"
  dir="${got#usage collect --claude-dir }"
  assert_contains "$(cat "$CF_DIR_STATE")" "DIR_OK " "$label: fake saw the dir still present"
  assert_not_contains "$(cat "$CF_DIR_STATE")" "DIR_GONE" "$label: collect ran before the dir was removed"
  assert_not_contains "$(cat "$CF_DIR_STATE")" "NOT_REAL" "$label: collected path was symlink-free"
  if [ -n "$dir" ] && [ ! -d "$dir" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$label: config dir should be gone after dispatch ($dir)"
  fi
}

e2e_one "7 cc-shim" \
  "$REVIEW" --runner cc-shim --model haiku --diff-file "$DIFF" --bin "$STUB" --endpoint TESTEP --timeout 20s

REAL_CFG="$TEST_TMP/real-claude-config"
seed_fake_claude_credentials "$REAL_CFG"
export CLAUDE_CONFIG_DIR="$REAL_CFG"
e2e_one "7 claude-native" \
  "$REVIEW" --runner claude-native --model haiku --diff-file "$DIFF" --bin "$STUB" --timeout 20s

finalize_test
