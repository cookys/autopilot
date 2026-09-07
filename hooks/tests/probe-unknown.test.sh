#!/usr/bin/env bash
# Fixtures for scripts/probe-unknown.js + the ladder telemetry kinds in
# scripts/decision-ledger.js + the rehydration-bundle tail priority
# (plan docs/plans/2026-09-07-unknown-escalation-ladder.md P1, rubric R2/R3/R10/R11/R12/R13/R16).
# Every classification exits 0 (KR5); only usage and --strict exit 2.
. "$(dirname "$0")/lib.sh"

PROBE="$REPO_ROOT/scripts/probe-unknown.js"
LEDGER="$REPO_ROOT/scripts/decision-ledger.js"
BUNDLE="$REPO_ROOT/scripts/build-rehydration-bundle.js"
L="$TEST_TMP/ledger.jsonl"
mkdir -p "$TEST_TMP/k" "$TEST_TMP/m"
# A genuinely novel term: random so no repo/knowledge/memory file (including this test) can contain it.
NOVEL="novel$(date +%s%N | tail -c 9)$RANDOM"
# Every flag the probe would otherwise ask the resolver for is pinned, so the test never
# depends on the host's review-loop config or topology.
PIN=(--knob auto --consult-resolved-from topology --consult-dispatch auto --budget-u1 2 --budget-u2 1 --budget-u3 1 --knowledge-dir "$TEST_TMP/k" --memory-dir "$TEST_TMP/m" --repo-root "$REPO_ROOT")
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=process.argv[1].split(".").reduce((o,k)=>o&&o[k],j);process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }
append() { node "$LEDGER" append --ledger "$L" --kind "$1" --json "$2" >/dev/null; }

# ── ledger kinds: per-kind validation, telemetry exemption ──
node "$LEDGER" append --ledger "$L" --kind hypothesis --json '{"hypothesis_id":"h0","text":"t","status":"maybe"}' >/dev/null 2>&1
assert_exit_code "$?" "2" "hypothesis with bad status refused"
node "$LEDGER" append --ledger "$L" --kind ladder --json '{"rung":"U9","unknown_type":"why","terms":[],"signal_ids":[],"heterogeneous":true}' >/dev/null 2>&1
assert_exit_code "$?" "2" "ladder with bad rung refused"
node "$LEDGER" append --ledger "$L" --kind ladder --json '{"rung":"U1","unknown_type":"why","terms":[],"signal_ids":[],"heterogeneous":true,"reason":"tired"}' >/dev/null 2>&1
assert_exit_code "$?" "2" "ladder with unknown skip reason refused"
node "$LEDGER" append --ledger "$L" --kind unknown --json '{"type":"how"}' >/dev/null 2>&1
assert_exit_code "$?" "2" "unknown without rationale refused (it is a claim)"
node "$LEDGER" append --ledger "$L" --kind hypothesis --json '{"hypothesis_id":"h1","text":"cache stale","status":"refuted","work_unit":"p1"}' >/dev/null
assert_exit_code "$?" "0" "hypothesis row accepted without decision_id (telemetry kind)"
node "$LEDGER" append --ledger "$L" --kind decision --json '{"decision_id":"d-1","round":1,"class":"tactical"}' >/dev/null 2>&1
assert_exit_code "$?" "1" "decision kinds still require a rationale (unchanged)"

# ── classify: empty ledger ⇒ none, exit 0 ──
OUT="$(node "$PROBE" classify --ledger "$TEST_TMP/empty.jsonl" "${PIN[@]}")"; RC=$?
assert_exit_code "$RC" "0" "empty ledger exits 0"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "empty ledger ⇒ none"
assert_eq "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" "1" "classify prints exactly one JSON line"

# ── S1 threshold edge: one refuted ⇒ none; two ⇒ U1 (KR2) ──
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p1 "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "one refuted hypothesis ⇒ none"
append hypothesis '{"hypothesis_id":"h2","text":"race","status":"refuted","work_unit":"p1"}'
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p1 "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U1" "two refuted hypotheses ⇒ U1 (KR2)"
assert_eq "$(printf '%s' "$OUT" | field unknown_type)" "why" "S1 ⇒ unknown-why"
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p1 --refuted-threshold 3 "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "threshold is argv-overridable"

