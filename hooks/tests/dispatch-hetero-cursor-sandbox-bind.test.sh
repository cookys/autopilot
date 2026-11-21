#!/usr/bin/env bash
# dispatch-hetero-cursor-sandbox-bind.test.sh — sandbox_setup gives ONLY the cursor runner a writable
# $HOME/.config/cursor (the cursor CLI refreshes its login token there inside the dispatch), mirroring
# the agy-only $HOME/.gemini bind. Extracts current_runner_name + sandbox_setup from the script and
# inspects SANDBOX_ARGV; no bwrap, no cursor CLI. HOME is a mktemp fake.
#   1. cursor + dir exists  -> `--bind <home>/.config/cursor <home>/.config/cursor` (not --ro-bind)
#   2. codex  + dir exists  -> no bind of that dir
#   3. cursor + dir missing -> no bind, setup still succeeds
#   4. agy: still gets .gemini, never .config/cursor
. "$(dirname "$0")/lib.sh"

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/dispatch-hetero.sh"
FNS="$TEST_TMP/fns.sh"
for f in current_runner_name sandbox_setup; do
  awk -v f="$f" '$0 == f "() {" {p=1} p {print} p && $0 == "}" {exit}' "$SCRIPT" >> "$FNS"
done
grep -q '^sandbox_setup() {' "$FNS" || fail "could not extract sandbox_setup"

# argv_for <runner-flag-var> <home>: prints SANDBOX_ARGV one word per line.
argv_for() {
  local flag="$1" home="$2" wt="$TEST_TMP/wt"
  mkdir -p "$wt"
  (
    export HOME="$home" WT="$wt" RUNNER_RESOLVED=1
    [ -n "$flag" ] && export "$flag=1"
    . "$FNS"
    sandbox_setup || { echo "SETUP_FAILED"; exit 0; }
    printf '%s\n' "${SANDBOX_ARGV[@]}"
  )
}

H1="$TEST_TMP/home-present"; mkdir -p "$H1/.config/cursor" "$H1/.gemini"
H2="$TEST_TMP/home-missing"; mkdir -p "$H2"
CUR1="$H1/.config/cursor"

OUT="$(argv_for IS_CURSOR "$H1" | paste -sd' ')"
assert_contains "$OUT" "--bind $CUR1 $CUR1" "cursor: \$HOME/.config/cursor bound writable (--bind)"
assert_not_contains "$OUT" "--ro-bind $CUR1" "cursor: not bound read-only"
assert_not_contains "$OUT" ".gemini" "cursor: no .gemini bind"

OUT="$(argv_for IS_CODEX "$H1" | paste -sd' ')"
assert_not_contains "$OUT" "$CUR1" "codex: .config/cursor not bound"
assert_not_contains "$OUT" "SETUP_FAILED" "codex: setup succeeded"

OUT="$(argv_for IS_CURSOR "$H2" | paste -sd' ')"
assert_not_contains "$OUT" ".config/cursor" "cursor, dir missing: no bind"
assert_not_contains "$OUT" "SETUP_FAILED" "cursor, dir missing: setup still succeeds"
[ ! -e "$H2/.config" ] && ok=1 || ok=0
assert_eq "1" "$ok" "cursor, dir missing: setup did not create it"

OUT="$(argv_for "" "$H1" | paste -sd' ')"
assert_contains "$OUT" "--bind $H1/.gemini $H1/.gemini" "agy: .gemini bound writable"
assert_not_contains "$OUT" ".config/cursor" "agy: no cursor bind"

finalize_test
