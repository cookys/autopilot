'use strict';
// g5: the judge sees one examinee per call, mechanical wins on the hard fails it can decide, examinee usage
// comes from the CLI's own output, and the report names D1 / D3 separately. Stubs only, no model call.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const fx = require('../fixtures');
const jd = require('../judge');
const { gradeExam } = require('../grade');
const { runExam } = require('../run');
const { callProvider } = require('../transport');
const provider = require('../../../scripts/qualification-review-provider.js');

const items = lib.loadItems();
const SEED = 'seed-g5';
const gold = (name) => ({ name: name || 'gold', model: 'stub', outputs: fx.goldOutputs(SEED, items) });
const grade = (judge, runs) => gradeExam({ items, seed: SEED, runs: runs || [gold()], judge, rand: () => 0.5 });

// A judge that mis-attributes: whenever ANY output in the request it was handed holds a hard fail, it reports that
// hard fail on EVERY examinee output in the same request (the Haiku calibration failure shape).
function crossAttributingJudge() {
  const base = jd.stubJudge(items);
  return async (req) => {
    const reply = await base(req);
    const data = JSON.parse(reply.text);
    const seen = [];
    Object.keys(data.examinees).forEach((l) => data.examinees[l].hard_fails.forEach((h) => { if (!seen.includes(h.id)) seen.push(h.id); }));
    Object.keys(data.examinees).forEach((l) => {
      const e = data.examinees[l];
      if (req.outputs[l].indexOf('{') === -1) return; // the padding control has no JSON: leave it alone
      seen.forEach((id) => { if (!e.hard_fails.some((h) => h.id === id)) e.hard_fails.push({ id, quote: req.outputs[l].slice(0, 12) }); });
    });
    return { ...reply, text: JSON.stringify(data) };
  };
}

// A judge that always adds `id` to every output that has JSON, in `round` only.
function forcingJudge(id, round) {
  const base = jd.stubJudge(items);
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

test('regression: X answers E1=GO, the examinee E1=NO_GO, a cross-attributing judge: HF8 stays off the examinee, X still gets it', async () => {
  const rep = await grade(crossAttributingJudge());
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.judge, [], 'judge hard fails on the examinee');
  assert.deepStrictEqual(e.hard_fails.all, []);
  assert.strictEqual(e.pass, true);
  assert.strictEqual(rep.controls.rounds[5].status, 'ok', 'X still caught on HF8 in its own call');
  assert.deepStrictEqual(rep.controls.x_mechanical_hard_fails, ['HF1', 'HF7', 'HF8']);
});

test('a judge prompt never holds two examinees\' answers; X, Z and the tamper control have their own calls', async () => {
  const prompts = [];
  const base = jd.stubJudge(items);
  const judge = async (req) => { prompts.push({ req, prompt: jd.buildJudgePrompt(req) }); return base(req); };
  const other = { name: 'other', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'E1', 'action', 'GO') };
  const rep = await grade(judge, [gold(), other]);
  assert.ok(prompts.length > 0);
  prompts.forEach(({ req, prompt }) => {
    assert.strictEqual(Object.keys(req.outputs).length, 1, 'one output per request');
    assert.strictEqual((prompt.match(/的輸出（開始）/g) || []).length, 1, 'one output block per prompt');
  });
  // tamper 1 + per round (2 examinees + X + Z) * 6
  assert.strictEqual(rep.calls.length, 1 + 6 * 4);
  assert.strictEqual(rep.totals.judge_calls, 25);
  // the examinee that answered E1=GO carries HF8, the other does not
  assert.deepStrictEqual(rep.examinees[0].hard_fails.all, []);
  assert.deepStrictEqual(rep.examinees[1].hard_fails.all, ['HF8']);
});

test('blinding removes identity only: the id is opaque, not the run name, and differs between calls', async () => {
  const labels = [];
  const base = jd.stubJudge(items);
  let k = 0;
  const rand = () => { k += 1; return (k * 0.37) % 1; };
  const judge = async (req) => { labels.push(Object.keys(req.outputs)[0]); return base(req); };
  await gradeExam({ items, seed: SEED, runs: [gold('my-run-name')], judge, rand });
  assert.ok(labels.every((l) => /^ex-[0-9a-f]{6}$/.test(l)), labels.join(','));
  assert.ok(new Set(labels).size > 1, 'ids are re-drawn per call');
});

test('mechanical wins: a judge-only HF8 on E1=NO_GO is recorded as disagree, pass follows mechanical', async () => {
  const rep = await grade(forcingJudge('HF8', 5));
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.mechanical, []);
  assert.deepStrictEqual(e.hard_fails.judge, ['HF8']);
  assert.deepStrictEqual(e.hard_fails.all, [], 'the overruled judge verdict is not a hard fail');
  assert.ok(e.hard_fails.disagree.some((m) => /^HF8: judge only/.test(m)));
  assert.strictEqual(e.pass, true);
  assert.ok(e.red.some((m) => /disagree/.test(m)));
});

test('mechanical wins on HF1 and HF7 too (judge-only in the round that holds D2 / C3)', async () => {
  for (const [id, round] of [['HF1', 2], ['HF7', 3]]) {
    const rep = await grade(forcingJudge(id, round));
    assert.deepStrictEqual(rep.examinees[0].hard_fails.all, [], id);
    assert.strictEqual(rep.examinees[0].pass, true, id);
  }
});

