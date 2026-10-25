#!/usr/bin/env bash
# BL-0165: brain (owner_brain_seat) and foreman exams share role `owner`. A qualified brain row
# must not make the foreman seat look qualified (seat-status / computeSeatProjection / current).
# Fixture store only; never touches ~/.autopilot.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/scripts/engine-scorecard.js"
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"' EXIT
export ENGINE_SCORECARD_DIR="$TESTDIR/sc" ENGINE_CAPABILITY_DIR="$TESTDIR/cap"
mkdir -p "$ENGINE_SCORECARD_DIR" "$ENGINE_CAPABILITY_DIR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
field() { node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=process.argv[1].split('.').reduce((o,k)=>o==null?o:o[k],d);process.stdout.write(String(v))" "$1"; }

# row <engine> <brain|foreman> <event_id>
row() {
  node -e '
const [engine, kind, id] = process.argv.slice(1);
const r = { event_id: Number(id), engine, runner: "claude", role: "owner", status: "qualified",
  qualified_at: "2026-10-14", date: "2026-10-14", capability_score: 1,
  family: "x", cost: { source: "unknown" }, model_version: "v1", corpus_version: "c1",
  harness_version: "h1", runner_version: "r1", prompt_config_hash: "p1" };
if (kind === "brain") r.methodology_kind = "owner_brain_seat";
process.stdout.write(JSON.stringify(r) + "\n");' "$@"
}
{ row brain-only brain 1; row foreman-only foreman 2; row both brain 3; row both foreman 4; } > "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

status_of() { node "$CLI" seat-status --engine "$1" --runner claude --role owner | field admission_status; }

[ "$(status_of brain-only)" = "no_record" ] && ok "brain-only seat is NOT a qualified foreman seat" \
  || bad "brain-only seat leaked as foreman: $(status_of brain-only)"
# negative control: a genuine foreman row still qualifies
[ "$(status_of foreman-only)" = "qualified" ] && ok "foreman row still qualifies foreman seat" \
  || bad "foreman row no longer qualifies: $(status_of foreman-only)"
[ "$(status_of both)" = "qualified" ] && ok "seat with both rows qualifies via the foreman row" \
  || bad "both: $(status_of both)"
# current --role owner still lists the brain row
N="$(node "$CLI" current --role owner | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const a=Array.isArray(d)?d:(d.rows||d.current||[]);process.stdout.write(String(a.filter(r=>r.engine==='brain-only').length))")"
[ "$N" = "1" ] && ok "current --role owner still lists the brain row" || bad "current dropped the brain row (n=$N)"
printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
