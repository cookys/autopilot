#!/usr/bin/env bash
# Tests for resolve-review-loop.sh review_fresh_context config key (BL-0111).
# on (default) = a reviewer dispatch that would continue an existing session is refused;
# off = legal, stamped on the review receipt (stamp itself is covered in hetero-review-loop.test.sh).
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
seed_dogfood_implementer_pin

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# --- 1: no key in any config -> on (the built-in default) ---
EMPTY="$TEST_TMP/cfg-empty.md"
: > "$EMPTY"
val=$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY" bash "$SCRIPT" --field review_fresh_context 2>/dev/null)
assert_eq "on" "$val" "no config: --field review_fresh_context defaults to on"
json=$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY" bash "$SCRIPT" 2>/dev/null)
assert_contains "$json" '"review_fresh_context": "on"' "no config: JSON carries review_fresh_context=on"

# --- 2: shipped template default is on ---
val=$(grep -E '^- review_fresh_context:' "$REPO_ROOT/project-config-template/review-loop-config.md" | head -1 | sed 's/^- review_fresh_context: *//')
assert_eq "on" "$val" "shipped template sets review_fresh_context: on"

# --- 3: explicit off ---
CFG="$TEST_TMP/cfg-off.md"
printf -- '- review_fresh_context: off\n' > "$CFG"
val=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field review_fresh_context 2>/dev/null)
assert_eq "off" "$val" "explicit off: --field returns off"
json=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" 2>/dev/null)
assert_contains "$json" '"review_fresh_context": "off"' "explicit off: JSON carries off"

# --- 4: garbage -> on (fail-closed) with a named warning ---
CFG="$TEST_TMP/cfg-garbage.md"
printf -- '- review_fresh_context: maybe\n' > "$CFG"
val=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field review_fresh_context 2>/dev/null)
assert_eq "on" "$val" "garbage value falls back to on (fail-closed)"
ERR="$( { REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" >/dev/null; } 2>&1 )"
assert_contains "$ERR" 'review_fresh_context' "garbage value warns on stderr naming the key"

# --- negative control: dropping the validation makes garbage leak through ---
MUTROOT="$TEST_TMP/mut"
mkdir -p "$MUTROOT"
cp -r "$REPO_ROOT/scripts" "$MUTROOT/scripts"
for d in src schemas project-config-template references .claude-plugin; do
  [ -e "$REPO_ROOT/$d" ] && ln -s "$REPO_ROOT/$d" "$MUTROOT/$d"
done
sed_mutate "$MUTROOT/scripts/resolve-review-loop.sh" 's/^  on|off) ;;$/  on|off|maybe) ;;/'
mutval=$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$MUTROOT/scripts/resolve-review-loop.sh" --field review_fresh_context 2>/dev/null)
assert_eq "maybe" "$mutval" "mutation: with the on|off check loosened the garbage value leaks (so test 4 catches a removed check)"

finalize_test
