#!/usr/bin/env bash
# lane-ops.test.sh — unit tests for scripts/lane-ops.sh
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/lane-ops.sh"

# 1. --help and usage errors
bash "$SCRIPT" --help >/dev/null 2>&1
assert_eq "0" "$?" "--help exits 0"

bash "$SCRIPT" >/dev/null 2>&1
assert_eq "2" "$?" "no args exits 2"

bash "$SCRIPT" bogus >/dev/null 2>&1
assert_eq "2" "$?" "unknown subcommand exits 2"

# 2. land argument validation and delegation
bash "$SCRIPT" land only-one >/dev/null 2>&1
assert_eq "2" "$?" "land with missing args exits 2"

bash "$SCRIPT" land abc1234 "$TEST_TMP/nonexistent.msg" lbl >/dev/null 2>&1
assert_eq "2" "$?" "land with missing msg-file exits 2"

MSG_FILE="$TEST_TMP/commit.msg"
printf 'feat: test\n' > "$MSG_FILE"
STUB_LAND="$TEST_TMP/stub-land.sh"
cat > "$STUB_LAND" <<'EOF'
#!/usr/bin/env bash
printf 'LAND:%s:%s:%s\n' "$1" "$2" "$3"
EOF
chmod +x "$STUB_LAND"

OUT="$(LANE_OPS_LAND_SCRIPT="$STUB_LAND" bash "$SCRIPT" land abc1234 "$MSG_FILE" my-label 2>&1)"
assert_eq "0" "$?" "land delegates to LANE_OPS_LAND_SCRIPT"
assert_contains "$OUT" "LAND:abc1234:$MSG_FILE:my-label" "land passes sha, msg-file, label"

# 3. dispatch argument validation and delegation
bash "$SCRIPT" dispatch r e m >/dev/null 2>&1
assert_eq "2" "$?" "dispatch with missing args exits 2"

bash "$SCRIPT" dispatch r "" m b base brief 10 >/dev/null 2>&1
assert_eq "2" "$?" "dispatch with empty arg exits 2"

STUB_DISPATCH="$TEST_TMP/stub-dispatch.sh"
cat > "$STUB_DISPATCH" <<'EOF'
#!/usr/bin/env bash
printf 'DISPATCH:%s\n' "$*"
EOF
chmod +x "$STUB_DISPATCH"

LOG_DIR="$TEST_TMP/logs"
mkdir -p "$LOG_DIR"
LANE_OPS_USE_SG=0 LANE_OPS_DISPATCH_BIN="$STUB_DISPATCH" LANE_OPS_LOG_DIR="$LOG_DIR" \
  bash "$SCRIPT" dispatch codex ep1 gpt-6.1 feat/x develop /tmp/brief.md 15
assert_eq "0" "$?" "dispatch delegates to dispatch-hetero"
LOG_FILE="$LOG_DIR/lane-ops-dispatch-feat_x.log"
assert_eq "1" "$([[ -f "$LOG_FILE" ]] && echo 1 || echo 0)" "dispatch writes log file"
LOG_CONTENT="$(cat "$LOG_FILE")"
assert_contains "$LOG_CONTENT" "--runner codex" "dispatch passes --runner"
assert_contains "$LOG_CONTENT" "--branch feat/x" "dispatch passes --branch"
assert_contains "$LOG_CONTENT" "--timeout-min 15" "dispatch passes --timeout-min"

# 4. wait argument validation, fake fleet watch, and bounded fallback
bash "$SCRIPT" wait >/dev/null 2>&1
assert_eq "2" "$?" "wait with no args exits 2"

FAKE_FLEET="$TEST_TMP/fake-fleet"
cat > "$FAKE_FLEET" <<'EOF'
#!/usr/bin/env bash
printf 'FLEET:%s\n' "$*"
EOF
chmod +x "$FAKE_FLEET"

OUT="$(FLEET_BIN="$FAKE_FLEET" LANE_OPS_FORCE_FLEET=1 bash "$SCRIPT" wait "$LOG_FILE" "DONE" 2>&1)"
assert_eq "0" "$?" "wait uses fleet watch when session active"
assert_contains "$OUT" "FLEET:watch --file $LOG_FILE --pattern DONE" "wait invokes fleet watch with file and pattern"

LANE_OPS_WAIT_SECONDS=0 bash "$SCRIPT" wait "$LOG_FILE" "DISPATCH:" >/dev/null 2>&1
assert_eq "0" "$?" "wait bounded fallback finds matching pattern"

# 5. audit subcommand with stubbed test path
STUB_AUDIT_DIR="$TEST_TMP/audits"
mkdir -p "$STUB_AUDIT_DIR"
for t in check-claude-md-inventory.test.sh test-suite-finalize-gate.test.sh check-config-docs.test.sh; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB_AUDIT_DIR/$t"
  chmod +x "$STUB_AUDIT_DIR/$t"
done

OUT="$(LANE_OPS_AUDIT_DIR="$STUB_AUDIT_DIR" bash "$SCRIPT" audit 2>&1)"
assert_eq "0" "$?" "audit exits 0 when all 3 pass"
assert_contains "$OUT" "PASS check-claude-md-inventory.test.sh" "audit prints PASS for inventory"
assert_contains "$OUT" "PASS test-suite-finalize-gate.test.sh" "audit prints PASS for finalize-gate"
assert_contains "$OUT" "PASS check-config-docs.test.sh" "audit prints PASS for config-docs"

printf '#!/usr/bin/env bash\nexit 1\n' > "$STUB_AUDIT_DIR/check-config-docs.test.sh"
OUT="$(LANE_OPS_AUDIT_DIR="$STUB_AUDIT_DIR" bash "$SCRIPT" audit 2>&1)"
assert_eq "1" "$?" "audit exits 1 when one fails"
assert_contains "$OUT" "FAIL check-config-docs.test.sh" "audit prints FAIL for failing test"

finalize_test
