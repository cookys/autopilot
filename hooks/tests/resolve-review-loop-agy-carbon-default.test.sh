#!/usr/bin/env bash
# The agy reviewer default resolves to gemini-4-carbon-high, and the existing
# reviewer_cloud_fallback_rung (empty in the config) is filled with
# gemini-4-argon-high/high@agy. The roster loop reviewer stays the local qwen
# and its rung stays gpt-6.1-sol/high@codex. The roster qc google seat is carbon-high.
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR AUTOPILOT_QUALIFICATION_OVERRIDE
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

jget() {
  node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=d[process.argv[1]];process.stdout.write(v===undefined?"":(typeof v==="string"?v:JSON.stringify(v)));' "$1"
}

CFG="$TEST_TMP/agy-reviewer.md"
cat > "$CFG" <<'EOF'
- override: reviewer | until 2099-01-01 | agy carbon default
- reviewer_engine: gemini-flash
- reviewer_runner: agy
- reviewer_effort: high
EOF
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" 2>"$TEST_TMP/agy.err")"
RC=$?
assert_eq "$RC" "0" "agy reviewer default resolves (exit 0)"
assert_eq "$(printf '%s' "$OUT" | jget reviewer_engine)" "gemini-4-carbon-high" \
  "agy reviewer default (gemini-flash) resolves to carbon-high"
assert_eq "$(printf '%s' "$OUT" | jget reviewer_runner)" "agy" "runner stays agy"
assert_eq "$(printf '%s' "$OUT" | jget reviewer_effort)" "high" "effort stays high"
assert_eq "$(printf '%s' "$OUT" | jget reviewer_cloud_fallback_rung)" \
  '{"engine":"gemini-4-argon-high","effort":"high","runner":"agy"}' \
  "empty rung is filled with argon-high@agy"
assert_eq "$(printf '%s' "$OUT" | jget reviewer_on_engine_unavailable)" "cloud-fallback" \
  "empty reviewer policy becomes cloud-fallback so the existing retreat uses the rung"
assert_eq "$(printf '%s' "$OUT" | jget on_engine_unavailable)" "ask" \
  "global on_engine_unavailable stays ask"

# An explicit rung is not replaced. A different-family rung still passes the family check.
KEEP="$TEST_TMP/agy-reviewer-keep.md"
cat > "$KEEP" <<'EOF'
- override: reviewer | until 2099-01-01 | keep an explicit rung
- reviewer_engine: gemini-flash
- reviewer_runner: agy
- reviewer_effort: high
- reviewer_cloud_fallback_rung: gpt-6.1-sol/high@codex
- reviewer_on_engine_unavailable: cloud-fallback
EOF
KEEP_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$KEEP" bash "$SCRIPT" 2>"$TEST_TMP/keep.err")"
KEEP_RC=$?
assert_eq "$KEEP_RC" "0" "explicit rung still resolves"
assert_eq "$(printf '%s' "$KEEP_OUT" | jget reviewer_engine)" "gemini-4-carbon-high" \
  "alias still normalizes when a rung is explicit"
assert_eq "$(printf '%s' "$KEEP_OUT" | jget reviewer_cloud_fallback_rung)" \
  '{"engine":"gpt-6.1-sol","effort":"high","runner":"codex"}' \
  "an explicit rung is not overwritten with argon"

# Roster: qc google seat is carbon-high; the qwen reviewer's rung is unchanged.
STUB="$TEST_TMP/stub.md"
printf '# stub\n\n- loop_max_rounds: 5\n' > "$STUB"
STUB_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$STUB" bash "$SCRIPT" 2>/dev/null)"
STUB_RC=$?
assert_eq "$STUB_RC" "0" "roster stub resolves"
assert_eq "$(printf '%s' "$STUB_OUT" | jget reviewer_engine)" "Qwen3.8-27B-QUASAR-NVFP4" \
  "roster loop reviewer stays the local qwen"
assert_eq "$(printf '%s' "$STUB_OUT" | jget reviewer_cloud_fallback_rung)" \
  '{"engine":"gpt-6.1-sol","effort":"high","runner":"codex"}' \
  "qwen reviewer_cloud_fallback_rung stays gpt-6.1-sol/high@codex"
assert_eq "$(printf '%s' "$STUB_OUT" | jget qc_panel)" \
  '["gpt-6-astra","gpt-6.1-sol","GLM-5.3","gemini-4-carbon-high"]' \
  "roster qc google seat is carbon-high"

# agy implementer carbon-low, ladder left empty: rung 0 is carbon-low, rung 1 is argon-low.
IMPL="$TEST_TMP/agy-impl.md"
cat > "$IMPL" <<'EOF'
- override: implementer | until 2099-01-01 | agy carbon implementer
- implementer_engine: gemini-4-carbon-low
- implementer_runner: agy
- implementer_effort: low
EOF
IMPL_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$IMPL" bash "$SCRIPT" 2>"$TEST_TMP/impl.err")"
IMPL_RC=$?
assert_eq "$IMPL_RC" "0" "agy carbon implementer resolves"
assert_eq "$(printf '%s' "$IMPL_OUT" | jget implementer_ladder)" \
  '[{"engine":"gemini-4-carbon-low","effort":"low","runner":"agy"},{"engine":"gemini-4-argon-low","effort":"low","runner":"agy"}]' \
  "empty implementer ladder climbs from carbon-low to argon-low"

finalize_test
