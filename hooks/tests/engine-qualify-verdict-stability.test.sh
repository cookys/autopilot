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

# D1.6: ordinary record path unchanged; readers ignore marker (D1 — no projection change)
reset_store
echo "$(row ordeng ordrun openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-ord.json" 2>/dev/null
ord_id=$(jq_get event_id <"$TEST_TMP/d1-ord.json")
current_before=$(node "$CLI" current --role reviewer --now 2026-06-30)
seat_before=$(node "$CLI" seat-status --engine ordeng --runner ordrun --role reviewer --now 2026-06-30)
node "$CLI" record --supersede-provisional --supersedes-event-id "$ord_id" \
  --reason 'reader-noop' </dev/null >/dev/null 2>&1
current_after=$(node "$CLI" current --role reviewer --now 2026-06-30)
seat_after=$(node "$CLI" seat-status --engine ordeng --runner ordrun --role reviewer --now 2026-06-30)
echo "$(row ordeng2 ordrun openai reviewer c@1 0.8 manual 0 qualified 2099-01-01)" \
  | node "$CLI" record >"$TEST_TMP/d1-ord2.json" 2>/dev/null
ord2_ec=$?
ord2_id=$(jq_get event_id <"$TEST_TMP/d1-ord2.json")
[ "$current_before" = "$current_after" ] && [ "$seat_before" = "$seat_after" ] \
  && [ "$ord2_ec" = "0" ] && [ "$ord2_id" = "3" ] \
  && assert_eq "0" "0" "D1.6 ordinary record + current/seat-status unchanged by marker presence" \
  || fail "D1.6: readers drifted or ordinary record broke (ord2_ec=$ord2_ec id=$ord2_id)"

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

finalize_test
