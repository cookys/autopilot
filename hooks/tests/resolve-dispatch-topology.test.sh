#!/usr/bin/env bash
# resolve-dispatch-topology.test.sh — integration test for resolve-dispatch-topology.js
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-dispatch-topology.js"

# Create scratch PATH with fake agy executable, and ensure codex is absent
FAKE_BIN_DIR="$TEST_TMP/fake-bin"
mkdir -p "$FAKE_BIN_DIR"
cat > "$FAKE_BIN_DIR/agy" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '1.1.10\n'
  exit 0
fi
exit 0
STUB
chmod +x "$FAKE_BIN_DIR/agy"

# Ensure PATH has fake agy and NO codex
export PATH="$FAKE_BIN_DIR:/usr/bin:/bin"

# Test scratch dirs for store redirection
FIXTURE_STORE_DIR="$TEST_TMP/fixture-store"
mkdir -p "$FIXTURE_STORE_DIR"

TOPOLOGY_OUT="$TEST_TMP/topology.json"

# Helper to write a scorecard row
write_scorecard_row() {
  local engine="$1"
  local runner="$2"
  local effort="$3"
  local latency="$4"
  local status="$5"
  local event_id="${6:-100}"
  local role="${7:-implementer}"
  local family="${8:-test-family}"
  local cost="${9:-null}"

  node - "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$engine" "$runner" "$effort" "$latency" "$status" "$event_id" "$role" "$family" "$cost" <<'NODE'
const fs = require('fs');
const [file, engine, runner, effort, latency, status, eventId, role, family, costRaw] = process.argv.slice(2);
const row = {
  engine,
  runner,
  family,
  role,
  model_version: '1.0',
  version_source: 'runtime',
  corpus_version: '1.0',
  harness_version: '1.0',
  runner_version: '1.1.10',
  prompt_config_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  date: '2026-08-01',
  quality: 0.95,
  capability_score: 0.95,
  status,
  admission_status: status,
  latency: { sample_wall_time_s: Number(latency) },
  event_id: Number(eventId),
  baseline_event_id: Number(eventId),
  qualified_at: '2026-08-01T00:00:00.000Z',
};
if (effort && effort !== '') {
  row.effort = effort;
}
if (costRaw && costRaw !== 'null') {
  row.cost = Number(costRaw);
}
fs.appendFileSync(file, JSON.stringify(row) + '\n');
NODE
}

# -----------------------------------------------------------------------------
# Case 1: Two qualified seats (one low effort, one high effort) plus one
# provisional/unqualified. Ladder contains exactly the two qualified seats,
# low rung first; candidates_to_qualify lists only installed-but-unqualified
# runners (not codex, since it's not installed).
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "engine-high" "agy" "high" 10.0 "qualified" 101
write_scorecard_row "engine-low" "agy" "low" 15.0 "qualified" 102
write_scorecard_row "engine-prov" "agy" "medium" 5.0 "provisional" 103

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 1: exit 0"
assert_file_exists "$TOPOLOGY_OUT" "Case 1: topology.json written"

LADDER_LEN="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(topo.implementer_ladder.length));
NODE
)"
assert_eq "2" "$LADDER_LEN" "Case 1: ladder has exactly 2 qualified seats"

FIRST_RUNG="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.implementer_ladder[0].rung);
NODE
)"
assert_eq "engine-low/low@agy" "$FIRST_RUNG" "Case 1: low effort rung first"

SECOND_RUNG="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.implementer_ladder[1].rung);
NODE
)"
assert_eq "engine-high/high@agy" "$SECOND_RUNG" "Case 1: high effort rung second"

CANDIDATES="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.candidates_to_qualify));
NODE
)"
assert_eq "[]" "$CANDIDATES" "Case 1: agy is qualified so candidates_to_qualify is empty (codex not installed)"

# -----------------------------------------------------------------------------
# Case 2: Empty store (no seats at all) -> implementer_ladder: [],
# claude_fallback_ladder present and correct, exit 0.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
: > "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 2: empty store exit 0"

EMPTY_LADDER="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.implementer_ladder));
NODE
)"
assert_eq "[]" "$EMPTY_LADDER" "Case 2: implementer_ladder is []"

FALLBACK_LADDER="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.claude_fallback_ladder));
NODE
)"
assert_eq '["haiku/medium@claude-native","sonnet/medium@claude-native"]' "$FALLBACK_LADDER" "Case 2: claude_fallback_ladder present and correct"

CANDIDATES_EMPTY="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.candidates_to_qualify));
NODE
)"
assert_eq '["agy"]' "$CANDIDATES_EMPTY" "Case 2: installed agy is candidate to qualify"

# -----------------------------------------------------------------------------
# Case 3: --check mode:
# Run once to generate the file, run --check again unchanged -> exit 0;
# then edit/corrupt the on-disk file -> --check exit 1 with diff on stderr.
# -----------------------------------------------------------------------------
node "$SCRIPT" --out "$TOPOLOGY_OUT"
node "$SCRIPT" --check --out "$TOPOLOGY_OUT" >/dev/null 2>&1; CHECK_EXIT=$?
assert_eq "0" "$CHECK_EXIT" "Case 3: --check exit 0 when unchanged"

