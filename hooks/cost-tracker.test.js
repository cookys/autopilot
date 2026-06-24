'use strict';
// L1 unit tests for cost-tracker-lib.js — pure transcript→usage aggregation +
// per-session cursor delta + cache-aware pricing. Fixtures mirror the real
// Claude Code transcript JSONL shape (message.model + message.usage) captured
// 2026-06-24 (`message.usage`: input_tokens / output_tokens /
// cache_read_input_tokens / cache_creation_input_tokens).

const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseAssistantTurns, aggregateSince, costOf, getRate, PRICING,
  CACHE_READ_MULT, CACHE_WRITE_MULT,
} = require('./cost-tracker-lib.js');

// Real-shape assistant turn line.
const asst = (model, usage) => JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', model, usage },
});
const u = (input, output, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});
const noise = () => JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } });

test('parseAssistantTurns: extracts model+usage in file order, skips non-assistant', () => {
  const jsonl = [
    noise(),
    asst('claude-opus-4-8', u(100, 50, 1000, 200)),
    noise(),
    asst('claude-haiku-4-5', u(10, 5)),
  ].join('\n');
  const turns = parseAssistantTurns(jsonl);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0], { model: 'claude-opus-4-8', input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 });
  assert.deepEqual(turns[1], { model: 'claude-haiku-4-5', input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
});

test('parseAssistantTurns: malformed lines / empty / missing usage are skipped, never throw', () => {
  assert.deepEqual(parseAssistantTurns(''), []);
  assert.deepEqual(parseAssistantTurns('not json\n{bad'), []);
  // assistant with no usage block → skipped
  const jsonl = [JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'x' } })].join('\n');
  assert.deepEqual(parseAssistantTurns(jsonl), []);
});

test('parseAssistantTurns: missing model defaults to sonnet', () => {
  const jsonl = JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: u(1, 1) } });
  assert.equal(parseAssistantTurns(jsonl)[0].model, 'sonnet');
});

test('getRate: substring match opus/haiku, default sonnet', () => {
  assert.deepEqual(getRate('claude-opus-4-8'), PRICING.opus);
  assert.deepEqual(getRate('claude-haiku-4-5'), PRICING.haiku);
  assert.deepEqual(getRate('claude-sonnet-4-6'), PRICING.sonnet);
  assert.deepEqual(getRate('claude-fable-5'), PRICING.sonnet); // unknown → sonnet default
  assert.deepEqual(getRate(undefined), PRICING.sonnet);
});

test('costOf: cache-aware pricing (read 0.1x, write 1.25x of input rate)', () => {
  // opus input=15/Mtok. 1M input + 1M output + 1M cacheRead + 1M cacheWrite.
  const g = { model: 'opus', input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 };
  const expected = (1e6 * 15 + 1e6 * 75 + 1e6 * 15 * CACHE_READ_MULT + 1e6 * 15 * CACHE_WRITE_MULT) / 1e6;
  assert.equal(costOf(g), Math.round(expected * 1e6) / 1e6);
  // sanity: read multiplier is cheaper than write
  assert.ok(CACHE_READ_MULT < 1 && CACHE_WRITE_MULT > 1);
});

test('aggregateSince: from 0 sums all turns, groups by model, sets cursor to total', () => {
  const turns = parseAssistantTurns([
    asst('claude-opus-4-8', u(100, 50)),
    asst('claude-opus-4-8', u(200, 60)),
    asst('claude-haiku-4-5', u(10, 5)),
  ].join('\n'));
  const { totalTurns, deltas } = aggregateSince(turns, 0);
  assert.equal(totalTurns, 3);
  const opus = deltas.find((d) => d.model === 'claude-opus-4-8');
  const haiku = deltas.find((d) => d.model === 'claude-haiku-4-5');
  assert.equal(opus.input, 300);
  assert.equal(opus.output, 110);
  assert.equal(opus.turns, 2);
  assert.equal(haiku.turns, 1);
});

test('aggregateSince: cursor delta — only NEW turns after a prior Stop are counted', () => {
  const turns = parseAssistantTurns([
    asst('opus', u(100, 50)),   // already logged
    asst('opus', u(200, 60)),   // already logged
    asst('opus', u(7, 3)),      // new
  ].join('\n'));
  const { totalTurns, deltas } = aggregateSince(turns, 2);
  assert.equal(totalTurns, 3);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].input, 7);
  assert.equal(deltas[0].output, 3);
  assert.equal(deltas[0].turns, 1);
});

test('aggregateSince: no new turns → empty deltas, cursor unchanged at total', () => {
  const turns = parseAssistantTurns([asst('opus', u(1, 1)), asst('opus', u(1, 1))].join('\n'));
  const { totalTurns, deltas } = aggregateSince(turns, 2);
  assert.equal(totalTurns, 2);
  assert.deepEqual(deltas, []);
});

test('aggregateSince: transcript shrank (cursor > total) → re-baseline, emit nothing (no double-count)', () => {
  const turns = parseAssistantTurns([asst('opus', u(5, 5))].join('\n')); // only 1 turn now
  const { totalTurns, deltas } = aggregateSince(turns, 9); // cursor claims 9 already logged
  assert.equal(totalTurns, 1);       // re-baseline to current length
  assert.deepEqual(deltas, []);      // do not re-log the shorter file
});

test('integration: per-Stop deltas reproduce the one-shot total — token fields EXACT, cost within rounding tolerance', () => {
  const all = [
    asst('opus', u(100, 50, 1000, 200)),
    asst('opus', u(200, 60, 2000, 0)),
    asst('haiku', u(10, 5)),
    asst('opus', u(30, 15, 500, 0)),
  ];
  const sumTokens = (deltas) => deltas.reduce((a, d) => ({
    input: a.input + d.input, output: a.output + d.output,
    cacheRead: a.cacheRead + d.cacheRead, cacheWrite: a.cacheWrite + d.cacheWrite,
    cost: a.cost + d.cost_usd,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

  const oneShot = sumTokens(aggregateSince(parseAssistantTurns(all.join('\n')), 0).deltas);

  // Simulate three Stops firing as turns accrue: [0..2), [2..3), [3..4)
  let cursor = 0;
  const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const upto of [2, 3, 4]) {
    const turns = parseAssistantTurns(all.slice(0, upto).join('\n'));
    const { totalTurns, deltas } = aggregateSince(turns, cursor);
    const s = sumTokens(deltas);
    acc.input += s.input; acc.output += s.output;
    acc.cacheRead += s.cacheRead; acc.cacheWrite += s.cacheWrite; acc.cost += s.cost;
    cursor = totalTurns;
  }

  // Token counts are the real no-double-count guarantee → must be EXACTLY equal.
  assert.equal(acc.input, oneShot.input);
  assert.equal(acc.output, oneShot.output);
  assert.equal(acc.cacheRead, oneShot.cacheRead);
  assert.equal(acc.cacheWrite, oneShot.cacheWrite);
  // cost_usd rounds per delta-group per Stop, so splitting across Stops can drift
  // by up to ~(#Stops)×1e-6 USD vs one grouped round — sub-micro-dollar, not a
  // double-count. Assert within tolerance, not exact equality.
  assert.ok(Math.abs(acc.cost - oneShot.cost) < 1e-5, `cost drift ${Math.abs(acc.cost - oneShot.cost)}`);
});
