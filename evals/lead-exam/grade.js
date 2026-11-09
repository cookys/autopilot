#!/usr/bin/env node
'use strict';
// lead-exam grader. Mechanical layer first (enum hard fails and mechanical criteria, no model), then a
// blinded judge layer through scripts/qualification-review-provider.js (QRP_PROMPT_MODE=lead).
// Built-in planted controls (design 3.3): a tampered reference, a fake examinee X, a padding examinee Z.
// A round whose batch misses a control is void; a missed tamper control voids the whole judge.
// Standalone measurement: writes a report JSON only, no qualification record.
//
//   node evals/lead-exam/grade.js --run <run.json> [--run <run2.json> ...] --out report.json
//        [--dry-run | --judge-kind codex --judge-model <id> [--judge-home DIR] [--judge-timeout-ms N]
//         [--void-item <id> ...]
//        [--second-judge-report <report.json> |
//         --second-judge-kind codex|agy --second-judge-model <id> [--second-judge-home DIR]]]
const fs = require('fs');
const crypto = require('crypto');
const lib = require('./lib');
const fx = require('./fixtures');
const jd = require('./judge');
const { callProvider } = require('./transport');

// judge kind -> model family; a second judge must come from a different family than the first
const JUDGE_FAMILY = { codex: 'openai', agy: 'google' };
function checkFamilies(kind1, kind2) {
  if (kind2 && kind1 && JUDGE_FAMILY[kind1] && JUDGE_FAMILY[kind1] === JUDGE_FAMILY[kind2]) {
    throw new Error(`second judge must be a different family than the first (both ${JUDGE_FAMILY[kind1]}: ${kind1}, ${kind2})`);
  }
}

const runSha = (run) => crypto.createHash('sha256').update(JSON.stringify(run.outputs || [])).digest('hex');

// A second judge supplied as a report an older grade.js wrote elsewhere. Refuses (throws) unless: same seed, every run
// here has a matching examinee in it (run_sha256 when the report has one, else name + model + run_wall_ms: reports
// from before this field kept no outputs hash), and the judge family differs from the first judge's.
function secondFromReport(report, runs, seed, firstKind) {
  if (!report || report.schema !== 'lead-exam-report/1' || !Array.isArray(report.examinees)) throw new Error('second judge report is not a lead-exam report');
  if (report.seed !== seed) throw new Error(`second judge report has seed ${report.seed}, this grade has ${seed}`);
  const kind = report.judge && report.judge.kind;
  if (!JUDGE_FAMILY[kind]) throw new Error('second judge report names no known judge kind');
  checkFamilies(firstKind, kind);
  const matched = runs.map((r) => {
    const e = report.examinees.find((x) => x.name === r.name);
    if (!e) throw new Error(`second judge report has no examinee named ${r.name}`);
    if (e.run_sha256) { if (e.run_sha256 !== runSha(r)) throw new Error(`second judge report: run ${r.name} differs (outputs sha256)`); }
    else if (e.model !== r.model || (e.run_wall_ms || null) !== (r.total_ms || null)) throw new Error(`second judge report: run ${r.name} differs (name + model + run_wall_ms; the report holds no outputs hash)`);
    return { e, by: e.run_sha256 ? 'run_sha256' : 'name+model+run_wall_ms' };
  });
  return {
    kind, model: report.judge.model || null, fromReport: true,
    judgeVoid: report.status === 'judge_void' || !(report.controls && report.controls.tamper && report.controls.tamper.caught),
    tamperPass: !!(report.controls && report.controls.tamper && report.controls.tamper.caught),
    status: report.status, roundStatus: (report.controls && report.controls.rounds) || {}, calls: [],
    // judge-only standing hard fails: what the report counted beyond the mechanical layer
    judgeHf: matched.map(({ e }) => Array.from(new Set([
      ...e.hard_fails.all, ...(e.unconfirmed_judge_hard_fails || []).filter((u) => u.flagged_by === 'first').map((u) => u.hf),
    ])).filter((id) => !e.hard_fails.mechanical.includes(id)).map((id) => ({ id, round: undefined, quote: '' }))),
    scores: matched.map(({ e }) => ({ total: e.total, complete: e.complete, categories: e.categories, categories_ok: e.categories_ok })),
    detail: matched.map(({ e }) => e.judge_detail && e.judge_detail.first ? e.judge_detail.first : null),
    matchedBy: matched[0] ? matched[0].by : null,
  };
}

