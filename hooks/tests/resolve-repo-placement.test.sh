#!/usr/bin/env bash
# resolve-repo-placement.test.sh — one answer per repo for where its worktrees and handoffs go
# (plan docs/plans/2026-10-12-worktree-placement.md, D1/D8/D12): the same answer from the main
# checkout and from a linked worktree, a temp-dir fallback when there is no non-bare main checkout,
# and handoff keys that are per repo (manual) and per worktree (/clear).

set -uo pipefail
. "$(dirname "$0")/lib.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
R="$REPO_ROOT/scripts/resolve-repo-placement.js"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n     want: %s\n     got:  %s\n' "$1" "$2" "$3"; }
eq() { [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"; }
ne() { [ "$2" != "$3" ] && ok "$1" || no "$1" "not $2" "$3"; }

TMP="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$TMP"; cleanup_test_tmp' EXIT
export HOME="$TMP/home" TMPDIR="$TMP/tmp"; mkdir -p "$HOME" "$TMPDIR"
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
G() { git -C "$1" "${@:2}" >/dev/null 2>&1; }
mkrepo() { mkdir -p "$1"; G "$1" init -q -b develop; G "$1" commit -q --allow-empty -m init; }
field() { node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"))[process.argv[1]];process.stdout.write(v===null?"null":String(v))' "$1"; }
rp() { node "$R" "$@" 2>/dev/null; }

A="$TMP/a/proj"; mkrepo "$A"
G "$A" worktree add -q -b feat/x "$TMP/a-wt1"
G "$A" worktree add -q -b feat/y "$TMP/a-wt2"

# 1. main: the same main checkout and identity from the main checkout and from a linked worktree.
eq "main from the main checkout" "$A" "$(rp main --from "$A" | field main_checkout)"
eq "main from a linked worktree is the main checkout" "$A" "$(rp main --from "$TMP/a-wt1" | field main_checkout)"
eq "identity is the same from both" "$(rp main --from "$A" | field repo_identity)" "$(rp main --from "$TMP/a-wt1" | field repo_identity)"
eq "not a fallback" "false" "$(rp main --from "$TMP/a-wt1" | field fallback)"
eq "behind is null without an upstream" "null" "$(rp main --from "$A" | field behind)"

# 2. behind counts the main checkout's branch against its upstream.
U="$TMP/u"; G "$TMP" clone -q "$A" "$U"; G "$A" commit -q --allow-empty -m ahead
G "$U" fetch -q origin
eq "behind counts commits behind upstream" "1" "$(rp main --from "$U" | field behind)"

# 3. worktree: a template under <main>/.claude/worktrees, the directory created, from either checkout.
rm -rf "$A/.claude"
T1="$(rp worktree --prefix hetero --slug feat/x --from "$TMP/a-wt1")"
eq "template from a linked worktree is under the main checkout" "$A/.claude/worktrees/hetero-feat-x-XXXXXX" "$T1"
[ -d "$A/.claude/worktrees" ] && ok "worktree creates <main>/.claude/worktrees" || no "worktree creates <main>/.claude/worktrees" "dir" "missing"
eq "template from the main checkout is the same" "$T1" "$(rp worktree --prefix hetero --slug feat/x --from "$A")"
W="$(mktemp -u -d "$T1")"; G "$A" worktree add -q --detach "$W" HEAD
case "$W" in "$A/.claude/worktrees/hetero-feat-x-"??????) ok "mktemp fills the template" ;; *) no "mktemp fills the template" "$A/.claude/worktrees/hetero-feat-x-??????" "$W" ;; esac
eq "a worktree inside .claude/worktrees still answers the main checkout" "$A" "$(rp main --from "$W" | field main_checkout)"

# 4. Fallback: a bare repo has no main checkout; the template stays in the temp dir and says so.
B="$TMP/bare.git"; G "$TMP" init -q --bare -b develop "$B"; G "$A" push -q "$B" develop
G "$B" worktree add -q "$TMP/b-wt" develop
eq "bare repo: fallback" "true" "$(rp main --from "$TMP/b-wt" | field fallback)"
eq "bare repo: no main checkout" "null" "$(rp main --from "$TMP/b-wt" | field main_checkout)"
eq "bare repo: temp-dir template" "$TMPDIR/foreman-r1-XXXXXX" "$(rp worktree --prefix foreman --slug r1 --from "$TMP/b-wt")"
ERR="$(node "$R" worktree --prefix foreman --slug r1 --from "$TMP/b-wt" 2>&1 >/dev/null)"
case "$ERR" in *"temp dir"*) ok "fallback says so on stderr" ;; *) no "fallback says so on stderr" "*temp dir*" "$ERR" ;; esac

