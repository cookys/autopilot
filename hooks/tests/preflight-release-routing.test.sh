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
    PROBE_OUT=$( AUTOPILOT_SKIP_SLASH_PROBE=1 ENGINE_CAPABILITY_DIR="$store" SLASH_PROBE_MODEL="$MODEL" SLASH_PROBE_CLAUDE_BIN="$bin" AUTOPILOT_DISPATCH_MANIFEST=0 SPAWN_MARKER="$marker" bash "$REPO_ROOT/scripts/preflight-release.sh" --only-slash-probe 2>&1 )
    PROBE_RC=$?
    printf '%s\n' "$PROBE_OUT"
    printf 'rc=%s\n' "$PROBE_RC"
  else
    PROBE_OUT=$( ENGINE_CAPABILITY_DIR="$store" SLASH_PROBE_MODEL="$MODEL" SLASH_PROBE_CLAUDE_BIN="$bin" AUTOPILOT_DISPATCH_MANIFEST=0 SPAWN_MARKER="$marker" bash "$REPO_ROOT/scripts/preflight-release.sh" --only-slash-probe 2>&1 )
    PROBE_RC=$?
    printf '%s\n' "$PROBE_OUT"
    printf 'rc=%s\n' "$PROBE_RC"
  fi
  printf '%s\n' "$PROBE_OUT" > "$TEST_TMP/probe_out.txt"
  printf '%s' "$PROBE_RC" > "$TEST_TMP/probe_rc.txt"
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

run_probe "$STORE_EXH" "$BIN_EXH" "$MARKER_EXH" "0"
OUT_EXH=$(cat "$TEST_TMP/probe_out.txt"); RC_EXH=$(cat "$TEST_TMP/probe_rc.txt")

run_probe "$STORE_AVAIL" "$BIN_AVAIL" "$MARKER_AVAIL" "0"
OUT_AVAIL=$(cat "$TEST_TMP/probe_out.txt"); RC_AVAIL=$(cat "$TEST_TMP/probe_rc.txt")

run_probe "$STORE_SKIP" "$BIN_SKIP" "$MARKER_SKIP" "1"
OUT_SKIP=$(cat "$TEST_TMP/probe_out.txt"); RC_SKIP=$(cat "$TEST_TMP/probe_rc.txt")

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
assert_contains "$OUT_EXH" "probe-model-x" "P2 output names model"
if ! echo "$OUT_EXH" | grep -qiE "unavailable|exhausted"; then
  fail "P2 output missing unavailable/exhausted: $OUT_EXH"
fi
assert_file_absent "$MARKER_EXH" "P2 no spawn marker"
assert_not_contains "$OUT_EXH" "claude-haiku" "P4 no haiku fallback"
assert_not_contains "$OUT_EXH" "fallback" "P4 no fallback keyword"

assert_file_exists "$MARKER_AVAIL" "P3 spawn marker exists"

if ! echo "$OUT_SKIP" | grep -qiE "SKIPPED|SKIP"; then
  fail "P1 output missing SKIP/SKIPPED: $OUT_SKIP"
fi
assert_file_absent "$MARKER_SKIP" "P1 no spawn marker"

# North-star prose growth must be justified in the current canonical version's
# section. Exercise the real check with deterministic surface measurements.
PREFLIGHT_SCRIPT="$REPO_ROOT/scripts/preflight-release.sh"
eval "$(sed -n '/^changelog_version_section()/,/^}$/p' "$PREFLIGHT_SCRIPT")"
eval "$(sed -n '/^current_changelog_has_justification()/,/^}$/p' "$PREFLIGHT_SCRIPT")"
eval "$(sed -n '/^check_north_star()/,/^}$/p' "$PREFLIGHT_SCRIPT")"
# check_north_star tail-calls this (added by 435cdc27, v2.34.18). Extracting the REAL
# function rather than stubbing it keeps the coupling visible — stubbing is what would
# have let this break silently in the first place.
eval "$(sed -n '/^check_per_skill_ratchet()/,/^}$/p' "$PREFLIGHT_SCRIPT")"

NORTH_STAR_FIXTURE="$TEST_TMP/north-star"
mkdir -p "$NORTH_STAR_FIXTURE"
printf '{"version":"9.9.8","prose":100,"engine":10}\n' > "$NORTH_STAR_FIXTURE/baseline.json"

run_north_star() {
  local prose="$1"
  (
    cd "$NORTH_STAR_FIXTURE" || exit 1
    VERSION="9.9.9"
    CHANGELOG="CHANGELOG.md"
    SURFACE_BASELINE="baseline.json"
    TEST_SURF_PROSE="$prose"
    measure_surface() {
      SURF_PROSE="$TEST_SURF_PROSE"
      SURF_ENGINE=11
    }
    check_north_star
  ) >/dev/null 2>&1
}

cat > "$NORTH_STAR_FIXTURE/CHANGELOG.md" <<'CHANGELOG'
## v9.9.9

- Current release without a growth explanation.

## v9.9.8

- prose-justification: historical growth only.
CHANGELOG
run_north_star 106
assert_eq "$?" "1" "north-star rejects justification found only in a historical version"

cat > "$NORTH_STAR_FIXTURE/CHANGELOG.md" <<'CHANGELOG'
## v9.9.9

- prose-justification: current release needs the additional methodology text.

## v9.9.8

- Older release.
CHANGELOG
run_north_star 106
assert_eq "$?" "0" "north-star accepts justification in the current version section"

cat > "$NORTH_STAR_FIXTURE/CHANGELOG.md" <<'CHANGELOG'
## v9.9.9

- No justification required at or below the threshold.
CHANGELOG
run_north_star 105
assert_eq "$?" "0" "north-star preserves the under-threshold path"

finalize_test
