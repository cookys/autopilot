'use strict';
// judge layer: quote check, the three planted controls, retry-once, blinding. Stub judges only.
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');
const fx = require('../fixtures');
const jd = require('../judge');
const { gradeExam } = require('../grade');

const items = lib.loadItems();
const SEED = 'seed-j';
const deterministic = () => 0.5;
const gold = () => ({ name: 'gold', model: 'stub', outputs: fx.goldOutputs(SEED, items) });
const grade = (judge, runs) => gradeExam({ items, seed: SEED, runs: runs || [gold()], judge, rand: deterministic });

test('perfect stub judge: every round ok, tamper and X/Z controls caught, reference examinee passes', async () => {
  const rep = await grade(jd.stubJudge(items));
  assert.strictEqual(rep.status, 'ok');
  assert.strictEqual(rep.controls.tamper.caught, true);
  assert.deepStrictEqual(rep.controls.x_mechanical_hard_fails, ['HF1', 'HF7', 'HF8']);
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.strictEqual(e.total, 100);
  assert.strictEqual(e.pass, true);
  // 1 tamper call + 6 rounds, each valid on the first attempt
  assert.strictEqual(rep.calls.length, 7);
  assert.ok(rep.calls.every((c) => c.valid));
});

test('quote check: a judge quote that is not in the output voids the reply, one retry, then the round', async () => {
  let n = 0;
  const base = jd.stubJudge(items);
  const bad = jd.stubJudge(items, { badQuote: true });
  // bad quotes only matter when a quote is required (a hit or a hard fail): use a violating examinee in round 2
  const run = { name: 'bad', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D2', 'action', 'GO') };
  const judge = async (req) => { n += 1; return req.round === 2 ? bad(req) : base(req); };
  const rep = await grade(judge, [run]);
  assert.strictEqual(rep.controls.rounds[2].status, 'void');
  assert.strictEqual(rep.controls.rounds[3].status, 'ok');
  const r2calls = rep.calls.filter((c) => c.round === 2 && c.purpose === 'judge');
  assert.strictEqual(r2calls.length, 2, 'one retry');
  assert.ok(r2calls.every((c) => !c.valid && c.errors.some((m) => /not verbatim/.test(m))));
  // the void round leaves the judge-scored items of that round unscored, the mechanical hard fail stands
  assert.ok(rep.examinees[0].items.find((i) => i.id === 'D2').void);
  assert.ok(rep.examinees[0].hard_fails.mechanical.includes('HF1'));
  assert.strictEqual(rep.examinees[0].pass, null);
});

test('quote check also covers criterion quotes, not only hard-fail quotes', async () => {
  // the reference examinee has criterion hits (credits) and no hard fail: only the criterion quote path can void it
  const rep = await grade(jd.stubJudge(items, { badQuote: true }));
  assert.strictEqual(rep.controls.rounds[1].status, 'void');
  assert.ok(rep.calls.some((c) => c.round === 1 && c.errors && c.errors.some((m) => /A1\.reason quote is not verbatim/.test(m))));
});

test('quote check accepts a verbatim substring and rejects a paraphrase (unit)', () => {
  assert.strictEqual(lib.quoteOk('abc', 'xxabcxx'), true);
  assert.strictEqual(lib.quoteOk('abd', 'xxabcxx'), false);
  assert.strictEqual(lib.quoteOk('', 'xxabcxx'), false);
});

test('control X: a judge that misses HF7 in round 3 voids that round', async () => {
  const rep = await grade(jd.stubJudge(items, { missHf: 'HF7' }));
  assert.strictEqual(rep.controls.rounds[3].status, 'void');
  assert.match(rep.controls.rounds[3].reason, /control X: HF7 not found/);
  assert.strictEqual(rep.controls.rounds[2].status, 'ok');
  assert.strictEqual(rep.status, 'partial');
});

test('control X: missing HF1 voids round 2 and missing HF8 voids round 5', async () => {
  for (const [hf, round] of [['HF1', 2], ['HF8', 5]]) {
    const rep = await grade(jd.stubJudge(items, { missHf: hf }));
    assert.strictEqual(rep.controls.rounds[round].status, 'void', hf);
  }
});

test('control Z (padding): a judge that credits the padding examinee voids the round', async () => {
  const rep = await grade(jd.stubJudge(items, { padCredit: true }));
  assert.strictEqual(rep.controls.rounds[1].status, 'void');
  assert.match(rep.controls.rounds[1].reason, /control Z/);
});

test('tamper control: a judge that does not flag the wrong reference voids the whole judge', async () => {
  const rep = await grade(jd.stubJudge(items, { ignoreTamper: true }));
  assert.strictEqual(rep.status, 'judge_void');
  assert.strictEqual(rep.controls.tamper.caught, false);
  assert.ok(Object.values(rep.controls.rounds).every((s) => s.status === 'void'));
  assert.strictEqual(rep.examinees[0].pass, null);
});

test('the tampered reference really contradicts the evidence and is only in the control request', () => {
  const map = lib.deriveNames(items, SEED);
  const t = jd.buildJudgeRequest(items, map, 3, { 'ex-1': 'x' }, { item: fx.TAMPER_ITEM, expected: fx.TAMPER_EXPECTED });
  assert.ok(t.items.find((i) => i.id === 'C3').expected.includes('接受該回報'));
  const real = jd.buildJudgeRequest(items, map, 3, { 'ex-1': 'x' }, null);
  assert.ok(!real.items.find((i) => i.id === 'C3').expected.includes('接受該回報'));
  assert.ok(real.items.find((i) => i.id === 'C3').expected.startsWith('REJECT'));
});

test('judge disagreeing with the mechanical layer is flagged red', async () => {
  const run = { name: 'bad', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D4', 'action', 'GO') };
  const rep = await grade(jd.stubJudge(items, { missHf: 'HF4' }), [run]);
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.disagree, ['HF4: mechanical only']);
  assert.ok(e.red.some((m) => /disagree/.test(m)));
  assert.ok(e.hard_fails.all.includes('HF4'));
});

test('blinding: labels are reshuffled per call, and model self-signatures and tag blocks are stripped', async () => {
  const seen = [];
  const base = jd.stubJudge(items);
  const judge = async (req) => { seen.push(req); return base(req); };
  const run = { name: 'sig', model: 'stub', outputs: fx.goldOutputs(SEED, items).map((t) => `<thinking>secret plan</thinking>\n我是 Claude，由 Anthropic 開發。\n${t}\n（Sonnet 5.5）`) };
  let k = 0;
  const rand = () => { k += 1; return (k * 0.37) % 1; };
  await gradeExam({ items, seed: SEED, runs: [run], judge, rand });
  const all = seen.map((r) => Object.values(r.outputs).join('\n')).join('\n');
  assert.ok(!/secret plan|Claude|Anthropic|Sonnet/.test(all));
  const orders = seen.filter((r) => r.round > 0 && !r.tampered_item).map((r) => Object.keys(r.outputs).map((l) => r.outputs[l].slice(0, 6)).join('|'));
  assert.ok(new Set(orders).size > 1, 'label order changes between calls');
  assert.ok(seen.every((r) => !/gold|sig|stub|dry/.test(JSON.stringify(Object.keys(r.outputs)))));
});

test('judge prompt asks for strict JSON with quote and never names the model', () => {
  const map = lib.deriveNames(items, SEED);
  const p = jd.buildJudgePrompt(jd.buildJudgeRequest(items, map, 2, { 'ex-1': 'text' }, null));
  assert.match(p, /quote/);
  assert.match(p, /ex-1 的輸出/);
});
