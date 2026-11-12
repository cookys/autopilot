#!/usr/bin/env bash
# codeforge usage collect after a throwaway claude config dir.
# A recording fake `codeforge` is first on PATH. This file never invokes a real
# codeforge or a real model. Unit cases restrict PATH to the fake plus /usr/bin:/bin.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_CODEFORGE_COLLECT
# The runner that launches this file may hold a read-only pipe on fd 3. Close it
# so a child probe measures the dispatch fd, not that pipe.
exec 3>&-
HELPER="$REPO_ROOT/scripts/lib/codeforge-collect.sh"

CF_BIN="$TEST_TMP/cf-bin"
mkdir -p "$CF_BIN"
CF_ARGV="$TEST_TMP/cf-argv"
CF_DIR_STATE="$TEST_TMP/cf-dir-state"
export CF_ARGV CF_DIR_STATE CF_RC=0
# A parent value must not reach the fake. The helper strips it with env -u.
export CODEFORGE_DATA_DIR="$TEST_TMP/not-the-codeforge-store"
cat > "$CF_BIN/codeforge" <<'EOF'
#!/bin/sh
# Record the argv the helper actually passed. Refuse to look like a successful
# collect when the directory is already gone, when it lacks the child usage
# marker, or when CODEFORGE_DATA_DIR leaked into this process.
printf '%s\n' "$*" >> "$CF_ARGV"
if [ -z "${CODEFORGE_DATA_DIR+x}" ]; then
  printf 'DATA_DIR_UNSET\n' >> "$CF_DIR_STATE"
else
  printf 'DATA_DIR_SET\n' >> "$CF_DIR_STATE"
fi
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
  if [ -f "$dir/usage-marker" ]; then
    printf 'MARKER_OK\n' >> "$CF_DIR_STATE"
  else
    printf 'NO_MARKER\n' >> "$CF_DIR_STATE"
  fi
  if [ -f "$dir/fd3" ]; then
    printf 'FD3 %s\n' "$(tr -d '\n' < "$dir/fd3")" >> "$CF_DIR_STATE"
  else
    printf 'FD3 missing\n' >> "$CF_DIR_STATE"
  fi
fi
# Stand-in for codeforge rewriting <live>/codeforge/usage with an empty collect.
# Tests set CF_CLOBBER_LIVE to the sentinel they seeded. Never the uid live dir.
if [ -n "${CF_CLOBBER_LIVE:-}" ]; then
  _uid_live="/dev/shm/autopilot-$(id -u)"
  if [ "$CF_CLOBBER_LIVE" = "$_uid_live" ] || [ "$CF_CLOBBER_LIVE" = "/tmp/autopilot-$(id -u)" ]; then
    printf 'REFUSED_REAL_LIVE\n' >> "$CF_DIR_STATE"
    exit 99
  fi
  mkdir -p "$CF_CLOBBER_LIVE/codeforge/usage"
  printf '%s\n' '{"schema":"codeforge.usage-summary/1","days":[]}' > "$CF_CLOBBER_LIVE/codeforge/usage/summary.json"
  printf '%s\n' '{"schema":"codeforge.usage-sessions/1","rows":[]}' > "$CF_CLOBBER_LIVE/codeforge/usage/usage-sessions.json"
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
  assert_contains "$(cat "$CF_DIR_STATE")" "DATA_DIR_UNSET" "$label: CODEFORGE_DATA_DIR unset in codeforge"
  assert_not_contains "$(cat "$CF_DIR_STATE")" "DATA_DIR_SET" "$label: parent CODEFORGE_DATA_DIR did not leak"
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
assert_contains "$(cat "$CF_DIR_STATE")" "DATA_DIR_UNSET" "5 exit 1: CODEFORGE_DATA_DIR unset in codeforge"

# (6) AUTOPILOT_CODEFORGE_COLLECT=off -> no call
reset_cf
mkdir -p "$TEST_TMP/case6"
AUTOPILOT_CODEFORGE_COLLECT=off call_helper "$TEST_TMP/case6"
unset AUTOPILOT_CODEFORGE_COLLECT
assert_no_call "6 knob off"

