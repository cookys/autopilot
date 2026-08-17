#!/usr/bin/env bash
# Red-case coverage for scripts/build-rehydration-bundle.js (autonomous-brain P2, KR2).
# Proves: frozen five-section layout, cap breach = build error (no truncation),
# kill/resume equivalence via machine-graded quiz, and the KR2 red case —
# a deleted ledger line changes disk truth and the stale answer is refused.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/build-rehydration-bundle.js"
L="$TEST_TMP/ledger.jsonl"
M="$TEST_TMP/manifests"; mkdir -p "$M"

cat > "$TEST_TMP/contract.json" <<'JSON'
{"schema":1,"unit_id":"u1","role":"implementer","goal":"g","no_go":{"forbidden_actions":["push","merge"]},
 "frozen_four_tuple":{"granularity_path":"dag.json",
  "granularity_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "gate_set":["defect-review"],"rubric_path":"r.md",
  "rubric_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "control_plane_pins":{"config/pref.md":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}}}
JSON
cat > "$TEST_TMP/intent.json" <<'JSON'
{"schema":1,"unit_id":"u1","role":"implementer","gate_set":["defect-review"],
 "diff_scope":{"paths":["src/"],"churn_estimate":{"files":1,"lines":5}}}
JSON
for i in 1 2 3 4; do
  printf '{"schema_version":1,"ts":"t","kind":"decision","decision_id":"d-%s","round":1,"rationale":"r%s"}\n' "$i" "$i" >> "$L"
done
printf '{"run_id":"hetero-1","pid":999999999}\n' > "$M/hetero-1.manifest.json"

# ── build: five frozen sections present, in order ──
OUT="$(node "$SCRIPT" build --contract "$TEST_TMP/contract.json" --ledger "$L" --manifest-dir "$M")"
assert_exit_code "$?" "0" "bundle builds under the cap"
for s in 1_frozen_four_tuple 2_red_lines 3_control_plane_digests 4_ledger_tail 5_owned_processes; do
  assert_contains "$OUT" "$s" "section $s present"
done
assert_contains "$OUT" '"d-4"' "ledger tail carries the latest decision"

# ── cap breach = BUILD ERROR, never truncation ──
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('$TEST_TMP/contract.json','utf8'));
j.frozen_four_tuple.control_plane_pins={};
for(let i=0;i<900;i++)j.frozen_four_tuple.control_plane_pins['config/very-long-path-'+i+'-'+'x'.repeat(40)+'.md']='c'.repeat(64);
fs.writeFileSync('$TEST_TMP/contract-fat.json',JSON.stringify(j));"
ERR="$(node "$SCRIPT" build --contract "$TEST_TMP/contract-fat.json" --ledger "$L" --manifest-dir "$M" 2>&1 >/dev/null)"
RC=$?
assert_exit_code "$RC" "1" "over-cap bundle is a build error"
assert_contains "$ERR" "BUILD ERROR" "cap breach named"
assert_contains "$ERR" "No section is truncatable" "no-truncation rule stated"

# ── quiz emits disk truth ──
Q="$(node "$SCRIPT" quiz --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --ledger "$L" --manifest-dir "$M")"
assert_contains "$Q" '"current_unit_id":"u1"' "quiz names the current unit"
assert_contains "$Q" '"last3_decision_ids":["d-2","d-3","d-4"]' "quiz carries the last three decisions"

# ── kill/resume equivalence: pre-kill answer graded PASS against disk truth ──
printf '%s' "$Q" > "$TEST_TMP/answer.json"
node "$SCRIPT" grade --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --answer "$TEST_TMP/answer.json" --ledger "$L" --manifest-dir "$M" >/dev/null
assert_exit_code "$?" "0" "resume answer equal to disk truth passes"

# ── KR2 red: delete one ledger line → stale answer refused ──
head -3 "$L" > "$L.cut" && mv "$L.cut" "$L"
OUT="$(node "$SCRIPT" grade --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --answer "$TEST_TMP/answer.json" --ledger "$L" --manifest-dir "$M")"
RC=$?
assert_exit_code "$RC" "1" "deleted ledger line → quiz mismatch → round refuses"
assert_contains "$OUT" "last3_decision_ids" "the drifted field is named"

# ── four_tuple digest mismatch also refused ──
node -e "
const fs=require('fs');
const a=JSON.parse(fs.readFileSync('$TEST_TMP/answer.json','utf8'));
a.last3_decision_ids=['d-1','d-2','d-3'];
a.four_tuple_digest='0'.repeat(64);
fs.writeFileSync('$TEST_TMP/answer2.json',JSON.stringify(a));"
node "$SCRIPT" grade --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --answer "$TEST_TMP/answer2.json" --ledger "$L" --manifest-dir "$M" >/dev/null
assert_exit_code "$?" "1" "wrong four-tuple digest refused"

finalize_test
