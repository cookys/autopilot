'use strict';
const assert = require('assert');
const { exportTrace } = require('./export-hook-trace.js');
const L = (o) => JSON.stringify(o);
const text = [
  L({ timestamp: '2026-11-26T01:00:00Z', type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', content: ['ab', 'cde'] } }),
  L({ timestamp: '2026-11-26T01:00:01Z', type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', stdout: '12345', exitCode: 0 } }),
  L({ timestamp: '2026-11-26T01:00:02Z', type: 'attachment', attachment: { type: 'hook_blocking_error', hookEvent: 'Stop', hookName: 'Stop', blockingError: { a: 1 } } }),
  L({ timestamp: '2026-11-26T01:00:03Z', type: 'user', message: { content: 'secret text' } }),
  'not json',
  L({ timestamp: '2026-11-26T01:00:04Z', type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }),
  L({ timestamp: '2026-11-26T01:00:05Z', type: 'user', isMeta: true, message: { content: 'meta' } }),
  L({ timestamp: '2026-11-26T03:00:00Z', type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'Stop', hookName: 'Stop', stdout: '', exitCode: 0 } }),
].join('\n');
const all = exportTrace(text);
assert.strictEqual(all.length, 5, 'four hook rows plus one prompt row; tool result, meta and junk skipped');
assert.strictEqual(all.filter((r) => r.kind === 'prompt').length, 1);
assert.strictEqual(all[0].hook, 'PreToolUse:Bash');
assert.strictEqual(all[0].context_bytes, Buffer.byteLength(JSON.stringify(['ab', 'cde'])));
assert.strictEqual(all[1].stdout_bytes, 5);
assert.ok(!JSON.stringify(all).includes('secret'), 'no message text in rows');
assert.strictEqual(exportTrace(text, { from: '2026-11-26T02:00:00Z' }).length, 1, 'from filter');
assert.strictEqual(exportTrace(text, { to: '2026-11-26T02:00:00Z' }).length, 4, 'to filter');
console.log('PASS export-hook-trace');