# (8) directory was never created (parent exists) -> no call, no log.
# GNU realpath without -e still prints that path; the helper must not.
reset_cf
mkdir -p "$TEST_TMP/case8-parent"
call_helper "$TEST_TMP/case8-parent/never-made"
assert_no_call "8 missing dir"

# (9) a second call on the same real path in one process is a no-op
reset_cf
mkdir -p "$TEST_TMP/case9"
errf="$TEST_TMP/unit-err"
: > "$errf"
PATH="$CF_BIN:/usr/bin:/bin" bash -c '
  set -euo pipefail
  . "$1"
  codeforge_collect_claude_dir "$2"
  codeforge_collect_claude_dir "$2"
  exit 7
' _ "$HELPER" "$TEST_TMP/case9" 2>"$errf"
UNIT_RC=$?
UNIT_ERR="$(cat "$errf")"
assert_eq "7" "$UNIT_RC" "9 twice: caller rc stays 7"
assert_eq "" "$UNIT_ERR" "9 twice: second call is silent"
n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
assert_eq "1" "$n" "9 twice: exactly one call"

# (7) end-to-end. The child writes usage-marker and an fd-3 probe into the dir it
# actually ran with (${CLAUDE_CONFIG_DIR:-$HOME/.claude}). Collect must see that
# marker, must see fd 3 closed, and must not inherit CODEFORGE_DATA_DIR.
export PATH="$CF_BIN:$PATH"
export AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
export AUTOPILOT_ACCOUNTS_DIR="$TEST_TMP/no-accounts"
mkdir -p "$AUTOPILOT_ACCOUNTS_DIR"
unset CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY AUTOPILOT_CONFIG_FILE

DIFF="$TEST_TMP/d.diff"
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n' > "$DIFF"
AUTHOR_PROMPT="$TEST_TMP/author-prompt.txt"
printf 'write a line\n' > "$AUTHOR_PROMPT"
STUB="$TEST_TMP/claude-stub"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$cfg"
printf 'marker\n' > "$cfg/usage-marker"
if ( : >&3 ) 2>/dev/null; then printf 'open\n' > "$cfg/fd3"; else printf 'closed\n' > "$cfg/fd3"; fi
PROMPT="$(cat)"
begin="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-\(REVIEW\|AUTHOR\)-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$PROMPT" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
echo "$begin"
case "$begin" in
  *"AUTOPILOT-AUTHOR-"*) echo "ok from claude" ;;
  *)
    echo "VERDICT: SHIP-AS-IS"
    echo "FINDINGS: none"
    echo "NO-FINDING-PROOF: checked=fixture; evidence=slice traced; conclusion=no blocking discrepancy observed"
    ;;
esac
echo "$end"
STUBEOF
chmod +x "$STUB"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"

