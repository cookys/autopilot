#!/usr/bin/env bash
# A `key:` line that sits inside an HTML comment of review-loop-config.md must NOT be read as a
# setting. Before the fix every reader grepped line by line with no comment awareness, so a
# multi-line explanatory <!-- ... --> that spelled out `- reviewer_engine: x` (or `qc_panel: ...`)
# was parsed as a real setting and, being earlier in the file, won over the real line below it.
# Hangar hit it as `qc_panel_seats_complete=false (length 5 != 2)` (2026-09-19, harvested 2026-10).
# Negative control: the decoy sits BEFORE the real value; if the comment is honoured the decoy wins.
# RED at 086168637: 3 of 4 asserts failed — explicit-field printed bogus-from-comment, read_field printed 99, inline comment stayed in the value.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-such-topology.json"

CFG="$TEST_TMP/commented-decoy.md"
cat > "$CFG" <<'CFGEOF'
<!--
Notes for the next editor. Do not write these as settings:
- reviewer_engine: bogus-from-comment
- loop_max_rounds: 99
-->
- reviewer_engine: real-engine
- loop_max_rounds: 4
CFGEOF

run_field() {
  REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field "$1" 2>/dev/null
}

assert_eq "$(run_field reviewer_engine)" "real-engine" \
  "explicit-field reader ignores a decoy key inside an HTML comment"
assert_eq "$(run_field loop_max_rounds)" "4" \
  "read_field reader ignores a decoy key inside an HTML comment"

# A comment on one line, with the real value outside it, still parses; the comment text is dropped.
CFG2="$TEST_TMP/inline-comment.md"
printf -- '- reviewer_engine: real-engine <!-- reviewer_engine: nope -->\n' > "$CFG2"
CFG="$CFG2"
assert_eq "$(run_field reviewer_engine)" "real-engine" \
  "an inline trailing comment is not part of the value"

# Preservation: a config with no comments is read exactly as before.
CFG3="$TEST_TMP/plain.md"
printf -- '- reviewer_engine: plain-engine\n' > "$CFG3"
CFG="$CFG3"
assert_eq "$(run_field reviewer_engine)" "plain-engine" "plain config unchanged"

finalize_test
