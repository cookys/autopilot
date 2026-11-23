'use strict';
const assert = require('node:assert/strict');
const { autocompact, prescreen, batch, failures } = require('./pm-offline-estimate.js');
const turn = n => ({ type: 'assistant', message: { usage: { input_tokens: n } } });
assert.equal(autocompact([[turn(167000)]]).compressions, 0);
assert.equal(autocompact([[turn(167001)]]).compressions, 1);
assert.equal(autocompact([]).actual_cost, 0);
console.log('autocompact tests passed');

const user = text => ({ type: 'user', message: { content: text } });
assert.deepEqual(prescreen([[user('secret hello'), turn(10), turn(20), user('other'), turn(30)]], { auto_classes: [{ name: 'auto', match: { pattern: 'hello' } }] }), [{ name: 'auto', messages: 1, turns: 2, weighted_cost: 30 }]);
assert.equal(prescreen([], null), null);

const timed = (text, timestamp) => ({ ...user(text), timestamp, kind: 'notice' });
assert.deepEqual(batch([[timed('a', '2026-01-01T00:00:00Z'), turn(10), timed('b', '2026-01-01T00:01:00Z'), turn(20), turn(30)]]), { already_batched_items: 0, saved_turns: 1, weighted_cost: 20 });

assert.deepEqual(failures([[turn(10), { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'secret error' }] } }, turn(20)]]), [{ category: 'tool_error', failures: 1, retry_turns: 1, weighted_cost: 20 }]);
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-test-'));
try {
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), [user('PRIVATE PHRASE ONE'), turn(10), user('PRIVATE PHRASE TWO')].map(JSON.stringify).join('\n'));
  const output = execFileSync(process.execPath, [path.join(__dirname, 'pm-offline-estimate.js'), '--sessions-dir', dir], { encoding: 'utf8' });
  assert(!output.includes('PRIVATE PHRASE ONE'));
  assert(!output.includes('PRIVATE PHRASE TWO'));
  assert.equal(JSON.parse(output).autocompact[0].actual_cost, 10);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

assert.deepEqual(failures([[turn(10), { type: 'system', subtype: 'stop_hook', decision: 'block' }, turn(5)]]), [{ category: 'hook_block', failures: 1, retry_turns: 1, weighted_cost: 5 }]);

assert.ok(Math.abs(autocompact([[turn(167001)]], 200000, 10000, 40000).simulated_cost - 216700.1) < 1e-6, 'summary read+output, 1h rewrite of prefix+summary, then the turn on the rebuilt 50k context');

assert.deepEqual(batch([[{ ...user('a'), timestamp: '2026-01-01T00:00:00Z' }, turn(1), { ...user('b'), timestamp: '2026-01-01T00:01:00Z' }, turn(2)]]), { already_batched_items: 0, saved_turns: 0, weighted_cost: 0 });
assert.deepEqual(autocompact([]), { actual_cost: 0, simulated_cost: 0, difference: 0, compressions: 0, average_context: 0 });
assert.deepEqual(batch([]), { already_batched_items: 0, saved_turns: 0, weighted_cost: 0 });
assert.deepEqual(failures([]), []);
assert.deepEqual(prescreen([], { auto_classes: [{ name: 'auto', match: {} }] }), [{ name: 'auto', messages: 0, turns: 0, weighted_cost: 0 }]);
assert.equal(autocompact([[{ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } } }]]).actual_cost, 32);

assert.equal(failures([[turn(1), { type: 'user', message: { content: [{ type: 'tool_result', content: 'PreToolUse:Shell hook error: blocked' }] } }, turn(2)]])[0].category, 'hook_block');

// v2: a real compaction (context drop) must not make the following turns free, and the simulated compaction pays for the prefix rewrite.
const big = (n, read) => ({ type: 'assistant', message: { usage: { input_tokens: 0, cache_read_input_tokens: read, output_tokens: 0 } } });
const dropped = autocompact([[big(0, 300000), big(0, 50000), big(0, 60000)]], 400000, 10000, 40000);
assert.equal(dropped.compressions, 0);
assert.equal(dropped.simulated_cost, dropped.actual_cost, 'after a real drop the simulation restarts from the real value, not from zero');
const paid = autocompact([[big(0, 300000)]], 200000, 10000, 40000);
assert.equal(paid.simulated_cost, 300000 * 0.1 + 10000 * 5 + 50000 * 2 + 50000 * 0.1, 'summary call + prefix rewrite + the turn on the rebuilt context');
const gated = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'pm-offline-estimate.rules.default.json'), 'utf8'));
assert.equal(prescreen([[user('[fleet patrol] overdue: task x'), turn(10)]], gated)[0].messages, 1);
const wrap = (t, ts) => ({ ...user(`<channel kind="wake">\n[fleet patrol] ${t}\n</channel>`), timestamp: ts });
assert.equal(batch([[wrap('overdue: a', '2026-01-01T00:00:00Z'), turn(1), wrap('overdue: b', '2026-01-01T00:01:00Z'), turn(2)]]).saved_turns, 1, 'channel-wrapped patrol wakes of one class batch together');
console.log('v2 tests passed');

