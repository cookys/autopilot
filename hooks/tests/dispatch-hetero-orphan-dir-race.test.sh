#!/usr/bin/env bash
# dispatch-hetero-orphan-dir-race.test.sh — two first-ever dispatch-hetero starts can both see the per-user orphan state
# directory absent; the loser's `mkdir` fails with EEXIST. The start-up check must re-validate the directory the winner made
# (real dir, ours, mode 700) instead of exiting 2 "unsafe orphan state directory" (seen as a 1-in-6 flake of
# agy-print-timeout under load: five hetero rails launched at once into one fresh TMPDIR).
# Deterministic: a `mkdir` shell function stands in for the race, creating the directory the way the winner would and
# then failing with EEXIST.
# Negative control: with the old `(umask 077; mkdir "$dir") || return 1` body, case 1 goes red.
. "$(dirname "$0")/lib.sh"
SRC="$REPO_ROOT/scripts/dispatch-hetero.sh"
FN="$TEST_TMP/fn.sh"
sed -n '/^_init_orphan_state_dir() {/,/^}/p' "$SRC" > "$FN"
[ -s "$FN" ] && ok=1 || ok=0
assert_eq "$ok" "1" "extracted _init_orphan_state_dir from dispatch-hetero.sh"
. "$FN"

# 1. lost race: the dir appears (mode 700, ours) between the existence check and mkdir
D1="$TEST_TMP/race1"
mkdir() { command mkdir -m 700 "$@" ; return 1; }   # winner created it; ours reports EEXIST
_init_orphan_state_dir "$D1"; rc=$?
unset -f mkdir
assert_eq "$rc" "0" "lost mkdir race onto a private dir we own is accepted"

# 2. a pre-existing group-readable dir is still refused
D2="$TEST_TMP/loose"; command mkdir -m 755 "$D2"
_init_orphan_state_dir "$D2"; rc=$?
assert_eq "$rc" "1" "pre-existing mode 755 dir refused"

# 3. a symlink in the way is refused, also when mkdir "loses" to it
D3="$TEST_TMP/link"; command mkdir "$TEST_TMP/target3"; ln -s "$TEST_TMP/target3" "$D3"
_init_orphan_state_dir "$D3"; rc=$?
assert_eq "$rc" "1" "symlink refused"
D4="$TEST_TMP/race4"
mkdir() { ln -s "$TEST_TMP/target3" "$1"; return 1; }
_init_orphan_state_dir "$D4"; rc=$?
unset -f mkdir
assert_eq "$rc" "1" "lost race onto a symlink refused"

# 4. plain first creation still works and is 700
D5="$TEST_TMP/fresh"
_init_orphan_state_dir "$D5"; rc=$?
assert_eq "$rc" "0" "fresh creation accepted"
assert_eq "$(stat -c %a "$D5")" "700" "fresh dir is mode 700"
finalize_test
