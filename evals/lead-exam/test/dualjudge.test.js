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
