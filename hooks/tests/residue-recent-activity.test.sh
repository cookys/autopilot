#!/usr/bin/env bash
# residue-recent-activity.test.sh — a brand-new clean worktree (0 commits, branch at the integration ref) looks exactly like a merged one.
# (the JSON reader gets the path through the environment, not argv: an argument naming the worktree on a concurrently running process is, correctly, an in-use signal)
# It must not be listed as clearable and `reap --yes` must not remove it until its on-disk activity is older than the window (2026-10-16 incident).
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_RESIDUE_RECENT_HOURS

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
G() { git -C "$SBX" -c user.email=t@t -c user.name=t "$@"; }
G init -q -b develop; echo a > "$SBX/a.txt"; G add a.txt; G commit -q -m base
BASE="$(G rev-parse HEAD)"
WT="$TEST_TMP/wt-fresh"
G worktree add -q "$WT" -b fresh "$BASE"
listed() { node "$SCRIPT" scan --repo "$SBX" --json | WTP="$WT" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.needs_human||[]).filter(e=>e.path===process.env.WTP).map(e=>e.class).join(","))})'; }
class_of() { node "$SCRIPT" scan --repo "$SBX" --json | WTP="$WT" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.worktrees||[]).filter(e=>e.path===process.env.WTP).map(e=>e.class).join(","))})'; }

# fresh: not clearable, not removed
assert_eq "$(listed)" "" "fresh empty worktree is not listed as clearable"
assert_eq "$(class_of)" "live" "fresh empty worktree is classed as in use"
node "$SCRIPT" reap --repo "$SBX" --yes --worktree "$WT" >/dev/null
[ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap --yes removed a fresh worktree"

# negative control: the window turned off (the old behaviour) lists it
assert_eq "$(AUTOPILOT_RESIDUE_RECENT_HOURS=0 listed)" "clean-integrated" "negative control: without the window the same worktree is clearable"

# aged: directory, git admin files and the branch's first reflog line all older than the window
OLD=$(( $(date +%s) - 3*86400 ))
ADMIN="$(git -C "$WT" rev-parse --absolute-git-dir)"
COMMON="$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir)"
sed -i "s/> [0-9]\{10\} /> $OLD /" "$COMMON/logs/refs/heads/fresh"
touch -d "@$OLD" "$WT" "$ADMIN/HEAD" "$ADMIN/index" "$ADMIN/logs/HEAD" 2>/dev/null
assert_eq "$(listed)" "clean-integrated" "aged worktree is clearable"
node "$SCRIPT" reap --repo "$SBX" --yes --worktree "$WT" >/dev/null
[ -d "$WT" ] && fail "reap --yes kept an aged clean-integrated worktree" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

# only the branch's first reflog line is new: directory and admin files are old, yet the worktree is still in use
WT2="$TEST_TMP/wt-reflog-only"
G worktree add -q "$WT2" -b reflogonly "$BASE"
ADMIN2="$(git -C "$WT2" rev-parse --absolute-git-dir)"
touch -d "@$OLD" "$WT2" "$ADMIN2/HEAD" "$ADMIN2/index" "$ADMIN2/logs/HEAD" 2>/dev/null
class_of2() { node "$SCRIPT" scan --repo "$SBX" --json | WTP="$WT2" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.worktrees||[]).filter(e=>e.path===process.env.WTP).map(e=>e.class+"|"+e.reason).join(","))})'; }
assert_eq "$(class_of2 | cut -d'|' -f1)" "live" "only a new first reflog line still classes the worktree as in use"
case "$(class_of2)" in *"recent activity"*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1));; *) fail "live reason lost its recent-activity text";; esac
# negative control: the same worktree with the reflog line aged too is clearable
COMMON2="$(git -C "$WT2" rev-parse --path-format=absolute --git-common-dir)"
sed -i "s/> [0-9]\{10\} /> $OLD /" "$COMMON2/logs/refs/heads/reflogonly"
assert_eq "$(class_of2 | cut -d'|' -f1)" "clean-integrated" "negative control: with the reflog line aged the worktree is no longer live"
finalize_test