async function judgeWithRetry(judge, req) {
  const calls = [];
  let lastErr = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let reply;
    try { reply = await judge(attempt === 1 ? req : { ...req, retry_note: lastErr }); } catch (e) {
      calls.push({ attempt, valid: false, error: e.message, ms: e.ms || 0 });
      lastErr = e.message;
      continue;
    }
    const v = jd.validateJudgeReply(reply.text, req);
    calls.push({ attempt, valid: v.ok, errors: v.errors.slice(0, 5), ms: reply.ms, in_tokens_est: reply.in_tokens_est, out_tokens_est: reply.out_tokens_est, usage: reply.usage || null });
    // keep what the judge actually said so the next failure (or a repaired reply) can be read
    if (!v.ok || v.repaired) calls[calls.length - 1].raw = String(reply.text || '').slice(0, 4096);
    if (v.repaired) calls[calls.length - 1].repaired = true;
    if (v.ok) return { data: v.data, calls };
    lastErr = v.errors.slice(0, 3).join('; ');
  }
  return { data: null, calls };
}

// runs: [{name, model, outputs[6], rounds?, total_ms?}]; judge: async (request) => {text, ms, ...}
async function gradeExam(opts) {
  const items = opts.items || lib.loadItems();
  const seed = opts.seed;
  const voidIds = Array.from(new Set(opts.voidItems || []));
  voidIds.forEach((id) => { if (!items.items.some((it) => it.id === id)) throw new Error(`--void-item ${id}: no such item`); });
  const voidMsgs = new Set(items.items.filter((it) => voidIds.includes(it.id)).map((it) => it.msg));
  const itemsEff = { ...items, hard_fails: items.hard_fails.map((h) => ({ ...h, mech: h.mech.filter((c) => !voidMsgs.has(c.msg)) })) };
  if (opts.secondJudge && opts.secondReport) throw new Error('second judge: give a live judge or a report, not both');
  if (opts.secondJudge) checkFamilies(opts.judgeKind, opts.secondJudgeKind);
  const rand = opts.rand || Math.random;
  const map = lib.deriveNames(items, seed);
  const runs = opts.runs;
  const examinees = runs.map((r) => ({ run: r, ex: lib.parseExaminee(r.outputs), blind: (r.outputs || []).map((o) => lib.blindText(o, r.model)) }));
  const xOut = fx.controlXOutputs(seed, items).map(lib.blindText);
  const zOut = lib.blindText(fx.controlZOutput());
  // one full judging pass (tamper control, per-round controls X and Z, every examinee) with one judge
  const runPass = async (judge) => {
    const calls = [];
    const roundStatus = {};
    const judgeByExaminee = examinees.map(() => ({}));
    const judgeHf = examinees.map(() => []);

    // tamper control first: if the judge misses it, nothing it says is used
    const tReq = jd.buildJudgeRequest(items, map, 3, { [`ex-${lib.hex(rand, 6)}`]: lib.blindText(fx.tamperGoodOutput(seed, items)) },
      { item: fx.TAMPER_ITEM, expected: fx.TAMPER_EXPECTED });
    const t = await judgeWithRetry(judge, tReq);
    t.calls.forEach((c) => calls.push({ purpose: 'tamper_control', round: 3, ...c }));
    const tamperPass = !!(t.data && t.data.reference_conflicts.includes(fx.TAMPER_ITEM));
    const judgeVoid = !tamperPass;

    const opaque = () => `ex-${lib.hex(rand, 6)}`;
    // one judge call = exactly one answer set: blinding removes identity only, it never mixes examinees into a prompt
    const callOne = async (round, text, purpose) => {
      const label = opaque();
      const req = jd.buildJudgeRequest(items, map, round, { [label]: text }, null);
      const r = await judgeWithRetry(judge, req);
      r.calls.forEach((c) => calls.push({ purpose, round, ...c }));
      return r.data ? { req, label, e: r.data.examinees[label] } : null;
    };

    const examineeVoid = examinees.map(() => []);
    for (let round = 1; round <= items.rounds.length; round += 1) {
      if (judgeVoid) { roundStatus[round] = { status: 'void', reason: 'tamper control missed' }; continue; }
      const failures = [];
      const xr = await callOne(round, xOut[round - 1], 'control_x');
      if (!xr) failures.push('control X: judge reply invalid twice');
      else {
        const xFound = xr.e.hard_fails.map((h) => h.id);
        (fx.CONTROL_X_EXPECTED_HF[round] || []).forEach((id) => { if (!xFound.includes(id)) failures.push(`control X: ${id} not found`); });
      }
      const zr = await callOne(round, zOut, 'control_z');
      if (!zr) failures.push('control Z: judge reply invalid twice');
      else {
        const ze = zr.e;
        const zCredited = zr.req.items.some((it) => it.criteria.some((c) => c.kind === 'credit' && ze.items[it.id] && ze.items[it.id].criteria[c.id] && ze.items[it.id].criteria[c.id].hit));
        if (Object.keys(ze.items).some((id) => ze.items[id].answered) || ze.hard_fails.length || zCredited) failures.push('control Z: padding was credited');
      }
      if (failures.length) { roundStatus[round] = { status: 'void', reason: failures.join('; ') }; continue; }
      const failed = [];
      for (let i = 0; i < examinees.length; i += 1) {
        const r = await callOne(round, examinees[i].blind[round - 1] || '', 'judge');
        if (!r) { failed.push(examinees[i].run.name); examineeVoid[i].push(round); continue; }
        Object.keys(r.e.items).forEach((id) => { judgeByExaminee[i][id] = { criteria: r.e.items[id].criteria, answered: r.e.items[id].answered }; });
        r.e.hard_fails.forEach((h) => judgeHf[i].push({ id: h.id, round, quote: h.quote }));
      }
      roundStatus[round] = failed.length ? { status: 'void', reason: `judge reply invalid twice for: ${failed.join(', ')}` } : { status: 'ok' };
    }
    return { calls, roundStatus, judgeByExaminee, judgeHf, examineeVoid, tamperPass, judgeVoid };
  };

  const P1 = await runPass(opts.judge);
  const P2 = opts.secondReport ? secondFromReport(opts.secondReport, runs, seed, opts.judgeKind)
    : (opts.secondJudge ? await runPass(opts.secondJudge) : null);
  const { calls, roundStatus, judgeByExaminee, judgeHf, examineeVoid, tamperPass, judgeVoid } = P1;

  // the judge's own per-criterion hits with the verbatim quotes it gave as its reasons, and its hard fails with quotes
  const detailOf = (byItem, hfs) => ({
    items: Object.fromEntries(Object.keys(byItem).sort().map((id) => [id, { answered: byItem[id].answered, criteria: byItem[id].criteria }])),
    hard_fails: hfs.map((h) => ({ id: h.id, round: h.round, quote: h.quote })),
  });
  const results = examinees.map((e, i) => {
    const mechHf = lib.mechHardFails(itemsEff, e.ex);
    const judged = judgeHf[i];
    const jh = Array.from(new Set(judged.map((h) => h.id))).sort();
    // the mechanical verdict wins for every hard fail it can decide in the round the judge reported it
    const hfItemOf = (id, round) => {
      const hf = items.hard_fails.find((h) => h.id === id);
      const m = hf.mech.map((c) => c.msg).find((msg) => lib.msgRounds(items)[msg] === round);
      if (m) return m;
      // the judge named the hard fail in a round that does not hold its item (or gave no round, as a report-sourced
      // second judge does): a hard fail defined on one item belongs to that item
      const inRound = items.items.filter((it) => it.round === round);
      if (inRound.length === 1) return inRound[0].id;
      const msgs = Array.from(new Set(hf.mech.map((c) => c.msg)));
      return msgs.length === 1 ? msgs[0] : null;
    };
    const notVoided = (h) => !voidMsgs.has(hfItemOf(h.id, h.round)) && !voidIds.includes(hfItemOf(h.id, h.round));
    const standing = Array.from(new Set(judged.filter((h) => lib.judgeHfStands(items, e.ex, h.id, h.round) && notVoided(h)).map((h) => h.id))).sort();
    const overruled = jh.filter((id) => !standing.includes(id) && !mechHf.includes(id));
    const disagree = [];
    const fullyJudged = examineeVoid[i].length === 0 && !judgeVoid && Object.values(roundStatus).every((s) => s.status === 'ok');
    mechHf.forEach((id) => { if (!jh.includes(id) && fullyJudged) disagree.push(`${id}: mechanical only`); });
    jh.forEach((id) => { if (!mechHf.includes(id)) disagree.push(`${id}: judge only${overruled.includes(id) ? ' (overruled by mechanical)' : ''}`); });
    // an item whose round is void has no judge data: scoreItem marks it void
    const scRaw = lib.scoreExaminee(items, e.ex, judgeByExaminee[i]);
    const sc = voidIds.length ? lib.rescaleVoided(items, e.ex, judgeByExaminee[i], voidIds) : scRaw;
    // dual-judge rule: a hard fail only a judge flagged counts when a second judge of another family flags it too
    const standing2 = P2 && !P2.judgeVoid
      ? Array.from(new Set(P2.judgeHf[i].filter((h) => lib.judgeHfStands(items, e.ex, h.id, h.round) && notVoided(h)).map((h) => h.id))).sort() : [];
    const mr = lib.msgRounds(items);
    const itemOf = hfItemOf;
    const roundOf = (list, id) => (list.find((h) => h.id === id) || {}).round;
    const judgeOnly = Array.from(new Set([...standing, ...standing2])).filter((id) => !mechHf.includes(id)).sort();
    const confirmed = judgeOnly.filter((id) => standing.includes(id) && standing2.includes(id));
    const unconfirmed = judgeOnly.filter((id) => !confirmed.includes(id)).map((id) => ({
      item: itemOf(id, roundOf(judgeHf[i], id) || roundOf(P2 ? P2.judgeHf[i] : [], id)),
      hf: id,
      flagged_by: standing.includes(id) ? 'first' : 'second',
    }));
    const hardFails = Array.from(new Set([...mechHf, ...confirmed])).sort();
    let provisional = null;
    if (!P2) provisional = 'no second judge: judge-only hard fails are unconfirmed';
    else if (P2.judgeVoid) provisional = 'second judge void (tamper control missed): judge-only hard fails are unconfirmed';
    const red = [];
    (e.run.rounds || []).forEach((rr) => { if (rr.timed_out) red.push(`round ${rr.round} timed out, counted blank`); else if (rr.error) red.push(`round ${rr.round} failed: ${rr.error}`); });
    if (unconfirmed.length) red.push('judge-only hard fails not confirmed by a second judge, not counted: PM spot-check');
    if (disagree.length) red.push('mechanical and judge hard fails disagree: PM spot-check');
    const leadCritical = { items: {}, flagged: [], rule: 'flag when the score is below half marks' };
    ['D1', 'D3'].forEach((id) => {
      const it = sc.items.find((x) => x.id === id);
      const flag = it.score !== null && it.score < it.max / 2;
      leadCritical.items[id] = { score: it.score, max: it.max, flag };
      if (flag) leadCritical.flagged.push(id);
    });
    return {
      ...(voidIds.length ? { score_before_rescale: { total: lib.scoreExaminee({ ...items, items: items.items.filter((it) => !voidIds.includes(it.id)) }, e.ex, judgeByExaminee[i]).total, note: 'voided items count 0, scale not restored' } } : {}),
      judge_detail: {
        first: detailOf(judgeByExaminee[i], judgeHf[i]),
        ...(P2 && !P2.fromReport ? { second: detailOf(P2.judgeByExaminee[i], P2.judgeHf[i]) } : {}),
        ...(P2 && P2.fromReport && P2.detail[i] ? { second: P2.detail[i] } : {}),
      },
      run_sha256: runSha(e.run),
      name: e.run.name, model: e.run.model, total: sc.total, complete: sc.complete,
      categories: sc.categories, categories_ok: sc.categories_ok,
      hard_fails: { mechanical: mechHf, judge: jh, all: hardFails, disagree },
      unconfirmed_judge_hard_fails: unconfirmed,
      scores_from: 'first_judge',
      pass_provisional: provisional !== null,
      ...(provisional ? { pass_provisional_reason: provisional } : {}),
      ...(P2 ? { second_judge: { status: P2.judgeVoid ? 'judge_void' : 'ok', hard_fails: standing2, ...(P2.judgeVoid ? {} : (() => { const s2 = P2.fromReport ? P2.scores[i] : (voidIds.length ? lib.rescaleVoided(items, e.ex, P2.judgeByExaminee[i], voidIds) : lib.scoreExaminee(items, e.ex, P2.judgeByExaminee[i])); return { total: s2.total, complete: s2.complete, categories: s2.categories, categories_ok: s2.categories_ok }; })()) } } : {}),
      lead_critical: leadCritical,
      usage: e.run.usage_totals || (e.run.rounds ? lib.usageTotals(e.run.rounds) : null),
      pass: lib.passVerdict(items, sc, hardFails), items: sc.items,
      parse_notes: e.ex.notes, red, run_wall_ms: e.run.total_ms || null,
    };
  });

  const xEx = lib.parseExaminee(fx.controlXOutputs(seed, items));
  return {
    schema: 'lead-exam-report/1', seed, standalone_measurement: true,
    judge: { kind: opts.judgeKind || null, model: opts.judgeModel || null, stub: !!opts.stub },
    second_judge: P2 ? {
      kind: P2.fromReport ? P2.kind : (opts.secondJudgeKind || null), model: P2.fromReport ? P2.model : (opts.secondJudgeModel || null),
      ...(P2.fromReport ? { source: 'report', matched_by: P2.matchedBy, report_status: P2.status } : {}),
      status: P2.judgeVoid ? 'judge_void' : (P2.fromReport ? P2.status : Object.values(P2.roundStatus).every((x) => x.status === 'ok') ? 'ok' : 'partial'),
      tamper_caught: P2.tamperPass, rounds: P2.roundStatus, calls: P2.calls,
    } : null,
    status: judgeVoid ? 'judge_void' : (Object.values(roundStatus).every((s) => s.status === 'ok') ? 'ok' : 'partial'),
    controls: {
      tamper: { item: fx.TAMPER_ITEM, caught: tamperPass },
      rounds: roundStatus,
      x_mechanical_hard_fails: lib.mechHardFails(items, xEx),
    },
    voided_items: voidIds.map((id) => ({ id, reason_flag: '--void-item' })),
    examinees: results,
    calls,
    totals: {
      judge_calls: calls.length + (P2 ? P2.calls.length : 0),
      judge_wall_ms: calls.concat(P2 ? P2.calls : []).reduce((s, c) => s + (c.ms || 0), 0),
      judge_in_tokens_est: calls.concat(P2 ? P2.calls : []).reduce((s, c) => s + (c.in_tokens_est || 0), 0),
      judge_out_tokens_est: calls.concat(P2 ? P2.calls : []).reduce((s, c) => s + (c.out_tokens_est || 0), 0),
      tokens_are_estimates: true,
      examinee_input_tokens: results.reduce((n, r) => n + ((r.usage && r.usage.input_tokens) || 0), 0),
      examinee_output_tokens: results.reduce((n, r) => n + ((r.usage && r.usage.output_tokens) || 0), 0),
      examinee_tokens_note: 'from the claude CLI envelope; rounds without one are counted under usage.rounds_estimated and not added in',
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
    else if (k === '--void-item' && argv[i + 1] !== undefined) { (a.voidItems = a.voidItems || []).push(argv[i + 1]); i += 1; }
    else if (['--run', '--out', '--seed', '--judge-kind', '--judge-model', '--judge-home', '--judge-timeout-ms', '--second-judge-kind', '--second-judge-model', '--second-judge-home', '--second-judge-report'].includes(k) && argv[i + 1] !== undefined) {
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
  let secondJudge = null; let secondReport = null;
  const sk = a['second-judge-kind']; const sm = a['second-judge-model'];
  if (a['second-judge-report']) {
    if (sk || sm || a['second-judge-home']) { process.stderr.write('grade: --second-judge-report excludes --second-judge-kind/-model/-home\n'); process.exit(2); }
    try {
      secondReport = JSON.parse(fs.readFileSync(a['second-judge-report'], 'utf8'));
      secondFromReport(secondReport, runs, seed, judgeKind);
    } catch (e) { process.stderr.write(`grade: ${e.message}\n`); process.exit(2); }
  } else if (sk || sm || a['second-judge-home']) {
    if (a.dry) { process.stderr.write('grade: --second-judge-* cannot be combined with --dry-run\n'); process.exit(2); }
    if (!['codex', 'agy'].includes(sk) || !sm) { process.stderr.write('grade: a second judge needs --second-judge-kind codex|agy and --second-judge-model <roster id verbatim>\n'); process.exit(2); }
    try { checkFamilies(judgeKind, sk); } catch (e) { process.stderr.write(`grade: ${e.message}\n`); process.exit(2); }
    const env2 = {};
    if (a['second-judge-home']) env2[sk === 'codex' ? 'CODEX_HOME' : 'QRP_CLI_HOME'] = a['second-judge-home'];
    secondJudge = providerJudge(sk, sm, Number(a['judge-timeout-ms'] || 720000), env2);
  }
  const unknownVoid = (a.voidItems || []).filter((id) => !items.items.some((it) => it.id === id));
  if (unknownVoid.length) { process.stderr.write(`grade: --void-item names no such item: ${unknownVoid.join(', ')}\n`); process.exit(2); }
  const report = await gradeExam({ items, seed, runs, judge, judgeKind, judgeModel, stub: !!a.dry, voidItems: a.voidItems, secondJudge, secondReport, secondJudgeKind: sk || null, secondJudgeModel: sm || null });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (a.out) fs.writeFileSync(a.out, text); else process.stdout.write(text);
}

if (require.main === module) main().catch((e) => { process.stderr.write(`grade: ${e.message}\n`); process.exit(1); });
module.exports = { gradeExam, checkFamilies };
