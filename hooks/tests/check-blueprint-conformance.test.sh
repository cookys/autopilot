#!/usr/bin/env bash
# Red-case coverage for scripts/check-blueprint-conformance.js (autonomous-brain P1, KR1).
# Every refusal path is proven able to go red BEFORE the mechanism ships
# (evidence-discipline §9 family): gate-set drift, churn mega-batch, edited
# governance script, stale re-freeze digest, scope escape, vetoed basis,
# unknown unit, missing gate pin, audit over-scope — plus the conformant pass.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-blueprint-conformance.js"
WORK="$TEST_TMP/fft-repo"
PLUGIN="$TEST_TMP/fft-plugin"

mkdir -p "$WORK/config" "$WORK/units" "$PLUGIN/scripts"
git -C "$TEST_TMP" init -q fft-repo
git -C "$WORK" config user.email t@t && git -C "$WORK" config user.name t

# Frozen surfaces: DAG, rubric, one config, one governance script (pinned).
cat > "$WORK/units/dag.json" <<'JSON'
{"schema":1,"deliverables":[{"id":"u1","paths":["src/feature/"],"churn_budget":{"max_files":3,"max_lines":200}}]}
JSON
printf '# rubric v1\n' > "$WORK/rubric.md"
printf 'pref: a\n' > "$WORK/config/preference.md"
printf '// governance gate v1\n' > "$WORK/scripts-gate.js"
mkdir -p "$WORK/src/feature"
printf 'x\n' > "$WORK/src/feature/a.js"
git -C "$WORK" add -A && git -C "$WORK" commit -qm base
BASE_SHA="$(git -C "$WORK" rev-parse HEAD)"

# Plugin root fixture: exactly one governance script exists → must be pinned.
printf '// plugin copy\n' > "$PLUGIN/scripts/check-blueprint-conformance.js"

sha() { sha256sum "$1" | cut -d' ' -f1; }
DAG_SHA="$(sha "$WORK/units/dag.json")"
RUBRIC_SHA="$(sha "$WORK/rubric.md")"
PREF_SHA="$(sha "$WORK/config/preference.md")"
GATE_SHA="$(sha "$WORK/scripts-gate.js")"

contract() { # $1 out-file, $2 dag-digest
  cat > "$1" <<JSON
{"schema":1,"unit_id":"u1","role":"implementer","goal":"g","spec":{"path":"rubric.md","section":"r"},
 "base_sha":"$BASE_SHA","depends_on":[],
 "scope":{"allow_paths":["src/feature/"]},"go":{"required_engine_role":"implementer"},"no_go":{},
 "output":{"kind":"commit","paths":["src/feature/a.js"]},"acceptance":[],"budget":{},
 "frozen_four_tuple":{
   "granularity_path":"units/dag.json","granularity_digest":"$2",
   "gate_set":["defect-review","qc-panel"],
   "rubric_path":"rubric.md","rubric_digest":"$RUBRIC_SHA",
   "control_plane_pins":{"config/preference.md":"$PREF_SHA","scripts-gate.js":"$GATE_SHA",
     "scripts/check-blueprint-conformance.js":"$GATE_SHA"}}}
JSON
}
contract "$TEST_TMP/contract.json" "$DAG_SHA"
# The plugin-root pin entry points at a path that only exists in the repo fixture
# via scripts-gate.js; give the repo a matching file so pin verification passes.
mkdir -p "$WORK/scripts"
printf '// governance gate v1\n' > "$WORK/scripts/check-blueprint-conformance.js"
git -C "$WORK" add -A && git -C "$WORK" commit -qm pins
BASE_SHA="$(git -C "$WORK" rev-parse HEAD)"
contract "$TEST_TMP/contract.json" "$DAG_SHA"

intent() { # $1 out-file, $2 gate-set-json, $3 paths-json, $4 files, $5 lines, $6 extra
  cat > "$1" <<JSON
{"schema":1,"unit_id":"u1","role":"implementer","gate_set":$2,
 "diff_scope":{"paths":$3,"churn_estimate":{"files":$4,"lines":$5}}$6}
JSON
}

run_pf() { node "$SCRIPT" preflight --contract "$TEST_TMP/contract.json" --intent "$1" --repo "$WORK" --plugin-root "$PLUGIN" ${2:-}; }

# ── conformant intent passes (negative control: the gate can go green) ──
intent "$TEST_TMP/i-ok.json" '["qc-panel","defect-review"]' '["src/feature/a.js"]' 2 50 ''
OUT="$(run_pf "$TEST_TMP/i-ok.json")"; RC=$?
assert_exit_code "$RC" "0" "conformant declared intent passes preflight"
assert_contains "$OUT" "CONFORMANT" "conformant verdict printed"

# ── KR1 red: out-of-contract gate set refused pre-spawn ──
intent "$TEST_TMP/i-gate.json" '["defect-review","qc-panel","my-new-review-round"]' '["src/feature/a.js"]' 1 10 ''
OUT="$(run_pf "$TEST_TMP/i-gate.json")"; RC=$?
assert_exit_code "$RC" "1" "added gate refused (F3: gate reinvention)"
assert_contains "$OUT" "gate_set_drift" "gate drift named"

