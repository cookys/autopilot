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
# Scrubbing PATH is not enough: runner detection also probes $HOME-relative install
# locations (resolve-dispatch-topology.js fallbackPaths, e.g. ~/.kimi-code/bin/kimi), so
# on a host with kimi installed the "installed runners" set gained kimi and Cases 1-2
# red. Point HOME at lib.sh's empty per-test home so installed == exactly the fake bin.
export HOME="$HOOK_HOME"

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
  local corpus="${10:-1.0}"

  node - "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$engine" "$runner" "$effort" "$latency" "$status" "$event_id" "$role" "$family" "$cost" "$corpus" <<'NODE'
const fs = require('fs');
const [file, engine, runner, effort, latency, status, eventId, role, family, costRaw, corpus] = process.argv.slice(2);
const row = {
  engine,
  runner,
  family,
  role,
  model_version: '1.0',
  version_source: 'runtime',
  corpus_version: corpus || "1.0",
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
# Case 9b (negative control, d1-runner-alias-exclusion): a --exclude-seats entry spelled with
# the canonical "codex" runner must still exclude a seat whose scorecard row is qualified under
# the "codex-cli" alias — the two must be treated as the same rail for exclusion.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gpt-4o-cli" "codex-cli" "high" 10.0 "qualified" 703 "reviewer"
write_scorecard_row "claude-sonnet" "agy" "high" 10.0 "qualified" 704 "reviewer"

OUT="$(node "$SCRIPT" --json --role reviewer --exclude-seats "gpt-4o-cli/high@codex" --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 9b: exit 0"

REV_SEATS_ALIAS="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.reviewer_ladder.map(s => s.engine).join(','));
NODE
)"
assert_eq "claude-sonnet" "$REV_SEATS_ALIAS" "Case 9b: codex-cli seat excluded by a codex exclusion (alias canonicalized before comparison)"

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

# -----------------------------------------------------------------------------
# Case 13: implementer ladder — a legacy (no-effort) qualified seat must be emitted
# with effort 'high' (same rule as the reviewer path, Case 12) while keeping the
# `engine@runner` rung name; '' is outside the review-loop contract's
# implementer_effort enum and made `implementer_ladder: auto` fail validation on
# every host with a legacy seat (2026-09-07). Two rows resolving to the same seat
# (a superseded legacy row + its successor, both still current) collapse to ONE rung.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "engine-legacy" "agy" "" 20.0 "qualified" 301
write_scorecard_row "engine-legacy" "agy" "" 20.0 "qualified" 302
write_scorecard_row "engine-low" "agy" "low" 15.0 "qualified" 303
write_scorecard_row "engine-max" "agy" "max" 30.0 "qualified" 304
write_scorecard_row "engine-high" "agy" "high" 25.0 "qualified" 305

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" --role implementer 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 13: exit 0"

LADDER_13="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.implementer_ladder.map((r) => [r.rung, r.effort])));
NODE
)"
assert_eq '[["engine-low/low@agy","low"],["engine-high/high@agy","high"],["engine-legacy@agy","high"],["engine-max/max@agy","max"]]' "$LADDER_13" \
  "Case 13: legacy implementer seat emitted once, rung name engine@runner, effort 'high' (never ''), ranked by its emitted effort (after explicit high, never above max)"

EMPTY_EFFORT_13="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(String(topo.implementer_ladder.filter((r) => !r.effort).length));
NODE
)"
assert_eq "0" "$EMPTY_EFFORT_13" "Case 13: no implementer rung carries an empty effort"

# -----------------------------------------------------------------------------
# Case 14: implementer ladder rungs carry `family`, derived by the SAME
# familyOf() helper (and same value) the reviewer/consult/discuss path uses for
# the identical engine name — producer-side field, not yet plumbed through the
# review-loop contract. Uses vendor-shaped engine names so familyOf() resolves
# to something other than the 'unknown' fallback.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gpt-5" "agy" "high" 10.0 "qualified" 401
write_scorecard_row "gemini-2" "agy" "low" 5.0 "qualified" 402

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" --role implementer 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 14: exit 0"

FAMILIES_14="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(topo.implementer_ladder.map((r) => [r.engine, r.family])));
NODE
)"
assert_eq '[["gemini-2","google"],["gpt-5","openai"]]' "$FAMILIES_14" \
  "Case 14: implementer rungs carry the correct family per engine (same familyOf() mapping as reviewer/consult/discuss)"

