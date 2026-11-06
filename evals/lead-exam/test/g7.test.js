'use strict';
// g7: the judge's JSON arrived one closing brace short in single-item rounds. validateJudgeReply makes ONE bounded
// repair (append the missing closers only, string-aware) and records it. Stubs only, no model call.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib');
const jd = require('../judge');
const { gradeExam } = require('../grade');
const fx = require('../fixtures');

const items = lib.loadItems();
// the exact raw reply of the live rerun (round 1, control X): 7 braces opened, 6 closed
const RAW = fs.readFileSync(path.join(__dirname, 'g7-short-brace.raw.txt'), 'utf8');
const reqFor = (label, output) => ({
  items: [{ id: 'A1', points: 1, expected: 'x', criteria: [{ id: 'A1.reason', kind: 'credit', points: 1, desc: 'd', max_count: 1 }] }],
  hard_fails: [], outputs: { [label]: output },
});

test('the exact live raw (one } short) parses after repair, validates, and is flagged repaired', () => {
  const label = Object.keys(JSON.parse(RAW + '}').examinees)[0];
  const req = reqFor(label, '暴露與不可逆優先於有期限，有期限優先於 fyi。');
  const v = jd.validateJudgeReply(RAW, req);
  assert.strictEqual(v.ok, true, v.errors.join(';'));
  assert.strictEqual(v.repaired, true);
  assert.strictEqual(jd.validateJudgeReply(RAW + '}', req).repaired, undefined, 'a complete reply is not flagged');
});

test('an extra } or an unterminated string is not repaired into another structure', () => {
  const req = reqFor('ex-1', 'x');
  assert.strictEqual(jd.validateJudgeReply(RAW + '}}', req).ok, false);
  assert.strictEqual(jd.validateJudgeReply('{"reference_conflicts":[],"examinees":{"ex-1":{"items":{}}}}}', req).ok, false);
  assert.strictEqual(jd.validateJudgeReply('{"reference_conflicts":["a}', req).ok, false);
  assert.strictEqual(jd.validateJudgeReply('{"a":[}', req).ok, false, 'mismatched closer');
});

test('a brace inside a quoted string is not counted as structure', () => {
  const req = reqFor('ex-1', 'a } b');
  const s = '{"reference_conflicts":[],"examinees":{"ex-1":{"items":{"A1":{"answered":true,"criteria":{"A1.reason":{"hit":true,"quote":"a } b"}}}},"hard_fails":[]}}';
  const v = jd.validateJudgeReply(s, req);
  assert.strictEqual(v.ok, true, v.errors.join(';'));
  assert.strictEqual(v.repaired, true);
  // the repaired data equals the fully-braced parse: nothing reordered or dropped
  assert.deepStrictEqual(v.data, JSON.parse(s + '}'));
});

test('grade records repaired:true and the raw reply on the call', async () => {
  const SEED = 'seed-g7';
  const gold = { name: 'gold', model: 'stub', outputs: fx.goldOutputs(SEED, items) };
  const base = jd.stubJudge(items);
  const judge = async (req) => { const r = await base(req); return { ...r, text: r.text.slice(0, -1) }; };
  const rep = await gradeExam({ items, seed: SEED, runs: [gold], judge, rand: () => 0.5 });
  assert.strictEqual(rep.status, 'ok');
  assert.ok(rep.calls.length > 0);
  rep.calls.forEach((c) => { assert.strictEqual(c.valid, true); assert.strictEqual(c.repaired, true); assert.strictEqual(typeof c.raw, 'string'); });
});