# Corrupt on-disk file
node - "$TOPOLOGY_OUT" <<'NODE'
const fs = require('fs');
const topo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
topo.candidates_to_qualify.push("corrupted");
fs.writeFileSync(process.argv[2], JSON.stringify(topo, null, 2) + '\n');
NODE

CHECK_DIFF="$(node "$SCRIPT" --check --out "$TOPOLOGY_OUT" 2>&1)"; CHECK_FAIL_EXIT=$?
assert_eq "1" "$CHECK_FAIL_EXIT" "Case 3: --check exit 1 on corrupt file"
assert_contains "$CHECK_DIFF" "corrupted" "Case 3: diff printed on stderr"

# -----------------------------------------------------------------------------
# Case 4: Negative control: a seat that IS qualified but whose runner is NOT
# installed (e.g. codex) must be excluded from the ladder even though qualified.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "codex-spark" "codex" "high" 5.0 "qualified" 201

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 4: exit 0"

CODEX_LADDER="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.implementer_ladder));
NODE
)"
assert_eq "[]" "$CODEX_LADDER" "Case 4: uninstalled runner seat excluded from ladder"

CANDIDATES_CASE4="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.candidates_to_qualify));
NODE
)"
assert_contains "$CANDIDATES_CASE4" "agy" "Case 4: agy is candidate"
assert_not_contains "$CANDIDATES_CASE4" "codex" "Case 4: uninstalled codex not in candidates_to_qualify"

# -----------------------------------------------------------------------------
# Case 5: reviewer, consult, discuss ladders are produced and properly ordered
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "rev-high" "agy" "high" 10.0 "qualified" 301 "reviewer"
write_scorecard_row "rev-low" "agy" "low" 15.0 "qualified" 302 "reviewer"
write_scorecard_row "con-b" "agy" "medium" 20.0 "qualified" 303 "consult" "test-family" 10
write_scorecard_row "con-a" "agy" "medium" 10.0 "qualified" 304 "consult" "other-family" 5
write_scorecard_row "dis-b" "agy" "medium" 20.0 "qualified" 305 "discuss" "test-family" 10
write_scorecard_row "dis-a" "agy" "medium" 10.0 "qualified" 306 "discuss" "other-family" 5

OUT="$(node "$SCRIPT" --json --role reviewer,consult,discuss --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 5: exit 0"

REV_FIRST="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.reviewer_ladder[0].engine + '/' + topo.reviewer_ladder[0].effort);
NODE
)"
assert_eq "rev-low/low" "$REV_FIRST" "Case 5: reviewer ladder low effort first"

CON_FIRST="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.consult_ladder[0].engine);
NODE
)"
assert_eq "con-a" "$CON_FIRST" "Case 5: consult ladder sorted by different family first then latency/cost"

DIS_FIRST="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.discuss_ladder[0].engine);
NODE
)"
assert_eq "dis-a" "$DIS_FIRST" "Case 5: discuss ladder sorted by different family first then latency/cost"

# -----------------------------------------------------------------------------
# Case 6: plan_review_panel distinct families and max 3 seats
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
# 2 OpenAI engines, 1 Anthropic, 1 Google, 1 Alibaba
write_scorecard_row "gpt-4o" "agy" "high" 10.0 "qualified" 401 "reviewer"
write_scorecard_row "gpt-3.5" "agy" "low" 5.0 "qualified" 402 "reviewer"
write_scorecard_row "claude-sonnet" "agy" "high" 12.0 "qualified" 403 "consult"
write_scorecard_row "gemini-flash" "agy" "high" 15.0 "qualified" 404 "consult"
write_scorecard_row "qwen-max" "agy" "high" 20.0 "qualified" 405 "consult"

OUT="$(node "$SCRIPT" --json --role plan_reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 6: exit 0"

PANEL_LEN="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(topo.plan_review_panel.length));
NODE
)"
assert_eq "3" "$PANEL_LEN" "Case 6: panel never exceeds 3 seats"

PANEL_FAMILIES="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const families = topo.plan_review_panel.map(s => s.family);
const distinct = new Set(families);
process.stdout.write(families.length === distinct.size ? "distinct" : "duplicate");
NODE
)"
assert_eq "distinct" "$PANEL_FAMILIES" "Case 6: panel never contains two seats from same family"

CHAIR_ENGINE="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.plan_review_panel[0].engine);
NODE
)"
assert_eq "gpt-4o" "$CHAIR_ENGINE" "Case 6: chair is highest effort reviewer candidate"

# -----------------------------------------------------------------------------
# Case 7: runner codex-cli normalisation to codex
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
# Create fake codex binary so codex is installed
cat > "$FAKE_BIN_DIR/codex" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '0.1.0\n'
  exit 0
fi
exit 0
STUB
chmod +x "$FAKE_BIN_DIR/codex"

write_scorecard_row "gpt-4o-cli" "codex-cli" "high" 10.0 "qualified" 501 "reviewer"