# -----------------------------------------------------------------------------
# Case 15 (KR1 + KR3): a climb must change something. Two same-family seats at the
# same effort are a no-op climb — same vendor, same tier — so the nearest
# different-family rung is pulled forward between them. The FIRST rung must still
# be the globally cheapest (cheapest-first is not traded away for decorrelation).
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gpt-5a" "agy" "high" 10.0 "qualified" 401
write_scorecard_row "gpt-5b" "agy" "high" 20.0 "qualified" 402
write_scorecard_row "gemini-1" "agy" "high" 30.0 "qualified" 403
write_scorecard_row "gpt-5c" "agy" "low" 40.0 "qualified" 404

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" --role implementer 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 15: exit 0"

ORDER_15="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.implementer_ladder.map((r) => `${r.engine}:${r.family}:${r.effort}`).join(' '));
NODE
)"
assert_eq "gpt-5c:openai:low gpt-5a:openai:high gemini-1:google:high gpt-5b:openai:high" "$ORDER_15" \
  "Case 15: cheapest rung first, then the different-family rung is interleaved between the two same-family high seats"

KR1_15="$(node - "$TOPOLOGY_OUT" <<'NODE'
const R = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
const l = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')).implementer_ladder;
const bad = [];
for (let i = 0; i + 1 < l.length; i += 1) {
  const a = l[i]; const b = l[i + 1];
  if (a.family === b.family && !(R[b.effort] > R[a.effort])) bad.push(`${i}:${a.family}`);
}
process.stdout.write(bad.join(',') || 'kr1-ok');
NODE
)"
assert_eq "kr1-ok" "$KR1_15" "Case 15: no adjacent pair shares a family without a strictly higher effort"

# -----------------------------------------------------------------------------
# Case 16 (KR4): a single-family host must be byte-identical to the pure
# effort ordering — decorrelation has nothing to trade and must not reshuffle.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gpt-one" "agy" "low" 10.0 "qualified" 501
write_scorecard_row "gpt-two" "agy" "medium" 20.0 "qualified" 502
write_scorecard_row "gpt-three" "agy" "high" 30.0 "qualified" 503

OUT="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" --role implementer 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 16: exit 0"
ORDER_16="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.implementer_ladder.map((r) => r.engine).join(' '));
NODE
)"
assert_eq "gpt-one gpt-two gpt-three" "$ORDER_16" \
  "Case 16: single-family ladder keeps the plain cheapest-first order"

# ── Case 17: judge is the reviewer seat resolve-review-loop.sh resolves ──
# Distinct value per field, so a field read into the wrong slot shows up. Nothing asserted on
# `judge` before this case (a runner/effort swap stayed green, 2026-09-24).
JUDGE_CFG="$TEST_TMP/judge-review-loop-config.md"
cat >"$JUDGE_CFG" <<'CFG'
- reviewer_engine: judge-engine-17
- reviewer_runner: grok
- reviewer_effort: medium
CFG
REVIEW_LOOP_CONFIG_OVERRIDE="$JUDGE_CFG" node "$SCRIPT" --out "$TOPOLOGY_OUT" >/dev/null 2>&1
JUDGE_17="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).judge||{}; process.stdout.write([j.reviewer_engine,j.reviewer_runner,j.reviewer_effort].map(String).join(" "))' "$TOPOLOGY_OUT")"
assert_eq "judge-engine-17 grok medium" "$JUDGE_17" \
  "Case 17: judge carries reviewer engine, runner, effort from the resolved config"
# A config resolve-review-loop.sh refuses (unknown runner ⇒ exit 3) yields an all-null judge.
printf '%s\n' '- reviewer_engine: judge-engine-17' '- reviewer_runner: no-such-runner' >"$JUDGE_CFG"
REVIEW_LOOP_CONFIG_OVERRIDE="$JUDGE_CFG" node "$SCRIPT" --out "$TOPOLOGY_OUT" >/dev/null 2>&1
JUDGE_17B="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).judge||{}; process.stdout.write([j.reviewer_engine,j.reviewer_runner,j.reviewer_effort].map(String).join(" "))' "$TOPOLOGY_OUT")"
assert_eq "null null null" "$JUDGE_17B" \
  "Case 17: a refused review-loop config leaves every judge field null"

