#!/usr/bin/env bash
# Tests for resolve-review-loop.sh on_engine_unavailable config key.
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# --- Test 1: Default (no config) --field on_engine_unavailable prints ask ---
unset REVIEW_LOOP_CONFIG_OVERRIDE
val=$(bash "$SCRIPT" --field on_engine_unavailable)
assert_eq "ask" "$val" "default --field on_engine_unavailable is ask"

# --- Test 2: Default JSON contains the key and it appears AFTER min_panel_size ---
unset REVIEW_LOOP_CONFIG_OVERRIDE
json=$(bash "$SCRIPT")
assert_contains "$json" '"on_engine_unavailable": "ask"' "default JSON has on_engine_unavailable=ask"
min_pos=$(printf '%s' "$json" | grep -bo '"min_panel_size"' | head -1 | cut -d: -f1)
on_pos=$(printf '%s' "$json" | grep -bo '"on_engine_unavailable"' | head -1 | cut -d: -f1)
if [ -z "$min_pos" ] || [ -z "$on_pos" ]; then
  fail "could not locate min_panel_size (pos=$min_pos) or on_engine_unavailable (pos=$on_pos) in default JSON"
fi
if [ "$on_pos" -le "$min_pos" ]; then
  fail "on_engine_unavailable (byte $on_pos) must appear AFTER min_panel_size (byte $min_pos) in default JSON"
fi

# --- Test 3: Valid override wait-reset ---
CFG="$TEST_TMP/cfg-wait-reset.md"
printf -- '- on_engine_unavailable: wait-reset\n' > "$CFG"
val=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field on_engine_unavailable)
assert_eq "wait-reset" "$val" "wait-reset --field on_engine_unavailable"
json=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT")
assert_contains "$json" '"on_engine_unavailable": "wait-reset"' "wait-reset JSON has on_engine_unavailable=wait-reset"

# --- Test 4: Valid override solo-fallback ---
CFG="$TEST_TMP/cfg-solo.md"
printf -- '- on_engine_unavailable: solo-fallback\n' > "$CFG"
val=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field on_engine_unavailable)
assert_eq "solo-fallback" "$val" "solo-fallback --field on_engine_unavailable"

# --- Test 5: Garbage override falls back to ask with a stderr warning ---
CFG="$TEST_TMP/cfg-yolo.md"
printf -- '- on_engine_unavailable: yolo\n' > "$CFG"
val=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field on_engine_unavailable)
assert_eq "ask" "$val" "garbage override falls back to ask"
ERR="$( { REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" >/dev/null; } 2>&1 )"
assert_contains "$ERR" 'on_engine_unavailable' "garbage override warns on stderr mentioning on_engine_unavailable"
assert_contains "$ERR" 'yolo' "garbage override stderr contains the offending value"
assert_contains "$ERR" 'ask|solo-fallback|wait-reset' "garbage override stderr contains the enum hint"

# --- Test 6: Byte-prefix compat (the key's value must not affect the prefix) ---
CFG_ASK="$TEST_TMP/cfg-ask.md"
printf -- '- on_engine_unavailable: ask\n' > "$CFG_ASK"
json_ask=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ASK" bash "$SCRIPT")

CFG_WR="$TEST_TMP/cfg-wait-reset-compat.md"
printf -- '- on_engine_unavailable: wait-reset\n' > "$CFG_WR"
json_wr=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_WR" bash "$SCRIPT")

prefix_ask=$(printf '%s' "$json_ask" | sed 's/, "on_engine_unavailable":.*//')
prefix_wr=$(printf '%s' "$json_wr" | sed 's/, "on_engine_unavailable":.*//')
assert_eq "$prefix_ask" "$prefix_wr" "prefix before on_engine_unavailable is identical for ask vs wait-reset"

# --- Test 7: Default JSON stays parseable with the new key ---
unset REVIEW_LOOP_CONFIG_OVERRIDE
if ! bash "$SCRIPT" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' >/dev/null 2>&1; then
  fail "default JSON does not parse with node after adding on_engine_unavailable"
fi

finalize_test