# 4b. mkdir fails (`.claude` is a file): temp-dir template, the reason on stderr, exit 0.
M="$TMP/m"; mkrepo "$M"; : > "$M/.claude"
eq "mkdir failure: temp-dir template" "$TMPDIR/batch-r2-XXXXXX" "$(rp worktree --prefix batch --slug r2 --from "$M")"
ERR="$(node "$R" worktree --prefix batch --slug r2 --from "$M" 2>&1 >/dev/null)"
case "$ERR" in *"cannot create"*"temp dir"*) ok "mkdir failure says why on stderr" ;; *) no "mkdir failure says why on stderr" "*cannot create*temp dir*" "$ERR" ;; esac
(node "$R" worktree --prefix batch --slug r2 --from "$M" >/dev/null 2>&1); eq "mkdir failure exits 0" "0" "$?"

# 5. Separate --git-dir: the common dir is not `.git` ⇒ fallback.
S="$TMP/sep"; mkdir -p "$S/wt"; git --git-dir="$S/store" --work-tree="$S/wt" init -q -b develop >/dev/null 2>&1
eq "separate git dir: fallback" "true" "$(GIT_DIR="$S/store" GIT_WORK_TREE="$S/wt" node "$R" main --from "$S/wt" 2>/dev/null | field fallback)"

# 6. Handoff: manual is per repo (shared by worktrees, distinct for same-named repos); /clear is per worktree.
B2="$TMP/b/proj"; mkrepo "$B2"
M_A="$(rp handoff --route manual --from "$A")"
eq "manual: same path from a linked worktree" "$M_A" "$(rp handoff --route manual --from "$TMP/a-wt2")"
ne "manual: two repos named proj get different paths" "$M_A" "$(rp handoff --route manual --from "$B2")"
case "$M_A" in "$HOME/.autopilot/handoff-manual/proj-"????????.md) ok "manual: <basename>-<8 hex>.md under ~/.autopilot/handoff-manual" ;; *) no "manual path shape" "$HOME/.autopilot/handoff-manual/proj-XXXXXXXX.md" "$M_A" ;; esac
G "$B" worktree add -q -b feat/z "$TMP/b-wt2"
eq "manual: a bare repo's worktrees share one path" "$(rp handoff --route manual --from "$TMP/b-wt")" "$(rp handoff --route manual --from "$TMP/b-wt2")"
case "$(rp handoff --route manual --from "$TMP/b-wt")" in "$HOME/.autopilot/handoff-manual/bare-"????????.md) ok "manual: a bare repo is named without .git" ;; *) no "manual: bare repo name" "bare-XXXXXXXX.md" "$(rp handoff --route manual --from "$TMP/b-wt")" ;; esac
C1="$(rp handoff --route clear --from "$TMP/a-wt1")"
ne "clear: two worktrees of one repo differ" "$C1" "$(rp handoff --route clear --from "$TMP/a-wt2")"
eq "clear: sha1 of the realpath toplevel" "$HOME/.autopilot/handoff/$(printf '%s' "$TMP/a-wt1" | sha1sum | cut -d' ' -f1).md" "$C1"
NR="$TMP/plain"; mkdir -p "$NR"
case "$(rp handoff --route manual --from "$NR")" in "$HOME/.autopilot/handoff-manual/plain-"????????.md) ok "manual outside a repo: cwd name" ;; *) no "manual outside a repo" "plain-XXXXXXXX.md" "$(rp handoff --route manual --from "$NR")" ;; esac

# 7. Exit codes.
(node "$R" worktree --prefix hetero --slug x >/dev/null 2>&1); eq "worktree without --from exits 2" "2" "$?"
(node "$R" worktree --prefix hetero --slug x --from "$NR" >/dev/null 2>&1); eq "worktree outside a repo exits 1" "1" "$?"
(node "$R" handoff --route clear --from "$NR" >/dev/null 2>&1); eq "clear outside a repo exits 1" "1" "$?"
(node "$R" handoff --route other --from "$A" >/dev/null 2>&1); eq "unknown route exits 2" "2" "$?"
(node "$R" worktree --prefix 'a/b' --slug x --from "$A" >/dev/null 2>&1); eq "prefix with a slash exits 2" "2" "$?"
(node "$R" nope >/dev/null 2>&1); eq "unknown subcommand exits 2" "2" "$?"
(node "$R" main --from >/dev/null 2>&1); eq "flag without a value exits 2" "2" "$?"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