# -----------------------------------------------------------------------------
# Case 18: plan_review_panel chair is the HIGHEST explicit effort; `default` (unknown cost) never chairs.
# EFFORT_RANK is ascending (default=6) but comparePanelCandidates is descending, so default needs its
# own pin below `low`. Negative control: mapping default back to its ascending rank 6 makes it chair.
# Effort-rank sites in resolve-dispatch-topology.js: decorrelateAdjacent rankOf (ascending, normalizeEffort),
# implementer ladder sort (ascending, normalizeEffort), reviewer_ladder sort (ascending, EFFORT_RANK),
# sortConsultDiscuss (boolean has-effort only), comparePanelCandidates (DESCENDING, chairRank).
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gpt-4o" "agy" "max" 10.0 "qualified" 1801 "reviewer" "openai"
write_scorecard_row "claude-sonnet" "agy" "default" 10.0 "qualified" 1802 "reviewer" "anthropic"
write_scorecard_row "gemini-flash" "agy" "low" 10.0 "qualified" 1803 "reviewer" "google"
OUT="$(node "$SCRIPT" --json --role reviewer,plan_reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 18: exit 0"
CHAIR_PANEL="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.plan_review_panel.map(s => `${s.engine}/${s.effort}`).join(','));
NODE
)"
assert_eq "gpt-4o/max,gemini-flash/low,claude-sonnet/default" "$CHAIR_PANEL" \
  "Case 18: max chairs the panel; default sorts after every explicit effort"

# -----------------------------------------------------------------------------
# Case 19: `default` sorts after every explicit effort in the consult ladder (boolean has-effort sort)
# and in the reviewer ladder (ascending EFFORT_RANK). Negative controls: removing the `!== 'default'`
# test, or setting EFFORT_RANK.default to 0, puts default first.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "gemini-3-pro" "agy" "default" 50.0 "qualified" 1901 "consult" "google"
write_scorecard_row "gemini-flash" "agy" "low" 10.0 "qualified" 1902 "consult" "google"
write_scorecard_row "rev-default" "agy" "default" 10.0 "qualified" 1903 "reviewer" "google"
write_scorecard_row "rev-low" "agy" "low" 50.0 "qualified" 1904 "reviewer" "openai"
write_scorecard_row "rev-max" "agy" "max" 50.0 "qualified" 1905 "reviewer" "anthropic"
OUT="$(node "$SCRIPT" --json --role consult,reviewer --out "$TOPOLOGY_OUT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "Case 19: exit 0"
CON_ORDER="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.consult_ladder.map(s => `${s.engine}/${s.effort}`).join(','));
NODE
)"
assert_eq "gemini-flash/low,gemini-3-pro/default" "$CON_ORDER" "Case 19: consult ladder puts low before default"
REV_ORDER="$(node - "$TOPOLOGY_OUT" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(topo.reviewer_ladder.map(s => `${s.engine}/${s.effort}`).join(','));
NODE
)"
assert_eq "rev-low/low,rev-max/max,rev-default/default" "$REV_ORDER" "Case 19: reviewer ladder puts default after every explicit effort"

# -----------------------------------------------------------------------------
# Case 20: persistent operator exclusion (BL-0169). topology.exclude_seats in the operator
# config is applied on EVERY derivation path without --exclude-seats: ladders, panel, --check,
# --resolve-live. A bare engine entry retires every effort. Negative control: with the key
# removed the seats come back.
# -----------------------------------------------------------------------------
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/operator-config.json"
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "retired-a" "agy" "high" 10.0 "qualified" 2001 "implementer" "google"
write_scorecard_row "retired-a" "agy" "low" 10.0 "qualified" 2002 "implementer" "google"
write_scorecard_row "retired-b" "agy" "high" 11.0 "qualified" 2003 "reviewer" "google"
write_scorecard_row "retired-b" "agy" "high" 11.0 "qualified" 2004 "consult" "google"
write_scorecard_row "keeper" "agy" "high" 12.0 "qualified" 2005 "implementer" "anthropic"
write_scorecard_row "keeper" "agy" "high" 12.0 "qualified" 2006 "reviewer" "anthropic"
write_scorecard_row "keeper" "agy" "high" 12.0 "qualified" 2007 "consult" "anthropic"
printf '%s\n' '{"topology":{"exclude_seats":["retired-a","retired-b/high@agy"]}}' > "$AUTOPILOT_CONFIG_FILE"

