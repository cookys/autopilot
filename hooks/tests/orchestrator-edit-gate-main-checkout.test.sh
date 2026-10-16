#!/usr/bin/env bash
# orchestrator-edit-gate-main-checkout.test.sh — BL-0005 (owner ruling 2026-10-17): when the session
# marker follows into a linked worktree, the repo's main checkout stays gated for depth-0 edits.
# Both directions: marker in a worktree -> main checkout gated; marker in the main checkout -> a
# linked worktree keeps today's rules. Negative control: run against the pre-change hook and the main-checkout row goes red.
. "$(dirname "$0")/lib.sh"

export AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE=1 AUTOPILOT_ORCH_EDIT_GATE_MODE=block
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
MAIN="$(cd "$(mktemp -d "$TEST_TMP/main.XXXXXX")" && pwd -P)/proj"; mkdir -p "$MAIN/src" "$MAIN/docs/plans"
git -C "$MAIN" init -q -b develop; git -C "$MAIN" commit -q --allow-empty -m init
WT="$TEST_TMP/wt-linked"; git -C "$MAIN" worktree add -q -b feat/x "$WT"; mkdir -p "$WT/src"
OUT_WT="$TEST_TMP/outside-wt"; git -C "$MAIN" worktree add -q -b feat/y "$OUT_WT"; mkdir -p "$OUT_WT/src"
touch "$MAIN/src/a.js" "$WT/src/b.js" "$OUT_WT/src/c.js" "$MAIN/docs/plans/p.md"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export CLAUDE_CODE_SESSION_ID="oeg-main-sid"

setmarker() { HOME="$TEST_TMP/home" node "$REPO_ROOT/scripts/session-mode.js" set --level l5 --repo-root "$1" >/dev/null 2>&1; }
edit() { # file -> exit code of the hook
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"},"hook_event_name":"PreToolUse"}' "$1" \
    | HOME="$TEST_TMP/home" node "$HOOKS_DIR/orchestrator-edit-gate.js" >/dev/null 2>&1
  echo $?
}

# Direction 1: marker followed the session into the linked worktree.
setmarker "$WT"
assert_eq 2 "$(edit "$MAIN/src/a.js")" "marker in worktree: main-checkout product file is gated"
assert_eq 0 "$(edit "$MAIN/docs/plans/p.md")" "marker in worktree: main-checkout allowlisted path stays editable"
assert_eq 2 "$(edit "$WT/src/b.js")" "marker in worktree: own worktree still gated"
assert_eq 0 "$(edit "$TEST_TMP/scratch.txt")" "marker in worktree: unrelated scratch path allowed"
# explicit release: mode off
assert_eq 0 "$(AUTOPILOT_ORCH_EDIT_GATE_MODE=off edit "$MAIN/src/a.js")" "release: mode off lets the main checkout through"

# Direction 2: marker in the main checkout; a linked worktree outside it keeps the current rule (allowed).
setmarker "$MAIN"
assert_eq 2 "$(edit "$MAIN/src/a.js")" "marker in main: main-checkout file gated"
assert_eq 0 "$(edit "$OUT_WT/src/c.js")" "marker in main: unmarked linked worktree outside the repo root keeps current rule (allowed)"
touch "$OUT_WT/.autopilot-worktree"
assert_eq 2 "$(edit "$OUT_WT/src/c.js")" "marker in main: marked dispatch worktree is worker territory (gated)"

finalize_test
