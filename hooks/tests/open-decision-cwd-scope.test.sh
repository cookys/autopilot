#!/usr/bin/env bash
# BL-0337: `open` with no --cwd writes the card into the process cwd's git repo. A live session
# marker for a different repo used to print only the id (a bound root skips the unbound note), so
# the marker repo's panel never shows the card. stderr must name both repos and the exit stays 0.
# An explicit --cwd, the same repo (subdir or linked worktree), no session, or a dead marker does not warn.
# Negative control: deleting the WARNING line makes the mismatch case silent again (asserted below).
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
ERRF="$TEST_TMP/err"
SID="bl0337"

init_repo() {
  mkdir -p "$1"
  $GIT -C "$1" init -q
  $GIT -C "$1" commit -q --allow-empty -m base
}

MARK="$TEST_TMP/mark"
OTHER="$TEST_TMP/other"
init_repo "$MARK"
init_repo "$OTHER"
mkdir -p "$MARK/sub"

write_marker() {
  # $1 repo_root (empty = omit), $2 expires offset seconds (positive = future), $3 repo_identity (empty = omit)
  node -e '
    const fs = require("fs");
    const [dir, sid, repo, offset, identity] = process.argv.slice(1);
    const now = Date.now();
    const m = {
      session_id: sid,
      level: null,
      started_at: new Date(now - 1000).toISOString(),
      expires_at: new Date(now + Number(offset) * 1000).toISOString(),
      root_run_id: "job-marker",
    };
    if (repo) m.repo_root = repo;
    if (identity) m.repo_identity = identity;
    fs.writeFileSync(dir + "/" + sid + ".json", JSON.stringify(m));
  ' "$AUTOPILOT_SESSION_MODE_DIR" "$SID" "$1" "$2" "$3"
}

IDENT="$(node -e 'const {scopeFromCwd}=require(process.argv[1]); process.stdout.write(scopeFromCwd(process.argv[2]).repo_identity)' "$REPO_ROOT/src/status/project-key.js" "$MARK")"
write_marker "$MARK" 3600 "$IDENT"

# open_at <process-cwd> [extra args...]: sets OUT RC ERR. No --cwd unless the caller passes it.
open_at() {
  local dir="$1"; shift
  OUT="$(cd "$dir" && AUTOPILOT_SESSION_ID="$SID" node "$OD" open --executor ns/cc/exec--claude --question "Where does the card go?" --option "A::a" --option "B::b" --not-authorized irreversible "$@" 2>"$ERRF")"
  RC=$?
  ERR="$(cat "$ERRF")"
}
open_nosess() {
  local dir="$1"; shift
  OUT="$(cd "$dir" && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID -u CODEX_THREAD_ID node "$OD" open --executor ns/cc/exec--claude --question "Where does the card go?" --option "A::a" --option "B::b" --not-authorized irreversible "$@" 2>"$ERRF")"
  RC=$?
  ERR="$(cat "$ERRF")"
}
njson() { find "$1/.git/autopilot/decisions" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }

# 1. The bug: bound root (marker root_run_id), other repo, no --cwd. Card lands in OTHER, exit 0, both repos named.
open_at "$OTHER"
assert_eq "$RC" 0 "mismatch: exit 0 (warn, do not refuse)"
grep -Eq '^d-[0-9a-f]{8}$' <<<"$OUT"
assert_eq "$?" 0 "mismatch: stdout is only the card id"
MIS="$OUT"
assert_contains "$ERR" "open-decision: WARNING: card" "mismatch: loud warning"
assert_contains "$ERR" "$MIS" "mismatch: warning names the card id"
assert_contains "$ERR" "$OTHER" "mismatch: warning names the card repo"
assert_contains "$ERR" "$MARK" "mismatch: warning names the marker repo"
assert_not_contains "$ERR" "UNBOUND scope" "mismatch: a bound root does not take the unbound note"
assert_eq "$(njson "$OTHER")" 1 "mismatch: the card file is in the cwd repo"
assert_eq "$(njson "$MARK")" 0 "mismatch: the marker repo has no card file"
SHOW_O="$(node "$OD" show --cwd "$OTHER" 2>/dev/null)"
SHOW_M="$(node "$OD" show --cwd "$MARK" 2>/dev/null || true)"
assert_contains "$SHOW_O" "$MIS" "mismatch: the cwd repo's show lists the card"
assert_not_contains "$SHOW_M" "$MIS" "mismatch: the marker repo's show does not list the card"

