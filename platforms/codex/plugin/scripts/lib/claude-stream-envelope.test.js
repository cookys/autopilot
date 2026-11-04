'use strict';
// BL-0372 Task 1: unit tests for streamToEnvelope plus negative controls R1-R6 (each broken rebuilder must be caught).
// Fixtures are handwritten, NOT real CLI output (key order copied from the stored evidence instance; values invented).
const test = require('node:test');
const assert = require('assert');
// STREAMENV_MODULE lets the red-then-green proof point the suite at a deliberately mutated copy of the converter.
const { streamToEnvelope } = require(process.env.STREAMENV_MODULE || './claude-stream-envelope.js');
const { parseEnvelope } = require('../claude-account.js');
const { verifyClaudeRuntimeIdentity } = require('../qualification-review-provider.js');

const FINAL = {
  duration_api_ms: 812, stop_reason: 'end_turn', session_id: 'S', total_cost_usd: 0.0034,
  usage: { input_tokens: 5, output_tokens: 1 }, modelUsage: { 'claude-haiku-5-5': { inputTokens: 5, outputTokens: 1 } },
  permission_denials: [], terminal_reason: 'completed', fast_mode_state: 'off', is_error: false, num_turns: 1,
  subtype: 'success', api_error_status: null, result: '\n\nOK', ttft_ms: 400, type: 'result', duration_ms: 900, uuid: 'U',
};
const FINAL_LINE = JSON.stringify(FINAL);
const EARLY_LINE = JSON.stringify(Object.assign({}, FINAL, { result: 'early', is_error: false, uuid: 'E' }));
const STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'S' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } }),
  EARLY_LINE,
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
  FINAL_LINE,
].join('\n') + '\n';
const JSON_OUT = FINAL_LINE + '\n'; // what `--output-format json` prints for the same object

// What the comparer checks. Returns the list of failed checks (empty = the converter is faithful).
function failures(fn, stream = STREAM, jsonOut = JSON_OUT) {
  const out = [];
  const r = fn(stream);
  if (!r || r.ok !== true) return ['not_ok'];
  if (r.bytes !== jsonOut) out.push('layer2_bytes');
  if (!r.bytes.endsWith('\n')) out.push('trailing_newline');
  const a = parseEnvelope(r.bytes); const b = parseEnvelope(jsonOut);
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push('layer1_parse');
  if (a && b && Object.keys(a).join() !== Object.keys(b).join()) out.push('key_order');
  const lead = (x) => (x && typeof x.result === 'string' ? x.result : null);
  if (lead(a) !== lead(b)) out.push('result_text');
  try { verifyClaudeRuntimeIdentity(r.bytes, 'haiku'); } catch (_) { out.push('identity'); }
  return out;
}

// Deliberately broken rebuilders (negative controls). They live in the test only.
const BROKEN = {
  R1: (s) => { const r = streamToEnvelope(s); return { ok: r.ok, bytes: r.bytes.replace(/\n$/, '') }; },
  R2: (s) => { for (const l of s.split('\n')) { try { const o = JSON.parse(l); if (o.type === 'result') return { ok: true, bytes: l + '\n' }; } catch (_) { /* skip */ } } return { ok: false, bytes: '' }; },
  R3: (s) => {
    let text = '';
    for (const l of s.split('\n')) { try { const o = JSON.parse(l); if (o.type === 'assistant') text = o.message.content[0].text; } catch (_) { /* skip */ } }
    return { ok: true, bytes: JSON.stringify({ type: 'result', result: text }) + '\n' };
  },
  R4: (s) => { const o = JSON.parse(streamToEnvelope(s).bytes); o.result = o.result.trim(); return { ok: true, bytes: JSON.stringify(o) + '\n' }; },
  R5: (s) => ({ ok: true, bytes: JSON.stringify(JSON.parse(streamToEnvelope(s).bytes), null, 2) + '\n' }),
  R6: (s) => { const o = JSON.parse(streamToEnvelope(s).bytes); const { type, ...rest } = o; return { ok: true, bytes: JSON.stringify(Object.assign({ type }, rest)) + '\n' }; },
};

test('positive control: the real converter is faithful on the fixture', () => {
  assert.deepStrictEqual(failures(streamToEnvelope), []);
});

for (const [id, fn] of Object.entries(BROKEN)) {
  test(`negative control ${id}: the broken rebuilder is caught`, () => {
    assert.ok(failures(fn).length > 0, `${id} was not caught`);
  });
}

test('R1 is seen by the byte layer only; R6 by key order (division of work)', () => {
  assert.ok(failures(BROKEN.R1).includes('layer2_bytes'));
  assert.ok(failures(BROKEN.R6).includes('key_order'));
  assert.ok(failures(BROKEN.R2).includes('layer1_parse'));
  assert.ok(failures(BROKEN.R3).includes('identity'));
  assert.ok(failures(BROKEN.R4).includes('result_text'));
});

test('several results: the last one wins', () => {
  assert.strictEqual(streamToEnvelope(STREAM).bytes, JSON_OUT);
});

test('no result line gives ok:false and empty bytes', () => {
  for (const s of ['', 'not json\n', JSON.stringify({ type: 'assistant' }) + '\n', '[{"type":"result"}]\n']) {
    const r = streamToEnvelope(s);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.bytes, '');
    assert.strictEqual(r.reason, 'no_result_line');
  }
  assert.strictEqual(streamToEnvelope(null).reason, 'not_a_string');
});

test('the output is the raw line, never re-serialised (odd spacing survives)', () => {
  const odd = '{"type": "result",  "result":"x" , "n":1.0}';
  assert.strictEqual(streamToEnvelope('{"type":"system"}\n' + odd + '\n').bytes, odd + '\n');
});

test('a result line without a trailing newline in the input still ends with exactly one newline', () => {
  assert.strictEqual(streamToEnvelope(STREAM.replace(/\n$/, '')).bytes, JSON_OUT);
});

test('CRLF input: the trailing CR is dropped, one LF remains', () => {
  const crlf = STREAM.split('\n').join('\r\n');
  assert.strictEqual(streamToEnvelope(crlf).bytes, JSON_OUT);
});

test('huge result line (> 64 KiB) is returned whole', () => {
  const big = Object.assign({}, FINAL, { result: 'x'.repeat(200 * 1024) });
  const line = JSON.stringify(big);
  const r = streamToEnvelope(JSON.stringify({ type: 'system' }) + '\n' + line + '\n');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.bytes, line + '\n');
  assert.ok(r.bytes.length > 64 * 1024);
});

test('a later non-result JSON line or garbage after the result does not hide it', () => {
  const s = STREAM + 'garbage tail\n' + JSON.stringify({ type: 'rate_limit_event' }) + '\n';
  assert.strictEqual(streamToEnvelope(s).bytes, JSON_OUT);
});
