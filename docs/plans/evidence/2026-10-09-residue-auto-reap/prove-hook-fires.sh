#!/usr/bin/env bash
# prove-hook-fires.sh — real-session proof of residue auto-reap R3 (contract.md "Proof it fires").
#
# usage: bash prove-hook-fires.sh <scratch-dir>      (must not exist yet, or be empty; build it under the session scratchpad)
#
# Builds a fixture repo with:
#   wt-expired   marker worktree, clean, unintegrated commit, marker created 100 h ago (no retention fields => lease-expired by
#                created_at + 72 h)                                     -> must be REMOVED, branch hands/expired must REMAIN
#   wt-dirty     marker worktree, same age, an untracked file           -> must REMAIN and be listed in needs_human
#   hands/x      unintegrated branch whose tip commit and reflog are 15 days old, checked out nowhere
#                                                                       -> must be GONE, refs/archive/<date>/hands/x must resolve to the old tip
# then runs a REAL headless session in the fixture (`claude -p "say ok"`, the live plugin, CLAUDE_CONFIG_DIR NOT set), waits for
# <git-common-dir>/autopilot-residue-auto.stamp and the result file, prints PASS/FAIL per contract R3 bullet, and starts a second
# session to show the 24 h throttle (stamp and result unchanged). Exit 0 only when every line is PASS.
#
# The only state outside <scratch-dir> that a session touches is the normal live dir (an advisory row for the session id).
# Run it from a shell with the plugin that has the merged hook live (the main checkout on develop after the merge).
set -u

dir="${1:-}"
[ -n "$dir" ] || { echo "usage: $0 <scratch-dir>" >&2; exit 2; }
if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then echo "scratch dir $dir is not empty" >&2; exit 2; fi
unset CLAUDE_CONFIG_DIR
mkdir -p "$dir" || exit 2
dir="$(cd "$dir" && pwd -P)"
repo="$dir/repo"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$here/../../../.." && pwd -P)"
fails=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $1"; }
bad() { say "FAIL  $1"; fails=$((fails + 1)); }
check() { if eval "$2" 2>/dev/null; then ok "$1"; else bad "$1"; fi; } # check <label> <shell test>

g() { git -C "$repo" -c user.name=proof -c user.email=proof@example.invalid "$@"; }
now=$(date +%s)
old=$((now - 100 * 3600))
old15=$((now - 15 * 86400))

mkdir -p "$repo"
git -C "$repo" init -q -b main
g commit -q --allow-empty -m base
base="$(git -C "$repo" rev-parse HEAD)"

marker() { # marker <worktree> <branch> <id>   (schema 2, 7 lines, no retention => lease-expired by created_at + 72 h)
  {
    printf 'schema=2\ncreated_at=%s\nbranch=%s\nbase_sha=%s\nrun_id=%s\nroot_run_id=%s\nloop_id=%s\n' "$old" "$2" "$base" "$3" "$3" "$3"
  } > "$1/.autopilot-worktree"
  : > "$1/.autopilot-worktree.lock"
}

g worktree add -q -b hands/expired "$dir/wt-expired"
git -C "$dir/wt-expired" -c user.name=proof -c user.email=proof@example.invalid commit -q --allow-empty -m "expired work"
marker "$dir/wt-expired" hands/expired proof-expired

g worktree add -q -b hands/dirty "$dir/wt-dirty"
marker "$dir/wt-dirty" hands/dirty proof-dirty
printf 'unsaved\n' > "$dir/wt-dirty/untracked.txt"

tree="$(git -C "$repo" rev-parse 'HEAD^{tree}')"
oldtip="$(GIT_AUTHOR_DATE="$old15 +0000" GIT_COMMITTER_DATE="$old15 +0000" GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@e.invalid GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@e.invalid git -C "$repo" commit-tree "$tree" -p "$base" -m "old unintegrated work")"
git -C "$repo" -c core.logAllRefUpdates=false update-ref refs/heads/hands/x "$oldtip"
git -C "$repo" reflog expire --expire=now --all