# 2. Same repo, a subdirectory: no warning, card in the marker repo.
open_at "$MARK/sub"
assert_eq "$RC" 0 "subdir: exit 0"
assert_eq "$ERR" "" "subdir: no stderr"
assert_contains "$(node "$OD" show --cwd "$MARK" 2>/dev/null)" "$OUT" "subdir: the marker repo lists the card"

# 3. Linked worktree of the marker repo shares git-common-dir: no warning.
WT="$TEST_TMP/mark-wt"
$GIT -C "$MARK" worktree add -q "$WT" HEAD
open_at "$WT"
assert_eq "$RC" 0 "worktree: exit 0"
assert_eq "$ERR" "" "worktree: same repo identity, no warning"
assert_contains "$(node "$OD" show --cwd "$MARK" 2>/dev/null)" "$OUT" "worktree: the card is visible from the marker repo"

# 4. Explicit --cwd to the other repo is the caller naming the destination (Pointer option 1): no warning, exit 0.
open_at "$MARK" --cwd "$OTHER"
assert_eq "$RC" 0 "explicit --cwd: exit 0"
assert_eq "$ERR" "" "explicit --cwd to a different repo: no warning"
assert_contains "$(node "$OD" show --cwd "$OTHER" 2>/dev/null)" "$OUT" "explicit --cwd: the card is in the named repo"

# 5. No session id: nothing to compare, only the existing unbound note.
open_nosess "$OTHER"
assert_eq "$RC" 0 "no session: exit 0"
assert_not_contains "$ERR" "WARNING: card" "no session: no repo warning"
assert_contains "$ERR" "UNBOUND scope" "no session: the unbound note still fires"
assert_not_contains "$ERR" "$MARK" "no session: the marker repo is not named"

# 6. Expired marker, no live turn file: not this session, no repo warning.
write_marker "$MARK" -3600 "$IDENT"
open_at "$OTHER"
assert_eq "$RC" 0 "expired marker: exit 0"
assert_not_contains "$ERR" "WARNING: card" "expired marker: no repo warning"
assert_contains "$ERR" "UNBOUND scope" "expired marker: unbound note still fires"
assert_not_contains "$ERR" "$MARK" "expired marker: the dead marker repo is not named"

# 7. Marker with repo_root only (no stored repo_identity) still warns and names both repos.
rm -f "$AUTOPILOT_SESSION_MODE_DIR/$SID.json"
write_marker "$MARK" 3600 ""
open_at "$OTHER"
assert_eq "$RC" 0 "repo_root only: exit 0"
assert_contains "$ERR" "WARNING: card" "repo_root only: warning"
assert_contains "$ERR" "$OTHER" "repo_root only: names the card repo"
assert_contains "$ERR" "$MARK" "repo_root only: names the marker repo"

# Negative control: the WARNING line removed. The mismatch is silent, so assertion 1 would fail.
MUT="$TEST_TMP/mut"
rm -rf "$MUT"
mkdir -p "$MUT/scripts"
ln -s "$REPO_ROOT/src" "$MUT/src"
for f in "$REPO_ROOT"/scripts/*; do
  [ "$(basename "$f")" = open-decision.js ] && continue
  ln -s "$f" "$MUT/scripts/$(basename "$f")"
done
sed_mutant "$OD" "$MUT/scripts/open-decision.js" '/open-decision: WARNING: card/d' || fail "mutation did not remove the warning line"
OD="$MUT/scripts/open-decision.js"
open_at "$OTHER"
assert_eq "$RC" 0 "mutant: still exits 0 and still writes the card"
assert_not_contains "$ERR" "WARNING: card" "mutant: mismatch is silent, so the real warning assertion would be red"
assert_not_contains "$ERR" "$MARK" "mutant: the marker repo is not named"
assert_contains "$(node "$REPO_ROOT/scripts/open-decision.js" show --cwd "$OTHER" 2>/dev/null)" "$OUT" "mutant: the card was still written into the cwd repo (the bug)"
finalize_test
