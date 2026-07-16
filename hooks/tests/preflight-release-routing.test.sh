#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROBE_OUT=""
PROBE_RC=0

EVENT_SCHEMA_VERSION=1
RUNNER="claude"
MODEL="probe-model-x"
ROLE="probe"
RUNNER_VERSION="v1.0.0"
EVIDENCE="test"

write_capability_event() {
  local store="$1"
  local status="$2"
  local observed_at
  observed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local ev="$TEST_TMP/ev_$(basename "$store")_${status}.json"
  printf '%s\n' "{\"schema_version\":$EVENT_SCHEMA_VERSION,\"observed_at\":\"$observed_at\",\"runner\":\"$RUNNER\",\"model\":\"$MODEL\",\"role\":\"$ROLE\",\"runner_version\":\"$RUNNER_VERSION\",\"capability\":{\"quota\":{\"status\":\"$status\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"reset_at\":null,\"evidence\":\"$EVIDENCE\"}}}" > "$ev"
  if ! ENGINE_CAPABILITY_DIR="$store" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$ev" > /dev/null; then
    fail "Infrastructure error: seeding capability event failed for store $store status $status"
  fi
}

make_fake_bin() {
  local marker="$1"
  local bin="$TEST_TMP/fake_claude_$(echo "$marker" | md5sum | cut -c1-8)"
  printf '#!/usr/bin/env bash\n' > "$bin"
  printf 'mkdir -p "$(dirname "%s")"\n' "$marker" >> "$bin"
  printf 'touch "%s"\n' "$marker" >> "$bin"
  printf 'exit 0\n' >> "$bin"
  chmod +x "$bin"
  printf '%s' "$bin"
}

run_probe() {
  local store="$1"
  local bin="$2"
  local marker="$3"
  local skip="$4"
  printf '\n=== RUN run_probe store=%s bin=%s skip=%s ===\n' "$store" "$bin" "$skip"
  if [ "$skip" = "1" ]; then
    AUTOPILOT_SKIP_SLASH_PROBE=1 ENGINE_CAPABILITY_DIR="$store" SLASH_PROBE_MODEL="$MODEL" SLASH_PROBE_CLAUDE_BIN="$bin" AUTOPILOT_DISPATCH_MANIFEST=0 SPAWN_MARKER="$marker" bash "$REPO_ROOT/scripts/preflight-release.sh" --only-slash-probe
    PROBE_RC=$?
  else
    ENGINE_CAPABILITY_DIR="$store" SLASH_PROBE_MODEL="$MODEL" SLASH_PROBE_CLAUDE_BIN="$bin" AUTOPILOT_DISPATCH_MANIFEST=0 SPAWN_MARKER="$marker" bash "$REPO_ROOT/scripts/preflight-release.sh" --only-slash-probe
    PROBE_RC=$?
  fi
  printf 'rc=%s\n' "$PROBE_RC"
  printf '=== END RUN ===\n'
}

STORE_EXH="$TEST_TMP/cap_store_exhausted"
STORE_AVAIL="$TEST_TMP/cap_store_available"
STORE_SKIP="$TEST_TMP/cap_store_skip"

mkdir -p "$STORE_EXH" "$STORE_AVAIL" "$STORE_SKIP"

MARKER_EXH="$TEST_TMP/spawn_marker_exhausted"
MARKER_AVAIL="$TEST_TMP/spawn_marker_available"
MARKER_SKIP="$TEST_TMP/spawn_marker_skip"

write_capability_event "$STORE_EXH" "exhausted"
write_capability_event "$STORE_AVAIL" "available"

BIN_EXH="$(make_fake_bin "$MARKER_EXH")"
BIN_AVAIL="$(make_fake_bin "$MARKER_AVAIL")"
BIN_SKIP="$(make_fake_bin "$MARKER_SKIP")"

OUT_EXH="$(run_probe "$STORE_EXH" "$BIN_EXH" "$MARKER_EXH" "0" 2>&1)"
RC_EXH=$PROBE_RC

OUT_AVAIL="$(run_probe "$STORE_AVAIL" "$BIN_AVAIL" "$MARKER_AVAIL" "0" 2>&1)"
RC_AVAIL=$PROBE_RC

OUT_SKIP="$(run_probe "$STORE_SKIP" "$BIN_SKIP" "$MARKER_SKIP" "1" 2>&1)"
RC_SKIP=$PROBE_RC

assert_ne_zero() {
  local label="$1"
  local rc="$2"
  if [ "$rc" -eq 0 ]; then
    fail "Expected nonzero rc for $label, got 0"
  fi
}
assert_eq_zero() {
  local label="$1"
  local rc="$2"
  if [ "$rc" -ne 0 ]; then
    fail "Expected zero rc for $label, got $rc"
  fi
}

assert_ne_zero "P2 exhausted refusal" "$RC_EXH"
assert_contains "P2 output names model" "$OUT_EXH" "probe-model-x"
if ! echo "$OUT_EXH" | grep -qiE "unavailable|exhausted"; then
  fail "P2 output missing unavailable/exhausted: $OUT_EXH"
fi
assert_file_absent "P2 no spawn marker" "$MARKER_EXH"
assert_not_contains "P4 no haiku fallback" "$OUT_EXH" "claude-haiku"
assert_not_contains "P4 no fallback keyword" "$OUT_EXH" "fallback"

assert_eq_zero "P3 available proceeds" "$RC_AVAIL"
assert_file_exists "P3 spawn marker exists" "$MARKER_AVAIL"

if ! echo "$OUT_SKIP" | grep -qiE "SKIPPED|SKIP"; then
  fail "P1 output missing SKIP/SKIPPED: $OUT_SKIP"
fi
assert_file_absent "P1 no spawn marker" "$MARKER_SKIP"

finalize_test