# ── receipt: one JSON object, written through decision-ledger ──
OUT="$(node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type why --terms cache,race --signals S1 --work-unit p1 --run-id consult-1)"; RC=$?
assert_exit_code "$RC" "0" "receipt exits 0"
assert_eq "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" "1" "receipt prints exactly one JSON object (R2)"
assert_eq "$(printf '%s' "$OUT" | field kind)" "ladder" "receipt row is a ladder row"
assert_contains "$(tail -1 "$L")" '"dispatch_run_id":"consult-1"' "receipt landed in the ledger via append"
node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type why --terms cache --signals S1 --work-unit p1 >/dev/null

# ── exhaustion: U1 spent, why chain with hard signal ⇒ U2 (signal-eligible, not bought) ──
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p1 "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "U1 spent + hard signal ⇒ U2 is signal-eligible"
assert_eq "$(printf '%s' "$OUT" | field budget.used.U1)" "2" "used counts climbs per work unit"
node "$PROBE" receipt --ledger "$L" --rung U2 --unknown-type why --terms cache --signals S1 --work-unit p1 >/dev/null
node "$PROBE" receipt --ledger "$L" --rung U3 --unknown-type why --terms cache --signals S1 --work-unit p1 >/dev/null
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p1 "${PIN[@]}")"; RC=$?
assert_exit_code "$RC" "0" "exhausted still exits 0 (KR5)"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "every eligible rung spent ⇒ none (R11: never U4 from exhaustion)"
assert_eq "$(printf '%s' "$OUT" | field reason)" "budget-exhausted" "exhaustion names its reason"
# U4 only when a hard signal persists after the whole chain
printf '%s\n' '{"tripped":true,"consecutive_zero_product":3,"threshold":3,"violations":[]}' > "$TEST_TMP/stall.json"
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p1 --stall "$TEST_TMP/stall.json" "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U4" "chain climbed + stall tripped ⇒ U4"
assert_contains "$(printf '%s' "$OUT" | field signals)" '"S3"' "S3 reported from stall JSON"

# ── S4 co-signal rule (R10) ──
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p3 --terms $NOVEL "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field unknown_type)" "how" "zero-hit term ⇒ unknown-how"
assert_eq "$(printf '%s' "$OUT" | field eligible_max)" "U1" "S4 alone ⇒ at most U1"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U1" "S4 alone recommends U1"
node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type how --terms $NOVEL --signals S4 --work-unit p3 >/dev/null
node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type how --terms $NOVEL --signals S4 --work-unit p3 >/dev/null
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p3 --terms $NOVEL "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "S4-only with U1 spent ⇒ none, never U2 (R10)"
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p3 --terms $NOVEL --fast-moving "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "S4 + --fast-moving ⇒ U2"
append hypothesis '{"hypothesis_id":"h3","text":"x","status":"refuted","work_unit":"p4"}'
append hypothesis '{"hypothesis_id":"h4","text":"y","status":"refuted","work_unit":"p4"}'
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p4 --terms $NOVEL "${PIN[@]}")"
assert_contains "$(printf '%s' "$OUT" | field signals)" '"S4"' "S4 present alongside S1"
assert_eq "$(printf '%s' "$OUT" | field eligible_max)" "U3" "S4 + S1 ⇒ U2 eligible (why chain reaches U3)"
# a term with a local hit is not novel
printf 'zzqx-known appears here\n' > "$TEST_TMP/k/note.md"
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p6 --terms zzqx-known "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U0" "all terms hit locally ⇒ U0 (read first)"
assert_eq "$(printf '%s' "$OUT" | field terms_hits.zzqx-known.knowledge_or_memory)" "1" "knowledge hit counted"

# ── heterogeneity rule (R12): native-fallback skips U1 before any spawn ──
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p7 --terms $NOVEL --fast-moving "${PIN[@]}" --consult-resolved-from native-fallback)"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "native-fallback ⇒ U2"
assert_eq "$(printf '%s' "$OUT" | field skipped_rungs)" '["U1"]' "U1 skipped"
assert_eq "$(printf '%s' "$OUT" | field reason)" "not-heterogeneous" "skip reason named"
assert_eq "$(printf '%s' "$OUT" | field heterogeneous_u1)" "false" "heterogeneous_u1 false"
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p7 --terms $NOVEL "${PIN[@]}" --consult-dispatch off)"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "S4-only with consult off ⇒ none (U2 not signal-eligible)"
assert_eq "$(printf '%s' "$OUT" | field reason)" "not-heterogeneous" "consult off names not-heterogeneous"