# ── KR1 red: churn budget exceeded (F2 mega-batch) refused pre-spend ──
intent "$TEST_TMP/i-churn.json" '["defect-review","qc-panel"]' '["src/feature/a.js"]' 53 21137 ''
OUT="$(run_pf "$TEST_TMP/i-churn.json")"; RC=$?
assert_exit_code "$RC" "1" "mega-batch declaration refused pre-spend"
assert_contains "$OUT" "churn_budget" "churn breach named"

# ── KR1 red: edited governance script (pinned) refused ──
printf '// tampered\n' >> "$WORK/scripts-gate.js"
OUT="$(run_pf "$TEST_TMP/i-ok.json")"; RC=$?
assert_exit_code "$RC" "1" "edited pinned governance script refuses the round"
assert_contains "$OUT" "pin_drift" "pin drift named"
git -C "$WORK" checkout -q -- scripts-gate.js

# ── re-freeze case: DAG amended → OLD contract digest refused; NEW digest passes ──
node -e "const f='$WORK/units/dag.json';const j=require(f);j.deliverables[0].churn_budget.max_files=5;require('fs').writeFileSync(f,JSON.stringify(j))"
OUT="$(run_pf "$TEST_TMP/i-ok.json")"; RC=$?
assert_exit_code "$RC" "1" "old-digest contract refused after DAG amendment (re-freeze required)"
NEW_DAG_SHA="$(sha "$WORK/units/dag.json")"
contract "$TEST_TMP/contract.json" "$NEW_DAG_SHA"
OUT="$(run_pf "$TEST_TMP/i-ok.json")"; RC=$?
assert_exit_code "$RC" "0" "re-frozen contract (new digest) passes"

# ── scope escape: declared path outside the unit ──
intent "$TEST_TMP/i-scope.json" '["defect-review","qc-panel"]' '["src/other/b.js"]' 1 10 ''
OUT="$(run_pf "$TEST_TMP/i-scope.json")"; RC=$?
assert_exit_code "$RC" "1" "declared out-of-unit path refused"
assert_contains "$OUT" "scope_escape" "scope escape named"

# ── unknown unit ──
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$TEST_TMP/i-ok.json','utf8'));j.unit_id='u9';fs.writeFileSync('$TEST_TMP/i-unit.json',JSON.stringify(j))"
OUT="$(run_pf "$TEST_TMP/i-unit.json")"; RC=$?
assert_exit_code "$RC" "1" "unit absent from frozen DAG refused"
assert_contains "$OUT" "unknown_unit" "unknown unit named"

# ── vetoed basis (ledger-aware refusal) ──
printf '%s\n' '{"kind":"veto","target_decision_id":"d-7"}' > "$TEST_TMP/ledger.jsonl"
intent "$TEST_TMP/i-veto.json" '["defect-review","qc-panel"]' '["src/feature/a.js"]' 1 10 ',"based_on_decisions":["d-7"]'
OUT="$(run_pf "$TEST_TMP/i-veto.json" "--ledger $TEST_TMP/ledger.jsonl")"; RC=$?
assert_exit_code "$RC" "1" "round building on a vetoed decision refused"
assert_contains "$OUT" "vetoed_basis" "vetoed basis named"

# ── missing governance-script pin refused ──
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$TEST_TMP/contract.json','utf8'));delete j.frozen_four_tuple.control_plane_pins['scripts/check-blueprint-conformance.js'];fs.writeFileSync('$TEST_TMP/contract-nopin.json',JSON.stringify(j))"
OUT="$(node "$SCRIPT" preflight --contract "$TEST_TMP/contract-nopin.json" --intent "$TEST_TMP/i-ok.json" --repo "$WORK" --plugin-root "$PLUGIN")"; RC=$?
assert_exit_code "$RC" "1" "unpinned governance script refused (freeze must cover the gates)"
assert_contains "$OUT" "missing_pin" "missing pin named"

# ── audit: actual over-scope change caught post-round ──
printf 'y\n' > "$WORK/rogue.txt"
git -C "$WORK" add -A && git -C "$WORK" commit -qm rogue
OUT="$(node "$SCRIPT" audit --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/i-ok.json" --repo "$WORK" --plugin-root "$PLUGIN")"; RC=$?
assert_exit_code "$RC" "1" "audit catches an undeclared out-of-unit actual change"
assert_contains "$OUT" "scope_escape" "audit names the escape"

# ── audit: unlogged dispatch manifest (KR3 universe) ──
mkdir -p "$TEST_TMP/manifests"
printf '%s\n' '{"run_id":"hetero-999"}' > "$TEST_TMP/manifests/hetero-999.manifest.json"
printf '%s\n' '{"kind":"dispatch","run_id":"hetero-1"}' > "$TEST_TMP/ledger2.jsonl"
OUT="$(node "$SCRIPT" audit --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/i-ok.json" --repo "$WORK" --plugin-root "$PLUGIN" --manifest-dir "$TEST_TMP/manifests" --ledger "$TEST_TMP/ledger2.jsonl")"; RC=$?
assert_exit_code "$RC" "1" "manifest without ledger entry fails audit"
assert_contains "$OUT" "unlogged_decision" "unlogged decision named"

# dispatch-contract's own digest verification is covered with a fully schema-valid
# contract in hooks/tests/dispatch-contract-artifact.test.sh case 9 (KR1 wiring).

finalize_test