# Shared checks for one collect that saw the child's marker and a closed fd 3.
assert_child_collect() {
  local label="$1"
  local n got dir state
  n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
  assert_eq "1" "$n" "$label: exactly one collect [$(tr '\n' ' ' < "$CF_ARGV" 2>/dev/null)]"
  got="$(sed -n '1p' "$CF_ARGV")"
  state="$(cat "$CF_DIR_STATE" 2>/dev/null || true)"
  assert_not_contains "$got" "--quiet" "$label: no --quiet"
  assert_contains "$got" "usage collect --claude-dir /" "$label: argv starts with usage collect --claude-dir"
  assert_contains "$state" "DIR_OK " "$label: fake saw the dir still present"
  assert_contains "$state" "MARKER_OK" "$label: collected dir held the child usage-marker"
  assert_contains "$state" "FD3 closed" "$label: fd 3 was closed in the child"
  assert_contains "$state" "DATA_DIR_UNSET" "$label: CODEFORGE_DATA_DIR unset in codeforge"
  assert_not_contains "$state" "DIR_GONE" "$label: collect ran before the dir was removed"
  assert_not_contains "$state" "NOT_REAL" "$label: collected path was symlink-free"
  assert_not_contains "$state" "NO_MARKER" "$label: marker was present"
  assert_not_contains "$state" "FD3 open" "$label: fd 3 was not open in the child"
  assert_not_contains "$state" "FD3 missing" "$label: child wrote an fd 3 probe"
  assert_not_contains "$state" "DATA_DIR_SET" "$label: parent CODEFORGE_DATA_DIR did not leak"
  dir="${got#usage collect --claude-dir }"
  if [ -n "$dir" ] && [ ! -d "$dir" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$label: config dir should be gone afterwards ($dir)"
  fi
}

e2e_one() {
  local label="$1"
  shift
  reset_cf
  local out="$TEST_TMP/e2e-out"
  "$@" >"$out" 2>&1
  local rc=$?
  assert_eq "0" "$rc" "$label: dispatch exit 0 (collect must not change it) [$(tail -c 500 "$out" | tr '\n' ' ')]"
  assert_child_collect "$label"
}

e2e_one "7 cc-shim" \
  "$REVIEW" --runner cc-shim --model haiku --diff-file "$DIFF" --bin "$STUB" --endpoint TESTEP --timeout 20s

REAL_CFG="$TEST_TMP/real-claude-config"
seed_fake_claude_credentials "$REAL_CFG"
export CLAUDE_CONFIG_DIR="$REAL_CFG"
e2e_one "7 claude-native" \
  "$REVIEW" --runner claude-native --model haiku --diff-file "$DIFF" --bin "$STUB" --timeout 20s

# CF_RC=1 on the 3>&2 review path: verdict JSON stays on stdout, the failure line on stderr.
reset_cf
CF_RC=1
REVIEW_OUT="$TEST_TMP/review-rc1-out"
REVIEW_ERR="$TEST_TMP/review-rc1-err"
DISPATCH_QUIET=1 "$REVIEW" --runner claude-native --model haiku --diff-file "$DIFF" --bin "$STUB" --timeout 20s >"$REVIEW_OUT" 2>"$REVIEW_ERR"
REVIEW_RC=$?
CF_RC=0
assert_eq "0" "$REVIEW_RC" "7 CF_RC=1: review still exits 0 [out $(tail -c 300 "$REVIEW_OUT" | tr '\n' ' ') err $(tr '\n' ' ' < "$REVIEW_ERR")]"
assert_contains "$(cat "$REVIEW_OUT")" '"verdict": "SHIP-AS-IS"' "7 CF_RC=1: VERDICT stdout intact"
assert_not_contains "$(cat "$REVIEW_OUT")" "codeforge-collect:" "7 CF_RC=1: collect log is not on stdout"
assert_contains "$(cat "$REVIEW_ERR")" "codeforge-collect: usage collect failed" "7 CF_RC=1: failure line on stderr"
assert_child_collect "7 CF_RC=1"

# (10) spawn never reached: no collect, child status preserved.
reset_cf
mkdir -p "$TEST_TMP/case10-parent"
node "$REPO_ROOT/scripts/lib/seed-claude-config.js" --exec --parent "$TEST_TMP/case10-parent" -- /no/such/claude-binary-cfcollect >/dev/null 2>"$TEST_TMP/case10-err"
assert_eq "127" "$?" "10 ENOENT: wrapper exits 127"
assert_file_absent_content "10 ENOENT: no codeforge call"
assert_eq "0" "$(find "$TEST_TMP/case10-parent" -mindepth 1 -maxdepth 1 -type d -name 'claude-config-*' 2>/dev/null | wc -l | tr -d ' ')" "10 ENOENT: seeded dir removed"

# (11) standalone --exec with no 3>&2 and a failing codeforge: the failure line reaches stderr.
reset_cf
CF_RC=1
mkdir -p "$TEST_TMP/case11-parent"
SEED_OUT="$TEST_TMP/case11-out"
SEED_ERR="$TEST_TMP/case11-err"
node "$REPO_ROOT/scripts/lib/seed-claude-config.js" --exec --parent "$TEST_TMP/case11-parent" -- bash -c '
  cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  mkdir -p "$cfg"
  printf "marker\n" > "$cfg/usage-marker"
  if ( : >&3 ) 2>/dev/null; then printf "open\n" > "$cfg/fd3"; else printf "closed\n" > "$cfg/fd3"; fi
  exit 0
' >"$SEED_OUT" 2>"$SEED_ERR"
SEED_RC=$?
CF_RC=0
assert_eq "0" "$SEED_RC" "11 standalone: child rc preserved (got $SEED_RC, err $(tr '\n' ' ' < "$SEED_ERR"))"
assert_contains "$(cat "$SEED_ERR")" "codeforge-collect: usage collect failed" "11 standalone: failure line on stderr without 3>&2"
assert_not_contains "$(cat "$SEED_OUT")" "codeforge-collect:" "11 standalone: failure line is not on stdout"
n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
assert_eq "1" "$n" "11 standalone: exactly one collect"
assert_contains "$(cat "$CF_DIR_STATE")" "MARKER_OK" "11 standalone: marker was in the seeded dir"
assert_contains "$(cat "$CF_DIR_STATE")" "DATA_DIR_UNSET" "11 standalone: CODEFORGE_DATA_DIR unset"

# (12) dispatch-author cc-shim and claude-native each collect once.
e2e_one "12 author cc-shim" \
  env -u CLAUDE_CONFIG_DIR DISPATCH_QUIET=1 "$AUTHOR" --runner cc-shim --model mini --prompt-file "$AUTHOR_PROMPT" --bin "$STUB" --endpoint TESTEP --timeout 20s
export CLAUDE_CONFIG_DIR="$REAL_CFG"
e2e_one "12 author claude-native" \
  env DISPATCH_QUIET=1 "$AUTHOR" --runner claude-native --model haiku --prompt-file "$AUTHOR_PROMPT" --bin "$STUB" --timeout 20s

# (13) dispatch-hetero: claude-native seed, and cc-shim --sandbox bwrap. Each once.
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
HETERO_BIN="$TEST_TMP/hetero-bin"
mkdir -p "$HETERO_BIN"
cat > "$HETERO_BIN/claude" <<'STUBEOF'
#!/usr/bin/env bash
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$cfg"
printf 'marker\n' > "$cfg/usage-marker"
if ( : >&3 ) 2>/dev/null; then printf 'open\n' > "$cfg/fd3"; else printf 'closed\n' > "$cfg/fd3"; fi
cat >/dev/null
echo hetero-edited > hetero-out.txt
printf '%s\n' '{"type":"result","is_error":false,"result":"done"}'
STUBEOF
chmod +x "$HETERO_BIN/claude"
HETERO_REPO="$TEST_TMP/hetero-repo"
mkdir -p "$HETERO_REPO"
git -C "$HETERO_REPO" init -q -b develop
git -C "$HETERO_REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
HETERO_PROMPT="$TEST_TMP/hetero-prompt.txt"
printf 'update repo file\n' > "$HETERO_PROMPT"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/hetero-runs"
mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export DISPATCH_QUIET=1
node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null

e2e_one "13 hetero claude-native" \
  env PATH="$HETERO_BIN:$PATH" bash -c 'cd "$1" && exec "$2" --runner claude-native --model claude-sonnet-4-6 --effort low --prompt-file "$3" --context-window off --branch feat/cf-cn' \
  _ "$HETERO_REPO" "$HETERO" "$HETERO_PROMPT"

if ! command -v bwrap >/dev/null 2>&1 || ! bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1; then
  fail "13 hetero bwrap: bwrap is not usable; the sandbox collect wire cannot be shown red or green"
else
  HETERO_WT="$TEST_TMP/hetero-wts"
  mkdir -p "$HETERO_WT"
  e2e_one "13 hetero cc-shim bwrap" \
    env PATH="$HETERO_BIN:$PATH" ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t" \
    bash -c 'cd "$1" && exec "$2" --runner cc-shim --model MiniMax-M3 --prompt-file "$3" --context-window off --branch feat/cf-sbx --sandbox bwrap --worktree-parent "$4"' \
    _ "$HETERO_REPO" "$HETERO" "$HETERO_PROMPT" "$HETERO_WT"
fi

# Extra tmpfs dirs this file creates. The lib.sh trap only removes its own live dir.
_CF_EXTRA_CLEAN=""
_cf_extra_clean() {
  [ "$BASHPID" = "$__TEST_TOP_BASHPID" ] || return 0
  # shellcheck disable=SC2086
  [ -n "$_CF_EXTRA_CLEAN" ] && rm -rf $_CF_EXTRA_CLEAN
}
trap '_cf_extra_clean; cleanup_test_tmp' EXIT

# Seven-row usage pair. Counts are the "non-empty" signal; no host, path, or email.
seed_seven() {
  local dest="$1/codeforge/usage"
  mkdir -p "$dest"
  python3 -c '
import json, sys
dest = sys.argv[1]
days = [{"day": "2026-01-0%d" % i, "source": "claude", "requests": i} for i in range(1, 8)]
rows = [{"session": "s%d" % i, "requests": i} for i in range(1, 8)]
open(dest + "/summary.json", "w", encoding="utf-8").write(json.dumps({"schema": "codeforge.usage-summary/1", "days": days}) + "\n")
open(dest + "/usage-sessions.json", "w", encoding="utf-8").write(json.dumps({"schema": "codeforge.usage-sessions/1", "rows": rows}) + "\n")
' "$dest"
}
sum_usage() {
  sha256sum "$1/codeforge/usage/summary.json" "$1/codeforge/usage/usage-sessions.json" | sha256sum | awk '{print $1}'
}

# (b) HOME has no transcript dir, the collect target has no transcripts, and the
# live dir already holds 7 rows. An empty collect must not overwrite them.
reset_cf
B_LIVE="$(mktemp -d -p /dev/shm "autopilot-test-cfb-XXXXXX")"
_CF_EXTRA_CLEAN="$_CF_EXTRA_CLEAN $B_LIVE"
seed_seven "$B_LIVE"
B_BEFORE="$(sum_usage "$B_LIVE")"
B_HOME="$TEST_TMP/case-b-home"
mkdir -p "$B_HOME"
B_TARGET="$TEST_TMP/case-b-target"
mkdir -p "$B_TARGET"
: > "$TEST_TMP/unit-err"
PATH="$CF_BIN:/usr/bin:/bin" \
  HOME="$B_HOME" \
  AUTOPILOT_LIVE_DIR="$B_LIVE" \
  CF_CLOBBER_LIVE="$B_LIVE" \
  bash -c '
    set -euo pipefail
    unset AUTOPILOT_CODEFORGE_COLLECT
    . "$1"
    codeforge_collect_claude_dir "$2"
    exit 7
  ' _ "$HELPER" "$B_TARGET" 2>"$TEST_TMP/unit-err"
UNIT_RC=$?
UNIT_ERR="$(cat "$TEST_TMP/unit-err")"
assert_eq "7" "$UNIT_RC" "b missing transcripts: caller rc stays 7"
assert_eq "codeforge-collect: skipped empty collect; transcript dir missing, leaving non-empty usage in place" "$UNIT_ERR" "b missing transcripts: one log line"
assert_file_absent_content "b missing transcripts"
assert_eq "$B_BEFORE" "$(sum_usage "$B_LIVE")" "b missing transcripts: 7-row usage unchanged"
assert_neq "$B_LIVE" "/dev/shm/autopilot-$(id -u)" "b live dir is not the uid live dir"

# Run one collect against a private tmpfs live dir. Caller rc 7. Leaves UNIT_RC / UNIT_ERR.
run_guarded() {
  local home="$1" live="$2" target="$3"
  : > "$TEST_TMP/unit-err"
  PATH="$CF_BIN:/usr/bin:/bin" \
    HOME="$home" \
    AUTOPILOT_LIVE_DIR="$live" \
    CF_CLOBBER_LIVE="$live" \
    bash -c '
      set -euo pipefail
      unset AUTOPILOT_CODEFORGE_COLLECT
      . "$1"
      codeforge_collect_claude_dir "$2"
      exit 7
    ' _ "$HELPER" "$target" 2>"$TEST_TMP/unit-err"
  UNIT_RC=$?
  UNIT_ERR="$(cat "$TEST_TMP/unit-err")"
}

# (c) a real zero still writes: the transcript dir exists, even with no jsonl,
# and an already-empty pair is not "non-empty" so a missing transcript dir
# still collects. A transcript file under the target also still collects.
reset_cf
C_LIVE="$(mktemp -d -p /dev/shm "autopilot-test-cfc-XXXXXX")"
_CF_EXTRA_CLEAN="$_CF_EXTRA_CLEAN $C_LIVE"
seed_seven "$C_LIVE"
C_BEFORE="$(sum_usage "$C_LIVE")"
C_HOME="$TEST_TMP/case-c-home"
mkdir -p "$C_HOME/.claude/projects"
C_TARGET="$TEST_TMP/case-c-target"
mkdir -p "$C_TARGET"
run_guarded "$C_HOME" "$C_LIVE" "$C_TARGET"
assert_eq "7" "$UNIT_RC" "c transcript dir exists: caller rc stays 7"
assert_eq "" "$UNIT_ERR" "c transcript dir exists: success is silent"
n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
assert_eq "1" "$n" "c transcript dir exists: exactly one call"
assert_neq "$C_BEFORE" "$(sum_usage "$C_LIVE")" "c transcript dir exists: empty result was written"

reset_cf
E_LIVE="$(mktemp -d -p /dev/shm "autopilot-test-cfe-XXXXXX")"
_CF_EXTRA_CLEAN="$_CF_EXTRA_CLEAN $E_LIVE"
mkdir -p "$E_LIVE/codeforge/usage"
printf '%s\n' '{"schema":"codeforge.usage-summary/1","days":[]}' > "$E_LIVE/codeforge/usage/summary.json"
printf '%s\n' '{"schema":"codeforge.usage-sessions/1","rows":[]}' > "$E_LIVE/codeforge/usage/usage-sessions.json"
E_HOME="$TEST_TMP/case-e-home"
mkdir -p "$E_HOME"
E_TARGET="$TEST_TMP/case-e-target"
mkdir -p "$E_TARGET"
run_guarded "$E_HOME" "$E_LIVE" "$E_TARGET"
assert_eq "7" "$UNIT_RC" "c already empty: caller rc stays 7"
assert_eq "" "$UNIT_ERR" "c already empty: success is silent"
n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
assert_eq "1" "$n" "c already empty: exactly one call"

reset_cf
J_LIVE="$(mktemp -d -p /dev/shm "autopilot-test-cfj-XXXXXX")"
_CF_EXTRA_CLEAN="$_CF_EXTRA_CLEAN $J_LIVE"
seed_seven "$J_LIVE"
J_BEFORE="$(sum_usage "$J_LIVE")"
J_HOME="$TEST_TMP/case-j-home"
mkdir -p "$J_HOME"
J_TARGET="$TEST_TMP/case-j-target/projects/p"
mkdir -p "$J_TARGET"
printf '%s\n' '{}' > "$J_TARGET/s.jsonl"
run_guarded "$J_HOME" "$J_LIVE" "$TEST_TMP/case-j-target"
assert_eq "7" "$UNIT_RC" "c target transcript: caller rc stays 7"
assert_eq "" "$UNIT_ERR" "c target transcript: success is silent"
n="$(grep -c . "$CF_ARGV" 2>/dev/null || true)"
assert_eq "1" "$n" "c target transcript: exactly one call"
assert_neq "$J_BEFORE" "$(sum_usage "$J_LIVE")" "c target transcript: collect wrote"

# (a) Fake HOME, and the caller sets no live dir of its own. The sentinel is
# the directory the resolver would use ($XDG_RUNTIME_DIR/autopilot) and it
# already holds 7 rows. Entering the shared test env must not change it.
A_SENT_XDG="$(mktemp -d -p /dev/shm "autopilot-test-cfa-XXXXXX")"
_CF_EXTRA_CLEAN="$_CF_EXTRA_CLEAN $A_SENT_XDG"
A_SENT="$A_SENT_XDG/autopilot"
seed_seven "$A_SENT"
A_BEFORE="$(sum_usage "$A_SENT")"
A_UID="/dev/shm/autopilot-$(id -u)"

A_OUT="$(env -u AUTOPILOT_LIVE_DIR -u AUTOPILOT_CODEFORGE_COLLECT \
  XDG_RUNTIME_DIR="$A_SENT_XDG" \
  bash --noprofile --norc -c '
    set -euo pipefail
    . "$1"
    fs="$(findmnt -T "$AUTOPILOT_LIVE_DIR" -o FSTYPE -n 2>/dev/null | head -n 1 | tr -d "[:space:]")"
    printf "LIVE=%s\nCOLLECT=%s\nFSTYPE=%s\n" "$AUTOPILOT_LIVE_DIR" "${AUTOPILOT_CODEFORGE_COLLECT:-}" "$fs"
  ' _ "$REPO_ROOT/hooks/tests/lib.sh")"
A_LIVE_SH="$(printf '%s\n' "$A_OUT" | sed -n 's/^LIVE=//p')"
A_COLLECT_SH="$(printf '%s\n' "$A_OUT" | sed -n 's/^COLLECT=//p')"
A_FS_SH="$(printf '%s\n' "$A_OUT" | sed -n 's/^FSTYPE=//p')"
assert_eq "off" "$A_COLLECT_SH" "a shell env: collect off"
assert_eq "tmpfs" "$A_FS_SH" "a shell env: live dir is tmpfs"
case "$A_LIVE_SH" in
  /dev/shm/autopilot-test-live-*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "a shell env: live dir is not a private /dev/shm dir" ;;
esac
assert_neq "$A_LIVE_SH" "$A_SENT" "a shell env: live dir is not the sentinel"
assert_neq "$A_LIVE_SH" "$A_UID" "a shell env: live dir is not the uid live dir"
assert_eq "$A_BEFORE" "$(sum_usage "$A_SENT")" "a shell env: sentinel 7-row file unchanged"

A_META="$TEST_TMP/a-fx.json"
node -e '
  const { makeFixture } = require(process.argv[1]);
  const { spawnSync } = require("child_process");
  const fs = require("fs");
  const fx = makeFixture({ aliases: [{ alias: "a" }] });
  const live = fx.env.AUTOPILOT_LIVE_DIR;
  const r = spawnSync("findmnt", ["-T", live, "-o", "FSTYPE", "-n"], { encoding: "utf8" });
  const fstype = (r.stdout || "").trim().split(/\s+/)[0] || "";
  fs.writeFileSync(process.argv[2], JSON.stringify({
    root: fx.root,
    home: fx.env.HOME,
    live: live,
    collect: fx.env.AUTOPILOT_CODEFORGE_COLLECT || "",
    fstype: fstype,
    projects: fs.existsSync(fx.env.HOME + "/.claude/projects"),
  }));
' "$REPO_ROOT/scripts/lib/account-fixtures/shim-install.js" "$A_META"
A_ROOT="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).root)' "$A_META")"
_CF_EXTRA_CLEAN="$_CF_EXTRA_CLEAN $A_ROOT"
A_FX_HOME="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).home)' "$A_META")"
A_FX_LIVE="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).live)' "$A_META")"
A_FX_COLLECT="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).collect)' "$A_META")"
A_FX_FS="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).fstype)' "$A_META")"
A_FX_PROJECTS="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).projects ? "yes" : "no")' "$A_META")"
assert_eq "off" "$A_FX_COLLECT" "a fixture: collect off"
assert_eq "tmpfs" "$A_FX_FS" "a fixture: live dir is tmpfs"
assert_eq "no" "$A_FX_PROJECTS" "a fixture: fake HOME has no transcript dir"
case "$A_FX_LIVE" in
  /dev/shm/g37-fix-*/live) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "a fixture: live dir is not under a /dev/shm g37-fix- root" ;;
