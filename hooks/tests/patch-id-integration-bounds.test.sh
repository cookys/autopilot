#!/usr/bin/env bash
# patch-id-integration-bounds.test.sh — BL-0276: patch-id integration is whitespace-sensitive
# and a commit counts as integrated only while its change is still present at the tip.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME/.autopilot"
export AUTOPILOT_RESIDUE_RECENT_HOURS=0
unset AUTOPILOT_RESIDUE_AUTO_REAP AUTOPILOT_RESIDUE_LEASE_HOURS AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS

jx() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);let v;try{v=eval(process.argv[1]);}catch(e){v=undefined;}process.stdout.write(v===undefined?"<undef>":(typeof v==="string"?v:JSON.stringify(v)));})' "$2"; }
G() { git -C "$1" -c user.email=t@t -c user.name=t "${@:2}"; }
new_repo() {
  local d="$TEST_TMP/repo-$1"; mkdir -p "$d"
  git -C "$d" init -q -b develop
  printf 'if x:\n  y()\n' > "$d/f.py"; printf 'base\n' > "$d/a.txt"
  git -C "$d" add -A; G "$d" commit -q -m base
  printf '%s\n' "$d"
}
# <repo> <branch> — branch is a detached side commit; commit time old; develop gets a side commit.
mkbranch() { # repo name
  G "$1" checkout -q -b "$2"
}
verdict() { jx "$(node "$SCRIPT" scan --repo "$1" --integration-ref develop)" "j.branches.find(b=>b.branch==='$2').integrated"; }

# 1. indentation-only: develop has the 2-space version; branch re-indents to 4 spaces and
#    develop cherry-picks a whitespace-only-equivalent change -> must NOT be integrated.
R="$(new_repo indent)"
mkbranch "$R" hands/indent
printf 'if x:\n    y()\n' > "$R/f.py"; G "$R" commit -q -am reindent
G "$R" checkout -q develop
printf 'side\n' > "$R/z.txt"; G "$R" add z.txt; G "$R" commit -q -m side
# develop applies a different-whitespace variant of the same change (tabs)
printf 'if x:\n\ty()\n' > "$R/f.py"; G "$R" commit -q -am tabs
assert_eq "$(verdict "$R" hands/indent)" "false" "indent-only: not integrated"

# 2. cherry-picked then reverted -> not integrated
R="$(new_repo revert)"
mkbranch "$R" hands/rev
printf 'new\n' > "$R/n.txt"; G "$R" add n.txt; G "$R" commit -q -m addn
SHA="$(git -C "$R" rev-parse HEAD)"
G "$R" checkout -q develop
printf 'side\n' > "$R/z.txt"; G "$R" add z.txt; G "$R" commit -q -m side
G "$R" cherry-pick "$SHA" >/dev/null
G "$R" revert --no-edit HEAD >/dev/null
assert_eq "$(verdict "$R" hands/rev)" "false" "cherry-pick then revert: not integrated"

# 3. normal cherry-pick still integrated
R="$(new_repo ok)"
mkbranch "$R" hands/ok
printf 'new\n' > "$R/n.txt"; G "$R" add n.txt; G "$R" commit -q -m addn
SHA="$(git -C "$R" rev-parse HEAD)"
G "$R" checkout -q develop
printf 'side\n' > "$R/z.txt"; G "$R" add z.txt; G "$R" commit -q -m side
G "$R" cherry-pick "$SHA" >/dev/null
assert_eq "$(verdict "$R" hands/ok)" "true" "normal cherry-pick: integrated"

finalize_test
