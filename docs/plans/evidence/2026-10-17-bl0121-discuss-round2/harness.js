#!/usr/bin/env node
'use strict';
// harness.js — BL-0121 second-turn ON/OFF eval driver + deterministic scorer (see README.md = prereg).
//   node harness.js run   --phase pilot|main --out <dir> [--seats sonnet,kimi] [--reps N] [--concurrency N]
//   node harness.js score --out <dir> --phase pilot|main
// Every model call goes through the REAL scripts/dispatch-discuss.js (seat resolved from a per-seat
// temp repo-root review-loop-config.md; transport = author-wrap.sh -> scripts/dispatch-author.sh).
// Arms: A = frozen round one only (no extra call). B = round one + second turn (production prompt).
// red = same as B but the second-turn prompt paragraph is replaced by a broken one (planted cases only).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const corpus = require('./corpus.js');
const P = require('./predicates.js');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const DISCUSS = path.join(REPO, 'scripts', 'dispatch-discuss.js');
const WRAP = path.join(HERE, 'author-wrap.sh');
const SEATS = {
  sonnet: { engine: 'claude-sonnet-5-5', runner: 'claude-native', effort: 'high' },
  kimi: { engine: 'kimi-code/k3', runner: 'kimi', effort: 'high' },
};
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const phase = opt('--phase', 'pilot');
const out = path.resolve(opt('--out', ''));
if (!opt('--out')) { console.error('--out required'); process.exit(2); }
const seatNames = opt('--seats', 'sonnet,kimi').split(',');
const REPS = Number(opt('--reps', phase === 'pilot' ? '1' : '3'));
const CONC = Number(opt('--concurrency', '4'));
const NEED = phase === 'pilot' ? { plants: 99, controls: 99 } : { plants: 8, controls: 4 };

function pool() {
  const o = corpus.ordered(phase === 'pilot');
  if (phase === 'pilot') return { plants: o.plants.slice(0, 2), controls: o.controls.slice(0, 1) };
  return o;
}
function seatRoot(seat) {
  const root = path.join(out, '_roots', seat);
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const s = SEATS[seat];
  fs.writeFileSync(path.join(root, '.claude', 'review-loop-config.md'),
    `- discuss_dispatch: on\n- discuss_engine: ${s.engine}\n- discuss_effort: ${s.effort}\n- discuss_runner: ${s.runner}\n- discuss_endpoint:\n`);
  return root;
}
function runDiscuss(seat, bundle, arm, tag) {
  const dir = path.join(out, '_work');
  fs.mkdirSync(dir, { recursive: true });
  const bf = path.join(dir, `${tag}.bundle.json`);
  const wl = path.join(dir, `${tag}.wrap.log`);
  fs.writeFileSync(bf, JSON.stringify(bundle));
  try { fs.unlinkSync(wl); } catch (e) { /* none */ }
  return new Promise((resolve) => {
    const child = cp.spawn('node', [DISCUSS, '--bundle-file', bf, '--repo-root', seatRoot(seat), '--dispatch-author-bin', WRAP, '--timeout', '8m'],
      { env: Object.assign({}, process.env, { ARM: arm, WRAP_LOG: wl }) });
    let so = ''; let se = '';
    child.stdout.on('data', (d) => { so += d; });
    child.stderr.on('data', (d) => { se += d; });
    child.on('close', (rc) => {
      let wrap = null;
      try { wrap = JSON.parse(fs.readFileSync(wl, 'utf8').trim().split('\n').pop()); } catch (e) { /* no call reached the rail */ }
      resolve({ rc, stdout: so, stderr: se.trim(), wrap });
    });
  });
}
const isValidationFail = (r) => r.rc === 4 && /closed-schema validation/.test(r.stderr);
async function cell(seat, c, arm, rep, bundle, file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let attempts = 0; let r;
  for (;;) {
    attempts += 1;
    r = await runDiscuss(seat, bundle, arm, `${seat}-${c.case_id}-${arm}-${rep}-a${attempts}`);
    if (r.rc === 0 || isValidationFail(r) || r.rc === 2 || r.rc === 3 || attempts >= 2) break;
  }
  let contribution = null;
  if (r.rc === 0) { try { contribution = JSON.parse(r.stdout); } catch (e) { /* leave null */ } }
  const rec = {
    seat, case_id: c.case_id, arm, rep, attempts, rc: r.rc,
    status: r.rc === 0 ? 'ok' : isValidationFail(r) ? 'validation_fail' : (r.rc === 2 || r.rc === 3) ? 'abort' : 'infra_fail',
    stderr: r.stderr.slice(0, 400), contribution, wrap: r.wrap,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rec, null, 1));
  return rec;
}
async function pooled(items, fn) {
  const results = new Array(items.length); let next = 0;
  async function worker() { for (;;) { const i = next; next += 1; if (i >= items.length) return; results[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: CONC }, worker));
  return results;
}
// Amendment 1: round one is BLIND. In the new protocol all seats speak round one before anyone sees the
// others; the seat's first turn therefore has an empty transcript (the other roles' axes stay listed in
// taken_axes so the seat lands on the free axis). The scripted roles' round-one turns appear only in round two.
function round1Bundle(c) {
  const b = JSON.parse(JSON.stringify(c.bundle));
  b.transcript = [];
  return b;
}
function round2Bundle(c, r1) {
  const b = JSON.parse(JSON.stringify(c.bundle));
  b.round_id = `${c.case_id}-r2`;
  b.transcript.push({ role: 'this-seat', axis_id: r1.axis_id, claim_vector: r1.claim_vector, position: r1.position, risk_tags: r1.risk_tags, anchors: r1.anchors });
  return b; // taken_axes already lists only the three other roles' axes
}
const cellFile = (seat, cid, name) => path.join(out, seat, cid, `${name}.json`);

