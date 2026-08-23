#!/usr/bin/env bash
# negative-controls.sh — evidence reproducer for the test-integrity coverage ship.
#
# Answers ONE question: does `check-test-integrity.sh` actually catch a gaming
# implementer on THIS repo's test surface, and did it fail to before?
#
# For each of four gaming moves it runs the gate three ways over the same commit:
#   BEFORE  — origin/develop toolchain + the generic template config (status quo)
#   AFTER   — this branch's toolchain + .claude/test-integrity-config.md (warn)
#   BLOCK   — same, with mode flipped to block, to prove the gate CAN exit 1
#
# It never touches the real repo working tree, ~/.autopilot, or any real store:
# every run happens in a throwaway git repo under $TMPDIR.
#
# Usage: bash docs/projects/2026-08-23-test-integrity-coverage/evidence/negative-controls.sh
# Exit 0 if every control behaved as recorded in RESULTS.md; non-zero otherwise.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BASE_REF="${NEGCTL_BASE_REF:-origin/develop}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/test-integrity-negctl.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

FAILURES=0
note() { printf '%s\n' "$*"; }
expect() { # expect <label> <actual> <wanted>
  if [ "$2" = "$3" ]; then
    printf '    ok   %-46s %s\n' "$1" "$2"
  else
    printf '    FAIL %-46s got=%s want=%s\n' "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}

# ── toolchains ───────────────────────────────────────────────────────────────
mk_toolchain() { # mk_toolchain <dir> <ref|WORKTREE>
  local dir="$1" ref="$2"
  mkdir -p "$dir/scripts/lib"
  if [ "$ref" = "WORKTREE" ]; then
    cp "$REPO_ROOT/scripts/check-test-integrity.sh" "$dir/scripts/"
    cp "$REPO_ROOT/scripts/lib/test-integrity-l1.py" "$dir/scripts/lib/"
  else
    git -C "$REPO_ROOT" show "$ref:scripts/check-test-integrity.sh" >"$dir/scripts/check-test-integrity.sh"
    git -C "$REPO_ROOT" show "$ref:scripts/lib/test-integrity-l1.py" >"$dir/scripts/lib/test-integrity-l1.py"
  fi
}
TOOL_OLD="$WORK/tool-old"; mk_toolchain "$TOOL_OLD" "$BASE_REF"
TOOL_NEW="$WORK/tool-new"; mk_toolchain "$TOOL_NEW" WORKTREE

CFG_NEW="$REPO_ROOT/.claude/test-integrity-config.md"
CFG_BLOCK="$WORK/config-block.md"
sed 's/^mode: warn$/mode: block/' "$CFG_NEW" >"$CFG_BLOCK"
grep -q '^mode: block$' "$CFG_BLOCK" || { echo "could not build block-mode config"; exit 2; }

# ── fixture repo ─────────────────────────────────────────────────────────────
FIX="$WORK/fixture"
mkdir -p "$FIX/hooks/tests" "$FIX/project-config-template" "$FIX/.claude"
git -C "$FIX" init -q
git -C "$FIX" config user.email negctl@example.invalid
git -C "$FIX" config user.name negctl

# The template config is what the engine falls back to when a repo has no
# .claude/test-integrity-config.md — i.e. exactly autopilot's state before this
# ship. Copy the REAL one so BEFORE is the real status quo, not a mock of it.
cp "$REPO_ROOT/project-config-template/test-integrity-config.md" "$FIX/project-config-template/"
# A suite shaped like this repo's 260 real *.test.sh files.
cat >"$FIX/hooks/tests/example.test.sh" <<'SUITE'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

out="$(printf 'alpha beta')"
assert_eq "$out" "alpha beta" "payload is rendered verbatim"
assert_contains "$out" "alpha" "payload carries the alpha token"
assert_exit_code 0 0 "command exits clean"
assert_eq "$(printf '2')" "2" "counter increments once"

finalize_test
SUITE
cat >"$FIX/hooks/tests/lib.sh" <<'LIB'
assert_eq() { [ "$1" = "$2" ] || { echo "FAIL: $3"; exit 1; }; }
assert_contains() { case "$1" in *"$2"*) ;; *) echo "FAIL: $3"; exit 1;; esac; }
assert_exit_code() { [ "$1" = "$2" ] || { echo "FAIL: $3"; exit 1; }; }
finalize_test() { echo "PASS"; }
LIB
git -C "$FIX" add -A
git -C "$FIX" commit -qm "fixture base (no .claude config — pre-ship state)"
git -C "$FIX" tag base-noconfig

# A second base that carries the new config, since the engine reads config from
# the BASE commit's blob.
cp "$CFG_NEW" "$FIX/.claude/test-integrity-config.md"
git -C "$FIX" add -A
git -C "$FIX" commit -qm "adopt .claude/test-integrity-config.md"
git -C "$FIX" tag base-config

# ── runner ───────────────────────────────────────────────────────────────────
LAST_JSON=""
LAST_EXIT=0
run_gate() { # run_gate <toolchain> <base-tag> [config-override]
  local tool="$1" base="$2" override="${3:-}"
  local args=(validate --no-l1 --range "$base..HEAD" --repo "$FIX")
  if [ -n "$override" ]; then
    args+=(--allow-env-config)
    export TEST_INTEGRITY_CONFIG_OVERRIDE="$override"
  else
    unset TEST_INTEGRITY_CONFIG_OVERRIDE
  fi
  LAST_EXIT=0
  LAST_JSON="$(bash "$tool/scripts/check-test-integrity.sh" "${args[@]}" 2>&1)" || LAST_EXIT=$?
  unset TEST_INTEGRITY_CONFIG_OVERRIDE
}
jq_get() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1]))' "$1" <<<"$LAST_JSON" 2>/dev/null || echo "?"; }
matched() { jq_get 'd["test_paths_matched"]'; }
kinds()   { jq_get 'sorted({v["kind"] for v in d["violations"]}) or []' | tr -d "[]' "; }
okflag()  { jq_get 'str(d["ok"]).lower()'; }

