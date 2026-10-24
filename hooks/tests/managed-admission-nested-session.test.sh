#!/usr/bin/env bash
# BL-0175 -- validateManagedDevFlowAdmission must pick the marker it judges with the SAME resolver the marker
# writers use (resolveMarkerWriteTarget), not getSessionId(). Below a rail (AUTOPILOT_PARENT_SESSION_ID = P set)
# an inherited AUTOPILOT_SESSION_ID / CLAUDE_SESSION_ID must not select the marker, and the parent's own marker
# must never be judged as the child's.
# Discriminator: a valid-shaped l5 marker for the child C, admission asked at effectiveLevel l4. Reaching
# "marker=l5" proves the session-identity step passed on C's marker; "absent" / "unresolved" / "mismatch"
# proves it did not. (The level check precedes the Mission projection, so no sealed campaign is needed here.)
# Cells: n1 nested + inherited AUTOPILOT_SESSION_ID=P; n2 nested, only CLAUDE_SESSION_ID; n3 nested, CC id == P;
# n4 nested, plain CC id (pin); p1/p2 non-nested (no P) behaviour pinned.
# Negative control: with the entry check put back on getSessionId(), n1 and n3 must turn red.
. "$(dirname "$0")/lib.sh"
SM="$REPO_ROOT/scripts/session-mode.js"
MD="$TEST_TMP/markers"; mkdir -p "$MD"
export AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_RUNS_WATCH_AUTOSTART=0
unset AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID
P="pppppppp-1111"; C="cccccccc-2222"; X="xxxxxxxx-3333"

REPO="$TEST_TMP/repo"; mkdir -p "$REPO"
git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -C "$REPO" init -q
git -c user.email=t@t -c user.name=t -c commit.gpgsign=false -C "$REPO" commit -q --allow-empty -m base
REPO="$(cd "$REPO" && pwd -P)"

seed() { # <id> <level>: a well-formed l5 marker, unexpired
  node -e '
    const [id, level, repo, dir] = process.argv.slice(1);
    const m = { session_id: id, level, repo_root: repo, repo_identity: null, project_key: null,
      started_at: "2026-01-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", root_run_id: "job-seed" };
    require("fs").writeFileSync(require("path").join(dir, id + ".json"), JSON.stringify(m, null, 2) + "\n");
  ' "$1" "$2" "$REPO" "$MD"
}
seed "$C" l5; seed "$X" l5; seed "$P" l3   # parent (and any inherited id) is l3, child l5: the reason names whose marker was read

# admit <module> [VAR=value ...] -> prints the rejection reason (or VALID)
admit() {
  local mod="$1"; shift
  env "$@" node -e '
    const { validateManagedDevFlowAdmission } = require(process.argv[1]);
    const r = validateManagedDevFlowAdmission({ repoRoot: process.argv[2], effectiveLevel: "l4", campaignContract: {} });
    process.stdout.write(r.valid ? "VALID" : r.reason);
  ' "$mod" "$REPO"
}

run_cells() { # <module> <tag>
  local mod="$1" tag="$2"
  # n1: nested; the rail's AUTOPILOT_SESSION_ID is the parent's (inherited); the child's own id is CLAUDE_CODE_SESSION_ID
  assert_contains "$(admit "$mod" AUTOPILOT_PARENT_SESSION_ID=$P AUTOPILOT_SESSION_ID=$P CLAUDE_CODE_SESSION_ID=$C)" "marker=l5" "$tag n1 nested child reads its own marker, not the inherited one"
  # n2: nested, only CLAUDE_SESSION_ID: the writers refuse this (inherited id is read-only), so admission fails closed
  assert_contains "$(admit "$mod" AUTOPILOT_PARENT_SESSION_ID=$P CLAUDE_SESSION_ID=$C)" "unresolved" "$tag n2 nested, only CLAUDE_SESSION_ID: fail closed like the writers"
  # n3: nested but CLAUDE_CODE_SESSION_ID equals P: the parent's marker is never judged as the child's
  assert_contains "$(admit "$mod" AUTOPILOT_PARENT_SESSION_ID=$P CLAUDE_CODE_SESSION_ID=$P)" "unresolved" "$tag n3 nested, CC id == parent: parent marker not read"
  # n4: nested, plain CC id differing from P (pin: unchanged)
  assert_contains "$(admit "$mod" AUTOPILOT_PARENT_SESSION_ID=$P CLAUDE_CODE_SESSION_ID=$C)" "marker=l5" "$tag n4 nested, own CC id"
  # p1/p2: non-nested (no P): the getSessionId() chain, unchanged
  assert_contains "$(admit "$mod" AUTOPILOT_SESSION_ID=$X CLAUDE_CODE_SESSION_ID=$C)" "marker=l5" "$tag p1 non-nested AUTOPILOT_SESSION_ID wins"
  assert_contains "$(admit "$mod" CLAUDE_SESSION_ID=$C)" "marker=l5" "$tag p2 non-nested CLAUDE_SESSION_ID"
  assert_contains "$(admit "$mod" CLAUDE_CODE_SESSION_ID=nomarker-1)" "session marker absent" "$tag p3 non-nested, no marker -> absent"
}

run_cells "$SM" real

# Negative control: the entry check back on getSessionId() (and the default path on markerPath()).
NC="$TEST_TMP/nc"; mkdir -p "$NC"
sed_mutant "$SM" "$NC/session-mode.js" -e "s#require('\\.\\./#require('$REPO_ROOT/#g" -e "s#require('\\./#require('$REPO_ROOT/scripts/#g"  -e "s#const target = resolveMarkerWriteTarget();#const target = { id: getSessionId() };#"
nc1="$(admit "$NC/session-mode.js" AUTOPILOT_PARENT_SESSION_ID=$P AUTOPILOT_SESSION_ID=$P CLAUDE_CODE_SESSION_ID=$C)"
assert_not_contains "$nc1" "marker=l5" "negative control n1: getSessionId() reads the inherited id -> cell red ('$nc1')"
nc3="$(admit "$NC/session-mode.js" AUTOPILOT_PARENT_SESSION_ID=$P CLAUDE_CODE_SESSION_ID=$P)"
assert_not_contains "$nc3" "unresolved" "negative control n3: getSessionId() reads the parent marker -> cell red ('$nc3')"
finalize_test