# ── rail-failed: consumes the rung budget, is a skip (never learn), so a dead seat is not re-recommended forever ──
append hypothesis '{"hypothesis_id":"h5","text":"x","status":"refuted","work_unit":"p12"}'
append hypothesis '{"hypothesis_id":"h6","text":"y","status":"refuted","work_unit":"p12"}'
node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type why --terms dead --signals S1 --work-unit p12 --reason rail-failed >/dev/null
node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type why --terms dead --signals S1 --work-unit p12 --reason rail-failed >/dev/null
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p12 "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field budget.used.U1)" "2" "rail-failed rows consume the U1 budget"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "after two failed U1 attempts the signal-eligible U2 is recommended, not U1 again"
OUT="$(node "$PROBE" report --ledger "$L")"
assert_eq "$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.learn_required.filter(c=>c.terms.includes("dead")).length)})')" "0" "rail-failed rows never become a learn trigger"
assert_eq "$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.skips.filter(c=>c.reason==="rail-failed").length)})')" "2" "rail-failed rows are reported as skips"

# ── S5 / S6 ──
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p8 --consensus LOW "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field unknown_type)" "whether" "consensus LOW ⇒ unknown-whether"
assert_eq "$(printf '%s' "$OUT" | field eligible_max)" "U3" "S5 ⇒ U3 eligible"
append unknown '{"type":"how","rationale":"never seen this protocol","work_unit":"p9"}'
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p9 "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U1" "S6 alone ⇒ U1"
assert_eq "$(printf '%s' "$OUT" | field eligible_max)" "U1" "S6 alone caps at U1 (R16)"
node "$PROBE" receipt --ledger "$L" --rung U1 --unknown-type how --terms proto --signals S6 --work-unit p9 >/dev/null

# ── knob off ⇒ none, reason knob-off, one ladder row in the same JSONL ──
OUT="$(node "$PROBE" classify --ledger "$L" --work-unit p10 --terms $NOVEL "${PIN[@]}" --knob off)"; RC=$?
assert_exit_code "$RC" "0" "knob off exits 0"
assert_eq "$(printf '%s' "$OUT" | field reason)" "knob-off" "knob off names its reason"
node "$PROBE" classify --ledger "$L" --work-unit p10 --terms $NOVEL "${PIN[@]}" --knob off >/dev/null
assert_eq "$(grep -c '"reason":"knob-off"' "$L")" "1" "knob-off row written once, into the same ledger"
assert_file_absent "$TEST_TMP/receipt-p10.json" "no second receipt file"

# ── --strict: exit 2 only for U2/U3/U4 ──
node "$PROBE" classify --ledger "$L" --work-unit p11 --terms $NOVEL --fast-moving "${PIN[@]}" --consult-resolved-from native-fallback --strict >/dev/null; RC=$?
assert_exit_code "$RC" "2" "--strict exits 2 on U2"
node "$PROBE" classify --ledger "$L" --work-unit p11 --terms $NOVEL "${PIN[@]}" --strict >/dev/null; RC=$?
assert_exit_code "$RC" "0" "--strict exits 0 on U1"
node "$PROBE" classify --ledger "$L" --bogus 1 >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "usage error exits 2"

