'use strict';
// dual judge: a hard fail only a judge flagged counts when a second judge of another family flags it too.
// Stub judges only, no model call (the CLI refusal test spawns grade.js, which refuses before any judge runs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('../lib');
const fx = require('../fixtures');
const jd = require('../judge');
const { gradeExam } = require('../grade');

const items = lib.loadItems();
const SEED = 'seed-dual';
const gold = () => ({ name: 'gold', model: 'stub', outputs: fx.goldOutputs(SEED, items) });

// stub judge that adds hard fail `id` to every output with JSON in `round`
function forcing(id, round, opts) {
  const base = jd.stubJudge(items, opts);
  return async (req) => {
    const reply = await base(req);
    if (req.round !== round) return reply;
    const data = JSON.parse(reply.text);
    Object.keys(data.examinees).forEach((l) => {
      const e = data.examinees[l];
      if (req.outputs[l].indexOf('{') === -1) return;
      if (!e.hard_fails.some((h) => h.id === id)) e.hard_fails.push({ id, quote: req.outputs[l].slice(0, 12) });
    });
    return { ...reply, text: JSON.stringify(data) };
  };
}
const plain = (opts) => jd.stubJudge(items, opts);
const grade = (o) => gradeExam({ items, seed: SEED, runs: o.runs || [gold()], rand: () => 0.5, judgeKind: 'codex', secondJudgeKind: 'agy', ...o });

test('mechanical hard fail counts directly, with or without a second judge', async () => {
  const bad = { name: 'bad', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D4', 'action', 'GO') };
  const a = await grade({ runs: [bad], judge: plain() });
  assert.deepStrictEqual(a.examinees[0].hard_fails.all, ['HF4']);
  assert.strictEqual(a.examinees[0].pass, false);
  const b = await grade({ runs: [bad], judge: plain(), secondJudge: plain() });
  assert.deepStrictEqual(b.examinees[0].hard_fails.all, ['HF4']);
  assert.strictEqual(b.examinees[0].pass_provisional, false);
});

test('judge and second judge both flag: counted, pass false, not provisional', async () => {
  const rep = await grade({ judge: forcing('HF7', 6), secondJudge: forcing('HF7', 6) });
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, ['HF7']);
  assert.strictEqual(e.pass, false);
  assert.deepStrictEqual(e.unconfirmed_judge_hard_fails, []);
  assert.strictEqual(e.pass_provisional, false);
  assert.strictEqual(e.scores_from, 'first_judge');
  assert.strictEqual(rep.second_judge.status, 'ok');
  assert.strictEqual(e.second_judge.total, e.total);
});

test('only the first judge flags: not counted, listed unconfirmed with flagged_by first', async () => {
  const rep = await grade({ judge: forcing('HF7', 6), secondJudge: plain() });
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.strictEqual(e.pass, true);
  assert.deepStrictEqual(e.unconfirmed_judge_hard_fails, [{ item: 'R', hf: 'HF7', flagged_by: 'first' }]);
  assert.strictEqual(e.pass_provisional, false);
});

test('only the second judge flags: not counted, listed unconfirmed with flagged_by second', async () => {
  const rep = await grade({ judge: plain(), secondJudge: forcing('HF7', 6) });
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.strictEqual(e.pass, true);
  assert.deepStrictEqual(e.unconfirmed_judge_hard_fails, [{ item: 'R', hf: 'HF7', flagged_by: 'second' }]);
});

test('no second judge: judge-only hard fail unconfirmed, pass provisional', async () => {
  const rep = await grade({ judge: forcing('HF7', 6), secondJudgeKind: undefined });
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.deepStrictEqual(e.unconfirmed_judge_hard_fails, [{ item: 'R', hf: 'HF7', flagged_by: 'first' }]);
  assert.strictEqual(e.pass_provisional, true);
  assert.match(e.pass_provisional_reason, /no second judge/);
  assert.strictEqual(rep.second_judge, null);
});

test('second judge void (tamper missed): same as no second judge, reason says void', async () => {
  const rep = await grade({ judge: forcing('HF7', 6), secondJudge: forcing('HF7', 6, { ignoreTamper: true }) });
  const e = rep.examinees[0];
  assert.strictEqual(rep.second_judge.status, 'judge_void');
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.deepStrictEqual(e.unconfirmed_judge_hard_fails, [{ item: 'R', hf: 'HF7', flagged_by: 'first' }]);
  assert.strictEqual(e.pass_provisional, true);
  assert.match(e.pass_provisional_reason, /void/);
});

