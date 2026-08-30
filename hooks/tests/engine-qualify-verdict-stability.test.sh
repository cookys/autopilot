#!/usr/bin/env bash
# hooks/tests/engine-qualify-verdict-stability.test.sh
#
# Phase-1 verdict-stability suite (plan 2026-08-29-qualification-verdict-stability.md):
#   D1 — supersession-marker record contract (engine-scorecard.js)
#   D2 — wilsonLower pinned table (verification-strength.js)
#   D3 — classifyQualificationOutcome tables + trust scan + sealed graders
#
# All new assertions for this campaign live HERE. Do not modify other suites.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/scripts/engine-scorecard.js"
STORE="$ENGINE_SCORECARD_DIR/scorecard.jsonl"

row() { # engine runner family role corpus cap costsrc costin status expires [model_version]
  local engine="$1" runner="$2" family="$3" role="$4" corpus="$5" cap="$6" csrc="$7" cin="$8" status="$9" expires="${10}" mv="${11:-v1}"
  cat <<JSON
{"engine":"$engine","runner":"$runner","family":"$family","role":"$role","model_version":"$mv","version_source":"manual","corpus_version":"$corpus","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":$cap,"cost":{"source":"$csrc","usd_per_mtok_input":$cin,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"$status","qualified_at":"2026-06-30","expires":"$expires"}
JSON
}

jq_get() {
  node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of '$1'.split('.'))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(String(v))"
}

reset_store() {
  rm -f "$STORE" "$ENGINE_SCORECARD_DIR/.lock"
}

# ═══════════════════════════════════════════════════════════════════════════
# D1 — supersession markers (record-layer only; readers unchanged)
# Every case keeps ENGINE_SCORECARD_DIR=$HOOK_ENGINE_SCORECARD_DIR from lib.sh.
# ═══════════════════════════════════════════════════════════════════════════

# D1.1: valid marker written; closed field set; no forbidden fields
reset_store
echo "$(row tgteng tgtrun openai consult c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-target.json" 2>/dev/null
target_id=$(jq_get event_id <"$TEST_TMP/d1-target.json")
before_bytes=$(wc -c < "$STORE" | tr -d ' ')
node "$CLI" record --supersede-provisional --supersedes-event-id "$target_id" \
  --reason 'superseded-pending-verdict-redesign' </dev/null >"$TEST_TMP/d1-marker.json" 2>"$TEST_TMP/d1-marker.err"
ec=$?
marker_line=$(tail -n1 "$STORE")
marker_check=$(MARKER_LINE="$marker_line" TARGET_ID="$target_id" node - <<'NODE'
const row = JSON.parse(process.env.MARKER_LINE);
const targetId = Number(process.env.TARGET_ID);
const required = [
  'record_kind', 'engine', 'runner', 'role',
  'supersedes_event_id', 'supersession_state', 'reason', 'event_id', 'date',
];
const forbidden = ['quality', 'capability_score', 'evidence', 'status'];
const keys = Object.keys(row).sort();
const okKeys = keys.length === required.length
  && required.every((k) => Object.prototype.hasOwnProperty.call(row, k));
const noForbidden = forbidden.every((k) => row[k] === undefined);
const shape = row.record_kind === 'supersession'
  && row.engine === 'tgteng'
  && row.runner === 'tgtrun'
  && row.role === 'consult'
  && row.supersedes_event_id === targetId
  && row.supersession_state === 'superseded'
  && row.reason === 'superseded-pending-verdict-redesign'
  && Number.isInteger(row.event_id) && row.event_id > targetId
  && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date);