show_engines() {
  node - "$TOPOLOGY_OUT" <<'NODE'
const t = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const j = (a) => a.map((s) => s.engine).join(',');
process.stdout.write([j(t.implementer_ladder), j(t.reviewer_ladder), j(t.consult_ladder), j(t.plan_review_panel)].join('|'));
NODE
}
node "$SCRIPT" --json --out "$TOPOLOGY_OUT" >/dev/null 2>&1; EXIT=$?
assert_eq "0" "$EXIT" "Case 20: exit 0"
assert_eq "keeper|keeper|keeper|keeper" "$(show_engines)" "Case 20: config exclusions applied to every ladder and the panel"
node "$SCRIPT" --check --out "$TOPOLOGY_OUT" >/dev/null 2>&1; EXIT=$?
assert_eq "0" "$EXIT" "Case 20: --check applies the same persistent exclusions"

# --resolve-live: a stale on-disk topology that still lists the retired seat first must not win.
node - "$TOPOLOGY_OUT" <<'NODE'
const fs = require('fs');
const t = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
t.implementer_ladder.unshift({ rung: 'retired-a/high@agy', engine: 'retired-a', effort: 'high', runner: 'agy', family: 'google' });
fs.writeFileSync(process.argv[2], JSON.stringify(t));
NODE
LIVE_STORE="$TEST_TMP/live-store"; mkdir -p "$LIVE_STORE"
LIVE_ENGINE="$(node "$SCRIPT" --resolve-live --role implementer --store "$LIVE_STORE" --out "$TOPOLOGY_OUT" 2>/dev/null | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).preferred_tuple.engine)')"
assert_eq "keeper" "$LIVE_ENGINE" "Case 20: --resolve-live skips a persistently excluded seat"

# union with the one-shot flag
node "$SCRIPT" --json --out "$TOPOLOGY_OUT" --exclude-seats "keeper/high@agy" >/dev/null 2>&1
assert_eq "|||" "$(show_engines)" "Case 20: --exclude-seats is unioned with the config list"

# negative control: without the config key the retired seats return
printf '%s\n' '{}' > "$AUTOPILOT_CONFIG_FILE"
node "$SCRIPT" --json --out "$TOPOLOGY_OUT" >/dev/null 2>&1
case "$(show_engines)" in
  *retired-a*|*retired-b*) assert_eq 1 1 "Case 20 (negative control): no config key -> retired seats regenerate" ;;
  *) fail "Case 20 (negative control): retired seats absent without the config key" ;;
esac

# -----------------------------------------------------------------------------
# Case 21: a malformed operator config fails loudly instead of silently dropping the list.
# -----------------------------------------------------------------------------
for BAD in '{not json' '[]' '{"topology":[]}' '{"topology":{"exclude_seats":"retired-a"}}' '{"topology":{"exclude_seats":["ok",""]}}'; do
  printf '%s\n' "$BAD" > "$AUTOPILOT_CONFIG_FILE"
  ERR="$(node "$SCRIPT" --json --out "$TOPOLOGY_OUT" 2>&1 >/dev/null)"; EXIT=$?
  assert_eq "1" "$EXIT" "Case 21: bad config '$BAD' exits 1"
  case "$ERR" in *"Operator config"*) assert_eq 1 1 "Case 21: '$BAD' names the operator config" ;; *) fail "Case 21: '$BAD' stderr lacks the operator config message: $ERR" ;; esac
done
rm -f "$AUTOPILOT_CONFIG_FILE"

# -----------------------------------------------------------------------------
# Case 22: one seat qualified under two corpus rows (two events, same engine/effort/runner)
# is ONE rung in reviewer_ladder, carrying the latest baseline. Negative control: reverting the
# dedupe leaves two rungs.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "dup-rev" "agy" "low" 10.0 "qualified" 2201 "reviewer" "google" null "c-v4"
write_scorecard_row "dup-rev" "agy" "low" 10.0 "qualified" 2202 "reviewer" "google" null "c-v6"
node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
DUP="$(node - "$TOPOLOGY_OUT" <<'NODE'
const t = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(`${t.reviewer_ladder.length}:${t.reviewer_ladder[0].baseline_event_id}`);
NODE
)"
assert_eq "1:2202" "$DUP" "Case 22: duplicate reviewer rows collapse to one rung with the latest baseline"