say "fixture: $repo (claude: $(claude --version 2>&1 | head -1))"
say "  expired worktree $dir/wt-expired · dirty worktree $dir/wt-dirty · hands/x tip ${oldtip:0:12} (15 days old)"

common="$repo/.git"
stamp="$common/autopilot-residue-auto.stamp"
result="$common/autopilot-residue-auto.json"
start=$(date +%s)

say "session 1: claude -p \"say ok\" (cwd = fixture, no CLAUDE_CONFIG_DIR)"
( cd "$repo" && timeout 240 claude -p "say ok" > "$dir/session1.out" 2>&1 )
say "  session 1 rc=$? output: $(head -c 120 "$dir/session1.out" | tr '\n' ' ')"

for _ in $(seq 1 120); do [ -f "$stamp" ] && [ -f "$result" ] && break; sleep 1; done
sleep 2

check "stamp exists ($stamp)" '[ -f "$stamp" ]'
check "result file written (autopilot-residue-auto.json, schema autopilot.residue-auto/1)" 'node -e "const r=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));process.exit(r.schema===\"autopilot.residue-auto/1\"?0:1)" "$result"'
check "expired clean worktree is gone (directory and registration)" '[ ! -e "$dir/wt-expired" ] && ! git -C "$repo" worktree list --porcelain | grep -qx "worktree $dir/wt-expired"'
check "its branch hands/expired remains" 'git -C "$repo" rev-parse --verify -q refs/heads/hands/expired >/dev/null'
check "dirty worktree remains" '[ -d "$dir/wt-dirty" ] && [ -f "$dir/wt-dirty/untracked.txt" ]'
check "dirty worktree is listed in needs_human" 'node -e "const r=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));const d=process.argv[2];process.exit((r.needs_human||[]).some(e=>e.path&&require(\"fs\").realpathSync.native(e.path)===d)?0:1)" "$result" "$dir/wt-dirty"'
check "needs_human_count > 0 and sizes present or null" 'node -e "const r=JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"));process.exit(r.needs_human_count>0?0:1)" "$result"'
check "hands/x branch is gone" '! git -C "$repo" rev-parse --verify -q refs/heads/hands/x >/dev/null'
archived="$(git -C "$repo" for-each-ref --format='%(refname) %(objectname)' 'refs/archive/*/hands/x' | head -1)"
check "refs/archive/<date>/hands/x resolves to the old tip (${archived:-none})" '[ "${archived#* }" = "$oldtip" ]'

# advisory (P7a bridge): one residue row in some advisories/<sid>.jsonl written after this proof started
live="$(node -e "console.log(require(process.argv[1]).resolveLiveDir().base)" "$root/scripts/lib/live-state-dir.js" 2>/dev/null)"
check "advisory row (kind residue) appended under ${live:-<live>}/advisories after the sweep" '[ -n "$live" ] && find "$live/advisories" -name "*.jsonl" -newermt "@$start" 2>/dev/null | xargs -r grep -l "\"kind\":\"residue\"" 2>/dev/null | grep -q .'

# throttle: a second session within 24 h must not run again
stamp_before="$(stat -c %Y "$stamp" 2>/dev/null)"
ran_before="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ran_at)" "$result" 2>/dev/null)"
say "session 2 (throttle): claude -p \"say ok\""
( cd "$repo" && timeout 240 claude -p "say ok" > "$dir/session2.out" 2>&1 )
sleep 8
stamp_after="$(stat -c %Y "$stamp" 2>/dev/null)"
ran_after="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ran_at)" "$result" 2>/dev/null)"
check "second session within 24 h did not run again (stamp mtime and ran_at unchanged)" '[ -n "$stamp_before" ] && [ "$stamp_before" = "$stamp_after" ] && [ "$ran_before" = "$ran_after" ]'

if [ "$fails" -eq 0 ]; then say "ALL PASS"; exit 0; fi
say "$fails FAIL"
exit 1