const { incomingMessages } = require('./pm-offline-estimate.js');
const stamp = '2026-01-01T00:00:00Z';
const formats = [{ ...user('one'), timestamp: stamp }, { type: 'attachment', timestamp: stamp, attachment: { type: 'queued_command', prompt: 'two' } }, { type: 'queue-operation', timestamp: stamp, content: 'two' }];
assert.deepEqual(incomingMessages(formats).map(x => x.text), ['one', 'two']);

const packed = '[inbox batch sample]\n#1 alpha\n#2 beta';
assert.deepEqual(prescreen([[user(packed), turn(10)]], { auto_classes: [{ name: 'a', match: { pattern: 'alpha' } }, { name: 'b', match: { pattern: 'beta' } }] }), [{ name: 'a', messages: 1, turns: 0.5, weighted_cost: 5 }, { name: 'b', messages: 1, turns: 0.5, weighted_cost: 5 }]);

assert.equal(batch([[{ ...user('[inbox batch sample]\n#1 [wake] alpha\n#2 [wake] beta'), timestamp: stamp }, turn(10)]]).already_batched_items, 2);
assert.equal(batch([[{ ...user('[inbox batch sample]\n#1 [wake] alpha\n#2 [wake] beta'), timestamp: stamp }, turn(10)]]).saved_turns, 0);

const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-dispositions-'));
try {
  const text = '[inbox batch sample]\n#1 message_id="id-one" SECRET ALPHA\n### 項目 2 message_id="id-two" SECRET BETA';
  fs.writeFileSync(path.join(privateDir, 'messages.jsonl'), [ { ...user(text), timestamp: stamp }, turn(10), ...formats.slice(1), turn(4) ].map(JSON.stringify).join('\n'));
  const file = path.join(privateDir, 'dispositions.json');
  fs.writeFileSync(file, JSON.stringify({ items: [{ message_id: 'id-one', category: 'patrol', disposition: 'no_action' }, { message_id: 'id-two', category: 'patrol', disposition: 'done', fyi: true }] }));
  const output = execFileSync(process.execPath, [path.join(__dirname, 'pm-offline-estimate.js'), '--sessions-dir', privateDir, '--dispositions', file], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.deepEqual(result.s4.find(x => x.name === 'patrol'), { name: 'patrol', messages: 2, turns: 1, weighted_cost: 10, matched: 2, auto_processable: 2, auto_weighted_cost: 10 });
  for (const secret of ['SECRET ALPHA', 'SECRET BETA', 'two']) assert(!output.includes(secret));
} finally { fs.rmSync(privateDir, { recursive: true, force: true }); }

const s4Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-s4-'));
try {
  const entries = [
    { ...user('PRIVATE operator'), timestamp: '2026-01-02T00:00:00Z' }, turn(10),
    wrap('PRIVATE old', '2025-12-31T00:00:00Z'), turn(20),
    wrap('PRIVATE other', '2026-01-02T00:00:00Z'), turn(30),
    { ...user('[inbox batch sample]\n#1 message_id="auto" PRIVATE auto\n#2 message_id="manual" PRIVATE manual'), timestamp: stamp }, turn(40),
  ];
  fs.writeFileSync(path.join(s4Dir, 'fixture.jsonl'), entries.map(JSON.stringify).join('\n'));
  const file = path.join(s4Dir, 'dispositions.json');
  fs.writeFileSync(file, JSON.stringify({ items: [
    { message_id: 'auto', category: 'matched', disposition: 'no_action', delivered_at: stamp },
    { message_id: 'manual', category: 'matched', disposition: 'action', delivered_at: stamp },
  ] }));
  const output = execFileSync(process.execPath, [path.join(__dirname, 'pm-offline-estimate.js'), '--sessions-dir', s4Dir, '--dispositions', file], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.deepEqual(result.s4.find(x => x.name === 'unmatched_operator'), { name: 'unmatched_operator', messages: 1, turns: 1, weighted_cost: 10, matched: 0, auto_processable: 0, auto_weighted_cost: 0, excluded_from_s4: true });
  assert.equal(result.s4.find(x => x.name === 'unmatched_pre_baseline').weighted_cost, 20);
  assert.equal(result.s4.find(x => x.name === 'unmatched_other').weighted_cost, 30);
  assert.equal(result.s4.find(x => x.name === 'matched').auto_weighted_cost, 20);
  assert.deepEqual(result.s4_summary, { total_weighted_cost: 100, excluded_operator_weighted_cost: 10, s4_base_weighted_cost: 90, auto_weighted_cost: 20, auto_share_of_base: 20 / 90 });
  assert(!output.includes('PRIVATE'));
} finally { fs.rmSync(s4Dir, { recursive: true, force: true }); }
