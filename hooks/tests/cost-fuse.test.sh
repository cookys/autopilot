#!/usr/bin/env bash
# cost-fuse + brain-tier-report tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=hooks/tests/lib.sh
source "$SCRIPT_DIR/lib.sh"

# 1. Retired cost-fuse.js is a silent no-op (never blocks or advises in-session)
PAYLOAD='{"tool_name":"Edit","tool_input":{"file_path":"/tmp/x.js"},"hook_event_name":"PreToolUse"}'
run_hook cost-fuse.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "cost-fuse-noop-exit"
assert_eq "" "$__RUN_STDOUT" "cost-fuse-noop-stdout"

# 2. brain-tier-report.js on fixture data
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
mkdir -p "$TEST_TMP/state" "$TEST_TMP/home/.autopilot"
cat > "$TEST_TMP/costs.jsonl" <<'EOF'
{"ts":"2026-11-22T01:00:00Z","session":"s1","lane":"alpha","model":"claude-opus-4-6","cost_usd":6.0}
{"ts":"2026-11-22T01:05:00Z","session":"s1","lane":"alpha","model":"claude-sonnet-4-6","cost_usd":4.0}
{"ts":"2026-11-22T01:10:00Z","session":"s2","lane":"beta","model":"claude-sonnet-4-6","cost_usd":10.0}
{"ts":"2026-11-21T23:00:00Z","session":"s3","lane":"alpha","model":"claude-opus-4-6","cost_usd":50.0}
EOF
cat > "$TEST_TMP/state/brain-tier-dispatch.jsonl" <<'EOF'
{"ts":"2026-11-22T01:00:00Z","session":"s1","lane":"alpha","model":"opus","reason":null,"allowed":false}
{"ts":"2026-11-22T01:01:00Z","session":"s1","lane":"alpha","model":"opus","reason":"hard judgment","allowed":true}
EOF

OUT_JSON="$(AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl" AUTOPILOT_STATE_DIR="$TEST_TMP/state" HOME="$TEST_TMP/home" node "$REPO_ROOT/scripts/brain-tier-report.js" --day 2026-11-22)"
CHECK_JSON="$(node -e '
  const d = JSON.parse(process.argv[1]);
  if (!d.alpha || d.alpha.brain_usd !== 6 || d.alpha.total_usd !== 10 || d.alpha.brain_share !== 0.6 || d.alpha.opus_without_reason !== 1) process.exit(2);
  if (!d.beta || d.beta.brain_usd !== 0 || d.beta.total_usd !== 10 || d.beta.brain_share !== 0 || d.beta.opus_without_reason !== 0) process.exit(3);
  process.stdout.write("report_ok");
' "$OUT_JSON")"
assert_eq "report_ok" "$CHECK_JSON" "brain-tier-report-day-json"

OUT_OVER="$(AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl" AUTOPILOT_STATE_DIR="$TEST_TMP/state" HOME="$TEST_TMP/home" node "$REPO_ROOT/scripts/brain-tier-report.js" --day 2026-11-22 --over-baseline)"
CHECK_OVER="$(node -e '
  const d = JSON.parse(process.argv[1]);
  if (!d.alpha || d.beta) process.exit(2);
  process.stdout.write("over_ok");
' "$OUT_OVER")"
assert_eq "over_ok" "$CHECK_OVER" "brain-tier-report-over-baseline"

OUT_TEXT="$(AUTOPILOT_COSTS_FILE="$TEST_TMP/costs.jsonl" AUTOPILOT_STATE_DIR="$TEST_TMP/state" HOME="$TEST_TMP/home" node "$REPO_ROOT/scripts/brain-tier-report.js" --day 2026-11-22 --text)"
assert_contains "$OUT_TEXT" "alpha" "brain-tier-report-text-alpha"
assert_contains "$OUT_TEXT" "60.0%" "brain-tier-report-text-share"

finalize_test
