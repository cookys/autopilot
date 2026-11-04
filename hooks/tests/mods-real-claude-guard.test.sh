#!/usr/bin/env bash
# mods-real-claude-guard.test.sh -- mods/lib/real-claude-env.sh (AUTOPILOT_MODS_REAL_CLAUDE) with FAKE claude binaries only; the real claude is never run here.
# MODS_REAL_CLAUDE_LIB may point at a mutated copy of the helper to prove each negative control goes red.
set -u
# FIRST: nothing below may ever touch the real home. HOME and the config dirs are sandboxes; a helper that stops overriding HOME then leaks into
# here (and the leak detector at the end goes red) instead of into the caller's real ~/.claude.
OUTER="$(mktemp -d)"
export HOME="$OUTER/home" CLAUDE_CONFIG_DIR="$OUTER/home/.claude" XDG_CONFIG_HOME="$OUTER/xc" XDG_DATA_HOME="$OUTER/xd" XDG_STATE_HOME="$OUTER/xs" XDG_CACHE_HOME="$OUTER/xk"
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${MODS_REAL_CLAUDE_LIB:-$REPO_ROOT/mods/lib/real-claude-env.sh}"
T="$(mktemp -d)"; trap 'chmod -R u+rwX "$T" "$OUTER" 2>/dev/null; rm -rf "$T" "$OUTER"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

mkdir -p "$T/plug"
fake() { # <name> <body>: a fake claude that records its env, then runs <body>
  printf '#!/usr/bin/env bash\n{ echo "HOME=$HOME"; echo "CCD=$CLAUDE_CONFIG_DIR"; echo "KEY=${ANTHROPIC_API_KEY:-}"; echo "TOK=${CLAUDE_CODE_OAUTH_TOKEN:-}"; echo "ARGS=$*"; echo "ROOT=$(dirname "$HOME")"; echo "XC=$XDG_CONFIG_HOME"; echo "XD=$XDG_DATA_HOME"; echo "XS=$XDG_STATE_HOME"; echo "XK=$XDG_CACHE_HOME"; } > "%s/%s.env"\n%s\n' "$T" "$1" "$2" > "$T/$1"
  chmod +x "$T/$1"
}
run() { # <fake name> -> rc (helper sourced in a subshell, like the runners do)
  ( . "$LIB"; ANTHROPIC_API_KEY=FAKE-key CLAUDE_CODE_OAUTH_TOKEN=FAKE-tok AUTOPILOT_MODS_REAL_CLAUDE="$T/$1" mods_run_plugin_test "$T/plug" --extra ) >"$T/$1.out" 2>"$T/$1.err" </dev/null
}

fake clean 'echo "{}" > "$CLAUDE_CONFIG_DIR/.claude.json"; exit 0'
run clean; rc=$?
[ "$rc" = 0 ] && ok || bad "clean fake (only .claude.json) must pass, rc=$rc"
grep -q '^ARGS=plugin test '"$T"'/plug --extra$' "$T/clean.env" && ok || bad "argv passed through"
grep -q '^KEY=$' "$T/clean.env" && grep -q '^TOK=$' "$T/clean.env" && ok || bad "auth env vars must be unset in the child"
h="$(sed -n 's/^HOME=//p' "$T/clean.env")"; c="$(sed -n 's/^CCD=//p' "$T/clean.env")"
{ [ -n "$h" ] && [ -n "$c" ] && [ "$h" != "$HOME" ] && [ ! -e "$h" ] && [ ! -e "$c" ]; } && ok || bad "HOME/CLAUDE_CONFIG_DIR must be fresh dirs removed afterwards ($h $c)"

# XDG dirs: each non-empty, under the same root as HOME, and gone afterwards
root="$(sed -n 's/^ROOT=//p' "$T/clean.env")"; xok=1
for k in XC XD XS XK; do v="$(sed -n "s/^$k=//p" "$T/clean.env")"; case "$v" in "$root"/?*) [ ! -e "$v" ] || xok=0;; *) xok=0;; esac; done
[ -n "$root" ] && [ "$xok" = 1 ] && [ ! -e "$root" ] && ok || bad "XDG_* must be set under the same root as HOME and removed afterwards"

# the scan must not fail open
fake gone 'rm -rf "$(dirname "$HOME")"; exit 0'
run gone; rc=$?
{ [ "$rc" = 98 ] && grep -q 'guard RED' "$T/gone.err"; } && ok || bad "a child that removes the sandbox root must go red 98 (rc=$rc)"
if [ "$(id -u)" = 0 ]; then echo "SKIP: unreadable-subdir case (chmod 000 does not block reads for uid 0)"; else
fake unread 'mkdir "$CLAUDE_CONFIG_DIR/locked"; chmod 000 "$CLAUDE_CONFIG_DIR/locked"; exit 0'
run unread; rc=$?
{ [ "$rc" = 98 ] && grep -q 'incomplete' "$T/unread.err"; } && ok || bad "an unreadable subdir (scan incomplete) must go red 98 (rc=$rc)"
fi
fake gonered 'rm -rf "$(dirname "$HOME")"; exit 4'
run gonered; rc=$?
[ "$rc" = 4 ] && ok || bad "a failing child keeps its own rc when the scan is also bad (rc=$rc)"
if [ "$(id -u)" = 0 ]; then echo "SKIP: set -e unreadable-subdir case (uid 0)"; else
# errexit active in the caller: cleanup still happens and the rc is right
( set -e; . "$LIB"; AUTOPILOT_MODS_REAL_CLAUDE="$T/unread" mods_run_plugin_test "$T/plug" ) >/dev/null 2>"$T/e.err"; rc=$?
left="$(sed -n 's/^ROOT=//p' "$T/unread.env")"
{ [ "$rc" = 98 ] && [ ! -e "$left" ]; } && ok || bad "under set -e: rc 98 and the sandbox removed (rc=$rc left=$left)"
fi
( set -e; . "$LIB"; AUTOPILOT_MODS_REAL_CLAUDE="$T/clean" mods_run_plugin_test "$T/plug" ) >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && ok || bad "under set -e a clean run returns 0 (rc=$rc)"

