#!/usr/bin/env bash
# check-tmp-residue-registry.test.sh — KR5 of docs/plans/_archive/2026/10/2026-10-12-tmp-residue-containment.md.
# The gate scripts/check-tmp-residue-registry.js must block an unregistered temp reference at the
# two real entry points, not merely exist:
#   - `--self-test` exits 0 and prints a verdict for every planted fixture (each negative exits 1,
#     each positive twin exits 0);
#   - the REAL .githooks/pre-commit, run by `git commit` in a scratch clone with core.hooksPath set,
#     rejects a staged file that plants an unregistered mkdtemp (exit 1, gate message) and lets an
#     unrelated clean change through (exit 0);
#   - scripts/preflight-release.sh's gate step fails on the same clone and passes on the clean one.
. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/scripts/check-tmp-residue-registry.js"

# ── Case 1: the gate is clean on this repo; the self-test passes with every fixture accounted for ──
node "$GATE" >"$TEST_TMP/gate.out" 2>&1
assert_eq "$?" "0" "case1: gate exits 0 on the repo"

ST="$(node "$GATE" --self-test 2>&1)"
assert_eq "$?" "0" "case1: --self-test exits 0"
for fx in "unregistered literal prefix" "success-path-only rmSync" "allocation before the try" \
          "mktemp before its trap" "unextractable prefix, no allowlist" "reaper-only prefix (parity)" \
          "bare /tmp/ literal"; do
  assert_contains "$ST" "PASS  $fx: expect exit 1" "case1: planted fixture '$fx' makes the gate exit 1"
done
for fx in "clean fixture repo" "registered literal prefix" "alloc first in try + finally rm" \
          "shell trap (guarded) before mktemp" "allowlisted unextractable prefix"; do
  assert_contains "$ST" "PASS  $fx: expect exit 0" "case1: positive control '$fx' exits 0"
done

# ── Case 2: scratch clone, real pre-commit ──
CL="$TMPDIR/clone"   # under TMPDIR so the test-identity gate bypass below is honoured
git clone -q --local "$REPO_ROOT" "$CL" >/dev/null 2>&1
assert_eq "$?" "0" "case2: scratch clone created"
# Overlay modified tracked files only (untracked files may be other parallel suites' transient
# droppings in a shared snapshot; empty once the change is committed,
# so the clone then tests exactly HEAD), then record a baseline with hooks off so the real hook only
# sees the planted/clean change.
while IFS= read -r f; do
  [ -f "$REPO_ROOT/$f" ] || continue
  mkdir -p "$CL/$(dirname "$f")"
  cp "$REPO_ROOT/$f" "$CL/$f"
done < <(git -C "$REPO_ROOT" ls-files -m)
export GIT_AUTHOR_NAME=tmp-gate GIT_AUTHOR_EMAIL=tmp-gate@example.invalid
export GIT_COMMITTER_NAME=tmp-gate GIT_COMMITTER_EMAIL=tmp-gate@example.invalid
git -C "$CL" -c core.hooksPath=/dev/null add -A >/dev/null 2>&1
git -C "$CL" -c core.hooksPath=/dev/null commit -q --no-verify -m "baseline" >/dev/null 2>&1
git -C "$CL" config core.hooksPath .githooks
git -C "$CL" config autopilot.testIdentityGate off
assert_eq "$(git -C "$CL" config --get core.hooksPath)" ".githooks" "case2: clone uses the repo's .githooks"

# 2a. clean change passes the real hook
echo "clean change $$" >> "$CL/docs/plans/_archive/2026/10/2026-10-12-tmp-residue-containment.md"
git -C "$CL" add docs/plans/_archive/2026/10/2026-10-12-tmp-residue-containment.md
OUT="$(git -C "$CL" commit -q -m "chore: clean change" 2>&1)"
assert_eq "$?" "0" "case2a: clean change is let through by the real pre-commit"
assert_not_contains "$OUT" "tmp-residue gate failed" "case2a: no gate complaint on the clean change"

# 2b. preflight gate step passes on the clean clone
PF="$(cd "$CL" && AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh 2>&1)"
assert_contains "$PF" "✓ temp-prefix registry gate" "case2b: preflight gate step passes on the clean clone"

# 2c. planted unregistered mkdtemp is blocked (the gate runs before the slower sync rituals, so the
#     rejection below is the gate's own; the clean-change control above proves the hook otherwise passes)
cat >> "$CL/scripts/lib/semver.js" <<'PLANT'
const __planted = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zz-planted-unregistered-'));
PLANT
git -C "$CL" add scripts/lib/semver.js
OUT="$(git -C "$CL" commit -q -m "feat: planted" 2>&1)"
RC=$?
assert_eq "$RC" "1" "case2c: real pre-commit rejects the planted file (exit 1)"
assert_contains "$OUT" "tmp-residue gate failed" "case2c: rejection comes from the tmp-residue gate"
assert_contains "$OUT" "zz-planted-unregistered-" "case2c: the message names the planted prefix"
assert_eq "$(git -C "$CL" log -1 --format=%s)" "chore: clean change" "case2c: nothing was committed"


# 2d. preflight gate step fails on the planted clone
PF="$(cd "$CL" && AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh 2>&1)"
assert_contains "$PF" "✗ temp-prefix registry gate" "case2d: preflight gate step fails on the planted clone"
assert_contains "$PF" "zz-planted-unregistered-" "case2d: preflight output names the planted prefix"

# 2e. staged-then-reverted plant: the index holds the planted line, the worktree is clean again.
#      --staged must judge the bytes being committed, so the real hook still rejects it.
git -C "$CL" checkout -- scripts/lib/semver.js 2>/dev/null || true
git -C "$CL" show HEAD:scripts/lib/semver.js > "$TMPDIR/semver.clean.js"
cat "$TMPDIR/semver.clean.js" > "$CL/scripts/lib/semver.js"
printf "const __planted2 = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'zz-staged-only-'));\n" >> "$CL/scripts/lib/semver.js"
git -C "$CL" add scripts/lib/semver.js
cat "$TMPDIR/semver.clean.js" > "$CL/scripts/lib/semver.js"
OUT="$(git -C "$CL" commit -q -m "feat: staged-only plant" 2>&1)"
RC=$?
assert_eq "$RC" "1" "case2e: pre-commit rejects a plant that exists only in the index (exit 1)"
assert_contains "$OUT" "zz-staged-only-" "case2e: the message names the index-only prefix"
git -C "$CL" reset -q HEAD -- scripts/lib/semver.js
git -C "$CL" checkout -q -- scripts/lib/semver.js

# ── Case 3: parity is enforced at the pre-commit entry point even when no shipped file changed ──
git -C "$CL" reset -q --hard HEAD
sed -i "s#^  'apt\.\*'\$#  'apt.*'\n  'zz-reaper-only-*'#" "$CL/hooks/tests/lib/suite-residue-reap.sh"
git -C "$CL" add hooks/tests/lib/suite-residue-reap.sh
OUT="$(git -C "$CL" commit -q -m "test: reaper-only prefix" 2>&1)"
assert_eq "$?" "1" "case3: reaper-only prefix is blocked by the real pre-commit"
assert_contains "$OUT" "parity_mismatch" "case3: failure is the parity check"

finalize_test "check-tmp-residue-registry"
