#!/usr/bin/env bash
# hooks/tests/test-git-env-bash.test.sh — negative control for the bash side of the ambient-GIT_DIR fix.
#
# Incident: GIT_DIR (without GIT_WORK_TREE) leaked into a test; the fixture's `git init` + `add -A` + `commit` then wrote into the
# OUTER repo and deleted its tree. Node side: scripts/lib/test-git-env.test.js. This is the bash side: a *.test.sh run directly
# (bash X.test.sh, as suite-baseline run-all and affected-suites --run do), not through run.sh / lib.sh.
#
#   1. lock: scripts/lib/test-git-env.sh unsets every name in src/status/git-env.js REPO_SELECTING, and hooks/tests/lib.sh
#      (git's own list, or its hard-coded fallback) covers the same names — one list, two consumers, locked by this test.
#   2. control bites: scripts/tests/run-ledger.test.sh with the fix line stripped DOES corrupt a mktemp outer repo.
#   3. fix holds: the real, unmodified run-ledger.test.sh leaves the outer repo's HEAD, tree and files unchanged.
#
# NOFIX=1 asserts "outer unchanged" on the stripped variant: that run must go red (the recorded red evidence).
# Only ever touches mktemp repos.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../../scripts/lib/test-git-env.sh
. "$REPO_ROOT/scripts/lib/test-git-env.sh"
WORK="$(mktemp -d -t "test-git-env-bash-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
FAILS=0
ok()  { printf 'ok   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }

# --- 1. lock the name list ---
NAMES="$(node -p "require('$REPO_ROOT/src/status/git-env.js').REPO_SELECTING.join(' ')")"
LEAK=""
for n in $NAMES; do LEAK="$LEAK $n=/nonexistent-$n"; done
# shellcheck disable=SC2086
LEFT="$(env $LEAK bash -c ". '$REPO_ROOT/scripts/lib/test-git-env.sh' && env | grep -c '^GIT_.*=/nonexistent-' || true")"
[ "$LEFT" = 0 ] && ok "test-git-env.sh unsets all $(echo $NAMES | wc -w) REPO_SELECTING names" || bad "test-git-env.sh left $LEFT of them set"
# shellcheck disable=SC2086
LEFT2="$(env $LEAK bash -c ". '$HERE/lib.sh' >/dev/null 2>&1; env | grep -c '^GIT_.*=/nonexistent-' || true")"
[ "$LEFT2" = 0 ] && ok "hooks/tests/lib.sh unsets the same names" || bad "hooks/tests/lib.sh left $LEFT2 of them set"

# --- outer repo + a variant of the representative fixture test ---
make_outer() { # $1 dir
  git init -q "$1" && ( cd "$1" && git config user.email o@example.com && git config user.name o \
    && echo outer > outer.txt && echo keep > keep.txt && git add -A && git commit -qm outer )
}
snapshot() { # $1 outer dir -> HEAD + tree + worktree listing
  printf '%s %s\n' "$(git -C "$1" rev-parse HEAD)" "$(git -C "$1" rev-parse 'HEAD^{tree}')"
  ( cd "$1" && ls -A | grep -v '^\.git$' | sort | tr '\n' ' '; git status --porcelain | tr '\n' ' ' )
}
variant() { # $1 out file, $2 keep|strip the fix line
  local src="$REPO_ROOT/scripts/tests/run-ledger.test.sh"
  { echo "SCRIPT_ROOT_FIXED='$REPO_ROOT'"; sed -e 's|^SCRIPT_ROOT=.*|SCRIPT_ROOT="$SCRIPT_ROOT_FIXED"|' "$src"; } > "$1"
  [ "$2" = strip ] && sed -i '/lib\/test-git-env\.sh/d' "$1"
  grep -q 'test-git-env.sh' "$1"; local has=$?
  if [ "$2" = strip ] && [ "$has" = 0 ]; then echo "variant strip did not remove the fix line" >&2; return 1; fi
  return 0
}
run_leaked() { # $1 outer dir, $2 script
  ( cd "$1" && env GIT_DIR="$1/.git" bash "$2" < /dev/null > "$WORK/run.out" 2>&1 ); return 0
}

# --- 2. control bites ---
make_outer "$WORK/outer-a"; BEFORE_A="$(snapshot "$WORK/outer-a")"
variant "$WORK/strip.test.sh" strip || bad "cannot build stripped variant"
run_leaked "$WORK/outer-a" "$WORK/strip.test.sh"
AFTER_A="$(snapshot "$WORK/outer-a")"
if [ "${NOFIX:-}" = 1 ]; then
  [ "$BEFORE_A" = "$AFTER_A" ] && ok "NOFIX: outer repo unchanged" || bad "NOFIX: stripped variant changed the outer repo (red expected)"
else
  [ "$BEFORE_A" != "$AFTER_A" ] && ok "control bites: without the fix the outer repo is changed" || bad "control does not bite: outer unchanged without the fix"
  # --- 3. fix holds ---
  make_outer "$WORK/outer-b"; BEFORE_B="$(snapshot "$WORK/outer-b")"
  variant "$WORK/keep.test.sh" keep || bad "cannot build kept variant"
  run_leaked "$WORK/outer-b" "$WORK/keep.test.sh"
  AFTER_B="$(snapshot "$WORK/outer-b")"
  [ "$BEFORE_B" = "$AFTER_B" ] && ok "fix holds: outer HEAD, tree and files unchanged" || bad "fix does not hold: outer repo changed"
  grep -q 'PASS\|passed\|ok' "$WORK/run.out" || bad "fixture test itself did not run to a pass"
fi

[ "$FAILS" = 0 ] && { echo "PASS test-git-env-bash"; exit 0; }
echo "FAIL test-git-env-bash ($FAILS)"; exit 1
