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
const inj = [
  L({ uuid: 'h1', timestamp: '2026-11-26T04:00:00Z', type: 'user', message: { content: 'human' } }),
  L({ uuid: 'a1', parentUuid: 'h1', timestamp: '2026-11-26T04:00:01Z', type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: 'UserPromptSubmit', hookName: 'UserPromptSubmit:x', content: 'abc' } }),
  L({ uuid: 'c1', timestamp: '2026-11-26T04:05:00Z', type: 'user', isMeta: true, origin: { kind: 'channel' }, message: { content: 'cron tick' } }),
  L({ uuid: 'a2', parentUuid: 'c1', timestamp: '2026-11-26T04:05:01Z', type: 'attachment', attachment: { type: 'hook_additional_context', hookEvent: 'UserPromptSubmit', hookName: 'UserPromptSubmit:x', content: 'abc' } }),
  L({ uuid: 'a3', parentUuid: 'c1', timestamp: '2026-11-26T04:05:02Z', type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'UserPromptSubmit', hookName: 'UserPromptSubmit:y', stdout: '', exitCode: 0 } }),
  L({ uuid: 'c2', timestamp: '2026-11-26T04:10:00Z', type: 'user', isMeta: true, message: { content: 'channel without UPS' } }),
].join('\n');
const ir = exportTrace(inj).filter((r) => r.kind === 'prompt');
assert.deepStrictEqual(ir.map((r) => r.source), ['human', 'injected'], 'one human, one injected (UPS fired twice on the same cron turn counts once); meta without UPS not counted');
console.log('PASS export-hook-trace');
