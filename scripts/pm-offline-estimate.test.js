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
assert.deepEqual(batch([[timed('a', '2026-01-01T00:00:00Z'), turn(10), timed('b', '2026-01-01T00:01:00Z'), turn(20), turn(30)]]), { saved_turns: 1, weighted_cost: 20 });

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

assert.equal(autocompact([[turn(167001)]], 200000, 10000).simulated_cost, 96700.1);

assert.deepEqual(batch([[{ ...user('a'), timestamp: '2026-01-01T00:00:00Z' }, turn(1), { ...user('b'), timestamp: '2026-01-01T00:01:00Z' }, turn(2)]]), { saved_turns: 0, weighted_cost: 0 });
assert.deepEqual(autocompact([]), { actual_cost: 0, simulated_cost: 0, difference: 0, compressions: 0, average_context: 0 });
assert.deepEqual(batch([]), { saved_turns: 0, weighted_cost: 0 });
assert.deepEqual(failures([]), []);
assert.deepEqual(prescreen([], { auto_classes: [{ name: 'auto', match: {} }] }), [{ name: 'auto', messages: 0, turns: 0, weighted_cost: 0 }]);
assert.equal(autocompact([[{ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } } }]]).actual_cost, 32);

assert.equal(failures([[turn(1), { type: 'user', message: { content: [{ type: 'tool_result', content: 'PreToolUse:Shell hook error: blocked' }] } }, turn(2)]])[0].category, 'hook_block');