# -----------------------------------------------------------------------------
# Case 23: vendor name beats the generic `flash` hint when deriving family.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "MiniMax-M3.1-Flash-Preview" "agy" "high" 10.0 "qualified" 2301 "implementer" "minimax"
write_scorecard_row "gemini-3.8-flash" "agy" "low" 10.0 "qualified" 2302 "implementer" "google"
node "$SCRIPT" --json --role implementer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
FAMS="$(node - "$TOPOLOGY_OUT" <<'NODE'
const t = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
process.stdout.write(t.implementer_ladder.map((r) => `${r.engine}=${r.family}`).sort().join(','));
NODE
)"
assert_eq "MiniMax-M3.1-Flash-Preview=minimax,gemini-3.8-flash=google" "$FAMS" "Case 23: MiniMax Flash is minimax, a Gemini flash stays google"

# -----------------------------------------------------------------------------
# Case 24: anthropic-compatible is an HTTP runner with no binary: a qualified reviewer seat is
# usable when an endpoint for the engine is configured, and absent when none is.
# -----------------------------------------------------------------------------
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
# An ambient AUTOPILOT_ENDPOINT_* (a shell that exported one) would make the negative control red: scrub them first.
for _v in $(compgen -e | grep "^AUTOPILOT_ENDPOINT_"); do unset "$_v"; done
write_scorecard_row "GLM-5.3" "anthropic-compatible" "low" 10.0 "qualified" 2401 "reviewer" "zhipu"
node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "0" "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reviewer_ladder.length))' "$TOPOLOGY_OUT")" "Case 24 (negative control): no endpoint configured -> HTTP seat absent"
AUTOPILOT_ENDPOINT_GLM_URL="http://127.0.0.1:1" node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "GLM-5.3@anthropic-compatible" "$(node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(t.reviewer_ladder.map(s=>s.engine+"@"+s.runner).join(","))' "$TOPOLOGY_OUT")" "Case 24: endpoint configured -> HTTP seat joins reviewer_ladder"