test('a hard fail the mechanical layer cannot decide keeps today\'s rule: HF7 on the round-6 summary still stands', async () => {
  const rep = await grade(forcingJudge('HF7', 6));
  const e = rep.examinees[0];
  assert.deepStrictEqual(e.hard_fails.all, ['HF7']);
  assert.strictEqual(e.pass, false);
});

test('mechanical hard fail with a judge that misses it: still a hard fail (unchanged)', async () => {
  const run = { name: 'bad', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D4', 'action', 'GO') };
  const rep = await grade(jd.stubJudge(items, { missHf: 'HF4' }), [run]);
  assert.deepStrictEqual(rep.examinees[0].hard_fails.all, ['HF4']);
  assert.strictEqual(rep.examinees[0].pass, false);
});

// ---- usage ------------------------------------------------------------------
test('provider: the claude envelope\'s usage block is handed back by verifyClaudeRuntimeIdentity', () => {
  const env = JSON.stringify({ result: 'hi', is_error: false, modelUsage: { 'claude-haiku-5-5-20261001': {} }, usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } });
  const v = provider.verifyClaudeRuntimeIdentity(env, 'claude-haiku-5-5');
  assert.deepStrictEqual(v.cliUsage, { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 });
});

test('transport: cli_usage from the provider JSON is returned as cli_usage; absent stays null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-g5-'));
  try {
    const mk = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, `#!/usr/bin/env node\nrequire('fs').readFileSync(0);process.stdout.write(${JSON.stringify(body)});\n`, { mode: 0o755 }); return f; };
    const withU = mk('with.js', JSON.stringify({ output: 'x', usage: null, cli_usage: { input_tokens: 5, output_tokens: 9, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } }));
    const without = mk('without.js', JSON.stringify({ output: 'x', usage: null }));
    const a = await callProvider('FAKE-PROMPT', { kind: 'claude', model: 'fake', timeoutMs: 20000, providerBin: withU });
    assert.deepStrictEqual(a.cli_usage, { input_tokens: 5, output_tokens: 9, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 });
    const b = await callProvider('FAKE-PROMPT', { kind: 'claude', model: 'fake', timeoutMs: 20000, providerBin: without });
    assert.strictEqual(b.cli_usage, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runExam records per-round usage from the CLI, null when the call gives none, and totals with estimates marked', async () => {
  const outs = fx.goldOutputs('t5', items);
  const rec = await runExam({
    items, seed: 't5', name: 'u', model: 'stub',
    call: async (p, r) => ({
      text: outs[r - 1], ms: 1, in_tokens_est: 100, out_tokens_est: 50,
      cli_usage: r === 3 ? null : { input_tokens: 10 * r, output_tokens: r, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
    }),
  });
  assert.deepStrictEqual(rec.rounds[0].usage, { source: 'cli', input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 });
  assert.strictEqual(rec.rounds[2].usage, null, 'null only when the call gave none');
  assert.strictEqual(rec.rounds[2].in_tokens_est, 100, 'the estimate stays, marked as one by the field name');
  const t = rec.usage_totals;
  assert.strictEqual(t.rounds_measured, 5);
  assert.strictEqual(t.rounds_estimated, 1);
  assert.strictEqual(t.input_tokens, 10 + 20 + 40 + 50 + 60);
  assert.strictEqual(t.output_tokens, 1 + 2 + 4 + 5 + 6);
  assert.strictEqual(t.estimate_in_tokens, 100);
  assert.strictEqual(t.estimate_out_tokens, 50);
  assert.strictEqual(t.estimates_included_in_totals, false);
});

test('the report carries the examinee usage totals from the run record', async () => {
  const outs = fx.goldOutputs(SEED, items);
  const rec = await runExam({
    items, seed: SEED, name: 'u', model: 'stub',
    call: async (_p, r) => ({ text: outs[r - 1], ms: 1, in_tokens_est: 1, out_tokens_est: 1, cli_usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
  });
  const rep = await grade(jd.stubJudge(items), [rec]);
  assert.strictEqual(rep.examinees[0].usage.input_tokens, 42);
  assert.strictEqual(rep.examinees[0].usage.output_tokens, 18);
  assert.strictEqual(rep.totals.examinee_input_tokens, 42);
  assert.strictEqual(rep.totals.examinee_output_tokens, 18);
});

// ---- lead_critical ----------------------------------------------------------
test('lead_critical names D1 and D3 separately and flags a score below half marks', async () => {
  const good = await grade(jd.stubJudge(items));
  const lc = good.examinees[0].lead_critical;
  assert.deepStrictEqual(Object.keys(lc.items).sort(), ['D1', 'D3']);
  assert.strictEqual(lc.items.D1.score, 4);
  assert.strictEqual(lc.items.D1.max, 4);
  assert.strictEqual(lc.items.D1.flag, false);
  assert.deepStrictEqual(lc.flagged, []);
  // over-escalate D1 and D3 to FORWARD_PM: the over-escalation deduction takes them below half marks
  const a = { name: 'esc', model: 'stub', outputs: fx.mutateOutputs(SEED, items, 'D1', 'action', 'FORWARD_PM') };
  const rep = await grade(jd.stubJudge(items), [a]);
  const l2 = rep.examinees[0].lead_critical;
  assert.strictEqual(l2.items.D1.flag, true);
  assert.strictEqual(l2.items.D3.flag, false);
  assert.deepStrictEqual(l2.flagged, ['D1']);
});