esac
case "$A_FX_HOME" in
  /dev/shm/g37-fix-*/fakehome) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "a fixture: HOME is not the fixture fakehome on /dev/shm" ;;
esac
assert_neq "$A_FX_LIVE" "$A_UID" "a fixture: live dir is not the uid live dir"
assert_neq "$A_FX_LIVE" "$A_SENT" "a fixture: live dir is not the sentinel"
if grep -q 'AUTOPILOT_CODEFORGE_COLLECT="$(jget "$F" env.AUTOPILOT_CODEFORGE_COLLECT)"' \
  "$REPO_ROOT/hooks/tests/dispatch-author-account-rail.test.sh"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "a author rail: env -i does not forward AUTOPILOT_CODEFORGE_COLLECT"
fi

# The suite's own env (no extra live-dir override). A call is safe only when
# collect is off or the fixture live dir is already tmpfs; otherwise the
# resolver would fall through to the uid directory, which this file must not touch.
A_TARGET="$TEST_TMP/case-a-target"
mkdir -p "$A_TARGET"
if [ "$A_FX_COLLECT" = off ] || [ "$A_FX_FS" = tmpfs ] || [ "$A_FX_FS" = ramfs ]; then
  reset_cf
  : > "$TEST_TMP/unit-err"
  PATH="$CF_BIN:/usr/bin:/bin" \
    HOME="$A_FX_HOME" \
    AUTOPILOT_LIVE_DIR="$A_FX_LIVE" \
    AUTOPILOT_CODEFORGE_COLLECT="$A_FX_COLLECT" \
    XDG_RUNTIME_DIR="$A_SENT_XDG" \
    CF_CLOBBER_LIVE="$A_SENT" \
    bash -c '
      set -euo pipefail
      . "$1"
      codeforge_collect_claude_dir "$2"
      exit 7
    ' _ "$HELPER" "$A_TARGET" 2>"$TEST_TMP/unit-err"
  UNIT_RC=$?
  UNIT_ERR="$(cat "$TEST_TMP/unit-err")"
  assert_eq "7" "$UNIT_RC" "a fixture env: caller rc stays 7"
  assert_eq "" "$UNIT_ERR" "a fixture env: collect off is silent"
  assert_file_absent_content "a fixture env"
  assert_eq "$A_BEFORE" "$(sum_usage "$A_SENT")" "a fixture env: sentinel 7-row file unchanged"
  # Knob dropped, live dir kept: the private tmpfs dir absorbs the empty write.
  if [ "$A_FX_FS" = tmpfs ] || [ "$A_FX_FS" = ramfs ]; then
    reset_cf
    PATH="$CF_BIN:/usr/bin:/bin" \
      HOME="$A_FX_HOME" \
      AUTOPILOT_LIVE_DIR="$A_FX_LIVE" \
      XDG_RUNTIME_DIR="$A_SENT_XDG" \
      CF_CLOBBER_LIVE="$A_FX_LIVE" \
      bash -c '
        set -euo pipefail
        unset AUTOPILOT_CODEFORGE_COLLECT
        . "$1"
        codeforge_collect_claude_dir "$2"
        exit 7
      ' _ "$HELPER" "$A_TARGET" 2>"$TEST_TMP/unit-err"
    UNIT_RC=$?
    assert_eq "7" "$UNIT_RC" "a fixture live dir only: caller rc stays 7"
    assert_eq "$A_BEFORE" "$(sum_usage "$A_SENT")" "a fixture live dir only: sentinel unchanged"
  fi
fi

finalize_test