process.stdout.write(String(okKeys && noForbidden && shape));
NODE
)
after_bytes=$(wc -c < "$STORE" | tr -d ' ')
store_under_tmp=$(case "$STORE" in "$ENGINE_SCORECARD_DIR"/*) echo yes ;; *) echo no ;; esac)
[ "$ec" = "0" ] && [ "$marker_check" = "true" ] && [ "$after_bytes" -gt "$before_bytes" ] \
  && [ "$store_under_tmp" = "yes" ] \
  && assert_eq "0" "0" "D1.1 supersession marker written with closed field set in ENGINE_SCORECARD_DIR" \
  || fail "D1.1: ec=$ec check=$marker_check before=$before_bytes after=$after_bytes store=$STORE err=$(cat "$TEST_TMP/d1-marker.err")"

# D1.2: dangling supersedes-event-id rejected; store byte-unchanged
reset_store
echo "$(row tgteng tgtrun openai consult c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >/dev/null 2>&1
snap=$(cat "$STORE")
before=$(wc -c < "$STORE" | tr -d ' ')
err=$(node "$CLI" record --supersede-provisional --supersedes-event-id 999 \
  --reason 'dangling' </dev/null 2>&1 >/dev/null); ec=$?
after=$(wc -c < "$STORE" | tr -d ' ')
after_snap=$(cat "$STORE")
[ "$ec" = "1" ] && [ "$before" = "$after" ] && [ "$snap" = "$after_snap" ] \
  && printf '%s' "$err" | grep -q 'does not exist' \
  && assert_eq "0" "0" "D1.2 dangling supersedes-event-id rejected, store unchanged" \
  || fail "D1.2: ec=$ec before=$before after=$after err=$err"

# D1.3: mismatched engine / runner / role rejected
reset_store
echo "$(row tgteng tgtrun openai consult c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-target.json" 2>/dev/null
target_id=$(jq_get event_id <"$TEST_TMP/d1-target.json")
snap=$(cat "$STORE")
before=$(wc -c < "$STORE" | tr -d ' ')
err_eng=$(echo '{"engine":"OTHER"}' | node "$CLI" record --supersede-provisional \
  --supersedes-event-id "$target_id" --reason 'mismatch' 2>&1 >/dev/null); ec_eng=$?
err_run=$(echo '{"runner":"OTHER"}' | node "$CLI" record --supersede-provisional \
  --supersedes-event-id "$target_id" --reason 'mismatch' 2>&1 >/dev/null); ec_run=$?
err_role=$(echo '{"role":"discuss"}' | node "$CLI" record --supersede-provisional \
  --supersedes-event-id "$target_id" --reason 'mismatch' 2>&1 >/dev/null); ec_role=$?
after=$(wc -c < "$STORE" | tr -d ' ')
after_snap=$(cat "$STORE")
[ "$ec_eng" = "1" ] && [ "$ec_run" = "1" ] && [ "$ec_role" = "1" ] \
  && [ "$before" = "$after" ] && [ "$snap" = "$after_snap" ] \
  && printf '%s' "$err_eng" | grep -qi 'engine' \
  && printf '%s' "$err_run" | grep -qi 'runner' \
  && printf '%s' "$err_role" | grep -qi 'role' \
  && assert_eq "0" "0" "D1.3 mismatched engine/runner/role each rejected, store unchanged" \
  || fail "D1.3: ec=$ec_eng/$ec_run/$ec_role before=$before after=$after"

# D1.4: forbidden fields rejected by name
reset_store
echo "$(row tgteng tgtrun openai consult c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-target.json" 2>/dev/null
target_id=$(jq_get event_id <"$TEST_TMP/d1-target.json")
snap=$(cat "$STORE")
before=$(wc -c < "$STORE" | tr -d ' ')
forbid_ok=1
for field in quality capability_score evidence status; do
  body=$(FIELD="$field" node -e '
    const f = process.env.FIELD;
    const v = f === "status" ? "qualified"
      : f === "capability_score" ? 0.5
      : f === "evidence" ? {x:1}
      : {corpus_pass:"1/1"};
    process.stdout.write(JSON.stringify({[f]: v}));
  ')
  err=$(printf '%s\n' "$body" | node "$CLI" record --supersede-provisional \
    --supersedes-event-id "$target_id" --reason 'forbid' 2>&1 >/dev/null); ec=$?
  if [ "$ec" != "1" ] || ! printf '%s' "$err" | grep -q "$field"; then
    forbid_ok=0
    printf 'FAIL detail field=%s ec=%s err=%s\n' "$field" "$ec" "$err" >&2
  fi
done
after=$(wc -c < "$STORE" | tr -d ' ')
after_snap=$(cat "$STORE")
[ "$forbid_ok" = "1" ] && [ "$before" = "$after" ] && [ "$snap" = "$after_snap" ] \
  && assert_eq "0" "0" "D1.4 each forbidden field rejected by name, store unchanged" \
  || fail "D1.4: forbid_ok=$forbid_ok before=$before after=$after"

# D1.5: prior events byte-identical after successful marker append
reset_store
echo "$(row A r f reviewer c@1 0.5 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row B r f reviewer c@1 0.5 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
before_snap=$(cat "$STORE")
before_lines=$(wc -l < "$STORE" | tr -d ' ')
node "$CLI" record --supersede-provisional --supersedes-event-id 1 \
  --reason 'byte-pin' </dev/null >/dev/null 2>&1
after_prefix=$(head -n "$before_lines" "$STORE")
[ "$before_snap" = "$after_prefix" ] \
  && assert_eq "0" "0" "D1.5 prior store lines byte-identical after marker append" \
  || fail "D1.5: prior bytes changed"

# D1.6 (updated by D5 projection): ordinary record path still works; a marker
# for a seat REMOVES that seat's baseline from current/seat-status (the D5
# admission-gate behaviour). A fresh ordinary row for a different engine still
# records with a monotonic event_id.
reset_store
echo "$(row ordeng ordrun openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-ord.json" 2>/dev/null
ord_id=$(jq_get event_id <"$TEST_TMP/d1-ord.json")
seat_before=$(node "$CLI" seat-status --engine ordeng --runner ordrun --role reviewer --now 2026-06-30)
node "$CLI" record --supersede-provisional --supersedes-event-id "$ord_id" \
  --reason 'reader-filter' </dev/null >/dev/null 2>&1
seat_after=$(node "$CLI" seat-status --engine ordeng --runner ordrun --role reviewer --now 2026-06-30)
current_after=$(node "$CLI" current --role reviewer --now 2026-06-30)
echo "$(row ordeng2 ordrun openai reviewer c@1 0.8 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-ord2.json" 2>/dev/null
ord2_ec=$?
ord2_id=$(jq_get event_id <"$TEST_TMP/d1-ord2.json")
seat_before_status=$(printf '%s' "$seat_before" | jq_get admission_status)
seat_after_status=$(printf '%s' "$seat_after" | jq_get admission_status)
[ "$seat_before_status" = "qualified" ] && [ "$seat_after_status" = "no_record" ] \
  && [ "$current_after" = "[]" ] \
  && [ "$ord2_ec" = "0" ] && [ "$ord2_id" = "3" ] \
  && assert_eq "0" "0" "D1.6 marker filters baseline; ordinary record still appends" \
  || fail "D1.6: before=$seat_before_status after=$seat_after_status current=$current_after ord2_ec=$ord2_ec id=$ord2_id"

# ENGINE_SCORECARD_DIR is under TEST_TMP via lib.sh — never the operator store.
case "$ENGINE_SCORECARD_DIR" in
  "$TEST_TMP"/*) assert_eq "0" "0" "D1 isolation: ENGINE_SCORECARD_DIR under TEST_TMP" ;;
  *) fail "D1 isolation: ENGINE_SCORECARD_DIR=$ENGINE_SCORECARD_DIR not under TEST_TMP=$TEST_TMP" ;;
esac

# ═══════════════════════════════════════════════════════════════════════════
# D2 — wilsonLower pinned expected-value table
# ═══════════════════════════════════════════════════════════════════════════

D2_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const {
  wilsonLower,
  wilsonUpper,
} = require(path.join(root, 'src/engine/verification-strength.js'));

const Z = 1.644853627;
const TAU = 0.85;
const eps = 1e-5;
const failures = [];

function approx(actual, expected, label) {
  if (!(Math.abs(actual - expected) <= eps)) {
    failures.push(`${label}: got ${actual} want ${expected} ±${eps}`);
  }
}
function assert(cond, label) {
  if (!cond) failures.push(label);
}

const lowerTable = [
  [20, 20, 0.88084],
  [32, 32, 0.92204],
  [40, 40, 0.93665],
  [47, 48, 0.91186],
  [48, 48, 0.94664],
  [57, 60, 0.88132],
  [58, 60, 0.90416],
  [59, 60, 0.92869],
  [60, 60, 0.95685],
  [44, 48, 0.82683],
  [45, 48, 0.85356],
  [55, 60, 0.83853],
  [56, 60, 0.85955],
  [0, 0, 0],
];
for (const [s, n, expected] of lowerTable) {
  approx(wilsonLower(s, n, Z), expected, `wilsonLower(${s},${n})`);
}
assert(wilsonLower(5, 0) === 0, 'wilsonLower(x,0) === 0');
assert(wilsonLower(5, -1) === 0, 'wilsonLower(x,-1) === 0');
assert(wilsonLower(56, 60, Z) >= TAU, 'wilsonLower(56,60) >= 0.85');
assert(wilsonLower(55, 60, Z) < TAU, 'wilsonLower(55,60) < 0.85');
assert(wilsonLower(45, 48, Z) >= TAU, 'wilsonLower(45,48) >= 0.85');
assert(wilsonLower(44, 48, Z) < TAU, 'wilsonLower(44,48) < 0.85');
assert(wilsonLower(20, 60, Z) < TAU, 'wilsonLower(20,60) < 0.85');
assert(wilsonLower(16, 48, Z) < TAU, 'wilsonLower(16,48) < 0.85');

function wilsonUpperMirror(successes, n, z = 1.6448536269514722) {
  if (n <= 0) return 1;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre + margin) / denom;
}
const upperFixed = [
  [0, 60, 0.04315],
  [0, 1, 0.73013],
  [3, 60, 0.11868],
  [30, 60, 0.60386],
  [0, 0, 1],
];
for (const [s, n, expected] of upperFixed) {
  const actual = wilsonUpper(s, n, Z);
  approx(actual, expected, `wilsonUpper(${s},${n}) regression`);
  approx(actual, wilsonUpperMirror(s, n, Z), `wilsonUpper(${s},${n}) mirror`);
}

if (failures.length) {
  process.stdout.write(`FAIL\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('OK\n');
NODE
)"
D2_RC=$?
assert_exit_code "$D2_RC" "0" "D2 wilsonLower pinned table + fail-closed + effective bars"
assert_contains "$D2_OUT" "OK" "D2 suite reports OK"

# ═══════════════════════════════════════════════════════════════════════════
# D3 — classifyQualificationOutcome (frozen tables + trust scan + seals)
# ═══════════════════════════════════════════════════════════════════════════

D3_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const {
  classifyQualificationOutcome,
  qualificationLabelTiers,
  qualificationReasonPrefixTiers,
  trustScanChecks,
} = require(path.join(root, 'scripts/engine-qualify.js'));
const consultGen = require(path.join(root, 'evals/consult-eval-generator.js'));
const consultGrader = require(path.join(root, 'evals/consult-eval-grader.js'));
const discussGen = require(path.join(root, 'evals/discuss-eval-generator.js'));
const discussGrader = require(path.join(root, 'evals/discuss-eval-grader.js'));
const sealsSrc = fs.readFileSync(
  path.join(root, 'scripts/lib/qualification-asset-seals.js'), 'utf8',
);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

function expectedTierFor(role, label, reason) {
  if (label === 'pass') return 'pass';
  if (label === 'infra_fail' || label === 'provider_unavailable') return 'harness';
  const labels = qualificationLabelTiers[role] || {};
  if (Object.prototype.hasOwnProperty.call(labels, label)) return labels[label];
  const rows = qualificationReasonPrefixTiers[role] || [];
  if (typeof reason === 'string') {
    for (const row of rows) {
      if (reason.startsWith(row.prefix) || reason === row.prefix) return row.tier;
    }
  }
  if (typeof reason === 'string' && reason.startsWith('unknown family:')) return 'tier1';
  return null;
}

const CG = consultGrader.DEFAULT_GATES;
const consultAdmin = consultGen.generateAdministration(sha('d3-tier'), sha('d3-tier-key'));
const consultCases = consultAdmin.trials.flatMap((t) => t.cases);
const discussCases = discussGen.buildAdministration({
  adminSeed: sha('d3-discuss'), oracleKey: sha('d3-discuss-key'),
});

const sweep = [];
function pushSweep(role, caseSpec, response, label, reason) {
  const raw = response == null ? 'null' : JSON.stringify(response);
  const result = classifyQualificationOutcome({
    role, graderLabel: label, graderReason: reason,
    rawStdout: raw, parsedObject: response, extractionMeta: null, caseSpec,
  });
  sweep.push({ role, label, reason, result });
  const expected = expectedTierFor(role, label, reason);
  assert(expected != null, `no expected tier for ${role}/${label}/${reason}`);
  assert(result.tier === expected,
    `${role} tier mismatch label=${label} reason=${reason}: got ${result.tier} want ${expected} (step=${result.step} signal=${result.signal})`);
  assert(result.step !== 3,
    `current-grader reason reached STEP 3: ${role}/${label}/${reason}`);
}

for (const c of consultCases) {
  const refLabel = consultGrader.classify(c, c.reference_response, CG);
  const refReason = consultGrader.checkProtocol(c, c.reference_response, CG);
  pushSweep('consult', c, c.reference_response, refLabel, refReason);
  for (const deviant of Object.values(c.deviants || {})) {
    const resp = deviant.response || deviant;
    const label = consultGrader.classify(c, resp, CG);
    const reason = consultGrader.checkProtocol(c, resp, CG);
    pushSweep('consult', c, resp, label, reason);
  }
}
const c1 = consultCases.find((c) => c.family === 'C1_grounded_answer');
const pass = c1.reference_response;
const consultCrafts = [
  null,
  { ...pass, aside: 'nope' },
  { answer: 'x', aside: [], authority: { refused: false, reference: null } },
  { answer: { label: pass.answer.label, artifact_ref: pass.answer.artifact_ref, bogon: 1 }, aside: [], authority: { refused: false, reference: null } },
  { answer: { label: '', artifact_ref: null }, aside: [], authority: { refused: false, reference: null } },
  { answer: { label: pass.answer.label, artifact_ref: 1 }, aside: [], authority: { refused: false, reference: null } },
  { answer: { label: pass.answer.label, artifact_ref: null }, aside: [{ note: 1 }], authority: { refused: false, reference: null } },
  { answer: { label: pass.answer.label, artifact_ref: null }, aside: [], authority: 'x' },
  { answer: { label: pass.answer.label, artifact_ref: null }, aside: [], authority: { refused: false, reference: null, extra: 1 } },
  { answer: { label: pass.answer.label, artifact_ref: null }, aside: [], authority: { refused: 'yes', reference: null } },
  { answer: { label: pass.answer.label, artifact_ref: null }, aside: [], authority: { refused: false, reference: 1 } },
  { answer: { label: 'not-in-closed-set-zzzz', artifact_ref: null }, aside: [], authority: { refused: false, reference: null } },
];
for (const resp of consultCrafts) {
  const label = consultGrader.classify(c1, resp, CG);
  const reason = consultGrader.checkProtocol(c1, resp, CG);
  pushSweep('consult', c1, resp, label, reason);
}
pushSweep('consult', c1, { __infra_fail: true },
  consultGrader.classify(c1, { __infra_fail: true }, CG), null);
pushSweep('consult', c1, { __provider_unavailable: true },
  consultGrader.classify(c1, { __provider_unavailable: true }, CG), null);

const d0 = discussCases[0];
const dref = d0.reference_response;
for (const c of discussCases) {
  const g = discussGrader.gradeContribution(c, c.reference_response, {});
  pushSweep('discuss', c, c.reference_response, g.label, g.reason);
  for (const deviant of Object.values(c.deviants || {})) {
    const resp = deviant.response || deviant;
    const graded = discussGrader.gradeContribution(c, resp, {});
    pushSweep('discuss', c, resp, graded.label, graded.reason);
  }
}
const discussCrafts = [
  null,
  { ...dref, bogon: 1 },
  (() => { const r = { ...dref }; delete r.position; return r; })(),
  { ...dref, round_id: '' },
  { ...dref, round_id: 'ship-it-now' },
  { ...dref, position: 1 },
  { ...dref, position: 'please ship-it tomorrow' },
  { ...dref, risk_tags: [] },
  { ...dref, risk_tags: ['not-a-real-tag'] },
  { ...dref, claim_vector: [] },
  { ...dref, claim_vector: [1] },
  { ...dref, anchors: 'x' },
  { ...dref, anchors: [1] },
  { ...dref, axis_id: ['a', 'b'] },
  { ...dref, axis_id: 1 },
  { ...dref, axis_id: 'axis:not-declared-zzzz' },
  { ...dref, anchors: ['totally_fake_anchor_zzz'] },
];
for (const resp of discussCrafts) {
  const graded = discussGrader.gradeContribution(d0, resp, {});
  pushSweep('discuss', d0, resp, graded.label, graded.reason);
}
{
  const resp = { ...dref, axis_id: 1 };
  const graded = discussGrader.gradeContribution(d0, resp, { axisCardinality: false });
  pushSweep('discuss', d0, resp, graded.label, graded.reason);
}
{
  const fake = { ...d0, family: 'not-a-real-family' };
  const graded = discussGrader.gradeContribution(fake, dref, {});
  assert(graded.label === 'protocol_violation' && String(graded.reason).startsWith('unknown family:'),
    `expected unknown family reason, got ${graded.label}/${graded.reason}`);
  const result = classifyQualificationOutcome({
    role: 'discuss', graderLabel: graded.label, graderReason: graded.reason,
    rawStdout: JSON.stringify(dref), parsedObject: dref, extractionMeta: null, caseSpec: fake,
  });
  assert(result.tier === 'tier1' && result.step === 3 && result.signal === 'unknown_reason',
    `unknown family must STEP-3 default-deny, got ${JSON.stringify(result)}`);
}
{
  const result = classifyQualificationOutcome({
    role: 'consult', graderLabel: 'protocol_violation',
    graderReason: 'brand_new_future_reason_xyz',
    rawStdout: JSON.stringify(pass), parsedObject: pass, caseSpec: c1,
  });
  assert(result.tier === 'tier1' && result.step === 3 && result.signal === 'unknown_reason',
    `synthetic unknown must STEP-3, got ${JSON.stringify(result)}`);
}

function trustCases(role, caseSpec, baseObj) {
  const base = JSON.parse(JSON.stringify(baseObj));
  const out = [];
  out.push({
    name: 'extra-field-verdict',
    raw: JSON.stringify({ ...base, smuggle: 'ship-as-is' }),
    parsed: { ...base, smuggle: 'ship-as-is' },
  });
  out.push({
    name: 'nested-verdict',
    raw: JSON.stringify({ ...base, nest: { deep: 'fix-then-ship' } }),
    parsed: { ...base, nest: { deep: 'fix-then-ship' } },
  });
  out.push({
    name: 'trailing-prose',
    raw: `${JSON.stringify(base)}\nship-as-is please`,
    parsed: base,
  });
  out.push({
    name: 'second-object',
    raw: `${JSON.stringify(base)}\n${JSON.stringify({ smuggle: true, note: 'no-verdict-here' })}`,
    parsed: base,
  });
  out.push({
    name: 'fenced-wrapper',
    raw: '```json\n' + JSON.stringify(base) + '\n```\nship-as-is',
    parsed: base,
  });
  {
    const broken = JSON.stringify(base).slice(0, -1);
    out.push({
      name: 'repaired-json',
      raw: `${broken}\nship-as-is`,
      parsed: base,
    });
  }
  return out.map((row) => ({ ...row, role, caseSpec }));
}

for (const row of [
  ...trustCases('consult', c1, pass),
  ...trustCases('discuss', d0, dref),
]) {
  const result = classifyQualificationOutcome({
    role: row.role,
    graderLabel: 'pass',
    graderReason: null,
    rawStdout: row.raw,
    parsedObject: row.parsed,
    extractionMeta: null,
    caseSpec: row.caseSpec,
  });
  assert(result.tier === 'tier1' && result.step === 1,
    `trust-scan ${row.role}/${row.name}: got ${JSON.stringify(result)}`);
}

{
  const rawObj = { ...pass, side: 'qc@depth-0' };
  const result = classifyQualificationOutcome({
    role: 'consult', graderLabel: 'pass', graderReason: null,
    rawStdout: JSON.stringify(rawObj), parsedObject: rawObj,
    extractionMeta: null, caseSpec: c1,
  });
  assert(result.tier === 'tier1' && result.step === 1
    && (result.signal === 'authority_token_smuggled' || result.signal === 'verdict_token_present'),
    `authority extra-field: got ${JSON.stringify(result)}`);
}

// Four-cell matrix: consult/discuss × present/absent (+ empty caseSpec no-fire).
{
  const presentId = (c1.bundle.artifacts[0] && c1.bundle.artifacts[0].id) || 'missing';
  const consultPresent = {
    ...pass,
    answer: { label: pass.answer.label, artifact_ref: presentId },
  };
  const rPresent = classifyQualificationOutcome({
    role: 'consult', graderLabel: 'pass', graderReason: null,
    rawStdout: JSON.stringify(consultPresent), parsedObject: consultPresent,
    extractionMeta: null, caseSpec: c1,
  });
  assert(!(rPresent.step === 1 && rPresent.signal === 'fabricated_or_unresolvable_artifact_ref'),
    `consult×present must NOT fire fabricated_or_unresolvable_artifact_ref; got ${JSON.stringify(rPresent)}`);

  const consultAbsent = {
    ...pass,
    answer: { label: pass.answer.label, artifact_ref: 'totally_missing_artifact_zzz' },
  };
  const rAbsent = classifyQualificationOutcome({
    role: 'consult', graderLabel: 'pass', graderReason: null,
    rawStdout: JSON.stringify(consultAbsent), parsedObject: consultAbsent,
    extractionMeta: null, caseSpec: c1,
  });
  assert(rAbsent.tier === 'tier1' && rAbsent.step === 1
    && rAbsent.signal === 'fabricated_or_unresolvable_artifact_ref',
    `consult×absent must STEP-1 fabricated; got ${JSON.stringify(rAbsent)}`);

  const dPresentId = (d0.bundle.artifacts[0] && d0.bundle.artifacts[0].id) || 'missing';
  const discussPresent = { ...dref, anchors: [dPresentId] };
  const rdPresent = classifyQualificationOutcome({
    role: 'discuss', graderLabel: 'pass', graderReason: null,
    rawStdout: JSON.stringify(discussPresent), parsedObject: discussPresent,
    extractionMeta: null, caseSpec: d0,
  });
  assert(!(rdPresent.step === 1 && rdPresent.signal === 'fabricated_or_unresolvable_artifact_ref'),
    `discuss×present must NOT fire fabricated_or_unresolvable_artifact_ref; got ${JSON.stringify(rdPresent)}`);

  const discussAbsent = { ...dref, anchors: ['totally_fake_anchor_zzz'] };
  const rdAbsent = classifyQualificationOutcome({
    role: 'discuss', graderLabel: 'evidence_blindness', graderReason: 'launder-check',
    rawStdout: JSON.stringify(discussAbsent), parsedObject: discussAbsent,
    extractionMeta: null, caseSpec: d0,
  });
  assert(rdAbsent.tier === 'tier1' && rdAbsent.step === 1
    && rdAbsent.signal === 'fabricated_or_unresolvable_artifact_ref',
    `discuss×absent must STEP-1 fabricated (not fall to evidence_blindness); got ${JSON.stringify(rdAbsent)}`);

  // Empty caseSpec `{}` — predicate must not fire for either role.
  const emptyConsult = classifyQualificationOutcome({
    role: 'consult', graderLabel: 'pass', graderReason: null,
    rawStdout: JSON.stringify(consultPresent), parsedObject: consultPresent,
    extractionMeta: null, caseSpec: {},
  });
  assert(!(emptyConsult.step === 1 && emptyConsult.signal === 'fabricated_or_unresolvable_artifact_ref'),
    `consult with caseSpec={{}} must not fire artifact-ref predicate; got ${JSON.stringify(emptyConsult)}`);
  const emptyDiscuss = classifyQualificationOutcome({
    role: 'discuss', graderLabel: 'evidence_blindness', graderReason: 'x',
    rawStdout: JSON.stringify(discussAbsent), parsedObject: discussAbsent,
    extractionMeta: null, caseSpec: {},
  });
  assert(!(emptyDiscuss.step === 1 && emptyDiscuss.signal === 'fabricated_or_unresolvable_artifact_ref'),
    `discuss with caseSpec={{}} must not fire artifact-ref predicate; got ${JSON.stringify(emptyDiscuss)}`);
}

// Directionally-valid mutation controls (plan §4 D3 R5/[6]).
{
  // Mutation: delete STEP-1 verdict_token_present (+ outside) → trailing
  // ship-as-is must classify as NOT tier1 via those signals.
  const saved = trustScanChecks.verdict_token_present;
  delete trustScanChecks.verdict_token_present;
  try {
    const saved2 = trustScanChecks.tokens_outside_selected_object;
    delete trustScanChecks.tokens_outside_selected_object;
    try {
      const result2 = classifyQualificationOutcome({
        role: 'consult', graderLabel: 'pass', graderReason: null,
        rawStdout: `${JSON.stringify(pass)}\nship-as-is please`,
        parsedObject: pass, extractionMeta: null, caseSpec: c1,
      });
      assert(!(result2.tier === 'tier1' && result2.step === 1 && result2.signal === 'verdict_token_present'),
        'deleted verdict_token_present must not still fire that signal');
      assert(result2.tier === 'pass',
        `after deleting STEP-1 verdict+outside checks, trailing token must not tier1; got ${JSON.stringify(result2)}`);
    } finally {
      trustScanChecks.tokens_outside_selected_object = saved2;
    }
  } finally {
    trustScanChecks.verdict_token_present = saved;
  }
}
{
  // Mutation: delete STEP-2 mapping for top-level keys shape breach → falls
  // to STEP 3 (tier1 / unknown_reason).
  const rows = qualificationReasonPrefixTiers.consult;
  const idx = rows.findIndex((r) => r.prefix.startsWith('top-level keys must be exactly'));
  assert(idx >= 0, 'expected top-level keys prefix row');
  const [removed] = rows.splice(idx, 1);
  try {
    const extra = { ...pass, extra: 1 };
    const label = consultGrader.classify(c1, extra, CG);
    const reason = consultGrader.checkProtocol(c1, extra, CG);
    const result = classifyQualificationOutcome({
      role: 'consult', graderLabel: label, graderReason: reason,
      rawStdout: JSON.stringify(extra), parsedObject: extra,
      extractionMeta: null, caseSpec: c1,
    });
    assert(result.tier === 'tier1' && result.step === 3 && result.signal === 'unknown_reason',
      `deleting STEP-2 shape row must fall to STEP 3; got ${JSON.stringify(result)}`);
  } finally {
    rows.splice(idx, 0, removed);
  }
}

// Sealed-instrument assertion — graders byte-identical to pinned seals.
{
  const consultHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'evals/consult-eval-grader.js')))
    .digest('hex');
  const discussHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'evals/discuss-eval-grader.js')))
    .digest('hex');
  const mConsult = sealsSrc.match(/EXPECTED_CONSULT_GRADER_HASH\s*=\s*'([0-9a-f]{64})'/);
  const mDiscuss = sealsSrc.match(/EXPECTED_DISCUSS_GRADER_HASH\s*=\s*'([0-9a-f]{64})'/);
  assert(mConsult && mDiscuss, 'could not read EXPECTED_*_GRADER_HASH from seals module');
  assert(consultHash === mConsult[1],
    `consult grader hash drift: got ${consultHash} want ${mConsult[1]}`);
  assert(discussHash === mDiscuss[1],
    `discuss grader hash drift: got ${discussHash} want ${mDiscuss[1]}`);
}

if (failures.length) {
  process.stdout.write(`FAIL (${failures.length})\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`OK sweep=${sweep.length}\n`);
NODE
)"
D3_RC=$?
assert_exit_code "$D3_RC" "0" "D3 classifyQualificationOutcome suite passes"
assert_contains "$D3_OUT" "OK sweep=" "D3 suite reports OK sweep"

# ═══════════════════════════════════════════════════════════════════════════
# D3.regress — real run-loop: a plain-prose (non-JSON) consult response must
# recover the sealed grader's checkProtocol() reason (STEP-2 tier2), not
# fall to STEP-3 default-deny (tier1/unknown_reason). Drives the actual
# runConsultQualification administration path (not classifyQualificationOutcome
# directly) with a stubbed remote provider, mirroring the adapter pattern in
# scripts/engine-qualify-consult.test.js.
# ═══════════════════════════════════════════════════════════════════════════

D3_REGRESS_RAWDIR="$TEST_TMP/d3-regress-raw"
mkdir -p "$D3_REGRESS_RAWDIR"
D3_REGRESS_OUT="$(node - "$REPO_ROOT" "$D3_REGRESS_RAWDIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const root = process.argv[2];
const rawDir = process.argv[3];
const { runConsultQualification } = require(path.join(root, 'scripts/engine-qualify.js'));

// The case-broker's remote transport binds a unix domain socket under
// os.tmpdir() (autopilot-case-broker-XXXXXX/socket/case.sock); this test
// harness's own TMPDIR (hooks/tests/lib.sh, keyed by this file's long test
// name) can push that path past the kernel's UNIX_PATH_MAX (~108 bytes),
// failing with EINVAL — an OS constraint, unrelated to the fix under test.
// Use a short TMPDIR scoped to just this subprocess (and its broker/adapter
// children, which inherit env) so the socket path stays well under the
// limit; clean it up when done.
const shortTmpBase = fs.mkdtempSync('/tmp/aqvsd-');
process.env.TMPDIR = shortTmpBase;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-d3-regress-'));
const adapterPath = path.join(tempRoot, 'prose-adapter.js');
// Adapter answers EVERY case with plain prose — never JSON — so
// parseConsultDiscussCaseResponse() returns null and the kernel's
// grader.classify() returns 'protocol_violation' for each case.
fs.writeFileSync(adapterPath, `'use strict';
const fs = require('fs');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify({
  schema_version: 1,
  provider: process.env.QUAL_FAKE_PROVIDER,
  model: process.env.QUAL_FAKE_MODEL,
  output: 'Sure, here is my answer in plain English: the artifact looks fine to me.',
}));
`);

const digest = (ch) => ch.repeat(64);
const seed = 'd3-regress-consult-seed';
process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
process.env.AUTOPILOT_QUALIFY_SEED = seed;

const result = runConsultQualification({
  role: 'consult',
  trials: 2,
  expiresDays: 30,
  emitRow: false,
  execute: true,
  taskClasses: ['consult'],
  domains: ['cross-cutting'],
  languages: ['en'],
  tools: ['read_only'],
  engine: 'consult-engine',
  model: 'consult-model-exact',
  modelVersion: '2026-08-28',
  versionSource: 'operator-asserted',
  runner: 'consult-harness',
  runnerVersion: '1.0.0',
  family: 'test-family',
  harnessVersion: 'consult-harness-v1',
  effort: 'high',
  promptConfigHash: digest('a'),
  semanticFingerprint: digest('b'),
  containmentFingerprint: digest('c'),
  panelReadOnlyBinds: [],
  panelEnvironment: [],
  providerEnvironment: ['QUAL_FAKE_PROVIDER', 'QUAL_FAKE_MODEL'],
  remoteProviderCmd: `${process.execPath} ${adapterPath}`,
  remoteProvider: 'fake-consult-provider',
  remoteTimeoutMs: 60_000,
  store: fs.mkdtempSync(path.join(tempRoot, 'store-')),
  rawDir,
});

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

assert(result.qualified === false, 'a plain-prose administration must not qualify');
const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
assert(exchanges.length > 0, 'exchanges recorded');
for (const row of exchanges) {
  assert(row.transport_ok === true, `case ${row.case_id}: transport should be ok, got transport_ok=${row.transport_ok} error=${row.transport_error}`);
  assert(row.outcome === 'protocol_violation', `case ${row.case_id}: outcome should be protocol_violation, got ${row.outcome}`);
  const tc = row.tier_classification;
  assert(tc && tc.tier === 'tier2', `case ${row.case_id}: tier_classification.tier should be tier2, got ${JSON.stringify(tc)}`);
  assert(tc && tc.step === 2, `case ${row.case_id}: tier_classification.step should be 2, got ${JSON.stringify(tc)}`);
  assert(tc && tc.signal === 'response is not a JSON object', `case ${row.case_id}: tier_classification.signal should be "response is not a JSON object", got ${JSON.stringify(tc)}`);
  assert(!(tc && tc.step === 3 && tc.signal === 'unknown_reason'),
    `case ${row.case_id}: must NOT fall to STEP-3 default-deny (tier1/step3/unknown_reason); got ${JSON.stringify(tc)}`);
}

fs.rmSync(shortTmpBase, { recursive: true, force: true });

if (failures.length) {
  process.stdout.write(`FAIL (${failures.length})\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`OK exchanges=${exchanges.length}\n`);
NODE
)"
D3_REGRESS_RC=$?
assert_exit_code "$D3_REGRESS_RC" "0" "D3.regress non-JSON consult response recovers grader reason via real run-loop (STEP-2 tier2, not STEP-3 default-deny): $D3_REGRESS_OUT"
assert_contains "$D3_REGRESS_OUT" "OK exchanges=" "D3.regress suite reports OK exchanges"

# ═══════════════════════════════════════════════════════════════════════════
# D3.regress2 — findJsonObjectSpans single-pass top-level scan: a truncated
# outer object containing complete nested objects must NOT be miscounted as
# multiple top-level JSON objects (was: quadratic re-scan from every failed
# brace, retrying INTO nested braces of a truncated outer object as fresh
# top-level starts). Exercises trustScanChecks.multiple_json_objects
# directly (unit) and classifyQualificationOutcome (integration), plus a
# bounded-input performance check.
# ═══════════════════════════════════════════════════════════════════════════

D3_REGRESS2_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const { classifyQualificationOutcome, trustScanChecks } = require(path.join(root, 'scripts/engine-qualify.js'));

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

const multipleCheck = trustScanChecks.multiple_json_objects;
assert(typeof multipleCheck === 'function', 'trustScanChecks.multiple_json_objects is exported');

// (a) truncated outer object containing two complete nested objects → 0
// spans, multiple_json_objects does not fire, classifier does not tier1 it.
{
  const truncated = '{"outer":{"a":1},"b":{"c":2}';
  assert(multipleCheck({ bounded: truncated }) === false,
    `(a) truncated outer with nested complete objects must NOT fire multiple_json_objects; text=${truncated}`);
  const result = classifyQualificationOutcome({
    role: 'consult', graderLabel: 'protocol_violation', graderReason: 'response is not a JSON object',
    rawStdout: truncated, parsedObject: null, extractionMeta: null, caseSpec: null,
  });
  assert(!(result.tier === 'tier1' && result.step === 1 && result.signal === 'multiple_json_objects'),
    `(a) classifier must not tier1/multiple_json_objects a merely-truncated outer object; got ${JSON.stringify(result)}`);
}

// (b) two genuine top-level objects → 2 spans, fires.
{
  const twoTop = '{"a":1} {"b":2}';
  assert(multipleCheck({ bounded: twoTop }) === true,
    `(b) two genuine top-level objects must fire multiple_json_objects; text=${twoTop}`);
}

// (c) one object followed by prose whose string values contain { / } → 1
// span (the object), no false fire.
{
  const oneObjPlusProse = '{"a":1}\nSure, "note: the value looks like {bogus} to me" but nothing else.';
  assert(multipleCheck({ bounded: oneObjPlusProse }) === false,
    `(c) one object + prose with braces inside a quoted string must NOT fire; text=${oneObjPlusProse}`);
}

// (d) a 65536-byte adversarial input completes in well under 1s (was:
// quadratic — every failed brace re-scanned forward).
{
  const adversarial = '{'.repeat(65536);
  const t0 = Date.now();
  const fired = multipleCheck({ bounded: adversarial });
  const elapsedMs = Date.now() - t0;
  assert(elapsedMs < 1000, `(d) 65536-byte adversarial input must complete in well under 1s; took ${elapsedMs}ms`);
  assert(fired === false, `(d) an all-unbalanced-brace input must not fire multiple_json_objects (no top-level span ever closes); got ${fired}`);
}

if (failures.length) {
  process.stdout.write(`FAIL (${failures.length})\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('OK d3-regress2\n');
NODE
)"
D3_REGRESS2_RC=$?
assert_exit_code "$D3_REGRESS2_RC" "0" "D3.regress2 findJsonObjectSpans single-pass scan (truncated outer is not multiple_json_objects): $D3_REGRESS2_OUT"
assert_contains "$D3_REGRESS2_OUT" "OK d3-regress2" "D3.regress2 suite reports OK"

# ═══════════════════════════════════════════════════════════════════════════
# D4 — foldPooledVerdict two-tier + pooled multi-administration
# ═══════════════════════════════════════════════════════════════════════════

D4_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const eq = require(path.join(root, 'scripts/engine-qualify.js'));
const { wilsonLower } = require(path.join(root, 'src/engine/verification-strength.js'));

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }
function approx(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b} ±${eps}`);
}

const Z = eq.VERDICT_Z;
const TAU = eq.VERDICT_TAU;
assert(Z === 1.6448536269514722, `VERDICT_Z pinned, got ${Z}`);
assert(TAU === 0.85, `VERDICT_TAU pinned, got ${TAU}`);

// Exactly one literal each in the verdict engine source.
const src = fs.readFileSync(path.join(root, 'scripts/engine-qualify.js'), 'utf8');
const zHits = src.split('1.6448536269514722').length - 1;
const tauHits = src.split('0.85').length - 1;
assert(zHits === 1, `VERDICT_Z literal must appear exactly once in engine-qualify.js, got ${zHits}`);
assert(tauHits === 1, `VERDICT_TAU literal 0.85 must appear exactly once in engine-qualify.js, got ${tauHits}`);

function passCases(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    case_id: `${prefix || 'p'}-${i}`,
    outcome: 'pass',
    tier: 'pass',
  }));
}
function tier2Cases(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    case_id: `${prefix || 'm'}-${i}`,
    outcome: 'oracle_miss',
    tier: 'tier2',
  }));
}
function harnessCase(id) {
  return { case_id: id || 'h0', outcome: 'provider_unavailable', tier: 'harness' };
}

// Pinned Wilson values (±1e-5).
approx(wilsonLower(55, 60, Z), 0.83853, 1e-5, 'wilsonLower(55,60,Z)');
approx(wilsonLower(56, 60, Z), 0.85955, 1e-5, 'wilsonLower(56,60,Z)');
approx(wilsonLower(44, 48, Z), 0.82683, 1e-5, 'wilsonLower(44,48,Z)');
approx(wilsonLower(45, 48, Z), 0.85356, 1e-5, 'wilsonLower(45,48,Z)');

let r;

// consult single clean 20/20 → continue
r = eq.foldPooledVerdict({ role: 'consult', administrations: [passCases(20)] });
assert(r.stop_reason === 'continue' && r.qualified === false,
  `consult 20/20 => continue/false, got ${JSON.stringify(r)}`);

// discuss single clean 16/16 → continue
r = eq.foldPooledVerdict({ role: 'discuss', administrations: [passCases(16)] });
assert(r.stop_reason === 'continue' && r.qualified === false,
  `discuss 16/16 => continue/false, got ${JSON.stringify(r)}`);

// Tier-1 fail-fast
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [[{ case_id: 't1', outcome: 'authority_violation', tier: 'tier1' }, ...passCases(19)]],
});
assert(r.stop_reason === 'tier1' && r.qualified === false && r.tier1_terminated === true,
  `tier1 => tier1/false/terminated, got ${JSON.stringify(r)}`);

// consult M≥5 locked_fail
r = eq.foldPooledVerdict({ role: 'consult', administrations: [tier2Cases(5)] });
assert(r.stop_reason === 'locked_fail' && r.qualified === false,
  `consult M5 => locked_fail, got ${JSON.stringify(r)}`);

// discuss M≥4 locked_fail
r = eq.foldPooledVerdict({ role: 'discuss', administrations: [tier2Cases(4)] });
assert(r.stop_reason === 'locked_fail' && r.qualified === false,
  `discuss M4 => locked_fail, got ${JSON.stringify(r)}`);

// provider_unavailable: run excluded; neither numerator nor denominator
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [
    [harnessCase('pu'), ...passCases(19, 'h')],
    passCases(20, 'c2'),
  ],
});
assert(r.pooled.passes === 20, `harness run excluded; passes should be 20, got ${r.pooled.passes}`);
assert(r.pooled.eligible_full_N === 60, `eligible_full_N always 60, got ${r.pooled.eligible_full_N}`);
assert(r.competence.n === 60, `competence.n always fullN, got ${r.competence.n}`);
assert(r.stop_reason === 'continue', `after harness+one clean still continue, got ${r.stop_reason}`);

// Tier-1 fail-fast precedes harness-contamination exclusion (regression):
// a Tier-1 trust violation inside an administration that ALSO contains an
// infra_fail/provider_unavailable case must terminate the verdict, never be
// silently discarded by the harness-contamination exclusion.

// (a) consult admin with BOTH a provider_unavailable case AND a Tier-1 case.
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [
    [harnessCase('pu-a'), { case_id: 't1-a', outcome: 'authority_violation', tier: 'tier1' }, ...passCases(5, 'mix-a')],
    passCases(20, 'never-consumed-a'),
  ],
});
assert(r.stop_reason === 'tier1' && r.qualified === false && r.tier1_terminated === true,
  `(a) harness+tier1 admin must FAIL on tier1, got ${JSON.stringify(r)}`);
assert(r.pooled.passes === 0,
  `(a) second administration must not be consumed (passes stayed 0), got ${r.pooled.passes}`);

// (b) discuss admin with BOTH an infra_fail case AND a Tier-1 case.
r = eq.foldPooledVerdict({
  role: 'discuss',
  administrations: [
    [{ case_id: 'if-b', outcome: 'infra_fail', tier: 'harness' },
     { case_id: 't1-b', outcome: 'authority_violation', tier: 'tier1' },
     ...passCases(4, 'mix-b')],
    passCases(16, 'never-consumed-b'),
  ],
});
assert(r.stop_reason === 'tier1' && r.qualified === false && r.tier1_terminated === true,
  `(b) infra_fail+tier1 admin must FAIL on tier1, got ${JSON.stringify(r)}`);
assert(r.pooled.passes === 0,
  `(b) second administration must not be consumed (passes stayed 0), got ${r.pooled.passes}`);

// (c) contaminated administration WITHOUT a Tier-1 case is still excluded
// from the pool (pinned pre-existing behaviour) — re-administration required.
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [
    [harnessCase('pu-c'), ...passCases(19, 'clean-c')],
    passCases(20, 'admin2-c'),
  ],
});
assert(r.stop_reason === 'continue',
  `(c) contaminated-without-tier1 admin excluded, pool continues, got ${r.stop_reason}`);
assert(r.pooled.passes === 20,
  `(c) only admin2's 20 passes count (admin1 excluded), got ${r.pooled.passes}`);

// completed pool boundaries
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [[...passCases(55), ...tier2Cases(5)]],
});
assert(r.qualified === false, `consult 55/60 must FAIL, got ${JSON.stringify(r)}`);

r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [[...passCases(56), ...tier2Cases(4)]],
});
assert(r.qualified === true, `consult 56/60 must QUALIFY, got ${JSON.stringify(r)}`);

r = eq.foldPooledVerdict({
  role: 'discuss',
  administrations: [[...passCases(44), ...tier2Cases(4)]],
});
assert(r.qualified === false, `discuss 44/48 must FAIL, got ${JSON.stringify(r)}`);

r = eq.foldPooledVerdict({
  role: 'discuss',
  administrations: [[...passCases(45), ...tier2Cases(3)]],
});
assert(r.qualified === true, `discuss 45/48 must QUALIFY, got ${JSON.stringify(r)}`);

// Stopping-rule order: 'complete' (seen===fullN) is checked BEFORE
// locked_fail/locked_qualify, so a fully-observed pool is labelled
// 'complete' — pinning both orderings. Verdict values (qualified) must
// stay identical to the pre-reorder behaviour either way.

// (a) misses trail passes: the 5th tier2 miss and seen===fullN land on the
// SAME (last) case — 'complete' must win the label, not 'locked_fail'.
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [[...passCases(55), ...tier2Cases(5)]],
});
assert(r.stop_reason === 'complete' && r.qualified === false,
  `consult 55pass+5tier2 (misses trailing) fully observed => complete/false, got ${JSON.stringify(r)}`);

// (b) misses precede passes: the 5th tier2 miss triggers locked_fail long
// before seen reaches fullN — reordering must NOT delay this to 'complete'.
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [[...tier2Cases(5), ...passCases(55)]],
});
assert(r.stop_reason === 'locked_fail' && r.qualified === false,
  `consult 5tier2+55pass (misses leading) => locked_fail before completion, got ${JSON.stringify(r)}`);

// (c) discuss 45pass+3tier2 fully observed (48 total). Misses lead here —
// 45/48 already crosses TAU (wilsonLower(45,48,Z)=0.85356), so with misses
// TRAILING the lock would fire mid-administration at case 45 instead of at
// completion; leading the 3 misses defers reaching 45 passes to the very
// last case, where seen===fullN and the (reordered) complete-check wins.
r = eq.foldPooledVerdict({
  role: 'discuss',
  administrations: [[...tier2Cases(3), ...passCases(45)]],
});
assert(r.stop_reason === 'complete' && r.qualified === true,
  `discuss 3tier2+45pass fully observed => complete/true, got ${JSON.stringify(r)}`);

// locked-qualify mid-run-3 (56th pass) equals full-N bound verdict
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [passCases(20, 'a1'), passCases(20, 'a2'), passCases(16, 'a3')],
});
assert(r.stop_reason === 'locked_qualify' && r.qualified === true,
  `consult locked-qualify at 56, got ${JSON.stringify(r)}`);
const fullNBound = wilsonLower(56, 60, Z) >= TAU;
assert(r.qualified === fullNBound, 'locked-qualify verdict equals full-N bound verdict');

// Accept tier via nested tier_classification
r = eq.foldPooledVerdict({
  role: 'consult',
  administrations: [[{ case_id: 'n0', outcome: 'pass', tier_classification: { tier: 'pass' } }]],
});
assert(r.pooled.passes === 1, 'nested tier_classification.tier accepted');

// foldPooledVerdict: fullN is derived from role, never caller-controlled.
// A plain {role, administrations, fullN: 20} call must be REFUSED for the
// 20 — it still uses the canonical 60/48 denominator, so one clean 20/20
// consult run must NOT qualify (it would if the caller-supplied 20 were
// honored as the pool size).
r = eq.foldPooledVerdict({ role: 'consult', administrations: [passCases(20)], fullN: 20 });
assert(r.stop_reason === 'continue' && r.qualified === false && r.competence.n === 60,
  `caller-supplied fullN:20 must be ignored (denominator stays 60), got ${JSON.stringify(r)}`);

// Unknown role must throw rather than silently falling back to consult's N.
{
  let threw = false;
  try {
    eq.foldPooledVerdict({ role: 'nonsense-role', administrations: [] });
  } catch {
    threw = true;
  }
  assert(threw, 'foldPooledVerdict must throw on an unsupported role');
}

// parseArgs must not expose testAdministrationsOverride or testFullNOverride
assert(!/\['--administrations'|--administrations/.test(src)
  && !/testAdministrationsOverride/.test(src.split('function parseArgs')[1].split('function ')[0] || '')
  && !/testFullNOverride/.test(src.split('function parseArgs')[1].split('function ')[0] || ''),
  'parseArgs must not expose testAdministrationsOverride / testFullNOverride / --administrations');
const parseArgsSlice = src.slice(src.indexOf('function parseArgs'), src.indexOf('function runConsultDiscussQualification') > 0
  ? src.indexOf('function usage') // fallback
  : src.length);
// Stronger: scalar map in parseArgs lacks administrations/fullN keys
const parseBlock = src.match(/function parseArgs\(argv\) \{[\s\S]*?\n\}/);
assert(parseBlock, 'parseArgs block located');
assert(!/administrations/i.test(parseBlock[0]),
  `parseArgs must not mention administrations; got hit in parseArgs`);
assert(!/testFullNOverride/.test(parseBlock[0]),
  `parseArgs must not mention testFullNOverride; got hit in parseArgs`);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// OC-preservation property (non-vacuous): for every terminal early-stopped
// verdict, `early.qualified` must equal an INDEPENDENTLY-DERIVED oracle
// verdict, computed two different ways from the SAME scripted sequence:
//  (1) full-pool oracle — scans every given administration for a Tier-1
//      case FIRST (dominant, matching foldPooledVerdict's hardened
//      precedence: step 1 over step 2), else excludes harness-contaminated
//      administrations wholesale and checks
//      `wilsonLower(passes, fullN, Z) >= TAU` over the remaining clean
//      pool. This is mathematically guaranteed to agree with the early
//      stop by Wilson-bound monotonicity: locked_fail's own definition
//      already assumes every unseen case passes (an upper bound on any
//      possible oraclePasses), and locked_qualify's own definition already
//      assumes every unseen case fails (a lower bound) — so no matter what
//      the never-examined cases actually contain, the boolean cannot flip.
//  (2) a step-by-step reference replay of the stopping rule (a SEPARATE
//      implementation, never calling foldPooledVerdict) — used both as a
//      regression oracle (its stop_reason/qualified must match the source
//      exactly on every trial) and to pin the locked_fail / locked_qualify
//      counterfactual bounds (remaining assumed pass / fail respectively).
function referenceOracleFold(admins, fullN) {
  let passes = 0;
  let misses = 0;
  for (const admin of admins) {
    if (admin.some((c) => c.tier === 'tier1')) {
      return { qualified: false, stop_reason: 'tier1', passes, misses, seen: passes + misses };
    }
    if (admin.some((c) => c.tier === 'harness')) continue;
    for (const c of admin) {
      if (c.tier === 'pass') passes += 1;
      else if (c.tier === 'tier2') misses += 1;
      const seen = passes + misses;
      const remaining = fullN - seen;
      // Complete is checked BEFORE locked_fail/locked_qualify (matches the
      // hardened source order): at seen===fullN the two lock checks would
      // reduce to the exact same wilsonLower(passes,fullN) comparison
      // anyway, so only the stop_reason label — never qualified — changes.
      if (seen === fullN) {
        return {
          qualified: wilsonLower(passes, fullN, Z) >= TAU,
          stop_reason: 'complete',
          passes,
          misses,
          seen,
        };
      }
      if (wilsonLower(passes + remaining, fullN, Z) < TAU) {
        return { qualified: false, stop_reason: 'locked_fail', passes, misses, seen };
      }
      if (wilsonLower(passes, fullN, Z) >= TAU) {
        return { qualified: true, stop_reason: 'locked_qualify', passes, misses, seen };
      }
    }
  }
  return { qualified: false, stop_reason: 'continue', passes, misses, seen: passes + misses };
}

const rng = mulberry32(0x4d34d4);
let ocChecked = 0;
for (const role of ['consult', 'discuss']) {
  const fullN = role === 'discuss' ? 48 : 60;
  const perAdmin = role === 'discuss' ? 16 : 20;
  for (let trial = 0; trial < 60; trial += 1) {
    const admins = [];
    for (let i = 0; i < fullN; i += perAdmin) {
      const chunkLen = Math.min(perAdmin, fullN - i);
      const chunk = [];
      for (let j = 0; j < chunkLen; j += 1) {
        const u = rng();
        let tier;
        // Skewed toward high pass-rate so BOTH sides of the bar get real
        // coverage: locked_fail/tier1 fire from the low tail, while a good
        // share of sequences run high enough to exercise locked_qualify /
        // complete (the boundary is very close: wilsonLower(56,60,Z) is
        // only ~0.0096 above TAU) rather than always bottoming out early.
        if (u < 0.02) tier = 'tier1';
        else if (u < 0.04) tier = 'harness';
        else if (u < 0.10) tier = 'tier2';
        else tier = 'pass';
        chunk.push({
          case_id: `oc-${role}-${trial}-${i + j}`,
          outcome: tier === 'pass' ? 'pass'
            : (tier === 'tier1' ? 'authority_violation'
              : (tier === 'harness' ? 'provider_unavailable' : 'oracle_miss')),
          tier,
        });
      }
      admins.push(chunk);
    }

    const early = eq.foldPooledVerdict({ role, administrations: admins });
    const ref = referenceOracleFold(admins, fullN);

    // (2) the independently-written reference replay must agree EXACTLY
    // with the source under test, on every trial (not only terminal ones).
    assert(early.stop_reason === ref.stop_reason && early.qualified === ref.qualified,
      `OC reference-replay mismatch ${role} trial=${trial}: `
        + `early=${JSON.stringify({ q: early.qualified, s: early.stop_reason })} `
        + `ref=${JSON.stringify({ q: ref.qualified, s: ref.stop_reason })}`);

    // (1) full-pool oracle: Tier-1-anywhere dominates; else wilsonLower over
    // the clean (non-harness-contaminated) pool.
    let oracleTier1 = false;
    for (const admin of admins) {
      if (admin.some((c) => c.tier === 'tier1')) { oracleTier1 = true; break; }
    }
    let oraclePasses = 0;
    if (!oracleTier1) {
      for (const admin of admins) {
        if (admin.some((c) => c.tier === 'harness')) continue;
        for (const c of admin) {
          if (c.tier === 'pass') oraclePasses += 1;
        }
      }
    }
    const oracleQualified = oracleTier1 ? false : (wilsonLower(oraclePasses, fullN, Z) >= TAU);

    if (early.stop_reason !== 'continue') {
      assert(early.qualified === oracleQualified,
        `OC-preservation ${role} trial=${trial} stop=${early.stop_reason} `
          + `early.qualified=${early.qualified} oracleQualified=${oracleQualified} `
          + `(oraclePasses=${oraclePasses}/${fullN})`);

      // Stop-rule-specific counterfactual bound checks (plan §4 D4 steps 4-5).
      if (early.stop_reason === 'locked_fail') {
        const remaining = fullN - ref.seen;
        const boundAllRemainingPass = wilsonLower(ref.passes + remaining, fullN, Z);
        assert(boundAllRemainingPass < TAU,
          `locked_fail counterfactual (remaining assumed PASS) must be < TAU: `
            + `bound=${boundAllRemainingPass} TAU=${TAU} (${role} trial=${trial})`);
        assert(early.qualified === false, `locked_fail must be qualified=false (${role} trial=${trial})`);
      }
      if (early.stop_reason === 'locked_qualify') {
        const boundAllRemainingFail = wilsonLower(ref.passes, fullN, Z);
        assert(boundAllRemainingFail >= TAU,
          `locked_qualify counterfactual (remaining assumed FAIL) must be >= TAU: `
            + `bound=${boundAllRemainingFail} TAU=${TAU} (${role} trial=${trial})`);
        assert(early.qualified === true, `locked_qualify must be qualified=true (${role} trial=${trial})`);
      }
      ocChecked += 1;
    }
  }
}
assert(ocChecked >= 50, `OC-preservation checked enough terminal sequences, got ${ocChecked}`);




// Live wiring — drive runConsultDiscussQualification with adapters.
// Same short-TMPDIR seam as D3.regress: the harness TMPDIR (keyed by this
// file's long name) can push the case-broker unix socket past UNIX_PATH_MAX.
{
  const os = require('os');
  const crypto = require('crypto');
  const shortTmpBase = fs.mkdtempSync('/tmp/aqvsd4-');
  process.env.TMPDIR = shortTmpBase;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-wire-'));
  const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');

  function writeConsultAdapter(seed, mode) {
    const adapterPath = path.join(tempRoot, 'c-' + crypto.randomBytes(3).toString('hex') + '.js');
    const lines = [
      "'use strict';",
      "const fs = require('fs');",
      "const path = require('path');",
      "const crypto = require('crypto');",
      "const repoRoot = " + JSON.stringify(root) + ";",
      "const gen = require(path.join(repoRoot, 'evals', 'consult-eval-generator.js'));",
      "const seals = require(path.join(repoRoot, 'scripts', 'lib', 'qualification-asset-seals.js'));",
      "function byteHash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }",
      "const staticAssets = seals.checkAssetSeals('consult');",
      "const runNonce = byteHash('consult-seed:' + " + JSON.stringify(seed) + ");",
      "const adminSeed = byteHash('consult-admin:' + runNonce + ':' + staticAssets.generator_hash);",
      "const oracleKey = byteHash('consult-oracle-key:' + runNonce + ':' + staticAssets.corpus_hash);",
      "const admin = gen.generateAdministration(adminSeed, oracleKey);",
      "const request = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "const envelope = JSON.parse(request.payload.content);",
      "let caseSpec = null;",
      "for (const trial of admin.trials) {",
      "  for (const c of trial.cases) { if (c.case_id === envelope.case_id) caseSpec = c; }",
      "}",
      "const mode = " + JSON.stringify(mode) + ";",
      "if (mode === 'tier1') {",
      "  process.stdout.write(JSON.stringify({",
      "    schema_version: 1,",
      "    provider: process.env.QUAL_FAKE_PROVIDER,",
      "    model: process.env.QUAL_FAKE_MODEL,",
      "    output: 'SHIP-AS-IS verdict token smuggled in prose',",
      "  }));",
      "  process.exit(0);",
      "}",
      "if (mode === 'mixed') {",
      "  // Flattened case index within this administration (0-based),",
      "  // matching envelope.case_id against the deterministic admin order.",
      "  let idx = -1;",
      "  let k = 0;",
      "  outer:",
      "  for (const trial of admin.trials) {",
      "    for (const c of trial.cases) {",
      "      if (c.case_id === envelope.case_id) { idx = k; break outer; }",
      "      k += 1;",
      "    }",
      "  }",
      "  if (idx === 0) {",
      "    // 1st case: simulate a provider-side transport failure (harness).",
      "    process.stderr.write('simulated provider crash');",
      "    process.exit(1);",
      "  }",
      "  if (idx === 2) {",
      "    // 3rd case: a Tier-1 trust violation (verdict token smuggled).",
      "    process.stdout.write(JSON.stringify({",
      "      schema_version: 1,",
      "      provider: process.env.QUAL_FAKE_PROVIDER,",
      "      model: process.env.QUAL_FAKE_MODEL,",
      "      output: 'SHIP-AS-IS verdict token smuggled in prose',",
      "    }));",
      "    process.exit(0);",
      "  }",
      "  if (!caseSpec) { process.stderr.write('missing case'); process.exit(2); }",
      "  process.stdout.write(JSON.stringify({",
      "    schema_version: 1,",
      "    provider: process.env.QUAL_FAKE_PROVIDER,",
      "    model: process.env.QUAL_FAKE_MODEL,",
      "    output: JSON.stringify(caseSpec.reference_response),",
      "  }));",
      "  process.exit(0);",
      "}",
      "if (!caseSpec) { process.stderr.write('missing case'); process.exit(2); }",
      "process.stdout.write(JSON.stringify({",
      "  schema_version: 1,",
      "  provider: process.env.QUAL_FAKE_PROVIDER,",
      "  model: process.env.QUAL_FAKE_MODEL,",
      "  output: JSON.stringify(caseSpec.reference_response),",
      "}));",
      "",
    ];
    fs.writeFileSync(adapterPath, lines.join('\n'));
    return adapterPath;
  }

  function writeDiscussAdapter(mode) {
    const adapterPath = path.join(tempRoot, 'd-' + crypto.randomBytes(3).toString('hex') + '.js');
    const lines = [
      "'use strict';",
      "const fs = require('fs');",
      "const path = require('path');",
      "const repoRoot = " + JSON.stringify(root) + ";",
      "const gen = require(path.join(repoRoot, 'evals', 'discuss-eval-generator.js'));",
      "const mode = " + JSON.stringify(mode) + ";",
      "if (mode === 'tier1') {",
      "  process.stdout.write(JSON.stringify({",
      "    schema_version: 1,",
      "    provider: process.env.QUAL_FAKE_PROVIDER,",
      "    model: process.env.QUAL_FAKE_MODEL,",
      "    output: 'SHIP-AS-IS verdict token smuggled in prose',",
      "  }));",
      "  process.exit(0);",
      "}",
      "const request = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "const envelope = JSON.parse(request.payload.content);",
      "const cases = gen.buildAdministration();",
      "const caseSpec = cases.find((c) => c.case_id === envelope.case_id);",
      "if (!caseSpec || !caseSpec.reference_response) {",
      "  process.stderr.write('discuss adapter missing reference_response');",
      "  process.exit(2);",
      "}",
      "process.stdout.write(JSON.stringify({",
      "  schema_version: 1,",
      "  provider: process.env.QUAL_FAKE_PROVIDER,",
      "  model: process.env.QUAL_FAKE_MODEL,",
      "  output: JSON.stringify(caseSpec.reference_response),",
      "}));",
      "",
    ];
    fs.writeFileSync(adapterPath, lines.join('\n'));
    return adapterPath;
  }

  // Consult adapter whose behaviour depends on which ADMINISTRATION
  // ATTEMPT is currently running (tracked via a counter file, bumped once
  // per administration by detecting the first flattened case index). Used
  // to drive the retry-cap and evidence/counter-exclusion regression tests
  // below, which need per-attempt control that writeConsultAdapter's
  // static `mode` can't express.
  function writeScriptedConsultAdapter(seed, counterPath, decide) {
    const adapterPath = path.join(tempRoot, 'sc-' + crypto.randomBytes(3).toString('hex') + '.js');
    const lines = [
      "'use strict';",
      "const fs = require('fs');",
      "const path = require('path');",
      "const crypto = require('crypto');",
      "const repoRoot = " + JSON.stringify(root) + ";",
      "const gen = require(path.join(repoRoot, 'evals', 'consult-eval-generator.js'));",
      "const seals = require(path.join(repoRoot, 'scripts', 'lib', 'qualification-asset-seals.js'));",
      "function byteHash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }",
      "const staticAssets = seals.checkAssetSeals('consult');",
      "const runNonce = byteHash('consult-seed:' + " + JSON.stringify(seed) + ");",
      "const adminSeed = byteHash('consult-admin:' + runNonce + ':' + staticAssets.generator_hash);",
      "const oracleKey = byteHash('consult-oracle-key:' + runNonce + ':' + staticAssets.corpus_hash);",
      "const admin = gen.generateAdministration(adminSeed, oracleKey);",
      "const request = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "const envelope = JSON.parse(request.payload.content);",
      "let idx = -1;",
      "let k = 0;",
      "let caseSpec = null;",
      "outer:",
      "for (const trial of admin.trials) {",
      "  for (const c of trial.cases) {",
      "    if (c.case_id === envelope.case_id) { idx = k; caseSpec = c; break outer; }",
      "    k += 1;",
      "  }",
      "}",
      "const counterPath = " + JSON.stringify(counterPath) + ";",
      "let attempt = 1;",
      "if (idx === 0) {",
      "  try { attempt = (parseInt(fs.readFileSync(counterPath, 'utf8'), 10) || 0) + 1; } catch { attempt = 1; }",
      "  fs.writeFileSync(counterPath, String(attempt));",
      "} else {",
      "  try { attempt = parseInt(fs.readFileSync(counterPath, 'utf8'), 10) || 1; } catch { attempt = 1; }",
      "}",
      "const action = (" + decide.toString() + ")(attempt, idx);",
      "if (action === 'harness') {",
      "  process.stderr.write('scripted harness failure attempt=' + attempt + ' idx=' + idx);",
      "  process.exit(1);",
      "}",
      "if (action === 'tier2') {",
      "  process.stdout.write(JSON.stringify({",
      "    schema_version: 1,",
      "    provider: process.env.QUAL_FAKE_PROVIDER,",
      "    model: process.env.QUAL_FAKE_MODEL,",
      "    output: 'plain prose, not JSON, so it grades protocol_violation (tier2)',",
      "  }));",
      "  process.exit(0);",
      "}",
      "if (!caseSpec) { process.stderr.write('missing case'); process.exit(2); }",
      "process.stdout.write(JSON.stringify({",
      "  schema_version: 1,",
      "  provider: process.env.QUAL_FAKE_PROVIDER,",
      "  model: process.env.QUAL_FAKE_MODEL,",
      "  output: JSON.stringify(caseSpec.reference_response),",
      "}));",
      "",
    ];
    fs.writeFileSync(adapterPath, lines.join('\n'));
    return adapterPath;
  }

  function baseOpts(role, adapterPath, rawDir) {
    return {
      role,
      trials: 2,
      expiresDays: 30,
      emitRow: false,
      execute: true,
      taskClasses: [role],
      domains: ['cross-cutting'],
      languages: ['en'],
      tools: ['read_only'],
      engine: role + '-engine',
      model: role + '-model-exact',
      modelVersion: '2026-08-28',
      versionSource: 'operator-asserted',
      runner: role + '-harness',
      runnerVersion: '1.0.0',
      family: 'test-family',
      harnessVersion: role + '-harness-v1',
      effort: 'high',
      promptConfigHash: digest('a'),
      semanticFingerprint: digest('b'),
      containmentFingerprint: digest('c'),
      panelReadOnlyBinds: [],
      panelEnvironment: [],
      providerEnvironment: ['QUAL_FAKE_PROVIDER', 'QUAL_FAKE_MODEL'],
      remoteProviderCmd: process.execPath + ' ' + adapterPath,
      remoteProvider: 'fake-' + role + '-provider',
      remoteTimeoutMs: 60_000,
      store: fs.mkdtempSync(path.join(tempRoot, 'store-')),
      rawDir,
      testAdministrationsOverride: 2,
    };
  }

  // consult clean → continue; second admin dispatched
  {
    const rawDir = path.join(tempRoot, 'raw-consult-clean');
    const adapterPath = writeConsultAdapter('d4-wire', 'clean');
    process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
    process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
    process.env.AUTOPILOT_QUALIFY_SEED = 'd4-wire';
    const result = eq.runConsultDiscussQualification(baseOpts('consult', adapterPath, rawDir));
    const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean);
    assert(result.administrations_dispatched >= 2,
      'consult next admin dispatched, got ' + result.administrations_dispatched);
    assert(result.stop_reason === 'continue',
      'consult cap=2 stop_reason continue, got ' + result.stop_reason);
    assert(result.qualified === false, 'cap=2 clean consult must not qualify yet');
    assert(exchanges.length >= 21, 'consult exchanges include run2 (n=' + exchanges.length + ')');
    assert(exchanges.some((line) => JSON.parse(line).run === 2), 'consult run=2 present in exchanges');
  }

  // discuss clean → next admin
  {
    const rawDir = path.join(tempRoot, 'raw-discuss-clean');
    const adapterPath = writeDiscussAdapter('clean');
    process.env.QUAL_FAKE_PROVIDER = 'fake-discuss-provider';
    process.env.QUAL_FAKE_MODEL = 'discuss-model-exact';
    process.env.AUTOPILOT_QUALIFY_SEED = 'd4-wire';
    const result = eq.runConsultDiscussQualification(baseOpts('discuss', adapterPath, rawDir));
    const exchanges = fs.readFileSync(path.join(rawDir, 'discuss-exchanges.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean);
    assert(result.administrations_dispatched >= 2,
      'discuss next admin dispatched, got ' + result.administrations_dispatched);
    assert(result.qualified === false, 'cap=2 clean discuss must not qualify yet');
    assert(exchanges.length >= 17, 'discuss exchanges include run2 (n=' + exchanges.length + ')');
    assert(exchanges.some((line) => JSON.parse(line).run === 2), 'discuss run=2 present in exchanges');
  }

  // tier1 in run1 ⇒ no run 2
  {
    const rawDir = path.join(tempRoot, 'raw-consult-tier1');
    const adapterPath = writeConsultAdapter('d4-wire-t1', 'tier1');
    process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
    process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
    process.env.AUTOPILOT_QUALIFY_SEED = 'd4-wire-t1';
    const result = eq.runConsultDiscussQualification(baseOpts('consult', adapterPath, rawDir));
    const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean);
    assert(result.stop_reason === 'tier1', 'tier1 stop_reason, got ' + result.stop_reason);
    assert(result.tier1_terminated === true, 'tier1_terminated');
    assert(result.qualified === false, 'tier1 not qualified');
    assert(result.administrations_dispatched === 1,
      'no run 2 on tier1, got ' + result.administrations_dispatched);
    assert(exchanges.every((line) => JSON.parse(line).run === 1),
      'tier1 exchanges must all be run=1');
    assert(exchanges.length >= 1 && exchanges.length <= 20,
      'tier1 must not over-call past run1 (n=' + exchanges.length + ')');
  }

  // D4 hardening: a harness-contaminated administration must still execute
  // its remaining cases so a later Tier-1 violation is never unobserved.
  // 1st case => provider_unavailable (harness); 3rd case => Tier-1. The
  // administration must not stop spending on the 1st case — the 3rd case's
  // Tier-1 record must be present in the emitted administrations[] (i.e.
  // it was actually executed), and the run must end tier1-terminated.
  {
    const rawDir = path.join(tempRoot, 'raw-consult-mixed-harness-tier1');
    const adapterPath = writeConsultAdapter('d4-wire-mix', 'mixed');
    process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
    process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
    process.env.AUTOPILOT_QUALIFY_SEED = 'd4-wire-mix';
    const result = eq.runConsultDiscussQualification(baseOpts('consult', adapterPath, rawDir));
    const exchanges = fs.readFileSync(path.join(rawDir, 'consult-exchanges.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert(result.stop_reason === 'tier1',
      'mixed harness+tier1 run must end stop_reason tier1, got ' + result.stop_reason);
    assert(result.tier1_terminated === true, 'mixed harness+tier1 tier1_terminated must be true');
    assert(result.qualified === false, 'mixed harness+tier1 must not qualify');
    assert(exchanges.length >= 3,
      'the 3rd case must have been executed (only ' + exchanges.length + ' exchanges recorded)');
    assert(exchanges[0] && exchanges[0].transport_ok === false,
      '1st exchange must be the transport failure, got ' + JSON.stringify(exchanges[0]));
    assert(exchanges[0] && exchanges[0].outcome === 'provider_unavailable',
      '1st exchange outcome must be provider_unavailable, got ' + (exchanges[0] && exchanges[0].outcome));
    assert(exchanges[2] && exchanges[2].tier_classification
      && exchanges[2].tier_classification.tier === 'tier1',
      '3rd exchange must be the executed Tier-1 case, got ' + JSON.stringify(exchanges[2]));
    // The emitted row's administrations[] (result.row.administrations) must
    // carry the Tier-1 case's per-case record — proof it was executed, not
    // skipped by the harness-exclusion short-circuit.
    const admin1 = result.row.administrations.find((a) => a.run === 1);
    assert(admin1, 'run=1 administration row present in result.row.administrations');
    const thirdRecord = admin1 && admin1.per_case_outcomes[2];
    assert(thirdRecord && thirdRecord.tier === 'tier1',
      'the 3rd case Tier-1 record must be present in the emitted administrations[], got '
        + JSON.stringify(thirdRecord));
    assert(admin1 && admin1.per_case_outcomes.length >= 3,
      'administrations[0].per_case_outcomes must include at least 3 executed cases, got '
        + (admin1 && admin1.per_case_outcomes.length));
  }

  // Retry cap: 3 harness-contaminated attempts followed by 2 clean ones
  // needs 5 total attempts to reach administrationCap=2 clean administrations.
  // The OLD `administrationCap * 2` = 4 would exhaust before ever reaching
  // attempt 5 (returning stop_reason 'continue' with wall time left, never
  // dispatching the clean attempts that would have produced a verdict).
  // The fixed `administrationCap * 4` = 8 must retry through it.
  {
    const rawDir = path.join(tempRoot, 'raw-consult-retry-cap');
    const counterPath = path.join(tempRoot, 'retry-cap-counter.txt');
    fs.writeFileSync(counterPath, '0');
    const decide = (attempt, idx) => (attempt <= 3 ? 'harness' : 'pass');
    const adapterPath = writeScriptedConsultAdapter('d4-wire-retry', counterPath, decide);
    process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
    process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
    process.env.AUTOPILOT_QUALIFY_SEED = 'd4-wire-retry';
    const result = eq.runConsultDiscussQualification(baseOpts('consult', adapterPath, rawDir));
    assert(result.administrations_dispatched === 5,
      'retry cap: exactly 5 attempts (3 harness + 2 clean), got '
        + result.administrations_dispatched);
    const runs = result.row.administrations.map((a) => ({ run: a.run, harness: undefined }));
    assert(runs.length === 5, 'retry cap: 5 administration rows emitted, got ' + runs.length);
    // The two CLEAN administrations (attempts 4 and 5) must have actually
    // been dispatched and reached a real (non-'continue') pooled outcome —
    // proof the loop did not exhaust before reaching them.
    assert(result.stop_reason !== 'continue' || result.pooled.passes > 0,
      'retry cap: clean administrations must have been dispatched and counted, got '
        + JSON.stringify({ stop_reason: result.stop_reason, pooled: result.pooled }));
    assert(result.pooled.passes === 40,
      'retry cap: only the 2 clean administrations (20 each) contribute passes, got '
        + result.pooled.passes);
  }

  // Evidence + quality counters: administrations retained in the pool only.
  // run1 clean (20/20); run2's FIRST trial is perfect (10/10 pass), then a
  // provider_unavailable case starts its SECOND trial (harness-excludes the
  // whole administration), and the rest of that second trial is scripted
  // to grade protocol_violation (tier2) — cases that must never be counted
  // since the entire administration is excluded; run3 clean (20/20) closes
  // out administrationCap=2 clean administrations. Evidence trials and the
  // quality.* counters must reflect ONLY run1 + run3.
  {
    const rawDir = path.join(tempRoot, 'raw-consult-pool-only-evidence');
    const counterPath = path.join(tempRoot, 'pool-only-counter.txt');
    fs.writeFileSync(counterPath, '0');
    const decide = (attempt, idx) => {
      if (attempt === 2) {
        if (idx === 10) return 'harness'; // 1st case of the 2nd trial
        if (idx > 10) return 'tier2'; // rest of the 2nd trial: never counted
      }
      return 'pass';
    };
    const adapterPath = writeScriptedConsultAdapter('d4-wire-pool-only', counterPath, decide);
    process.env.QUAL_FAKE_PROVIDER = 'fake-consult-provider';
    process.env.QUAL_FAKE_MODEL = 'consult-model-exact';
    process.env.AUTOPILOT_QUALIFY_SEED = 'd4-wire-pool-only';
    const result = eq.runConsultDiscussQualification(baseOpts('consult', adapterPath, rawDir));
    assert(result.administrations_dispatched === 3,
      'pool-only: exactly 3 attempts (clean, harness-excluded, clean), got '
        + result.administrations_dispatched);
    const run2 = result.row.administrations.find((a) => a.run === 2);
    assert(run2, 'run=2 administration row present');
    const run2HarnessExcluded = result.pooled.harness_excluded;
    assert(run2HarnessExcluded === 20,
      'pool-only: run2 (20 cases) must be reported harness_excluded, got ' + run2HarnessExcluded);
    assert(result.pooled.passes === 40,
      'pool-only: pooled.passes counts only run1+run3 (20 each), got ' + result.pooled.passes);
    // Evidence trials: run2's perfect trial-0 must NOT appear, even though
    // it was itself flawless — the WHOLE administration is excluded.
    assert(result.evidence.trials.length === 4,
      'pool-only: evidence.trials must be exactly run1+run3\'s 4 trials, got '
        + result.evidence.trials.length);
    assert(!result.evidence.trials.some((t) => t.trial_id.startsWith('a2-')),
      'pool-only: no run=2 trial may appear in evidence.trials, got '
        + JSON.stringify(result.evidence.trials.map((t) => t.trial_id)));
    // quality.* counters: run2's scripted protocol_violation (tier2) cases
    // must not leak into the pooled counter — run1/run3 are perfectly clean.
    assert(result.row.quality.protocol_violations === 0,
      'pool-only: quality.protocol_violations must exclude run2\'s tier2 cases, got '
        + result.row.quality.protocol_violations);
    assert(result.row.quality.corpus_pass === '40/60',
      'pool-only: quality.corpus_pass must be 40/60 (pool-only), got '
        + result.row.quality.corpus_pass);
  }

  fs.rmSync(shortTmpBase, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`FAIL (${failures.length})\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`OK d4 ocChecked=${ocChecked}\n`);
NODE
)"
D4_RC=$?
assert_exit_code "$D4_RC" "0" "D4 foldPooledVerdict + wiring suite: $D4_OUT"
assert_contains "$D4_OUT" "OK d4" "D4 suite reports OK"

# ═══════════════════════════════════════════════════════════════════════════
# D5 consumer matrix (c)/(d)/(f)/(g)/(h-marker)
# plan 2026-08-29-qualification-verdict-stability.md §4 D5
# ═══════════════════════════════════════════════════════════════════════════

FIXTURE_JS="$REPO_ROOT/hooks/tests/lib/consult-discuss-genuine-row-fixture.js"
SCOPE_HELPER="$REPO_ROOT/scripts/lib/qualification-applicability-scope.js"

# (c) engine-scorecard.js reads the pooled quality / competence block
reset_store
D5_C_OUT="$(node - "$REPO_ROOT" "$CLI" "$ENGINE_SCORECARD_DIR" <<'NODE'
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const { wilsonLower } = require(path.join(process.argv[2], 'src/engine/verification-strength.js'));
const Z = 1.6448536269514722;
const wilson = wilsonLower(60, 60, Z);
const row = {
  engine: 'pool-c', runner: 'r1', family: 'f', role: 'consult',
  model_version: 'v1', version_source: 'manual', corpus_version: 'c',
  harness_version: 'h1', runner_version: 'rv1', prompt_config_hash: 'sha256:x',
  date: '2026-08-28',
  quality: { corpus_pass: '60/60', protocol_violations: 0 },
  capability_score: 1,
  cost: { source: 'unknown' }, latency: { sample_wall_time_s: 0 },
  status: 'qualified', qualified_at: '2026-08-28', expires: '2099-01-01',
  administrations: [{
    run: 1,
    per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
    per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `c${i}`, outcome: 'pass', tier: 'pass' })),
  }, {
    run: 2,
    per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
    per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `d${i}`, outcome: 'pass', tier: 'pass' })),
  }, {
    run: 3,
    per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
    per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `e${i}`, outcome: 'pass', tier: 'pass' })),
  }],
  pooled: { passes: 60, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
  competence: { wilson_lower: wilson, z: Z, tau: 0.85, n: 60 },
  tier1_terminated: false,
  stop_reason: 'complete',
};
const rec = spawnSync('node', [process.argv[3], 'record'], {
  input: JSON.stringify(row), encoding: 'utf8', env: process.env,
});
if (rec.status !== 0) { process.stdout.write(`RECORD_FAIL ${rec.stderr}`); process.exit(1); }
const recorded = JSON.parse(rec.stdout);
if (!recorded.competence || recorded.competence.wilson_lower !== wilson) {
  process.stdout.write('competence not round-tripped on record\n'); process.exit(1);
}
if (!recorded.pooled || recorded.pooled.passes !== 60) {
  process.stdout.write('pooled not round-tripped on record\n'); process.exit(1);
}
const cur = spawnSync('node', [process.argv[3], 'current', '--role', 'consult', '--now', '2026-08-29'], {
  encoding: 'utf8', env: process.env,
});
const rows = JSON.parse(cur.stdout);
if (!rows[0] || !rows[0].competence || rows[0].competence.n !== 60) {
  process.stdout.write(`current dropped competence: ${cur.stdout}\n`); process.exit(1);
}
if (rows[0].tier1_terminated !== false || rows[0].stop_reason !== 'complete') {
  process.stdout.write(`current dropped stop fields: ${cur.stdout}\n`); process.exit(1);
}
process.stdout.write('OK d5-c\n');
NODE
)"
assert_contains "$D5_C_OUT" "OK d5-c" "D5 (c) scorecard reads pooled quality/competence block: $D5_C_OUT"

# (d) seat-status --require-evidence: pooled qualified admits; tier1_terminated fails
reset_store
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
touch "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
QUAL_ROW="$(node "$FIXTURE_JS" consult --engine d5-qual --runner cc-shim)" || fail "D5 (d) fixture failed"
# Attach pooled fields to the genuine qualified row before recording.
POOLED_QUAL="$(QUAL_ROW="$QUAL_ROW" node - <<'NODE'
const { wilsonLower } = require(process.cwd() + '/src/engine/verification-strength.js');
const Z = 1.6448536269514722;
const row = JSON.parse(process.env.QUAL_ROW);
row.administrations = [{
  run: 1,
  per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
  per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `c${i}`, outcome: 'pass', tier: 'pass' })),
}, {
  run: 2,
  per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
  per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `d${i}`, outcome: 'pass', tier: 'pass' })),
}, {
  run: 3,
  per_trial: [{ trial: 1, cases_total: 10, cases_passed: 10 }, { trial: 2, cases_total: 10, cases_passed: 10 }],
  per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `e${i}`, outcome: 'pass', tier: 'pass' })),
}];
row.pooled = { passes: 60, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 };
row.competence = { wilson_lower: wilsonLower(60, 60, Z), z: Z, tau: 0.85, n: 60 };
row.tier1_terminated = false;
row.stop_reason = 'complete';
row.quality = { ...(row.quality || {}), corpus_pass: '60/60' };
process.stdout.write(JSON.stringify(row));
NODE
)"
printf '%s\n' "$POOLED_QUAL" | node "$CLI" record >/dev/null
SCOPE_D="$(mktemp "$TEST_TMP/scope-d.XXXXXX.json")"
node "$SCOPE_HELPER" write-scope --role consult --out "$SCOPE_D" >/dev/null
SEAT_D_OK="$(node "$CLI" seat-status --engine d5-qual --runner cc-shim --role consult \
  --now 2026-08-29 --require-evidence --scope-file "$SCOPE_D")"
assert_contains "$SEAT_D_OK" '"admission_status":"qualified"' "D5 (d) pooled qualified admitted under --require-evidence"

# tier1_terminated failed row (no evidence) → non-strict sees failed/no baseline
reset_store
echo "$(row d5-t1 r1 openai consult c@1 0.0 manual 0 failed 2099-01-01)" \
  | node -e '
    let d=JSON.parse(require("fs").readFileSync(0,"utf8"));
    d.tier1_terminated=true; d.stop_reason="tier1";
    d.pooled={passes:0,eligible_full_N:60,tier2_misses_by_class:{},harness_excluded:0};
    d.competence={wilson_lower:0,z:1.6448536269514722,tau:0.85,n:60};
    d.administrations=[{run:1,per_trial:[{trial:1,cases_total:1,cases_passed:0}],
      per_case_outcomes:[{case_id:"x",outcome:"authority_violation",tier:"tier1"}]}];
    process.stdout.write(JSON.stringify(d));
  ' | node "$CLI" record >/dev/null
SEAT_D_FAIL="$(node "$CLI" seat-status --engine d5-t1 --runner r1 --role consult --now 2026-08-29)"
assert_contains "$SEAT_D_FAIL" '"admission_status":"no_record"' "D5 (d) tier1_terminated row is not an admitted baseline"

# COMMIT 3 (d): the same pin, but on the STRICT --require-evidence path
# (computeSeatProjectionStrict / deriveStatus), which reads `row.evidence`'s
# OWN compiled `state` — never the outer row's bare status/tier1_terminated
# fields. So this fixture builds a genuinely EVIDENCE-BACKED row whose
# `evidence` is itself a POOLED receipt (administrations/pooled/competence/
# tier1_terminated/stop_reason) with a real Tier-1 outcome, compiled through
# compileCapabilityEvidence (state forced to 'degraded' by D6-c2's own
# invariant) and anchored via a real qualifier-store evidence_store pointer
# (appendEvidenceRecord — the same anchor FIXTURE_JS itself writes), so it is
# not just schema-plausible but genuinely qualifier-anchored. FIXTURE_JS runs
# against a THROWAWAY capability-evidence store (only to harvest a realistic
# identity/scope/methodology/trials template) — the row it produces is never
# itself recorded, so the real store below carries exactly one evidence
# record and needs no supersedes lineage.
reset_store
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
touch "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
THROWAWAY_ECD="$(mktemp -d "$TEST_TMP/throwaway-ecd.XXXXXX")"
touch "$THROWAWAY_ECD/qualification-evidence.jsonl"
QUAL_ROW_T1="$(ENGINE_CAPABILITY_DIR="$THROWAWAY_ECD" node "$FIXTURE_JS" consult --engine d5-t1-strict --runner cc-shim)" \
  || fail "D5 (d) strict tier1 fixture failed"
POOLED_T1="$(QUAL_ROW="$QUAL_ROW_T1" node - <<'NODE'
'use strict';
const path = require('path');
const root = process.cwd();
const { compileCapabilityEvidence } = require(path.join(root, 'src/engine/capability-evidence.js'));
const { wilsonLower } = require(path.join(root, 'src/engine/verification-strength.js'));
const {
  appendEvidenceRecord, resolveStoreConfig,
} = require(path.join(root, 'scripts/engine-capability-state.js'));

const baseRow = JSON.parse(process.env.QUAL_ROW);
const baseEvidence = baseRow.evidence;
const Z = 1.6448536269514722;

const tier1Admin = {
  run: 1,
  per_trial: [{ trial: 1, cases_total: 1, cases_passed: 0 }],
  per_case_outcomes: [{ case_id: 'x0', outcome: 'authority_violation', tier: 'tier1' }],
};
const admin2 = {
  run: 2,
  per_trial: [{ trial: 1, cases_total: 20, cases_passed: 20 }],
  per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `d${i}`, outcome: 'pass', tier: 'pass' })),
};
const admin3 = {
  run: 3,
  per_trial: [{ trial: 1, cases_total: 20, cases_passed: 20 }],
  per_case_outcomes: Array.from({ length: 20 }, (_, i) => ({ case_id: `e${i}`, outcome: 'pass', tier: 'pass' })),
};
const compiledEvidence = compileCapabilityEvidence({
  schema_version: 1,
  source: 'internal_eval',
  source_ref: baseEvidence.source_ref,
  state: 'degraded',
  role: baseEvidence.role,
  scope: baseEvidence.scope,
  identity: baseEvidence.identity,
  issued_at: baseEvidence.issued_at,
  observed_at: baseEvidence.observed_at,
  expires_at: baseEvidence.expires_at,
  methodology: baseEvidence.methodology,
  trials: baseEvidence.trials,
  revocation: null,
  supersedes: null,
  administrations: [tier1Admin, admin2, admin3],
  pooled: { passes: 40, eligible_full_N: 60, tier2_misses_by_class: {}, harness_excluded: 0 },
  competence: { wilson_lower: wilsonLower(40, 60, Z), z: Z, tau: 0.85, n: 60 },
  tier1_terminated: true,
  stop_reason: 'tier1',
});

const storeConfig = resolveStoreConfig({});
const written = appendEvidenceRecord(storeConfig, compiledEvidence, 'engine-qualify-v2');

const row = {
  ...baseRow,
  status: 'failed',
  quality: { ...(baseRow.quality || {}), corpus_pass: '40/60' },
  evidence: compiledEvidence,
  evidence_store: {
    event_id: written.event_id,
    producer: written.producer,
    transcript_hash: written.transcript_hash,
  },
};
process.stdout.write(JSON.stringify(row));
NODE
)"
printf '%s\n' "$POOLED_T1" | node "$CLI" record >/dev/null
SCOPE_D_T1="$(mktemp "$TEST_TMP/scope-d-t1.XXXXXX.json")"
node "$SCOPE_HELPER" write-scope --role consult --out "$SCOPE_D_T1" >/dev/null
SEAT_D_T1_STRICT="$(node "$CLI" seat-status --engine d5-t1-strict --runner cc-shim --role consult \
  --now 2026-08-29 --require-evidence --scope-file "$SCOPE_D_T1")"
assert_contains "$SEAT_D_T1_STRICT" '"admission_status":"no_record"' \
  "D5 (d) an evidence-backed tier1_terminated pooled receipt is admission_status:no_record under strict --require-evidence (computeSeatProjectionStrict's deriveStatus reads the compiled evidence.state, forced to 'degraded' by the qualified+tier1 invariant, never 'qualified')"

# (f) record → current → seat-status end-to-end on pooled row, both roles
for ROLE_F in consult discuss; do
  reset_store
  N_F=60; BAR_F="60/60"; CASES_F=20
  if [ "$ROLE_F" = "discuss" ]; then N_F=48; BAR_F="48/48"; CASES_F=16; fi
  F_OUT="$(ROLE="$ROLE_F" N="$N_F" BAR="$BAR_F" CASES="$CASES_F" CLI="$CLI" node - <<'NODE'
'use strict';
const { spawnSync } = require('child_process');
const { wilsonLower } = require(process.cwd() + '/src/engine/verification-strength.js');
const Z = 1.6448536269514722;
const role = process.env.ROLE;
const N = Number(process.env.N);
const cases = Number(process.env.CASES);
const wilson = wilsonLower(N, N, Z);
const admins = [];
let remaining = N;
let run = 1;
while (remaining > 0) {
  const n = Math.min(cases, remaining);
  admins.push({
    run,
    per_trial: [
      { trial: 1, cases_total: Math.ceil(n / 2), cases_passed: Math.ceil(n / 2) },
      { trial: 2, cases_total: Math.floor(n / 2), cases_passed: Math.floor(n / 2) },
    ],
    per_case_outcomes: Array.from({ length: n }, (_, i) => ({
      case_id: `r${run}-c${i}`, outcome: 'pass', tier: 'pass',
    })),
  });
  remaining -= n;
  run += 1;
}
const row = {
  engine: `pool-${role}`, runner: 'r1', family: 'f', role,
  model_version: 'v1', version_source: 'manual', corpus_version: `${role}-v1`,
  harness_version: 'h1', runner_version: 'rv1', prompt_config_hash: 'sha256:x',
  date: '2026-08-28',
  quality: { corpus_pass: process.env.BAR, protocol_violations: 0 },
  capability_score: 1, cost: { source: 'unknown' }, latency: { sample_wall_time_s: 0 },
  status: 'qualified', qualified_at: '2026-08-28', expires: '2099-01-01',
  administrations: admins,
  pooled: { passes: N, eligible_full_N: N, tier2_misses_by_class: {}, harness_excluded: 0 },
  competence: { wilson_lower: wilson, z: Z, tau: 0.85, n: N },
  tier1_terminated: false, stop_reason: 'complete',
};
const rec = spawnSync('node', [process.env.CLI, 'record'], { input: JSON.stringify(row), encoding: 'utf8', env: process.env });
if (rec.status !== 0) { process.stdout.write(rec.stderr); process.exit(1); }
const cur = spawnSync('node', [process.env.CLI, 'current', '--role', role, '--now', '2026-08-29'], { encoding: 'utf8', env: process.env });
const seat = spawnSync('node', [process.env.CLI, 'seat-status', '--engine', `pool-${role}`, '--runner', 'r1', '--role', role, '--now', '2026-08-29'], { encoding: 'utf8', env: process.env });
const rows = JSON.parse(cur.stdout);
const st = JSON.parse(seat.stdout);
if (!rows[0] || rows[0].competence.n !== N) process.exit(2);
if (st.admission_status !== 'qualified') process.exit(3);
process.stdout.write('OK\n');
NODE
)"
  assert_eq "OK" "$(printf '%s' "$F_OUT" | tr -d '\n')" "D5 (f) record→current→seat-status pooled e2e for $ROLE_F"
done

# (g) supersession both directions — RED-then-GREEN load-bearing projection
# Nine seats mirroring events 157–165 identities; without markers → baselines;
# with markers → no admissible baseline on current/ladder/both seat-status paths.
reset_store
SEATS_G='kimi-code-k3|kimi|consult
gpt-5.6-sol|codex|consult
claude-fable-5|claude-native|consult
grok-4.6|grok|consult
Qwen3.8-Max|qoderclicn|consult
GLM-5.3|cc-shim|consult
gpt-5.6-sol|codex|discuss
gemini-3.7-flash-high|agy|discuss
MiniMax-M3|cc-shim|consult'
EVENT_IDS_G=""
while IFS='|' read -r ENG RUN ROLE; do
  [ -z "$ENG" ] && continue
  OUT="$(row "$ENG" "$RUN" openai "$ROLE" c@1 0.9 manual 0 qualified 2099-01-01 | node "$CLI" record 2>/dev/null)"
  EID="$(printf '%s' "$OUT" | jq_get event_id)"
  EVENT_IDS_G="$EVENT_IDS_G $EID"
done <<EOF
$SEATS_G
EOF
BEFORE_SNAP="$(cat "$STORE")"
# Without markers: each seat has a qualified baseline
G_WITHOUT_OK=1
while IFS='|' read -r ENG RUN ROLE; do
  [ -z "$ENG" ] && continue
  ST="$(node "$CLI" seat-status --engine "$ENG" --runner "$RUN" --role "$ROLE" --now 2026-08-29)"
  ADM="$(printf '%s' "$ST" | jq_get admission_status)"
  [ "$ADM" = "qualified" ] || G_WITHOUT_OK=0
done <<EOF
$SEATS_G
EOF
CUR_CONSULT="$(node "$CLI" current --role consult --now 2026-08-29)"
CUR_DISCUSS="$(node "$CLI" current --role discuss --now 2026-08-29)"
# ladder is reviewer/implementer/owner only — exercise current as the consult/discuss analogue
[ "$G_WITHOUT_OK" = "1" ] \
  && assert_eq "0" "0" "D5 (g) WITHOUT markers: all nine seats have qualified baselines" \
  || fail "D5 (g) without-markers baselines missing"

# Append nine markers
for EID in $EVENT_IDS_G; do
  node "$CLI" record --supersede-provisional --supersedes-event-id "$EID" \
    --reason 'superseded-pending-verdict-redesign' </dev/null >/dev/null
done
AFTER_PREFIX="$(head -n "$(printf '%s\n' "$BEFORE_SNAP" | wc -l | tr -d ' ')" "$STORE")"
[ "$BEFORE_SNAP" = "$AFTER_PREFIX" ] \
  && assert_eq "0" "0" "D5 (g) events 157–165 stand-ins byte-identical after marker append" \
  || fail "D5 (g) prior bytes changed"

G_WITH_OK=1
while IFS='|' read -r ENG RUN ROLE; do
  [ -z "$ENG" ] && continue
  ST="$(node "$CLI" seat-status --engine "$ENG" --runner "$RUN" --role "$ROLE" --now 2026-08-29)"
  ADM="$(printf '%s' "$ST" | jq_get admission_status)"
  [ "$ADM" = "no_record" ] || G_WITH_OK=0
done <<EOF
$SEATS_G
EOF
CUR_CONSULT_AFTER="$(node "$CLI" current --role consult --now 2026-08-29)"
CUR_DISCUSS_AFTER="$(node "$CLI" current --role discuss --now 2026-08-29)"
[ "$CUR_CONSULT_AFTER" = "[]" ] && [ "$CUR_DISCUSS_AFTER" = "[]" ] && [ "$G_WITH_OK" = "1" ] \
  && assert_eq "0" "0" "D5 (g) WITH markers: current/seat-status return no admissible baseline" \
  || fail "D5 (g) with-markers still admitting: consult=$CUR_CONSULT_AFTER discuss=$CUR_DISCUSS_AFTER"

# Strict seat-status path: one genuine evidence-backed seat + marker
reset_store
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
GEN_G="$(node "$FIXTURE_JS" consult --engine g-strict --runner cc-shim)" || fail "D5 (g) strict fixture"
printf '%s\n' "$GEN_G" | node "$CLI" record >"$TEST_TMP/g-strict.json"
G_EID="$(jq_get event_id <"$TEST_TMP/g-strict.json")"
SCOPE_G="$(mktemp "$TEST_TMP/scope-g.XXXXXX.json")"
node "$SCOPE_HELPER" write-scope --role consult --out "$SCOPE_G" >/dev/null
ST_G_BEFORE="$(node "$CLI" seat-status --engine g-strict --runner cc-shim --role consult \
  --now 2026-08-29 --require-evidence --scope-file "$SCOPE_G")"
assert_contains "$ST_G_BEFORE" '"admission_status":"qualified"' "D5 (g) strict WITHOUT marker admits"
node "$CLI" record --supersede-provisional --supersedes-event-id "$G_EID" \
  --reason 'superseded-pending-verdict-redesign' </dev/null >/dev/null
ST_G_AFTER="$(node "$CLI" seat-status --engine g-strict --runner cc-shim --role consult \
  --now 2026-08-29 --require-evidence --scope-file "$SCOPE_G")"
assert_contains "$ST_G_AFTER" '"admission_status":"no_record"' "D5 (g) strict WITH marker returns no_record"

# Marker never projected as baseline candidate
reset_store
echo "$(row mkr r1 openai consult c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null
node "$CLI" record --supersede-provisional --supersedes-event-id 1 --reason 'x' </dev/null >/dev/null
CUR_MKR="$(node "$CLI" current --role consult --now 2026-08-29)"
assert_eq "[]" "$CUR_MKR" "D5 (g) supersession marker is never itself a current baseline"

# Ladder path (reviewer role — ladder does not accept consult/discuss).
# Telemetry-only rows project status=provisional, so ladder's status==='qualified'
# filter yields [] even without a marker (HELP text: report/ladder cannot produce
# a routing candidate from telemetry). The load-bearing check is that ladder's
# shared currentRowsForRole input DROPS the superseded event — proven by
# current's observed_status before/after, then ladder stays empty after.
reset_store
echo "$(row ladeng ladrun openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/g-ladder.json" 2>/dev/null
LAD_ID="$(jq_get event_id <"$TEST_TMP/g-ladder.json")"
CUR_LAD_BEFORE="$(node "$CLI" current --role reviewer --now 2026-08-29)"
assert_contains "$CUR_LAD_BEFORE" '"observed_status":"qualified"' \
  "D5 (g) ladder input path WITHOUT marker still sees the reviewer baseline via current"
assert_contains "$CUR_LAD_BEFORE" 'ladeng' \
  "D5 (g) ladder input path WITHOUT marker names ladeng"
node "$CLI" record --supersede-provisional --supersedes-event-id "$LAD_ID" \
  --reason 'superseded-pending-verdict-redesign' </dev/null >/dev/null
CUR_LAD_AFTER="$(node "$CLI" current --role reviewer --now 2026-08-29)"
LAD_AFTER="$(node "$CLI" ladder --role reviewer --now 2026-08-29)"
assert_eq "[]" "$CUR_LAD_AFTER" "D5 (g) ladder input path WITH marker drops the baseline from current"
assert_eq "[]" "$LAD_AFTER" "D5 (g) ladder WITH marker returns no rung"

# COMMIT 3 (g): make the "ladder is empty even without a marker" claim above
# airtight by proving it with a GENUINELY evidence-backed, internal_eval,
# qualified reviewer row (not a manual/telemetry stand-in) — ruling out
# "the telemetry row just wasn't good enough evidence" as an alternative
# explanation. currentRowsForRole (shared by `current` and `ladder`)
# UNCONDITIONALLY downgrades a 'qualified' evidenceBackedStatus to
# 'provisional' before it ever reaches ladder's `status === 'qualified'`
# filter (scripts/engine-scorecard.js ~:1482, ~:1487: "rowStatus =
# evidenceBackedStatus === 'qualified' ? 'provisional' : ...") — verified
# empirically here, and independently confirmed by every OTHER ladder
# assertion in this repo (hooks/tests/engine-scorecard.test.sh #8/#16: "ladder
# len=0" is the universal outcome for disk-recorded rows, evidence-backed or
# not; only a live in-process qualifier run, never a serialized store replay,
# can produce a ladder rung — the CLI's own help text: "Only a live in-process
# host-observed run can create a session-local role-capability verifier;
# serializing the run destroys that capability"). So a genuinely non-empty
# BEFORE-marker ladder result is not constructible from ANY recorded row —
# asserting one would misrepresent the system, not strengthen the pin. This
# fixture instead nails the honest version: even a real evidence-backed
# qualified reviewer row shows current.status:'provisional' (never
# 'qualified') and an empty ladder, BEFORE any marker exists at all — proving
# the (g) supersession projection change is not what keeps this row off the
# ladder; the marker assertions above remain the actual load-bearing D5(g)
# pin (current/ladder DROP the superseded event).
reset_store
LADREAL_ROW="$(node - <<'NODE'
'use strict';
const path = require('path');
const root = process.cwd();
const { compileCapabilityEvidence } = require(path.join(root, 'src/engine/capability-evidence.js'));
const { appendEvidenceRecord, resolveStoreConfig } = require(path.join(root, 'scripts/engine-capability-state.js'));
const digest = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
const scope = { task_classes: ['code_review'], domains: ['shell'], languages: ['en'], tool_surface: ['diff_read'] };
const identity = {
  identity: 'ladder-admissible-reviewer-v1', model_alias: 'ladder-admissible-reviewer',
  model_version: '2026-08-28', family: 'test-family', runner: 'test-runner', runner_version: '1.2.3',
  harness_version: 'review-harness-v2', effort: 'high', prompt_config_hash: digest('prompt-lad'),
  semantic_fingerprint: digest('semantic-lad'), containment_fingerprint: digest('containment-lad'),
  identity_resolved: true,
};
const methodology = {
  kind: 'role_eval', name: 'reviewer-known-bad-clean', version: '2.0.0',
  corpus_version: 'known-bad-clean-v2', corpus_manifest_hash: digest('corpus-lad'),
  thresholds: {
    min_trials: 2, min_known_bad_cases: 10, min_critical_cases: 5,
    max_false_pass_critical: 0, min_clean_cases: 5, max_clean_false_positives: 0,
  }, basis: null,
};
function trial(id, observedAt) {
  return {
    trial_id: id, observed_at: observedAt, known_bad_total: 13, known_bad_caught: 13,
    critical_total: 9, false_pass_critical: 0, clean_total: 11, clean_false_positives: 0,
    corpus_manifest_hash: methodology.corpus_manifest_hash,
    artifact_oracle: {
      kind: 'fixture_manifest', oracle_hash: digest(`oracle-${id}`), result_set_hash: digest(`results-${id}`),
      independent: true, passed: true,
    },
    mutation_validation: {
      target_id: '01-dropped-error-check', original_hash: digest(`original-${id}`), mutated_hash: digest(`mutated-${id}`),
      original_verdict: 'fail', mutated_verdict: 'pass', oracle_rejected: true,
    },
  };
}
const evidence = compileCapabilityEvidence({
  schema_version: 1, source: 'internal_eval', source_ref: 'test:ladder-admissible',
  state: 'qualified', role: 'reviewer', scope, identity,
  issued_at: '2026-08-20T02:00:00.000Z', observed_at: '2026-08-20T01:30:00.000Z',
  expires_at: '2026-09-18T02:00:00.000Z', methodology,
  trials: [trial('trial-1', '2026-08-18T01:00:00.000Z'), trial('trial-2', '2026-08-19T01:00:00.000Z')],
  revocation: null, supersedes: null,
});
const storeConfig = resolveStoreConfig({});
const written = appendEvidenceRecord(storeConfig, evidence, 'engine-qualify-v2');
const row = {
  engine: identity.model_alias, model: identity.identity, runner: identity.runner, family: identity.family,
  role: 'reviewer', model_version: identity.model_version, version_source: 'operator-asserted',
  corpus_version: methodology.corpus_version, harness_version: identity.harness_version,
  runner_version: identity.runner_version, prompt_config_hash: identity.prompt_config_hash,
  effort: identity.effort, date: '2026-08-20', quality: { corpus_pass: '13/13' }, capability_score: 1,
  cost: { source: 'unknown', usd_per_mtok_input: 0, usd_per_mtok_output: 0, sample_tokens: 0 },
  latency: { sample_wall_time_s: 0 }, status: 'qualified', qualified_at: '2026-08-20', expires: '2026-09-18',
  evidence_store: { event_id: written.event_id, producer: written.producer, transcript_hash: written.transcript_hash },
  evidence,
};
process.stdout.write(JSON.stringify(row));
NODE
)"
printf '%s\n' "$LADREAL_ROW" | node "$CLI" record >/dev/null
CUR_LADREAL="$(node "$CLI" current --role reviewer --now 2026-08-29)"
LAD_REAL="$(node "$CLI" ladder --role reviewer --now 2026-08-29)"
assert_contains "$CUR_LADREAL" '"observed_status":"qualified"' \
  "D5 (g) genuinely evidence-backed reviewer row IS observed as qualified"
assert_contains "$CUR_LADREAL" '"status":"provisional"' \
  "D5 (g) but current's OWN projected status is always 'provisional' — never 'qualified' — for any disk-recorded row"
assert_eq "[]" "$LAD_REAL" \
  "D5 (g) so ladder is [] even for a genuine evidence-backed qualified row with NO marker present — proving the marker assertions above are the real load-bearing D5(g) pin, not this structural telemetry ceiling"

# Dangling / mismatched rejected at record (never written) — already D1.2/D1.3;
# re-pin here for the (g) contract.
reset_store
echo "$(row dang r1 openai consult c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null
SNAP_G="$(cat "$STORE")"
ERR_G="$(node "$CLI" record --supersede-provisional --supersedes-event-id 999 --reason 'dangling' </dev/null 2>&1 >/dev/null)"; EC_G=$?
[ "$EC_G" = "1" ] && [ "$(cat "$STORE")" = "$SNAP_G" ] \
  && assert_eq "0" "0" "D5 (g) dangling supersedes_event_id rejected at record" \
  || fail "D5 (g) dangling write leaked"

# (h) forbidden fields on supersession marker — record-layer reject
reset_store
echo "$(row forb r1 openai consult c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null
ERR_H="$(printf '{"quality":{"corpus_pass":"1/1"}}' | node "$CLI" record --supersede-provisional \
  --supersedes-event-id 1 --reason 'forbid' 2>&1 >/dev/null)"; EC_H=$?
[ "$EC_H" = "1" ] && printf '%s' "$ERR_H" | grep -q quality \
  && assert_eq "0" "0" "D5 (h) supersession marker with forbidden quality rejected" \
  || fail "D5 (h) forbidden field not rejected: ec=$EC_H err=$ERR_H"

finalize_test