async function run() {
  const { plants, controls } = pool();
  for (const seat of seatNames) {
    // Round one (frozen once, shared by A, B and red).
    const all = plants.concat(controls);
    const r1s = await pooled(all, (c) => cell(seat, c, 'r1', 0, round1Bundle(c), cellFile(seat, c.case_id, 'r1')));
    if (r1s.some((r) => r.status === 'abort')) { console.error(`abort: resolver/usage refusal for seat ${seat}: ${r1s.find((r) => r.status === 'abort').stderr}`); process.exit(3); }
    const byId = new Map(all.map((c, i) => [c.case_id, { c, r1: r1s[i] }]));
    const selPlants = plants.filter((c) => byId.get(c.case_id).r1.status === 'ok' && !P.caught(c, byId.get(c.case_id).r1.contribution)).slice(0, NEED.plants);
    const selControls = controls.filter((c) => byId.get(c.case_id).r1.status === 'ok' && P.controlRound1Valid(byId.get(c.case_id).r1.contribution)).slice(0, NEED.controls);
    fs.writeFileSync(path.join(out, seat, 'selection.json'), JSON.stringify({
      plants: selPlants.map((c) => c.case_id), controls: selControls.map((c) => c.case_id),
      excluded: all.filter((c) => !selPlants.includes(c) && !selControls.includes(c)).map((c) => ({ case_id: c.case_id, why: byId.get(c.case_id).r1.status !== 'ok' ? `round1_${byId.get(c.case_id).r1.status}` : c.kind === 'control' ? 'control_round1_not_correct_token' : 'round1_already_caught_or_surplus' })),
    }, null, 1));
    const jobs = [];
    for (const c of selPlants.concat(selControls)) {
      for (let rep = 1; rep <= REPS; rep += 1) {
        jobs.push({ c, arm: 'B', rep });
        if (c.kind !== 'control') jobs.push({ c, arm: 'red', rep });
      }
    }
    await pooled(jobs, (j) => cell(seat, j.c, j.arm, j.rep, round2Bundle(j.c, byId.get(j.c.case_id).r1.contribution), cellFile(seat, j.c.case_id, `r2-${j.arm}-${j.rep}`)));
    console.error(`seat ${seat}: done (${selPlants.length} planted, ${selControls.length} control selected)`);
  }
}