OUT="$(node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 7: exit 0"

NORMALIZED_RUNNER="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.reviewer_ladder[0].runner);
NODE
)"
assert_eq "codex" "$NORMALIZED_RUNNER" "Case 7: codex-cli normalized to codex in output"

# -----------------------------------------------------------------------------
# Case 8: runner kimi eligible for reviewer_ladder but NOT plan_review_panel
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
# Create fake kimi binary
cat > "$FAKE_BIN_DIR/kimi" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '1.0.0\n'
  exit 0
fi
exit 0
STUB
chmod +x "$FAKE_BIN_DIR/kimi"

write_scorecard_row "kimi-engine" "kimi" "high" 10.0 "qualified" 601 "reviewer"

OUT="$(node "$SCRIPT" --json --role reviewer,plan_reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 8: exit 0"

KIMI_IN_REV="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(topo.reviewer_ladder.length));
NODE
)"
assert_eq "1" "$KIMI_IN_REV" "Case 8: kimi appears in reviewer_ladder"

KIMI_IN_PANEL="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(topo.plan_review_panel.length));
NODE
)"
assert_eq "0" "$KIMI_IN_PANEL" "Case 8: kimi is not in panel-eligible runner list so panel is empty"

# -----------------------------------------------------------------------------
# Case 9: --exclude-seats removes seat from every list and panel
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gemini-pro" "agy" "high" 10.0 "qualified" 701 "reviewer"
write_scorecard_row "claude-sonnet" "agy" "high" 10.0 "qualified" 702 "reviewer"

OUT="$(node "$SCRIPT" --json --role reviewer,plan_reviewer --exclude-seats "gemini-pro/high@agy" --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 9: exit 0"

REV_SEATS="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.reviewer_ladder.map(s => s.engine).join(','));
NODE
)"
assert_eq "claude-sonnet" "$REV_SEATS" "Case 9: excluded seat removed from reviewer_ladder"

PANEL_SEATS="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.plan_review_panel.map(s => s.engine).join(','));
NODE
)"
assert_eq "claude-sonnet" "$PANEL_SEATS" "Case 9: excluded seat removed from plan_review_panel"

# -----------------------------------------------------------------------------
# Case 10: --asking-family openai sorts minimax before openai in consult_ladder
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gpt-4o" "agy" "high" 10.0 "qualified" 801 "consult"
write_scorecard_row "minimax-m3" "agy" "high" 20.0 "qualified" 802 "consult"

OUT="$(node "$SCRIPT" --json --role consult --asking-family openai --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 10: exit 0"

FIRST_CONSULT="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.consult_ladder[0].engine);
NODE
)"
assert_eq "minimax-m3" "$FIRST_CONSULT" "Case 10: different family (minimax) sorts before asking family (openai)"

# -----------------------------------------------------------------------------
# Case 11: zero scorecard rows for a role produces empty array and exits 0
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
: > "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

OUT="$(node "$SCRIPT" --json --role reviewer,consult,discuss,plan_reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 11: exit 0 on empty store"

EMPTY_CHECK="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const ok = Array.isArray(topo.reviewer_ladder) && topo.reviewer_ladder.length === 0 &&
           Array.isArray(topo.consult_ladder) && topo.consult_ladder.length === 0 &&
           Array.isArray(topo.discuss_ladder) && topo.discuss_ladder.length === 0 &&
           Array.isArray(topo.plan_review_panel) && topo.plan_review_panel.length === 0;
process.stdout.write(ok ? "empty_arrays_ok" : "mismatch");
NODE
)"
assert_eq "empty_arrays_ok" "$EMPTY_CHECK" "Case 11: empty arrays for all roles when store is empty"

# -----------------------------------------------------------------------------
# Case 12: plan_review_panel: legacy empty-effort seats sort last, not first,
# and emit effort: "high" instead of ""
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
# Write legacy empty-effort row (e.g. minimax-m3 with latency 5.0, lower latency than real effort)
write_scorecard_row "minimax-m3" "agy" "" 5.0 "qualified" 901 "reviewer" "minimax"
# Write real effort row (gpt-5.6-sol with max effort, higher latency 10.0)
write_scorecard_row "gpt-5.6-sol" "agy" "max" 10.0 "qualified" 902 "reviewer" "openai"

OUT="$(node "$SCRIPT" --json --role plan_reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 12: exit 0"

CHAIR_ENGINE_12="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.plan_review_panel[0].engine);
NODE
)"
assert_eq "gpt-5.6-sol" "$CHAIR_ENGINE_12" "Case 12: chair is seat with real effort, not empty-effort legacy row"

SECOND_ENGINE_12="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.plan_review_panel[1].engine);
NODE
)"
assert_eq "minimax-m3" "$SECOND_ENGINE_12" "Case 12: legacy seat placed second"

SECOND_EFFORT_12="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.plan_review_panel[1].effort);
NODE
)"
assert_eq "high" "$SECOND_EFFORT_12" "Case 12: legacy seat emitted with effort 'high', never ''"

finalize_test
