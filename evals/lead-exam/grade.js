#!/usr/bin/env node
'use strict';
// lead-exam grader. Mechanical layer first (enum hard fails and mechanical criteria, no model), then a
// blinded judge layer through scripts/qualification-review-provider.js (QRP_PROMPT_MODE=lead).
// Built-in planted controls (design 3.3): a tampered reference, a fake examinee X, a padding examinee Z.
// A round whose batch misses a control is void; a missed tamper control voids the whole judge.
// Standalone measurement: writes a report JSON only, no qualification record.
//
//   node evals/lead-exam/grade.js --run <run.json> [--run <run2.json> ...] --out report.json
//        [--dry-run | --judge-kind codex --judge-model <id> [--judge-home DIR] [--judge-timeout-ms N]]
const fs = require('fs');
const lib = require('./lib');
const fx = require('./fixtures');
const jd = require('./judge');
const { callProvider } = require('./transport');

async function judgeWithRetry(judge, req) {
  const calls = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let reply;
    try { reply = await judge(req); } catch (e) {
      calls.push({ attempt, valid: false, error: e.message, ms: e.ms || 0 });
      continue;
    }
    const v = jd.validateJudgeReply(reply.text, req);
    calls.push({ attempt, valid: v.ok, errors: v.errors.slice(0, 5), ms: reply.ms, in_tokens_est: reply.in_tokens_est, out_tokens_est: reply.out_tokens_est, usage: reply.usage || null });
    if (v.ok) return { data: v.data, calls };
  }
  return { data: null, calls };
}

// runs: [{name, model, outputs[6], rounds?, total_ms?}]; judge: async (request) => {text, ms, ...}
async function gradeExam(opts) {
  const items = opts.items || lib.loadItems();
  const seed = opts.seed;
  const rand = opts.rand || Math.random;
  const map = lib.deriveNames(items, seed);
  const runs = opts.runs;
  const examinees = runs.map((r) => ({ run: r, ex: lib.parseExaminee(r.outputs), blind: (r.outputs || []).map((o) => lib.blindText(o, r.model)) }));
  const xOut = fx.controlXOutputs(seed, items).map(lib.blindText);
  const zOut = lib.blindText(fx.controlZOutput());
  const calls = [];
  const roundStatus = {};
  const judgeByExaminee = examinees.map(() => ({}));
  const judgeHf = examinees.map(() => new Set());

  // tamper control first: if the judge misses it, nothing it says is used
  const tReq = jd.buildJudgeRequest(items, map, 3, { 'ex-1': lib.blindText(fx.tamperGoodOutput(seed, items)) },
    { item: fx.TAMPER_ITEM, expected: fx.TAMPER_EXPECTED });
  const t = await judgeWithRetry(opts.judge, tReq);
  t.calls.forEach((c) => calls.push({ purpose: 'tamper_control', round: 3, ...c }));
  const tamperPass = !!(t.data && t.data.reference_conflicts.includes(fx.TAMPER_ITEM));
  const judgeVoid = !tamperPass;

  for (let round = 1; round <= items.rounds.length; round += 1) {
    if (judgeVoid) { roundStatus[round] = { status: 'void', reason: 'tamper control missed' }; continue; }
    const entries = examinees.map((e, i) => ({ kind: 'real', idx: i, text: e.blind[round - 1] || '' }));
    entries.push({ kind: 'x', text: xOut[round - 1] });
    entries.push({ kind: 'z', text: zOut });
    const order = lib.shuffled(entries, rand);
    const outputs = {};
    order.forEach((en, k) => { en.label = `ex-${k + 1}`; outputs[en.label] = en.text; });
    const req = jd.buildJudgeRequest(items, map, round, outputs, null);
    const r = await judgeWithRetry(opts.judge, req);
    r.calls.forEach((c) => calls.push({ purpose: 'judge', round, ...c }));
    if (!r.data) { roundStatus[round] = { status: 'void', reason: 'judge reply invalid twice' }; continue; }
    const failures = [];
    const xe = r.data.examinees[order.find((en) => en.kind === 'x').label];
    const xFound = xe.hard_fails.map((h) => h.id);
    (fx.CONTROL_X_EXPECTED_HF[round] || []).forEach((id) => { if (!xFound.includes(id)) failures.push(`control X: ${id} not found`); });
    const ze = r.data.examinees[order.find((en) => en.kind === 'z').label];
    const zCredited = req.items.some((it) => it.criteria.some((c) => c.kind === 'credit' && ze.items[it.id] && ze.items[it.id].criteria[c.id] && ze.items[it.id].criteria[c.id].hit));
    if (Object.keys(ze.items).some((id) => ze.items[id].answered) || ze.hard_fails.length || zCredited) failures.push('control Z: padding was credited');
    if (failures.length) { roundStatus[round] = { status: 'void', reason: failures.join('; ') }; continue; }
    roundStatus[round] = { status: 'ok' };
    order.filter((en) => en.kind === 'real').forEach((en) => {
      const e = r.data.examinees[en.label];
      Object.keys(e.items).forEach((id) => { judgeByExaminee[en.idx][id] = { criteria: e.items[id].criteria, answered: e.items[id].answered }; });
      e.hard_fails.forEach((h) => judgeHf[en.idx].add(h.id));
    });
  }

  const results = examinees.map((e, i) => {
    const mechHf = lib.mechHardFails(items, e.ex);
    const jh = Array.from(judgeHf[i]).sort();
    const disagree = [];
    const judgedRounds = Object.keys(roundStatus).filter((k) => roundStatus[k].status === 'ok').map(Number);
    mechHf.forEach((id) => { if (!jh.includes(id) && judgedRounds.length === items.rounds.length) disagree.push(`${id}: mechanical only`); });
    jh.forEach((id) => { if (!mechHf.includes(id)) disagree.push(`${id}: judge only`); });
    // an item whose round is void has no judge data: scoreItem marks it void
    const sc = lib.scoreExaminee(items, e.ex, judgeByExaminee[i]);
    const hardFails = Array.from(new Set([...mechHf, ...jh])).sort();
    const red = [];
    (e.run.rounds || []).forEach((rr) => { if (rr.timed_out) red.push(`round ${rr.round} timed out, counted blank`); else if (rr.error) red.push(`round ${rr.round} failed: ${rr.error}`); });
    if (disagree.length) red.push('mechanical and judge hard fails disagree: PM spot-check');
    return {
      name: e.run.name, model: e.run.model, total: sc.total, complete: sc.complete,
      categories: sc.categories, categories_ok: sc.categories_ok,
      hard_fails: { mechanical: mechHf, judge: jh, all: hardFails, disagree },
      pass: lib.passVerdict(items, sc, hardFails), items: sc.items,
      parse_notes: e.ex.notes, red, run_wall_ms: e.run.total_ms || null,
    };
  });

  const xEx = lib.parseExaminee(fx.controlXOutputs(seed, items));
  return {
    schema: 'lead-exam-report/1', seed, standalone_measurement: true,
    judge: { kind: opts.judgeKind || null, model: opts.judgeModel || null, stub: !!opts.stub },
    status: judgeVoid ? 'judge_void' : (Object.values(roundStatus).every((s) => s.status === 'ok') ? 'ok' : 'partial'),
    controls: {
      tamper: { item: fx.TAMPER_ITEM, caught: tamperPass },
      rounds: roundStatus,
      x_mechanical_hard_fails: lib.mechHardFails(items, xEx),
    },
    examinees: results,
    calls,
    totals: {
      judge_calls: calls.length,
      judge_wall_ms: calls.reduce((s, c) => s + (c.ms || 0), 0),
      judge_in_tokens_est: calls.reduce((s, c) => s + (c.in_tokens_est || 0), 0),
      judge_out_tokens_est: calls.reduce((s, c) => s + (c.out_tokens_est || 0), 0),
      tokens_are_estimates: true,
    },
  };
}