const proxy = (w) => (w ? (w.prompt_bytes + w.out_bytes) / 4 : 0);
function scoreSeat(seat) {
  const sel = JSON.parse(fs.readFileSync(path.join(out, seat, 'selection.json'), 'utf8'));
  const all = corpus.ALL;
  const get = (id) => all.find((c) => c.case_id === id);
  const rd = (cid, name) => JSON.parse(fs.readFileSync(cellFile(seat, cid, name), 'utf8'));
  const need = REPS;
  const maj = Math.floor(need / 2) + 1;
  const m = { seat, planted_selected: sel.plants.length, controls_selected: sel.controls.length, reps: REPS };
  let aCatch = 0; let bCatch = 0; let redCatch = 0; let harmCases = 0;
  let b2Calls = 0; let b2Ok = 0; let b2Valid = 0; let infra = 0; let hold = 0; let holdN = 0; let jac = 0;
  let costA = 0; let costB2 = 0; const per = [];
  for (const id of sel.plants.concat(sel.controls)) {
    const c = get(id); const r1 = rd(id, 'r1');
    costA += proxy(r1.wrap);
    const row = { case_id: id, kind: c.kind };
    if (c.kind !== 'control') {
      if (P.caught(c, r1.contribution)) aCatch += 1;
      let bc = 0; let rc = 0;
      for (let rep = 1; rep <= REPS; rep += 1) {
        const b = rd(id, `r2-B-${rep}`); const red = rd(id, `r2-red-${rep}`);
        if (b.status === 'ok' && P.caught(c, b.contribution)) bc += 1;
        if (red.status === 'ok' && P.caught(c, red.contribution)) rc += 1;
      }
      row.B_caught_reps = bc; row.red_caught_reps = rc;
      if (bc >= maj) bCatch += 1;
      if (rc >= maj) redCatch += 1;
    } else {
      let h = 0;
      for (let rep = 1; rep <= REPS; rep += 1) { const b = rd(id, `r2-B-${rep}`); if (b.status === 'ok' && P.harmed(b.contribution)) h += 1; }
      row.B_harm_reps = h;
      if (h >= 1) harmCases += 1;
    }
    let caseB2 = 0; let caseN = 0;
    for (let rep = 1; rep <= REPS; rep += 1) {
      const b = rd(id, `r2-B-${rep}`);
      if (b.status === 'infra_fail') { infra += 1; continue; }
      b2Calls += 1;
      if (b.status === 'ok') {
        b2Ok += 1;
        holdN += 1; if (P.sameVector(b.contribution.claim_vector, r1.contribution.claim_vector)) hold += 1;
        jac += P.jaccard(b.contribution.position, r1.contribution.position);
      }
      caseB2 += proxy(b.wrap); caseN += 1;
    }
    costB2 += caseN ? caseB2 / caseN : 0;
    per.push(row);
  }
  b2Valid = b2Calls ? b2Ok / b2Calls : 0;
  Object.assign(m, {
    A_catch: aCatch, B_catch: bCatch, red_catch: redCatch, B_minus_A: bCatch - aCatch, B_minus_red: bCatch - redCatch,
    control_harm_cases: harmCases, validator_pass_rate: Number(b2Valid.toFixed(3)), B_calls_scored: b2Calls, infra_fail_excluded: infra,
    hold_rate: holdN ? Number((hold / holdN).toFixed(3)) : null, mean_position_jaccard: holdN ? Number((jac / holdN).toFixed(3)) : null,
    cost_incremental_ratio: costA ? Number((costB2 / costA).toFixed(3)) : null,
    calls: { A: sel.plants.length + sel.controls.length, B_round2: sel.plants.length * REPS + sel.controls.length * REPS, red_round2: sel.plants.length * REPS },
    per_case: per,
  });
  const strict = phase === 'main';
  const gates = {
    G1_B_minus_A_ge_3: m.B_minus_A >= 3,
    G2_control_harm_le_1: m.control_harm_cases <= 1,
    G3_validator_pass_ge_0_90: m.validator_pass_rate >= 0.90,
    G4_red_at_least_3_below_B: m.B_minus_red >= 3,
    G5_cost_total_le_2x: m.cost_incremental_ratio !== null && m.cost_incremental_ratio <= 1.0, // Amendment 3: B total <= 2x A, i.e. increment <= 1x
  };
  m.gates = gates;
  // Amendment 3: gate 4 (red) is informative for kimi only. For sonnet a failing gate 4 is reported as
  // UNINFORMATIVE on 'does the rule text matter' and does not decide; its other gates still do.
  const redExempt = seat === 'sonnet';
  m.red_gate_status = gates.G4_red_at_least_3_below_B ? 'ok' : (redExempt ? 'UNINFORMATIVE' : 'INSTRUMENT-INVALID');
  const others = Object.entries(gates).filter(([k]) => k !== 'G4_red_at_least_3_below_B').every(([, v]) => v);
  if (!strict) m.verdict = 'PILOT (no verdict; pipeline and scorer-readability check only)';
  else if (m.planted_selected < 6 || m.controls_selected < 3) m.verdict = 'INSUFFICIENT-CASES';
  else if (!redExempt && !gates.G4_red_at_least_3_below_B) m.verdict = 'INSTRUMENT-INVALID';
  else m.verdict = others ? 'SHIP' : 'NOT-SHIP';
  return m;
}
function score() {
  const res = seatNames.map(scoreSeat);
  const verdicts = res.map((r) => r.verdict);
  const k = res.find((r) => r.seat === 'kimi'); const so = res.find((r) => r.seat === 'sonnet');
  const bad = (v) => v === 'INSTRUMENT-INVALID' || v === 'INSUFFICIENT-CASES';
  const overall = phase !== 'main' ? 'PILOT'
    : verdicts.some(bad) ? 'NO-VERDICT'
      : (k && so && k.verdict === 'SHIP' && so.verdict === 'SHIP') ? 'SHIP' : 'NOT-SHIP';
  process.stdout.write(`${JSON.stringify({ phase, overall, seats: res }, null, 1)}\n`);
}
if (cmd === 'run') run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
else if (cmd === 'score') score();
else { console.error('usage: harness.js run|score ...'); process.exit(2); }