# -----------------------------------------------------------------------------
# Case 25: claude-native (local `claude` CLI) seats. Available when `claude` is installed, listed
# after every other family in the reviewer ladder, never in the implementer ladder.
# -----------------------------------------------------------------------------
CLAUDE_BIN_DIR="$TEST_TMP/claude-bin"
mkdir -p "$CLAUDE_BIN_DIR"
printf '#!/usr/bin/env bash\nexit 0\n' > "$CLAUDE_BIN_DIR/claude"
chmod +x "$CLAUDE_BIN_DIR/claude"
lad() { node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((t[process.argv[2]]||[]).map(s=>s.engine+"/"+s.effort+"@"+s.runner).join(","))' "$TOPOLOGY_OUT" "$1"; }

rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "claude-opus-5-5" "claude-native" "low" 5.0 "qualified" 2501 "reviewer"
write_scorecard_row "rev-high" "agy" "high" 10.0 "qualified" 2502 "reviewer"
write_scorecard_row "claude-opus-5-5" "claude-native" "high" 5.0 "qualified" 2503 "consult"
write_scorecard_row "con-agy" "agy" "high" 50.0 "qualified" 2504 "consult"
write_scorecard_row "claude-opus-5-5" "claude-native" "high" 5.0 "qualified" 2505 "implementer"

# negative control: no `claude` binary -> no claude-native seat anywhere
node "$SCRIPT" --json --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(lad reviewer_ladder)" "rev-high/high@agy" "Case 25 (negative control): claude not installed -> claude-native seat absent"

PATH="$CLAUDE_BIN_DIR:$PATH" node "$SCRIPT" --json --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(lad reviewer_ladder)" "rev-high/high@agy,claude-opus-5-5/low@claude-native" "Case 25: claude installed -> claude-native joins reviewer_ladder, after the other family even at lower effort"
assert_eq "$(lad consult_ladder)" "con-agy/high@agy,claude-opus-5-5/high@claude-native" "Case 25: consult asking-family demotion keeps claude-native last"
assert_eq "$(lad implementer_ladder)" "" "Case 25 (negative control): claude-native never enters the implementer ladder"
assert_not_contains "$(node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(t.candidates_to_qualify))' "$TOPOLOGY_OUT")" "claude-native" "Case 25: claude-native is not an implementer qualify candidate"

# openai asking family: anthropic seat is no longer demoted in consult
PATH="$CLAUDE_BIN_DIR:$PATH" node "$SCRIPT" --json --asking-family openai --role consult --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(lad consult_ladder)" "claude-opus-5-5/high@claude-native,con-agy/high@agy" "Case 25: --asking-family openai does not demote the claude-native consult seat (latency order)"

# legacy no-effort row next to the explicit-effort row of the same engine -> one rung
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "claude-opus-5-5" "claude-native" "" 5.0 "qualified" 2601 "reviewer"
write_scorecard_row "claude-opus-5-5" "claude-native" "high" 5.0 "qualified" 2602 "reviewer"
PATH="$CLAUDE_BIN_DIR:$PATH" node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(lad reviewer_ladder)" "claude-opus-5-5/high@claude-native" "Case 25: legacy no-effort row and explicit high row are one rung"

# plan-review chair: at equal effort an anthropic seat does not chair ahead of another family
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "claude-opus-5-5" "claude-native" "high" 1.0 "qualified" 2701 "reviewer"
write_scorecard_row "gemini-x" "agy" "high" 90.0 "qualified" 2702 "reviewer"
PATH="$CLAUDE_BIN_DIR:$PATH" node "$SCRIPT" --json --role reviewer,plan_reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(lad plan_review_panel)" "gemini-x/high@agy,claude-opus-5-5/high@claude-native" "Case 25: panel chair is the non-anthropic seat on an effort tie"

# Case 26 (BL-0229): a recorded qoderclicn model the runner no longer lists is dropped at
# derivation (stderr warning); a listing failure or empty listing fails open and keeps every seat.
# RED at 8d2620ae4: stale seat kept: expected 'Qwen3.8-Max', got 'Qwen3.8-Max,qwen3.8-max-preview'; stderr lacked the dropped seat.
QODER_BIN_DIR="$TEST_TMP/qoder-bin"
mkdir -p "$QODER_BIN_DIR"
write_qoder_stub() {
  cat > "$QODER_BIN_DIR/qoderclicn" <<STUB
#!/usr/bin/env bash
if [ "\${1:-}" = "--list-models" ]; then
  $1
fi
exit 0
STUB
  chmod +x "$QODER_BIN_DIR/qoderclicn"
}
rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$TOPOLOGY_OUT"
write_scorecard_row "Qwen3.8-Max" "qoderclicn" "high" 5.0 "qualified" 2801 "reviewer"
write_scorecard_row "qwen3.8-max-preview" "qoderclicn" "high" 6.0 "qualified" 2802 "reviewer"
qlad() { node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(t.reviewer_ladder.map(s=>s.engine).sort().join(","))' "$TOPOLOGY_OUT"; }

write_qoder_stub 'printf "MODEL\nQwen3.8-Max\nDeepSeek-Flash\n"'
QERR="$(PATH="$QODER_BIN_DIR:$PATH" node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" 2>&1 >/dev/null)"
assert_eq "$(qlad)" "Qwen3.8-Max" "Case 26: retired qoder model is dropped, listed one kept (case-insensitive)"
assert_contains "$QERR" "qwen3.8-max-preview" "Case 26: dropped seat is named on stderr"

# negative control: listing command fails -> fail-open, both seats kept
write_qoder_stub 'exit 1'
PATH="$QODER_BIN_DIR:$PATH" node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(qlad)" "Qwen3.8-Max,qwen3.8-max-preview" "Case 26 (negative control): --list-models failure fails open"

# negative control: empty listing -> fail-open
write_qoder_stub 'printf ""'
PATH="$QODER_BIN_DIR:$PATH" node "$SCRIPT" --json --role reviewer --out "$TOPOLOGY_OUT" >/dev/null 2>&1
assert_eq "$(qlad)" "Qwen3.8-Max,qwen3.8-max-preview" "Case 26 (negative control): empty listing fails open"

finalize_test
