#!/usr/bin/env bash
# hooks/tests/run-eval-batch-isolation.test.sh — tests per-arm plugin isolation and baseline-contamination selftest.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/run-eval-batch.sh"

# 1. Test Clean Baseline
# In a clean baseline, the runner reports no loaded plugins for baseline arm (ARM_PLUGIN_DIR is empty)
CLEAN_STUB="$TEST_TMP/clean_stub_runner.sh"
cat << 'EOF' > "$CLEAN_STUB"
#!/usr/bin/env bash
# Mock JSON to stdout
echo '{"summary": {"passed": 1, "total": 1}}'

# Mock log to stderr
if [[ -n "${ARM_PLUGIN_DIR:-}" ]]; then
  echo "[runner] Loaded plugins: [$(basename "$ARM_PLUGIN_DIR")]" >&2
else
  echo "[runner] Loaded plugins: []" >&2
fi
exit 0
EOF
chmod +x "$CLEAN_STUB"

# Run scripts/run-eval-batch.sh --selftest with RUN_EVAL_CMD pointing to the clean stub
export RUN_EVAL_CMD="$CLEAN_STUB"
OUT=$("$SCRIPT" --selftest 2>&1); EXIT=$?
assert_eq "0" "$EXIT" "Clean baseline selftest should pass (exit 0)"
assert_contains "$OUT" "baseline arm is clean" "Clean baseline output message"

# 2. Test Contaminated Baseline
# In a contaminated baseline, the runner reports loaded plugins even for baseline arm
CONTAMINATED_STUB="$TEST_TMP/contaminated_stub_runner.sh"
cat << 'EOF' > "$CONTAMINATED_STUB"
#!/usr/bin/env bash
echo '{"summary": {"passed": 1, "total": 1}}'

if [[ -n "${ARM_PLUGIN_DIR:-}" ]]; then
  echo "[runner] Loaded plugins: [$(basename "$ARM_PLUGIN_DIR")]" >&2
else
  # Contaminated! Reports loading a plugin in the baseline arm
  echo "[runner] Loaded plugins: [contaminated-plugin-hook]" >&2
fi
exit 0
EOF
chmod +x "$CONTAMINATED_STUB"

export RUN_EVAL_CMD="$CONTAMINATED_STUB"
OUT=$("$SCRIPT" --selftest 2>&1); EXIT=$?
assert_eq "1" "$EXIT" "Contaminated baseline selftest should fail (exit 1)"
assert_contains "$OUT" "ERROR: Baseline arm loaded plugins: contaminated-plugin-hook" "Contaminated baseline error message"

finalize_test
