#!/usr/bin/env bash
# run-summary-skip.test.sh — hooks/tests/run.sh's Summary must surface `SKIP [suite]` lines.
#
# A suite that runs but asserts nothing (mission-terminal-rollover in a registry-less clone)
# prints `SKIP [suite] VACUOUS RUN ...` and exits 0. The line sits mid-output; the Summary used
# to print only "ALL TESTS PASSED", so the vacuous run was invisible there. The runner is
# exercised from a scratch tree (its REPO_ROOT derives from its own path) holding one fake suite.
# Negative control: a suite WITHOUT a SKIP line must not produce the warning block.
. "$(dirname "$0")/lib.sh"

RUN_SRC="$REPO_ROOT/hooks/tests/run.sh"
SCR="$TEST_TMP/scratch"
mkdir -p "$SCR/hooks/tests"
cp "$RUN_SRC" "$SCR/hooks/tests/run.sh"
cp -r "$REPO_ROOT/hooks/tests/lib" "$SCR/hooks/tests/lib"
mkdir -p "$SCR/scripts"
cp -r "$REPO_ROOT/scripts/lib" "$SCR/scripts/lib"
git init -q "$SCR"
git -C "$SCR" -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m init

cat >"$SCR/hooks/tests/fake-vacuous.test.sh" <<'EOT'
#!/usr/bin/env bash
printf 'SKIP [fake-vacuous] VACUOUS RUN - no assertion executed: nothing to act on\n'
exit 0
EOT
chmod +x "$SCR/hooks/tests/fake-vacuous.test.sh" "$SCR/hooks/tests/run.sh"

run_mode() {
  # $@ = extra run.sh args (may be empty)
  (cd "$SCR" && AUTOPILOT_TEST_DURATIONS_FILE="$TEST_TMP/dur.tsv" bash hooks/tests/run.sh "$@" fake- 2>&1)
}

OUT="$(run_mode)"; RC=$?
assert_eq "$RC" "0" "serial: run.sh exits 0 (a vacuous suite is still exit 0)"
SUMMARY="$(printf '%s\n' "$OUT" | sed -n '/Summary/,$p')"
assert_contains "$SUMMARY" "fake-vacuous.test.sh: SKIP [fake-vacuous]" "serial: Summary names the SKIPped suite"

OUT="$(run_mode --parallel 1)"; RC=$?
assert_eq "$RC" "0" "parallel: run.sh exits 0"
SUMMARY="$(printf '%s\n' "$OUT" | sed -n '/Summary/,$p')"
assert_contains "$SUMMARY" "fake-vacuous.test.sh: SKIP [fake-vacuous]" "parallel: Summary names the SKIPped suite"

# Negative control: no SKIP line => no warning block.
cat >"$SCR/hooks/tests/fake-vacuous.test.sh" <<'EOT'
#!/usr/bin/env bash
echo "PASS: real assertion"
exit 0
EOT
OUT="$(run_mode)"
SUMMARY="$(printf '%s\n' "$OUT" | sed -n '/Summary/,$p')"
assert_not_contains "$SUMMARY" "reported a SKIP" "control: a suite with no SKIP adds no warning"

finalize_test "run-summary-skip"
