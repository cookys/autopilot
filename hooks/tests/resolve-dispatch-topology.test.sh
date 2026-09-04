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

  node - "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$engine" "$runner" "$effort" "$latency" "$status" "$event_id" <<'NODE'
const fs = require('fs');
const [file, engine, runner, effort, latency, status, eventId] = process.argv.slice(2);
const row = {
  engine,
  runner,
  family: 'test-family',
  role: 'implementer',
  model_version: '1.0',
  version_source: 'runtime',
  corpus_version: '1.0',
  harness_version: '1.0',
  runner_version: '1.1.10',
  prompt_config_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  date: '2026-08-01',
  quality: 0.95,
  capability_score: 0.95,
  effort,
  status,
  admission_status: status,
  latency: { sample_wall_time_s: Number(latency) },
  event_id: Number(eventId),
  baseline_event_id: Number(eventId),
  qualified_at: '2026-08-01T00:00:00.000Z',
};
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

finalize_test