reset_to() { git -C "$FIX" checkout -q "$1"; git -C "$FIX" reset -q --hard "$1"; git -C "$FIX" clean -qfd; }

# control <name> <mutation-fn> <expected-after-kinds>
control() {
  local name="$1" mutate="$2" want_kinds="$3"
  note ""
  note "── control: $name"

  reset_to base-noconfig
  "$mutate"
  git -C "$FIX" add -A
  git -C "$FIX" commit -qm "$name"
  run_gate "$TOOL_OLD" base-noconfig
  note "  BEFORE (develop toolchain + template config)"
  note "    source=$(jq_get 'd["source"]') matched=$(matched) ok=$(okflag) kinds=[$(kinds)] exit=$LAST_EXIT"
  expect "BEFORE test_paths_matched" "$(matched)" "0"
  expect "BEFORE violations" "[$(kinds)]" "[]"
  expect "BEFORE exit" "$LAST_EXIT" "0"

  reset_to base-config
  "$mutate"
  git -C "$FIX" add -A
  git -C "$FIX" commit -qm "$name"
  run_gate "$TOOL_NEW" base-config
  note "  AFTER (this branch + .claude/test-integrity-config.md, warn)"
  note "    source=$(jq_get 'd["source"]') matched=$(matched) ok=$(okflag) kinds=[$(kinds)] exit=$LAST_EXIT"
  expect "AFTER  test_paths_matched" "$(matched)" "1"
  expect "AFTER  violation kinds" "[$(kinds)]" "[$want_kinds]"

  run_gate "$TOOL_NEW" base-config "$CFG_BLOCK"
  note "  BLOCK (same config, mode: block) -> exit=$LAST_EXIT ok=$(okflag)"
  expect "BLOCK  exit code" "$LAST_EXIT" "1"
  expect "BLOCK  ok" "$(okflag)" "false"
}

m_delete_assertions() {
  grep -v 'assert_contains\|counter increments once' "$FIX/hooks/tests/example.test.sh" \
    >"$FIX/hooks/tests/example.test.sh.new"
  mv "$FIX/hooks/tests/example.test.sh.new" "$FIX/hooks/tests/example.test.sh"
}
m_weaken_assertion() {
  sed -i 's|^assert_eq "\$out" "alpha beta" .*$|true|' "$FIX/hooks/tests/example.test.sh"
}
m_add_skip() {
  # Pure addition: no deleted lines at all, so this control isolates skip
  # detection from the language-agnostic deleted_line check.
  sed -i '2a skip "flaky on CI"' "$FIX/hooks/tests/example.test.sh"
}
m_delete_file() {
  git -C "$FIX" rm -q "hooks/tests/example.test.sh"
}

note "toolchain BEFORE = $BASE_REF ($(git -C "$REPO_ROOT" rev-parse --short "$BASE_REF"))"
note "toolchain AFTER  = worktree"

control "delete assertions from a *.test.sh suite" m_delete_assertions "deleted_line"
control "weaken an assertion (assert_eq -> true)"  m_weaken_assertion  "deleted_line"
control "add a skip to a suite (pure addition)"    m_add_skip          "skip_marker"
control "delete an entire test file"               m_delete_file       "deleted_line"

# ── extra: attribute the skip control to the engine change, not the config ───
note ""
note "── attribution: which change catches the added skip, config or engine?"
reset_to base-config
m_add_skip
git -C "$FIX" add -A
git -C "$FIX" commit -qm "add skip (attribution)"
run_gate "$TOOL_OLD" base-config
note "    new config + OLD engine : matched=$(matched) kinds=[$(kinds)]"
# The old engine cannot even PARSE a config that declares test_paths: its
# `##`-heading branch sat below the generic `#`-comment skip and was therefore
# unreachable, so every `- <glob>` line landed with section=None and tripped
# "Unrecognized config line" -> malformed_config -> silent fallback to the
# built-in ecosystem defaults (which still match nothing here, hence matched=0).
# That is the finding: the gate's test_paths surface had never been usable by
# any project, and no test had ever exercised it.
expect "old engine rejects a test_paths config" "[$(kinds)]" "[malformed_config]"
expect "old engine still matches nothing"       "$(matched)" "0"
run_gate "$TOOL_NEW" base-config
note "    new config + NEW engine : matched=$(matched) kinds=[$(kinds)]"
expect "new config + new engine kinds" "[$(kinds)]" "[skip_marker]"

# ── extra: the documented gap, asserted rather than assumed ─────────────────
note ""
note "── documented gap: early exit inserted mid-suite is NOT detected"
reset_to base-config
sed -i '3a exit 0' "$FIX/hooks/tests/example.test.sh"
git -C "$FIX" add -A
git -C "$FIX" commit -qm "early exit"
run_gate "$TOOL_NEW" base-config
note "    matched=$(matched) kinds=[$(kinds)]  <- deliberately empty; see config comments"
expect "early-exit gap is real" "[$(kinds)]" "[]"

note ""
if [ "$FAILURES" -eq 0 ]; then
  note "ALL CONTROLS BEHAVED AS RECORDED"
else
  note "$FAILURES EXPECTATION(S) DIVERGED FROM RESULTS.md"
fi
exit $((FAILURES > 0))