# ── report ──
OUT="$(node "$PROBE" report --ledger "$L")"
assert_eq "$(printf '%s' "$OUT" | field skips.length)" "3" "report separates skips (1 knob-off + 2 rail-failed)"
assert_eq "$(printf '%s' "$OUT" | field s6_only.length)" "1" "report lists S6-only climbs (R16)"
assert_contains "$(printf '%s' "$OUT" | field repeat_terms)" '"cache"' "repeat_terms groups by term (KR4)"
assert_eq "$(printf '%s' "$OUT" | field judgment_only)" "0" "no judgment-only climbs in this fixture"
assert_contains "$(printf '%s' "$OUT" | field climbs.0.signal_coverage)" "1" "signal_coverage per climb (R10 observable)"
assert_eq "$(printf '%s' "$OUT" | field learn_required.length)" "$(printf '%s' "$OUT" | field climbs.length)" "every rung≥1 climb is a learn trigger (R14)"
mkdir -p "$TEST_TMP/proj/a/ledger" "$TEST_TMP/proj/b/ledger"; cp "$L" "$TEST_TMP/proj/a/ledger/decisions.jsonl"; cp "$L" "$TEST_TMP/proj/b/ledger/decisions.jsonl"
OUT="$(node "$PROBE" report --project-dir "$TEST_TMP/proj")"
assert_eq "$(printf '%s' "$OUT" | field ledgers.length)" "2" "--project-dir aggregates ledgers"

# ── ledger round-end report: Ladder section ──
OUT="$(node "$LEDGER" report --ledger "$L")"
assert_contains "$OUT" "## Ladder" "round-end report has a Ladder section"
assert_contains "$OUT" "refuted hypotheses: 6" "refuted count rendered"
assert_contains "$OUT" "skip U0 reason=knob-off" "skips rendered"
assert_contains "$OUT" "S6-only climbs (self-reported unknown, no mechanical co-signal): U1 terms=proto" "S6-only subset rendered"

# ── rehydration bundle: current-round ladder rows survive the 20-row tail ──
B="$TEST_TMP/bundle.jsonl"
node "$LEDGER" append --ledger "$B" --kind ladder --json '{"round":1,"rung":"U1","unknown_type":"why","terms":["old"],"signal_ids":["S1"],"heterogeneous":true}' >/dev/null
node "$LEDGER" append --ledger "$B" --kind hypothesis --json '{"round":2,"hypothesis_id":"keep-h","text":"k","status":"refuted"}' >/dev/null
node "$LEDGER" append --ledger "$B" --kind ladder --json '{"round":2,"rung":"U2","unknown_type":"why","terms":["keep-term"],"signal_ids":["S1"],"heterogeneous":true}' >/dev/null
for i in $(seq 1 30); do node "$LEDGER" append --ledger "$B" --kind note --json "{\"round\":2,\"text\":\"filler $i\"}" >/dev/null; done
cat > "$TEST_TMP/contract.json" <<'JSON'
{"schema":1,"unit_id":"u1","frozen_four_tuple":{"granularity_path":"g","granularity_digest":"d","gate_set":[],"rubric_path":"r","rubric_digest":"d","control_plane_pins":{}},"red_lines":[]}
JSON
OUT="$(node "$BUNDLE" build --contract "$TEST_TMP/contract.json" --ledger "$B" 2>/dev/null || true)"
if [ -n "$OUT" ]; then
  assert_contains "$OUT" "keep-term" "current-round ladder row survives the tail"
  assert_contains "$OUT" "keep-h" "current-round hypothesis row survives the tail"
  assert_not_contains "$OUT" '"old"' "older-round ladder row is not force-kept"
  assert_eq "$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sections["4_ledger_tail"].length))')" "20" "tail still 20 rows"
else
  # build needs a fuller contract on this host; assert the selector directly.
  OUT="$(node -e '
const src=require("fs").readFileSync(process.argv[1],"utf8");
const m=src.match(/const LEDGER_TAIL_ROWS = (\d+);[\s\S]*?function ledgerTailSelect[\s\S]*?\n}\n/);
const fn=new Function("fs",m[0]+"; return ledgerTailSelect;")(require("fs"));
const rows=require("fs").readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean).map(JSON.parse);
const sel=fn(rows); console.log(JSON.stringify({n:sel.length,keep:sel.some(r=>(r.terms||[]).includes("keep-term")),hyp:sel.some(r=>r.hypothesis_id==="keep-h"),old:sel.some(r=>(r.terms||[]).includes("old"))}));
' "$BUNDLE" "$B")"
  assert_contains "$OUT" '"n":20' "tail still 20 rows"
  assert_contains "$OUT" '"keep":true' "current-round ladder row survives the tail"
  assert_contains "$OUT" '"hyp":true' "current-round hypothesis row survives the tail"
  assert_contains "$OUT" '"old":false' "older-round ladder row is not force-kept"
fi

finalize_test