# symlinks the cleanup could follow out of the sandbox: an outside dir (mode 500, with a 500 subdir and a file) must stay byte for byte as it was
OUT="$T/outside"; mkdir -p "$OUT/sub"; echo keep > "$OUT/f"; echo keep > "$OUT/sub/g"; chmod 500 "$OUT/sub" "$OUT"
export OUT
snap() { find "$OUT" -printf '%p %m\n' | sort; cat "$OUT/f" "$OUT/sub/g"; }
before="$(snap)"
fake rootlink 'r="$(dirname "$HOME")"; echo "$r" > "$OUT/../rootlink.path"; rm -rf "$r"; ln -s "$OUT" "$r"; exit 0'
run rootlink; rc=$?; rp="$(cat "$T/rootlink.path" 2>/dev/null)"
{ [ "$rc" = 98 ] && grep -q 'symlink' "$T/rootlink.err" && [ ! -e "$rp" ] && [ ! -L "$rp" ] && [ "$(snap)" = "$before" ]; } && ok || bad "a root replaced by a symlink must go red 98, the link removed, the outside dir untouched (rc=$rc)"
fake innerlink 'ln -s "$OUT" "$CLAUDE_CONFIG_DIR/lnk"; ln -s "$OUT" "$HOME/lnk2"; exit 0'
run innerlink; rc=$?
{ [ "$rc" = 0 ] && [ "$(snap)" = "$before" ]; } && ok || bad "a symlink inside the sandbox must not be followed by the cleanup (rc=$rc)"

fake cred 'echo FAKE-credentials > "$CLAUDE_CONFIG_DIR/.credentials.json"; exit 0'
run cred; rc=$?
{ [ "$rc" != 0 ] && grep -q 'guard RED' "$T/cred.err" && grep -q '.credentials.json' "$T/cred.err"; } && ok || bad "planted .credentials.json must go red (rc=$rc)"

fake jsonl 'mkdir -p "$CLAUDE_CONFIG_DIR/projects/p"; echo "{}" > "$CLAUDE_CONFIG_DIR/projects/p/x.jsonl"; exit 0'
run jsonl; rc=$?
{ [ "$rc" != 0 ] && grep -q 'guard RED' "$T/jsonl.err" && grep -q 'x.jsonl' "$T/jsonl.err"; } && ok || bad "planted x.jsonl must go red (rc=$rc)"

fake homecred 'mkdir -p "$HOME/.claude"; echo FAKE-credentials > "$HOME/.claude/.credentials.json"; exit 0'
run homecred; rc=$?
[ "$rc" != 0 ] && ok || bad "credentials planted under HOME must go red (rc=$rc)"

fake red 'exit 3'
run red; rc=$?
[ "$rc" = 3 ] && ok || bad "the test run's own rc is kept (rc=$rc)"

# unset: exactly the old behaviour, claude from PATH (here a sentinel-like fake that exits 97)
mkdir -p "$T/bin"; printf '#!/usr/bin/env bash\nexit 97\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
( . "$LIB"; unset AUTOPILOT_MODS_REAL_CLAUDE; PATH="$T/bin:$PATH" mods_run_plugin_test "$T/plug" ) >/dev/null 2>&1; rc=$?
[ "$rc" = 97 ] && ok || bad "unset var must use PATH claude unchanged (rc=$rc)"
( . "$LIB"; AUTOPILOT_MODS_REAL_CLAUDE=/nonexistent/claude PATH="$T/bin:$PATH" mods_run_plugin_test "$T/plug" ) >/dev/null 2>&1; rc=$?
[ "$rc" = 99 ] && ok || bad "a non-executable path must be refused, not fall back to PATH (rc=$rc)"

# end to end through a real runner (viewer): the runner wires the helper and the guard fires there too
VR="${MODS_VIEWER_RUNNER:-$REPO_ROOT/mods/viewer/run-tests.sh}"
AUTOPILOT_MODS_REAL_CLAUDE="$T/cred" bash "$VR" >"$T/e2e.out" 2>"$T/e2e.err" </dev/null; rc=$?
{ [ "$rc" != 0 ] && grep -q 'guard RED' "$T/e2e.err"; } && ok || bad "viewer runner with a credentials-planting fake must go red (rc=$rc)"
AUTOPILOT_MODS_REAL_CLAUDE="$T/clean" bash "$VR" >"$T/e2e2.out" 2>"$T/e2e2.err" </dev/null; rc=$?
[ "$rc" = 0 ] && ok || bad "viewer runner with a clean fake must pass (rc=$rc)"

# leak detector: nothing may have been written into the outer sandbox home/config (the helper overrides HOME and the config dirs)
leak="$(find "$OUTER" -type f 2>/dev/null)"
[ -z "$leak" ] && ok || bad "something leaked into the outer sandbox HOME/config: $leak"

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