function providerJudge(kind, model, timeoutMs, passEnv) {
  return (req) => callProvider(jd.buildJudgePrompt(req), { kind, model, timeoutMs, passEnv });
}

function parseArgs(argv) {
  const a = { runs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dry = true;
    else if (['--run', '--out', '--seed', '--judge-kind', '--judge-model', '--judge-home', '--judge-timeout-ms'].includes(k) && argv[i + 1] !== undefined) {
      const v = argv[i + 1]; i += 1;
      if (k === '--run') a.runs.push(v); else a[k.slice(2)] = v;
    } else { process.stderr.write(`grade: unknown or incomplete argument ${k}\n`); process.exit(2); }
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.runs.length === 0) { process.stderr.write('grade: at least one --run file is required\n'); process.exit(2); }
  const runs = a.runs.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const seed = a.seed || runs[0].seed;
  if (runs.some((r) => r.seed !== seed)) { process.stderr.write('grade: run files carry different seeds\n'); process.exit(2); }
  const items = lib.loadItems();
  let judge; let judgeKind = null; let judgeModel = null;
  if (a.dry) judge = jd.stubJudge(items);
  else {
    judgeKind = a['judge-kind']; judgeModel = a['judge-model'];
    if (!['codex', 'agy'].includes(judgeKind) || !judgeModel) { process.stderr.write('grade: live judging needs --judge-kind codex|agy and --judge-model <roster id verbatim>\n'); process.exit(2); }
    const passEnv = {};
    if (a['judge-home']) passEnv[judgeKind === 'codex' ? 'CODEX_HOME' : 'QRP_CLI_HOME'] = a['judge-home'];
    judge = providerJudge(judgeKind, judgeModel, Number(a['judge-timeout-ms'] || 720000), passEnv);
  }
  const report = await gradeExam({ items, seed, runs, judge, judgeKind, judgeModel, stub: !!a.dry });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (a.out) fs.writeFileSync(a.out, text); else process.stdout.write(text);
}

if (require.main === module) main().catch((e) => { process.stderr.write(`grade: ${e.message}\n`); process.exit(1); });
module.exports = { gradeExam };
