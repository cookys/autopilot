#!/usr/bin/env bash
# mods-real-claude-guard.test.sh -- mods/lib/real-claude-env.sh (AUTOPILOT_MODS_REAL_CLAUDE) with FAKE claude binaries only; the real claude is never run here.
# MODS_REAL_CLAUDE_LIB may point at a mutated copy of the helper to prove each negative control goes red.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${MODS_REAL_CLAUDE_LIB:-$REPO_ROOT/mods/lib/real-claude-env.sh}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

mkdir -p "$T/plug"
fake() { # <name> <body>: a fake claude that records its env, then runs <body>
  printf '#!/usr/bin/env bash\n{ echo "HOME=$HOME"; echo "CCD=$CLAUDE_CONFIG_DIR"; echo "KEY=${ANTHROPIC_API_KEY:-}"; echo "TOK=${CLAUDE_CODE_OAUTH_TOKEN:-}"; echo "ARGS=$*"; } > "%s/%s.env"\n%s\n' "$T" "$1" "$2" > "$T/$1"
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

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
