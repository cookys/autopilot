#!/usr/bin/env bash
# Pool-aware mechanical routing (fleet 01M883AEHTJWZH95JSY1MSKEFX): on a seat of the
# singularaion account pool the mechanical roles (hands, fast-worker, test-runner) resolve to a
# non-Claude engine (agy, codex A, codex B); judgment roles stay Claude; private lanes never
# resolve to kimi or another Chinese-model engine; the switch OFF restores the old output exactly.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-dispatch.sh"
NOCFG="/dev/null/nonexistent"

# run_pool <env assignments...> bash ...   (sandbox env; never the real config)
run_pool() {
  env -u AUTOPILOT_ACCOUNT -u CLAUDE_CONFIG_DIR -u AUTOPILOT_LANE -u AUTOPILOT_POOL_MECH_ROUTE \
    -u AUTOPILOT_MECH_ROUTE_EXCLUDE -u AUTOPILOT_POOL_MECH_ROUTE_CONFIG \
    MODEL_ROUTING_CONFIG_OVERRIDE="${OVERRIDE_FILE:-$NOCFG}" \
    "$@" 2>&1
}

BASE_HANDS="$(run_pool bash "$SCRIPT" --role hands)"
BASE_FW="$(run_pool bash "$SCRIPT" --role fast-worker)"
BASE_TR="$(run_pool bash "$SCRIPT" --role test-runner)"

# (a) singularaion mechanical roles -> agy / codex
for role in hands fast-worker test-runner; do
  OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion bash "$SCRIPT" --role "$role")"
  assert_contains "$OUT" '"engine":"agy"'        "(a) singularaion $role -> agy"
  assert_contains "$OUT" '"source":"pool-route"' "(a) singularaion $role source pool-route"
  assert_not_contains "$OUT" '"model":"haiku"'   "(a) $role not Claude haiku"
  assert_not_contains "$OUT" '"model":"sonnet"'  "(a) $role not Claude sonnet"
done
OUT="$(run_pool CLAUDE_CONFIG_DIR=/x/.claude-profiles/singularaion bash "$SCRIPT" --role hands)"
assert_contains "$OUT" '"engine":"agy"'          "(a) pool detected from CLAUDE_CONFIG_DIR profile"
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_MECH_ROUTE_EXCLUDE=agy bash "$SCRIPT" --role hands)"
assert_contains "$OUT" '"pool":"codex A"'        "(a) exclude agy -> codex A"
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion "AUTOPILOT_MECH_ROUTE_EXCLUDE=agy,codex A" bash "$SCRIPT" --role hands)"
assert_contains "$OUT" '"pool":"codex B"'        "(a) exclude agy,codex A -> codex B"

# (b) judgment roles stay Claude on singularaion; other pools unchanged
for role in reviewer planner debugger deep-reasoner implementer; do
  BASE="$(run_pool bash "$SCRIPT" --role "$role")"
  OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion bash "$SCRIPT" --role "$role")"
  assert_eq "$BASE" "$OUT" "(b) singularaion $role unchanged (Claude)"
done
OUT="$(run_pool AUTOPILOT_ACCOUNT=stranity bash "$SCRIPT" --role hands)"
assert_eq "$BASE_HANDS" "$OUT"                   "(b) other pool: hands unchanged"
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion bash "$SCRIPT" --role implementer --tree)"
assert_not_contains "$OUT" 'pool-route'          "(b) --tree table never pool-routed"

# (c) private lane never resolves to kimi / Chinese-model engines
for lane in 308 mple2 msn thinksmart alfred; do
  OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_LANE=$lane bash "$SCRIPT" --role hands)"
  case "$OUT" in *'"engine":"agy"'*|*'"engine":"codex"'*) ok=1;; *) ok=0;; esac
  assert_eq "1" "$ok"                            "(c) private lane $lane mechanical -> codex/agy"
  assert_not_contains "$OUT" "kimi"              "(c) private lane $lane no kimi"
done
OVERRIDE_FILE="$TEST_TMP/cn-override.md"
cat > "$OVERRIDE_FILE" <<'CFG'
| Role | Model | Mode |
|------|-------|------|
| hands | kimi-code/k3 | default |
| fast-worker | glm-5.3 | default |
CFG
OUT="$(run_pool AUTOPILOT_LANE=308 bash "$SCRIPT" --role hands)"
assert_not_contains "$OUT" "kimi"                "(c) private lane: override row naming kimi is refused"
OUT="$(run_pool AUTOPILOT_LANE=alfred bash "$SCRIPT" --role fast-worker)"
assert_not_contains "$OUT" "glm"                 "(c) private lane: override row naming glm is refused"
OUT="$(run_pool AUTOPILOT_LANE=autopilot bash "$SCRIPT" --role hands)"
assert_contains "$OUT" "kimi-code/k3"            "(c) non-private lane keeps the override row"
unset OVERRIDE_FILE

# (d) switch OFF restores current behaviour exactly
for role in hands fast-worker test-runner; do
  OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_POOL_MECH_ROUTE=0 bash "$SCRIPT" --role "$role")"
  case "$role" in hands) B="$BASE_HANDS";; fast-worker) B="$BASE_FW";; *) B="$BASE_TR";; esac
  assert_eq "$B" "$OUT"                          "(d) switch off: $role identical to unrouted output"
done
echo '{"enabled":false}' > "$TEST_TMP/off.json"
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_POOL_MECH_ROUTE_CONFIG="$TEST_TMP/off.json" bash "$SCRIPT" --role hands)"
assert_eq "$BASE_HANDS" "$OUT"                   "(d) config enabled:false: identical to unrouted output"

# (e) the routed output still passes through the data-class gate (finish_ok)
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion bash "$SCRIPT" --role hands --data-class transcript)"; EC=$?
assert_eq "0" "$EC"                              "(e) routed + allowed data class: exit 0"
assert_contains "$OUT" '"source":"pool-route"'   "(e) routed + allowed data class: still routed"
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion bash "$SCRIPT" --role hands --data-class bogus)"; EC=$?
assert_eq "3" "$EC"                              "(e) routed + unknown data class: refused exit 3"
assert_not_contains "$OUT" '"engine"'            "(e) refused routed output prints no JSON"
cat > "$TEST_TMP/cn-route.json" <<'CFG'
{"enabled":true,"pools":["singularaion"],"roles":["hands"],"engines":[{"engine":"kimi","pool":"kimi","runner":"kimi","model":"kimi-code/k3"}],"private_lanes":[],"private_allowed_engines":["codex","agy","claude"],"private_barred_model_pattern":"kimi"}
CFG
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_POOL_MECH_ROUTE_CONFIG="$TEST_TMP/cn-route.json" bash "$SCRIPT" --role hands --data-class transcript)"; EC=$?
assert_eq "3" "$EC"                              "(e) routed Chinese-model engine + transcript: gate refuses (exit 3)"
OUT="$(run_pool AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_POOL_MECH_ROUTE_CONFIG="$TEST_TMP/cn-route.json" bash "$SCRIPT" --role hands)"; EC=$?
assert_eq "0" "$EC"                              "(e) same config without data class: not gated"

finalize_test
