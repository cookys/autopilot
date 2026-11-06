'use strict';
// g6: a judge that answers prose on an output with no gradable answer must not void a control round; an invalid
// reply's raw text (4 KB cap) is kept in the call record. Stubs only, no model call.
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');
const fx = require('../fixtures');
const jd = require('../judge');
const { gradeExam } = require('../grade');

const items = lib.loadItems();
const SEED = 'seed-g6';
const gold = { name: 'gold', model: 'stub', outputs: fx.goldOutputs(SEED, items) };
const grade = (judge, runs) => gradeExam({ items, seed: SEED, runs: runs || [gold], judge, rand: () => 0.5 });

// Answers prose when the prompt does not tell it to reply with the full JSON even for an output that holds no
// answer (the shape the live Haiku judge showed on the padding control); JSON otherwise.
function proseUnlessToldJudge() {
  const base = jd.stubJudge(items);
  return async (req) => {
    const p = jd.buildJudgePrompt(req);
    if (!p.includes('即使輸出裡沒有任何可評的答案')) return { text: '這份輸出沒有可評分的答案，無法評分。', ms: 0, in_tokens_est: 0, out_tokens_est: 9, usage: null };
    return base(req);
  };
}

test('a prose-prone judge on the control prompts: no round is void at the tip', async () => {
  const rep = await grade(proseUnlessToldJudge());
  Object.keys(rep.controls.rounds).forEach((r) => assert.strictEqual(rep.controls.rounds[r].status, 'ok', `round ${r}`));
  assert.strictEqual(rep.status, 'ok');
});

test('the prompt names the real opaque label in the format line, never a fixed ex-1', () => {
  const map = lib.deriveNames(items, SEED);
  const p = jd.buildJudgePrompt(jd.buildJudgeRequest(items, map, 1, { 'ex-ab12cd': 'x' }, null));
  assert.ok(p.includes('"ex-ab12cd":{"items"'), 'format line carries the real label');
  assert.ok(!p.includes('"ex-1"'), 'no fixed ex-1 label');
});

test('an invalid reply keeps its raw text, cut to 4 KB, in the call record; a valid one carries none', async () => {
  const long = 'P'.repeat(6000);
  const base = jd.stubJudge(items);
  let n = 0;
  const judge = async (req) => {
    n += 1;
    if (req.tampered_item === null && req.round === 1 && n <= 2 + 0) return { text: long, ms: 0, in_tokens_est: 0, out_tokens_est: 0, usage: null };
    return base(req);
  };
  const rep = await grade(judge);
  const bad = rep.calls.filter((c) => !c.valid);
  assert.ok(bad.length >= 1, 'an invalid call was recorded');
  bad.forEach((c) => { assert.strictEqual(typeof c.raw, 'string'); assert.strictEqual(c.raw.length, 4096); });
  rep.calls.filter((c) => c.valid).forEach((c) => assert.strictEqual(c.raw, undefined));
});

test('the second attempt tells the judge why the first reply was refused', async () => {
  const base = jd.stubJudge(items);
  const seen = [];
  let first = true;
  const judge = async (req) => {
    seen.push(jd.buildJudgePrompt(req));
    if (first) { first = false; return { text: 'prose', ms: 0, in_tokens_est: 0, out_tokens_est: 0, usage: null }; }
    return base(req);
  };
  await grade(judge);
  assert.ok(!seen[0].includes('上一次回覆'), 'first attempt has no retry note');
  assert.ok(seen[1].includes('上一次回覆'), 'second attempt carries the retry note');
});
