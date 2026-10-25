#!/usr/bin/env bash
# `default` effort label + `engine-scorecard.js relabel-effort`.
#
# `default` = the endpoint HAS an effort dimension but the runner sent none, so the endpoint default
# ran. It is its own seat partition: distinct from every explicit effort, from `none` (no effort
# dimension at all) and from an absent effort (the legacy partition). `relabel-effort` corrects rows
# whose label was false (anthropic-compatible exams recorded "high"/"max" while no effort was sent).
#
# Each behaviour group (vocabulary, seat hash, strike migration, pin migration, not-vacated seat, v1 strike
# refusal, backups, partial-write restore, rank, timeout) was shown red under a planted mutation and green
# after restore (evidence-discipline §58); the reviewer-facing mutation list is in the commit report. All stores are temp dirs; the operator's real ~/.autopilot is only
# stat'ed before/after to prove it was not written.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"; cleanup_test_tmp' EXIT

REAL_SC="$HOME/.autopilot/engine-scorecard/scorecard.jsonl"
REAL_EV="$HOME/.autopilot/engine-capability/qualification-evidence.jsonl"
REAL_SC_BEFORE=$( [ -f "$REAL_SC" ] && stat -c%s "$REAL_SC" 2>/dev/null || echo 0 )
REAL_EV_BEFORE=$( [ -f "$REAL_EV" ] && stat -c%s "$REAL_EV" 2>/dev/null || echo 0 )