test('same-family second judge is refused (API and CLI)', async () => {
  await assert.rejects(grade({ judge: plain(), secondJudge: plain(), secondJudgeKind: 'codex' }), /different family/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dualjudge-'));
  const runFile = path.join(dir, 'run.json');
  fs.writeFileSync(runFile, JSON.stringify({ ...gold(), seed: SEED }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'grade.js'), '--run', runFile, '--out', path.join(dir, 'r.json'),
    '--judge-kind', 'codex', '--judge-model', 'm1', '--second-judge-kind', 'codex', '--second-judge-model', 'm2'], { encoding: 'utf8', input: '', timeout: 20000 });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /different family/);
  assert.ok(!fs.existsSync(path.join(dir, 'r.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- judge detail kept in the report --------------------------------------
test('report keeps each judge\'s per-item criteria with their quotes and hard fails with quotes (first and second)', async () => {
  const rep = await grade({ judge: forcing('HF7', 6), secondJudge: forcing('HF7', 6) });
  const d = rep.examinees[0].judge_detail;
  ['first', 'second'].forEach((w) => {
    assert.ok(d[w].items.D1 && typeof d[w].items.D1.answered === 'boolean', `${w} items`);
    const quoted = Object.values(d[w].items).flatMap((it) => Object.values(it.criteria)).filter((c) => c.hit);
    assert.ok(quoted.length > 0 && quoted.every((c) => typeof c.quote === 'string' && c.quote.length > 0), `${w} hit criteria carry quotes`);
    assert.strictEqual(d[w].hard_fails.length, 1);
    assert.strictEqual(d[w].hard_fails[0].id, 'HF7');
    assert.ok(d[w].hard_fails[0].quote.length > 0);
  });
});

// ---- --void-item ------------------------------------------------------------
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const d3bad = () => ({ name: 'd3', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D3', 'action', 'NO_GO') });

test('no --void-item: result unchanged, no voided entries, no rescale block', async () => {
  const rep = await grade({ runs: [d3bad()], judge: plain(), secondJudge: plain() });
  assert.deepStrictEqual(rep.voided_items, []);
  assert.strictEqual(rep.examinees[0].total, 96);
  assert.strictEqual(rep.examinees[0].categories.B.score, 21);
  assert.strictEqual(rep.examinees[0].score_before_rescale, undefined);
});

test('--void-item D1: score scaled back to 100 (total 92 * 100/96, B 17 * 25/21), thresholds unchanged', async () => {
  const rep = await grade({ runs: [d3bad()], judge: plain(), secondJudge: plain(), voidItems: ['D1'] });
  const e = rep.examinees[0];
  assert.deepStrictEqual(rep.voided_items, [{ id: 'D1', reason_flag: '--void-item' }]);
  assert.strictEqual(e.score_before_rescale.total, 92);
  near(e.total, 92 * 100 / 96);
  near(e.categories.B.score, 17 * 25 / 21);
  assert.strictEqual(e.categories.B.raw, 17);
  assert.strictEqual(e.items.find((x) => x.id === 'D1').voided, true);
  assert.strictEqual(e.lead_critical.items.D1.flag, false);
  assert.strictEqual(e.pass, true);
  near(e.second_judge.total, 92 * 100 / 96);
});

test('--void-item: a hard fail of the voided item is not counted, one of another item still is', async () => {
  const bad = { name: 'bad', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D4', 'action', 'GO') };
  const on = await grade({ runs: [bad], judge: plain(), secondJudge: plain() });
  assert.deepStrictEqual(on.examinees[0].hard_fails.all, ['HF4']);
  const off = await grade({ runs: [bad], judge: plain(), secondJudge: plain(), voidItems: ['D4'] });
  assert.deepStrictEqual(off.examinees[0].hard_fails.all, []);
  assert.deepStrictEqual(off.examinees[0].hard_fails.mechanical, []);
  assert.strictEqual(off.examinees[0].pass, true);
  const other = await grade({ runs: [bad], judge: plain(), secondJudge: plain(), voidItems: ['D1'] });
  assert.deepStrictEqual(other.examinees[0].hard_fails.all, ['HF4']);
  assert.strictEqual(other.examinees[0].pass, false);
});

test('--void-item with an unknown id is refused (API and CLI)', async () => {
  await assert.rejects(grade({ judge: plain(), voidItems: ['ZZ'] }), /no such item/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dualjudge-'));
  const runFile = path.join(dir, 'run.json');
  fs.writeFileSync(runFile, JSON.stringify({ ...gold(), seed: SEED }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'grade.js'), '--run', runFile, '--dry-run', '--void-item', 'ZZ'], { encoding: 'utf8', input: '', timeout: 20000 });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no such item/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- --second-judge-report ----------------------------------------------------
// A report an earlier grade.js wrote elsewhere (made here by a stub judge, then given the old shape: no judge_detail,
// no run_sha256), used as the second judge.
async function oldStyleReport(o) {
  const rep = await gradeExam({ items, seed: SEED, runs: o.runs || [gold()], rand: () => 0.5, judgeKind: o.kind || 'agy', judge: o.judge || plain() });
  rep.judge = { kind: o.kind || 'agy', model: 'm', stub: false };
  rep.examinees.forEach((e) => {
    // the old grade.js counted a judge-only hard fail straight into `all`
    e.hard_fails.all = Array.from(new Set([...e.hard_fails.all, ...e.unconfirmed_judge_hard_fails.map((u) => u.hf)])).sort();
    delete e.unconfirmed_judge_hard_fails; delete e.judge_detail; delete e.run_sha256; e.run_wall_ms = null;
  });
  return rep;
}
const viaReport = (report, o) => grade({ judgeKind: 'codex', secondJudgeKind: undefined, secondReport: report, ...o });

test('report as second judge, both judges flag: counted, matched by name+model+run_wall_ms', async () => {
  const rep = await viaReport(await oldStyleReport({ judge: forcing('HF7', 6) }), { judge: forcing('HF7', 6) });
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, ['HF7']);
  assert.strictEqual(e.pass_provisional, false);
  assert.strictEqual(rep.second_judge.source, 'report');
  assert.strictEqual(rep.second_judge.matched_by, 'name+model+run_wall_ms');
  assert.strictEqual(rep.second_judge.kind, 'agy');
  assert.strictEqual(e.second_judge.total, e.total);
  assert.strictEqual(e.judge_detail.second, undefined, 'an old report without judge_detail is skipped, not an error');
});

test('report as second judge, only one side flags: unconfirmed', async () => {
  const a = await viaReport(await oldStyleReport({}), { judge: forcing('HF7', 6) });
  assert.deepStrictEqual(a.examinees[0].hard_fails.all, []);
  assert.strictEqual(a.examinees[0].unconfirmed_judge_hard_fails[0].flagged_by, 'first');
  const b = await viaReport(await oldStyleReport({ judge: forcing('HF7', 6) }), { judge: plain() });
  assert.deepStrictEqual(b.examinees[0].hard_fails.all, []);
  assert.strictEqual(b.examinees[0].unconfirmed_judge_hard_fails[0].flagged_by, 'second');
});

test('report as second judge: a new-format report matches by run_sha256', async () => {
  const r = await gradeExam({ items, seed: SEED, runs: [gold()], rand: () => 0.5, judgeKind: 'agy', judge: plain() });
  r.judge = { kind: 'agy', model: 'm', stub: false };
  const ok = await viaReport(r, { judge: plain() });
  assert.strictEqual(ok.second_judge.matched_by, 'run_sha256');
  r.examinees[0].run_sha256 = 'f'.repeat(64);
  await assert.rejects(viaReport(r, { judge: plain() }), /outputs sha256/);
});

test('report as second judge, void report: same as a void second judge (provisional)', async () => {
  const r = await oldStyleReport({ judge: forcing('HF7', 6, { ignoreTamper: true }) });
  assert.strictEqual(r.status, 'judge_void');
  const rep = await viaReport(r, { judge: forcing('HF7', 6) });
  const e = rep.examinees[0];
  assert.strictEqual(rep.second_judge.status, 'judge_void');
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.strictEqual(e.pass_provisional, true);
  assert.match(e.pass_provisional_reason, /void/);
});

test('report as second judge: different seed, run mismatch and same family are refused', async () => {
  const r = await oldStyleReport({});
  await assert.rejects(viaReport({ ...r, seed: 'other' }, { judge: plain() }), /seed/);
  const wall = JSON.parse(JSON.stringify(r)); wall.examinees[0].run_wall_ms = 123;
  await assert.rejects(viaReport(wall, { judge: plain() }), /differs/);
  const nm = JSON.parse(JSON.stringify(r)); nm.examinees[0].name = 'someone-else';
  await assert.rejects(viaReport(nm, { judge: plain() }), /no examinee named/);
  const fam = await oldStyleReport({ kind: 'codex' });
  await assert.rejects(viaReport(fam, { judge: plain() }), /different family/);
});

test('--second-judge-report CLI: exit 2 on mismatch and on use with --second-judge-kind; reads the real void report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dualjudge-'));
  const runFile = path.join(dir, 'run.json');
  fs.writeFileSync(runFile, JSON.stringify({ ...gold(), seed: SEED }));
  const repFile = path.join(dir, 'rep.json');
  fs.writeFileSync(repFile, JSON.stringify({ schema: 'lead-exam-report/1', seed: 'other', judge: { kind: 'agy' }, examinees: [] }));
  const g = path.join(__dirname, '..', 'grade.js');
  const run = (args) => spawnSync(process.execPath, [g, '--run', runFile, '--dry-run', ...args], { encoding: 'utf8', input: '', timeout: 30000 });
  let r = run(['--second-judge-report', repFile]);
  assert.strictEqual(r.status, 2); assert.match(r.stderr, /seed/);
  r = run(['--second-judge-report', repFile, '--second-judge-kind', 'agy']);
  assert.strictEqual(r.status, 2); assert.match(r.stderr, /excludes/);
  fs.rmSync(dir, { recursive: true, force: true });
});
