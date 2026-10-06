#!/usr/bin/env bash
# version-drift-check: emits a one-line advisory ONLY when CLAUDE_PLUGIN_ROOT is a
# dev-mode git clone that sits behind its upstream. Non-git roots, missing upstream,
# unset root, and up-to-date clones are all SILENT. Always exit 0 (fail-open).
#
# run_hook hard-codes CLAUDE_PLUGIN_ROOT=$REPO_ROOT (the live repo, non-deterministic
# git state), so this test invokes the hook directly with controlled fixtures.
. "$(dirname "$0")/lib.sh"

HOOK="$REPO_ROOT/hooks/version-drift-check.js"
GIT="git -c user.email=t@t -c user.name=t -c commit.gpgsign=false -c init.defaultBranch=main"

# additional_context extractor (no jq dependency): the hook emits additionalContext
# (CLAUDE_PLUGIN_ROOT set) or additional_context (unset). Grep the rendered JSON.
ctx_of() { printf '%s' "$1" | tr -d '\n'; }

# ── (1) non-git root → silent ──────────────────────────────────────────────
NONGIT="$TEST_TMP/nongit"; mkdir -p "$NONGIT"
OUT=$(CLAUDE_PLUGIN_ROOT="$NONGIT" node "$HOOK"); EC=$?
assert_exit_code "$EC" 0 "non-git root: exit 0"
assert_not_contains "$(ctx_of "$OUT")" "behind" "non-git root: no drift warning"

# ── (2) unset root → fail-open empty SessionStart additionalContext ────────
OUT=$(env -u CLAUDE_PLUGIN_ROOT node "$HOOK"); EC=$?
assert_exit_code "$EC" 0 "unset root: exit 0"
assert_contains "$OUT" "hookSpecificOutput" "unset root: emits SessionStart envelope"
assert_contains "$OUT" "additionalContext" "unset root: uses additionalContext key (not legacy)"
assert_not_contains "$(ctx_of "$OUT")" "behind" "unset root: no drift warning"

# ── Build a clone that is 2 commits behind its upstream ────────────────────
REMOTE="$TEST_TMP/remote.git"; WORK="$TEST_TMP/clone"
$GIT init --bare -q "$REMOTE"
$GIT clone -q "$REMOTE" "$WORK" 2>/dev/null
( cd "$WORK"
  echo a > f.txt; $GIT add f.txt; $GIT commit -qm init
  $GIT push -q origin HEAD:main 2>/dev/null
  $GIT branch -q --set-upstream-to=origin/main 2>/dev/null || $GIT push -q -u origin main 2>/dev/null
)
# Advance the remote by 2 commits via a second clone, then fetch (no merge) in WORK
SEED="$TEST_TMP/seed"; $GIT clone -q "$REMOTE" "$SEED" 2>/dev/null
( cd "$SEED"
  echo b > f.txt; $GIT commit -qam c1
  echo c > f.txt; $GIT commit -qam c2
  $GIT push -q origin HEAD:main 2>/dev/null
)
( cd "$WORK"; $GIT fetch -q origin 2>/dev/null; $GIT branch -q --set-upstream-to=origin/main 2>/dev/null )

# P7a advisory bridge: the drift text goes to <live>/advisories/<sid>.jsonl (shown by the live mod), not model context.
# AUTOPILOT_ADVISORY_BRIDGE_VERSION_DRIFT=inject restores the SessionStart injection. Tests give an empty-HOME sandbox
# and a payload on stdin (the real hook always gets one).
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
PAYLOAD='{"session_id":"vd-sid","hook_event_name":"SessionStart"}'
ROWS="$AUTOPILOT_LIVE_DIR/advisories/vd-sid.jsonl"

# ── (3) clone behind upstream, knob=inject → old injection ─────────────────
OUT=$(printf '%s' "$PAYLOAD" | AUTOPILOT_ADVISORY_BRIDGE_VERSION_DRIFT=inject CLAUDE_PLUGIN_ROOT="$WORK" node "$HOOK"); EC=$?
assert_exit_code "$EC" 0 "behind clone, inject: exit 0"
assert_contains "$(ctx_of "$OUT")" "behind" "behind clone, inject: drift warning emitted"
assert_contains "$(ctx_of "$OUT")" "2 commits behind" "behind clone, inject: reports correct count"
assert_contains "$(ctx_of "$OUT")" "/reload-plugins" "behind clone, inject: names the fix command"
assert_file_absent "$ROWS" "behind clone, inject: no advisory row"

# ── (3b) clone behind upstream, default (bridge) → no context, exactly one advisory row, text unchanged ──
OUT=$(printf '%s' "$PAYLOAD" | CLAUDE_PLUGIN_ROOT="$WORK" node "$HOOK" 2>"$TEST_TMP/vd.err"); EC=$?
assert_exit_code "$EC" 0 "behind clone, bridge: exit 0"
assert_not_contains "$(ctx_of "$OUT")" "behind" "behind clone, bridge: no drift text in model context"
assert_file_exists "$ROWS" "behind clone, bridge: advisory file written"
assert_eq "1" "$(wc -l < "$ROWS" | tr -d ' ')" "behind clone, bridge: exactly one advisory row"
ROW_TEXT=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim()); if(!r.id||r.kind!=="version-drift"||r.severity!=="warn"||!r.at){process.exit(3)} process.stdout.write(r.text)' "$ROWS"); RC=$?
assert_exit_code "$RC" 0 "behind clone, bridge: row shape {id, kind, severity, text, at}"
assert_contains "$ROW_TEXT" "2 commits behind" "behind clone, bridge: row reports correct count"
assert_contains "$ROW_TEXT" "/reload-plugins" "behind clone, bridge: row names the fix command"
assert_eq "$ROW_TEXT" "$(grep '^⚠' "$TEST_TMP/vd.err")" "behind clone, bridge: stderr copy equals the row text"

# ── (5) nested subdir of a behind repo → silent (no parent-repo false positive) ─
# CLAUDE_PLUGIN_ROOT is a subdir, so git top-level != root → must NOT borrow the
# parent clone's behind-upstream count. (Guards the release-dir-under-a-git-tree case.)
mkdir -p "$WORK/sub/dir"
OUT=$(printf '%s' "$PAYLOAD" | CLAUDE_PLUGIN_ROOT="$WORK/sub/dir" node "$HOOK"); EC=$?
assert_exit_code "$EC" 0 "nested subdir: exit 0"
assert_not_contains "$(ctx_of "$OUT")" "behind" "nested subdir: no false parent-repo warning"

# ── (4) up-to-date clone → silent ──────────────────────────────────────────
( cd "$WORK"; $GIT merge -q origin/main 2>/dev/null )
OUT=$(printf '%s' "$PAYLOAD" | CLAUDE_PLUGIN_ROOT="$WORK" node "$HOOK"); EC=$?
assert_exit_code "$EC" 0 "up-to-date clone: exit 0"
assert_not_contains "$(ctx_of "$OUT")" "behind" "up-to-date clone: no drift warning"

finalize_test