OUT="$(ROOT="$ROOT" TESTDIR="$TESTDIR" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const root = process.env.ROOT;
const testdir = process.env.TESTDIR;
const { compileCapabilityEvidence, capabilityEvidenceProducerHash } = require(path.join(root, 'src/engine/capability-evidence.js'));
const { canonicalJson, sha256 } = require(path.join(root, 'src/engine/owner-kernel/canonical.js'));
const scorecardMod = require(path.join(root, 'scripts/engine-scorecard.js'));
const effortScale = require(path.join(root, 'scripts/lib/effort-scale.js'));
const ESC = path.join(root, 'scripts/engine-scorecard.js');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`PASS: ${m}`); };
const bad = (m) => { fail += 1; console.log(`FAIL: ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(`${m}${detail === undefined ? '' : ` (got: ${detail})`}`));

let SC = path.join(testdir, 'scorecard');
let CAP = path.join(testdir, 'capability');
fs.mkdirSync(SC, { recursive: true });
fs.mkdirSync(CAP, { recursive: true });
let env = { ...process.env, ENGINE_SCORECARD_DIR: SC, ENGINE_CAPABILITY_DIR: CAP };
const run = (args, input) => spawnSync(process.execPath, [ESC, ...args], { env, encoding: 'utf8', input });
let scFile = path.join(SC, 'scorecard.jsonl');
let evFile = path.join(CAP, 'qualification-evidence.jsonl');
let strikeFile = path.join(CAP, 'strikes.jsonl');
let pinsFile = path.join(CAP, 'pins.jsonl');
function useStores(name) {
  SC = path.join(testdir, `${name}-sc`);
  CAP = path.join(testdir, `${name}-cap`);
  fs.mkdirSync(SC, { recursive: true });
  fs.mkdirSync(CAP, { recursive: true });
  env = { ...process.env, ENGINE_SCORECARD_DIR: SC, ENGINE_CAPABILITY_DIR: CAP };
  scFile = path.join(SC, 'scorecard.jsonl');
  evFile = path.join(CAP, 'qualification-evidence.jsonl');
  strikeFile = path.join(CAP, 'strikes.jsonl');
  pinsFile = path.join(CAP, 'pins.jsonl');
}
const sha = (f) => (fs.existsSync(f) ? sha256(fs.readFileSync(f, 'utf8')) : 'absent');
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- fixture: one REAL shipped administration, re-stamped through the real compiler ----------
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'references/official-qualification-defaults.json'), 'utf8'));
const src = artifact.defaults.find((d) => d.row && d.row.evidence && d.row.status === 'qualified' && d.capability_evidence);
if (!src) { console.log('FAIL: no qualified shipped fixture'); process.exit(1); }
const producer = src.capability_evidence.producer;
const now = new Date();
const issued = new Date(now.getTime() - 3600_000).toISOString();
const DERIVED = ['evidence_id', 'evidence_hash', 'scope_hash', 'identity_hash', 'grant_identity_hash', 'trial_set_hash'];

function makeEvidence(alias, effort) {
  const raw = JSON.parse(JSON.stringify(src.row.evidence));
  for (const f of DERIVED) delete raw[f];
  raw.issued_at = issued; raw.observed_at = issued;
  for (const t of raw.trials || []) if (t.observed_at) t.observed_at = issued;
  raw.identity.model_alias = alias;
  raw.identity.effort = effort;
  return compileCapabilityEvidence(raw);
}
function appendWrapper(eventId, evidence) {
  const w = { ...src.capability_evidence, event_id: eventId, evidence, transcript_hash: capabilityEvidenceProducerHash(evidence, producer) };
  fs.appendFileSync(evFile, `${JSON.stringify(w)}\n`);
  return w;
}
function rowFor(evidence, wrapper, effort) {
  const row = JSON.parse(JSON.stringify(src.row));
  const today = now.toISOString().slice(0, 10);
  row.engine = evidence.identity.model_alias;
  row.date = today; row.qualified_at = today;
  if (effort === undefined) delete row.effort; else row.effort = effort;
  row.evidence = evidence;
  row.evidence_store = { event_id: wrapper.event_id, producer, transcript_hash: wrapper.transcript_hash };
  return row;
}
const recordRow = (row) => run(['record'], JSON.stringify(row));
const seatStatus = (row, effort) => {
  const r = run(['seat-status', '--engine', row.engine, '--runner', row.runner, '--role', row.role,
    ...(effort === undefined ? [] : ['--effort', effort])]);
  return r.status === 0 ? JSON.parse(r.stdout) : { error: r.stderr, status: r.status };
};
const independentSeatHash = (engine, runner, role, effort) => sha256(canonicalJson({
  engine, runner, role, ...(effort === undefined ? {} : { effort }),
}));

// event 1 (ledger) / row 1: the FALSE label, "high". Row 2: a legacy row (no effort) on the same seat triple.
const ev1 = makeEvidence('relabel-fixture-model', 'high');
const w1 = appendWrapper(1, ev1);
const row1 = rowFor(ev1, w1, 'high');
const rec1 = recordRow(row1);
check(rec1.status === 0, 'fixture: a high-labelled evidence-anchored row records', rec1.stderr);
const legacyRow = JSON.parse(JSON.stringify(row1));
delete legacyRow.effort; delete legacyRow.evidence; delete legacyRow.evidence_store;
const recLegacy = recordRow(legacyRow);
check(recLegacy.status === 0, 'fixture: a legacy (effort-less) row on the same seat triple records', recLegacy.stderr);
const E = row1.engine; const R = row1.runner; const ROLE = row1.role;

// A strike recorded against the OLD (high) seat, observed after the baseline.
const oldHash = independentSeatHash(E, R, ROLE, 'high');
fs.writeFileSync(strikeFile, `${JSON.stringify({
  schema_version: 2, event_id: 1, kind: 'strike', seat_hash: oldHash, engine: E, runner: R, role: ROLE,
  class: 'ordinary_strike', predicate_id: null, cause_class: 'engine_output', writer: 'dispatch_hetero_failclosed',
  dedup_key: 'relabel-fixture-strike-1', detector_id: 'dispatch_hetero_classify_outcome', detector_version: '1',
  artifact_sha256: 'a'.repeat(64), receipt_ref: 'log=/tmp/relabel-fixture', observed_at: now.toISOString(),
  invalidates_event_id: null, proof_artifact_sha256: null, proof_detector_id: null,
})}\n`);

const before = seatStatus(row1, 'high');
check(before.admission_status === 'qualified' && before.strikes_since_pass === 1,
  'pre: the high seat is qualified and counts the strike', JSON.stringify(before));
check(seatStatus(row1, 'default').admission_status === 'no_record', 'pre: nothing answers for the default seat yet');

// ---- vocabulary / partition isolation ---------------------------------------------------------
const hHigh = independentSeatHash(E, R, ROLE, 'high');
const hDefault = independentSeatHash(E, R, ROLE, 'default');
const hLegacy = independentSeatHash(E, R, ROLE, undefined);
const hNone = independentSeatHash(E, R, ROLE, 'none');
check(new Set([hHigh, hDefault, hLegacy, hNone]).size === 4,
  'seat_hash: default, high, none and the legacy (omitted) partition are four different seats');
check(scorecardMod.seatIdentityHash(E, R, ROLE, 'default') === hDefault
  && scorecardMod.seatIdentityHash(E, R, ROLE, undefined) === hLegacy,
'seat_hash: the shipped derivation agrees with the independent one for default and legacy');

// ---- dry-run is read-only ---------------------------------------------------------------------
const snap = () => [sha(scFile), sha(evFile), sha(strikeFile)].join('|');
const s0 = snap();
const dry = run(['relabel-effort', '--to', 'default', '--reason', 'fixture', '--event-id', '1', '--dry-run']);
check(dry.status === 0 && JSON.parse(dry.stdout).dry_run === true && snap() === s0,
  'relabel dry-run reports the plan and changes no byte of any store', dry.stderr);
const dryPlan = JSON.parse(dry.stdout);
check(dryPlan.strikes_moved === 1 && dryPlan.seats_moved === 1 && dryPlan.evidence_records.length === 1,
  'relabel dry-run counts the strike and the anchored evidence record it would move', dry.stdout);

// ---- error paths: refused, nothing written ----------------------------------------------------
const mustRefuse = (args, label) => {
  const s = snap();
  const r = run(args);
  check(r.status !== 0 && snap() === s, `relabel refuses ${label} and writes nothing`, `${r.status} ${r.stderr.trim()}`);
  return r;
};
mustRefuse(['relabel-effort', '--to', 'high', '--reason', 'x', '--event-id', '1'], '--to anything but default');
mustRefuse(['relabel-effort', '--to', 'default', '--event-id', '1'], 'a missing --reason');
mustRefuse(['relabel-effort', '--to', 'default', '--reason', 'x', '--event-id', '999'], 'an event that does not exist');
const legacyId = lines(scFile).find((r) => r.effort === undefined).event_id;
mustRefuse(['relabel-effort', '--to', 'default', '--reason', 'x', '--event-id', String(legacyId)], 'a legacy row (no effort label)');
mustRefuse(['relabel-effort', '--to', 'default', '--reason', 'x', '--event-id', '1', '--event-id', '999'], 'a batch containing one bad id (all-or-nothing)');
mustRefuse(['relabel-effort', '--to', 'default', '--reason', 'x', '--evidence-event-id', '1'], 'an evidence record a scorecard row anchors');

// ---- the real relabel -------------------------------------------------------------------------
const real = run(['relabel-effort', '--to', 'default', '--reason', 'anthropic-compatible never sent effort', '--event-id', '1']);
check(real.status === 0, 'relabel succeeds on the false-labelled row', real.stderr);
const report = JSON.parse(real.stdout || '{}');
check(Array.isArray(report.backups) && report.backups.length === 3 && report.backups.every((b) => fs.existsSync(b)),
  'relabel wrote a backup of every store it changed (scorecard, evidence, strikes) before rewriting', JSON.stringify(report.backups));
check(report.backups.some((b) => sha(b) !== 'absent') && lines(report.backups.find((b) => b.includes('scorecard.jsonl'))).some((r) => r.effort === 'high'),
  'the scorecard backup still holds the original high label');

const rowsAfter = lines(scFile);
const relabelled = rowsAfter.find((r) => r.event_id === 1);
check(relabelled.effort === 'default' && relabelled.evidence.identity.effort === 'default'
  && relabelled.effort_relabel && relabelled.effort_relabel.from === 'high',
'row and its embedded evidence both say default, and the row records where it came from');
const wAfter = lines(evFile)[0];
check(wAfter.evidence.identity.effort === 'default'
  && compileCapabilityEvidence(wAfter.evidence).evidence_id === wAfter.evidence.evidence_id
  && wAfter.transcript_hash === capabilityEvidenceProducerHash(wAfter.evidence, wAfter.producer)
  && relabelled.evidence_store.transcript_hash === wAfter.transcript_hash
  && relabelled.evidence.evidence_id === wAfter.evidence.evidence_id
  && wAfter.evidence.evidence_id !== ev1.evidence_id,
'evidence ledger is re-sealed: new evidence_id, valid transcript_hash, and the scorecard anchor binds it');
check(rowsAfter.find((r) => r.event_id === legacyId).effort === undefined,
  'the legacy row was not touched (it is a different partition)');

// ---- partition isolation after the relabel ----------------------------------------------------
const nowDefault = seatStatus(row1, 'default');
check(nowDefault.admission_status === 'qualified' && nowDefault.effort === 'default',
  'seat-status --effort default now answers qualified from the relabelled row', JSON.stringify(nowDefault));
check(seatStatus(row1, 'high').admission_status === 'no_record',
  'seat-status --effort high no longer hits the relabelled (default) row');
const legacyAnswer = seatStatus(row1, undefined);
check(legacyAnswer.baseline_event_id === legacyId && legacyAnswer.effort === null,
  'seat-status without --effort still answers from the legacy row, never from default', JSON.stringify(legacyAnswer));
check(nowDefault.seat_hash === hDefault && legacyAnswer.seat_hash === hLegacy && hDefault !== hLegacy,
  'default and omitted-effort are different seats by seat_hash, not only by label');

// ---- strikes travel with the seat -------------------------------------------------------------
check(nowDefault.strikes_since_pass === 1,
  'the strike recorded before the relabel is still counted on the new default seat', JSON.stringify(nowDefault));
const strikeAfter = lines(strikeFile);
check(strikeAfter.length === 1 && strikeAfter[0].seat_hash === hDefault && strikeAfter[0].dedup_key === 'relabel-fixture-strike-1',
  'strikes.jsonl row was re-keyed to the default seat hash (no orphan left on the old seat)');

// ---- second run: already default --------------------------------------------------------------
mustRefuse(['relabel-effort', '--to', 'default', '--reason', 'again', '--event-id', '1'], 'a row that is already default');

// ---- record accepts default; high/default stay apart ------------------------------------------
const ev3 = makeEvidence('relabel-fixture-model-b', 'default');
const w3 = appendWrapper(2, ev3);
const row3 = rowFor(ev3, w3, 'default');
const rec3 = recordRow(row3);
check(rec3.status === 0, 'record accepts effort=default (scorecard row and evidence agree)', rec3.stderr);
check(seatStatus(row3, 'default').admission_status === 'qualified' && seatStatus(row3, 'high').admission_status === 'no_record',
  'default row answers --effort default and is invisible to --effort high');
const recBad = recordRow({ ...row3, effort: 'bogus' });
check(recBad.status !== 0, 'record still rejects an effort outside the vocabulary');

// ---- evidence-only relabel (a sitting with no scorecard row yet) ------------------------------
const ev4 = makeEvidence('relabel-fixture-model-c', 'max');
appendWrapper(3, ev4);
const evOnly = run(['relabel-effort', '--to', 'default', '--reason', 'unregistered sitting', '--evidence-event-id', '3']);
check(evOnly.status === 0 && lines(evFile).find((w) => w.event_id === 3).evidence.identity.effort === 'default',
  'evidence-only relabel re-labels a ledger record that has no scorecard row', evOnly.stderr);
check(lines(evFile).find((w) => w.event_id === 2).evidence.identity.effort === 'default'
  && lines(evFile).find((w) => w.event_id === 1).evidence.identity.effort === 'default',
'other ledger records were left as they were');

// ---- rank -------------------------------------------------------------------------------------
const explicit = ['low', 'medium', 'high', 'xhigh', 'max'];
for (const fam of ['anthropic', 'openai', 'unknown-family']) {
  const d = effortScale.normalizeEffort(fam, 'default');
  check(explicit.every((e) => d > effortScale.normalizeEffort(fam, e)) && d !== effortScale.UNKNOWN_RANK,
    `rank: default sorts after every explicit effort (${fam}) and is not the "unknown" rank`, d);
}
const topo = fs.readFileSync(path.join(root, 'scripts/resolve-dispatch-topology.js'), 'utf8');
check(/EFFORT_RANK = Object\.freeze\(\{[^}]*max: 5,[^}]*default: 6,/s.test(topo),
  'rank: the topology EFFORT_RANK table also places default after max');
const timeout = require(path.join(root, 'scripts/lib/plan-review-timeout.js'));
check(timeout.effortSeatTimeoutSeconds('default', null) === 1200, 'plan-review seat timeout: default gets the long tier');


// ---- extra scenarios, each on its own fresh store pair ----------------------------------------
const strikeV2 = (hash, e, r, ro, key) => ({
  schema_version: 2, event_id: 1, kind: 'strike', seat_hash: hash, engine: e, runner: r, role: ro,
  class: 'ordinary_strike', predicate_id: null, cause_class: 'engine_output', writer: 'dispatch_hetero_failclosed',
  dedup_key: key, detector_id: 'dispatch_hetero_classify_outcome', detector_version: '1',
  artifact_sha256: 'b'.repeat(64), receipt_ref: 'log=/tmp/relabel-fixture', observed_at: now.toISOString(),
  invalidates_event_id: null, proof_artifact_sha256: null, proof_detector_id: null,
});
const pinRow = (row, effort) => ({
  engine: row.engine, runner: row.runner, role: row.role, effort, endpoint: null,
  reason: 'fixture pin', operator: 'tester',
});
function freshHighSeat(name, alias) {
  useStores(name);
  const ev = makeEvidence(alias, 'high');
  const w = appendWrapper(1, ev);
  const row = rowFor(ev, w, 'high');
  const rec = recordRow(row);
  if (rec.status !== 0) bad(`${name}: fixture row did not record: ${rec.stderr}`);
  return row;
}

// pins travel with a vacated seat
{
  const row = freshHighSeat('pin', 'pin-fixture-model');
  fs.writeFileSync(pinsFile, `${JSON.stringify(pinRow(row, 'high'))}\n`);
  const r = run(['relabel-effort', '--to', 'default', '--reason', 'pin move', '--event-id', '1']);
  const rep = JSON.parse(r.stdout || '{}');
  check(r.status === 0 && rep.pins_moved === 1 && lines(pinsFile)[0].effort === 'default',
    'pins: a pin on the vacated seat is re-pointed at the default seat', r.stderr || r.stdout);
  check(rep.backups.some((b) => b.includes('pins.jsonl.bak-relabel-effort')),
    'pins: the pins file was backed up before it was rewritten');
}

// a seat that still has another ordinary row is NOT vacated: strikes and pins stay, and it is reported
{
  const row = freshHighSeat('nv', 'nv-fixture-model');
  const other = JSON.parse(JSON.stringify(row));
  delete other.evidence; delete other.evidence_store;
  const rec2 = recordRow(other);
  check(rec2.status === 0, 'not-vacated: a second ordinary high row on the same seat records', rec2.stderr);
  const oldHash = independentSeatHash(row.engine, row.runner, row.role, 'high');
  fs.writeFileSync(strikeFile, `${JSON.stringify(strikeV2(oldHash, row.engine, row.runner, row.role, 'nv-strike'))}\n`);
  fs.writeFileSync(pinsFile, `${JSON.stringify(pinRow(row, 'high'))}\n`);
  const r = run(['relabel-effort', '--to', 'default', '--reason', 'partial seat', '--event-id', '1']);
  const rep = JSON.parse(r.stdout || '{}');
  check(r.status === 0 && Array.isArray(rep.seats_not_vacated) && rep.seats_not_vacated.length === 1
    && rep.strikes_moved === 0 && rep.pins_moved === 0 && rep.strikes_left_on_old_seat === 1,
  'not-vacated: report names the seat and says no strike or pin moved', r.stderr || r.stdout);
  check(lines(strikeFile)[0].seat_hash === oldHash && lines(pinsFile)[0].effort === 'high',
    'not-vacated: the strike and the pin stay on the old seat (nothing silently reset or orphaned)');
}

// legacy v1 strikes keyed to the old identity_hash block the evidence re-seal
{
  const row = freshHighSeat('v1', 'v1-fixture-model');
  fs.writeFileSync(strikeFile, `${JSON.stringify({
    schema_version: 1, event_id: 7, identity_hash: row.evidence.identity_hash, source: 'fuse',
    observed_at: now.toISOString(), receipt_ref: 'fixture-v1',
  })}\n`);
  const s = snap();
  const r = run(['relabel-effort', '--to', 'default', '--reason', 'v1 guard', '--event-id', '1']);
  check(r.status !== 0 && /v1 strike/.test(r.stderr) && /7/.test(r.stderr) && /nothing written/.test(r.stderr) && snap() === s,
    'v1 strike keyed to the old identity_hash: relabel refuses, names the strike, writes nothing', r.stderr.trim());
}

// a failure after writing began restores every store and says so honestly
{
  const row = freshHighSeat('rb', 'rb-fixture-model');
  const oldHash = independentSeatHash(row.engine, row.runner, row.role, 'high');
  fs.writeFileSync(strikeFile, `${JSON.stringify(strikeV2(oldHash, row.engine, row.runner, row.role, 'rb-strike'))}\n`);
  const inject = path.join(testdir, 'inject-fail.js');
  // Fail the rename onto the SECOND file written (the scorecard; the evidence ledger already landed).
  fs.writeFileSync(inject, `
const fs = require('fs');
const real = fs.renameSync;
fs.renameSync = function (from, to) {
  if (String(to).endsWith('scorecard.jsonl')) { const e = new Error('ENOSPC: injected'); e.code = 'ENOSPC'; throw e; }
  return real.apply(this, arguments);
};`);
  fs.chmodSync(scFile, 0o664); fs.chmodSync(evFile, 0o644);
  const s = snap();
  const r = spawnSync(process.execPath, ['--require', inject, ESC, 'relabel-effort', '--to', 'default', '--reason', 'rollback', '--event-id', '1'],
    { env, encoding: 'utf8' });
  check(r.status !== 0 && snap() === s,
    'partial write: all three stores are byte-identical to before after a mid-write failure', `${r.status} ${snap() === s}`);
  check(/after writing began/.test(r.stderr) && /RESTORED/.test(r.stderr) && !/nothing written/.test(r.stderr),
    'partial write: the message says writing began and was restored, never "nothing written"', r.stderr.trim());
  check(lines(evFile)[0].evidence.identity.effort === 'high' && lines(scFile)[0].effort === 'high',
    'partial write: ledger and scorecard both still say high (anchor consistent)');
  const modeOf = (f) => (fs.statSync(f).mode & 0o777).toString(8);
  check(modeOf(scFile) === '664' && modeOf(evFile) === '644',
    'partial write: restored files keep their original modes (not the 0600 of the backup)', `${modeOf(scFile)} ${modeOf(evFile)}`);
}

// a failed write AND a failed restore is reported as RESTORE FAILED with the backup paths
{
  const row = freshHighSeat('rf', 'rf-fixture-model');
  const inject = path.join(testdir, 'inject-fail-restore.js');
  fs.writeFileSync(inject, `
const fs = require('fs');
const realRename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (String(to).endsWith('scorecard.jsonl')) { const e = new Error('ENOSPC: injected'); e.code = 'ENOSPC'; throw e; }
  return realRename.apply(this, arguments);
};
const realCopy = fs.copyFileSync;
fs.copyFileSync = function (from, to) {
  if (String(from).includes('.bak-relabel-effort-') && String(to).endsWith('qualification-evidence.jsonl')) {
    const e = new Error('EIO: injected restore failure'); e.code = 'EIO'; throw e;
  }
  return realCopy.apply(this, arguments);
};`);
  const r = spawnSync(process.execPath, ['--require', inject, ESC, 'relabel-effort', '--to', 'default', '--reason', 'rf', '--event-id', '1'],
    { env, encoding: 'utf8' });
  const baks = fs.readdirSync(CAP).filter((f) => f.startsWith('qualification-evidence.jsonl.bak-relabel-effort-'));
  check(r.status !== 0 && /RESTORE FAILED/.test(r.stderr) && !/then RESTORED/.test(r.stderr)
    && baks.length === 1 && r.stderr.includes(path.join(CAP, baks[0])),
  'restore failure: message says RESTORE FAILED and names the surviving backup path', r.stderr.trim());
}

console.log(`SUMMARY ${pass} ${fail}`);
process.exit(fail === 0 ? 0 : 1);
NODE
)"
NODE_RC=$?
printf '%s\n' "$OUT" | grep -v '^SUMMARY '

PASS=$(printf '%s\n' "$OUT" | grep -c '^PASS:')
FAIL=$(printf '%s\n' "$OUT" | grep -c '^FAIL:')
[ "$NODE_RC" -eq 0 ] || FAIL=$((FAIL+1))

REAL_SC_AFTER=$( [ -f "$REAL_SC" ] && stat -c%s "$REAL_SC" 2>/dev/null || echo 0 )
REAL_EV_AFTER=$( [ -f "$REAL_EV" ] && stat -c%s "$REAL_EV" 2>/dev/null || echo 0 )
if [ "$REAL_SC_AFTER" = "$REAL_SC_BEFORE" ] && [ "$REAL_EV_AFTER" = "$REAL_EV_BEFORE" ]; then
  PASS=$((PASS+1)); echo "PASS: the operator's real scorecard and evidence stores were not written"
else
  FAIL=$((FAIL+1)); echo "FAIL: a real store changed size during this suite"
fi

echo "----"
echo "engine-effort-default harness: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
