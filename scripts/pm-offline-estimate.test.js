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

assert.deepEqual(failures([[turn(10), { type: 'system', subtype: 'stop_hook', decision: 'block' }, turn(5)]]), [{ category: 'hook_block', failures: 1, retry_turns: 1, weighted_cost: 5, by_hook: [{ hook: 'unknown', event: 'Stop', failures: 1, retry_turns: 1, weighted_cost: 5, by_tool: { other: 1 }, by_shape: { empty: 1 } }] }]);

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
  assert.deepEqual(result.s4.find(x => x.name === 'patrol'), { name: 'patrol', messages: 2, turns: 1, weighted_cost: 10, matched: 2, auto_processable: 2, auto_weighted_cost: 10, auto_with_side_effect: 0, auto_with_side_effect_weighted_cost: 0 });
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
  assert.deepEqual(result.s4.find(x => x.name === 'unmatched_operator'), { name: 'unmatched_operator', messages: 1, turns: 1, weighted_cost: 10, matched: 0, auto_processable: 0, auto_weighted_cost: 0, auto_with_side_effect: 0, auto_with_side_effect_weighted_cost: 0, excluded_from_s4: true });
  assert.equal(result.s4.find(x => x.name === 'unmatched_pre_baseline').weighted_cost, 20);
  assert.equal(result.s4.find(x => x.name === 'unmatched_other').weighted_cost, 30);
  assert.equal(result.s4.find(x => x.name === 'matched').auto_weighted_cost, 20);
  assert.deepEqual(result.s4_summary, { bypass_candidates: 0, total_weighted_cost: 100, excluded_operator_weighted_cost: 10, s4_base_weighted_cost: 90, auto_weighted_cost: 20, auto_share_of_base: 20 / 90 });
  assert(!output.includes('PRIVATE'));
} finally { fs.rmSync(s4Dir, { recursive: true, force: true }); }

const bypassDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-bypass-'));
try {
  const tools = names => ({ type: 'assistant', message: { content: names.map(name => ({ type: 'tool_use', name, input: { secret: 'PRIVATE TOOL PARAMETER' } })) } });
  const entries = [];
  const items = [];
  for (const [id, category, names, disposition] of [
    ['read', 'task_result', ['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'TaskGet', 'TaskList', ...['recent', 'directory', 'whoami', 'state', 'fetch', 'watch', 'list_claims', 'task_status'].map(x => `mcp__fleet__${x}`)], 'no_action'],
    ['write', 'task_result', ['Bash'], 'no_action'],
    ['credential', 'credential_redline', ['mcp__fleet__send'], 'done'],
    ['other', 'patrol', ['Edit'], 'no_action'],
    ['manual', 'patrol', ['Write'], 'action'],
  ]) {
    entries.push({ ...user(`<channel message_id="${id}"> PRIVATE MESSAGE </channel>`), timestamp: stamp }, tools(names), turn(10));
    items.push({ message_id: id, category, disposition, fyi: true });
  }
  fs.writeFileSync(path.join(bypassDir, 'fixture.jsonl'), entries.map(JSON.stringify).join('\n'));
  const file = path.join(bypassDir, 'dispositions.json');
  fs.writeFileSync(file, JSON.stringify({ items }));
  const output = execFileSync(process.execPath, [path.join(__dirname, 'pm-offline-estimate.js'), '--sessions-dir', bypassDir, '--dispositions', file], { encoding: 'utf8' });
  const result = JSON.parse(output);
  const task = result.s4.find(x => x.name === 'task_result');
  assert.equal(task.auto_with_side_effect, 1);
  assert.equal(task.auto_with_side_effect_weighted_cost, 10);
  assert.equal(task.bypass_candidates, 1);
  assert.equal(result.s4.find(x => x.name === 'credential_redline').bypass_candidates, 1);
  assert.equal(result.s4.find(x => x.name === 'patrol').auto_with_side_effect, 1);
  assert.equal('bypass_candidates' in result.s4.find(x => x.name === 'patrol'), false);
  assert.equal(result.s4_summary.bypass_candidates, 3);
  assert(!output.includes('PRIVATE MESSAGE'));
  assert(!output.includes('PRIVATE TOOL PARAMETER'));
} finally { fs.rmSync(bypassDir, { recursive: true, force: true }); }

const breakdownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-breakdown-'));
try {
  const texts = ['<task-notification PRIVATE>', '<system-reminder>PRIVATE', 'Stop hook PRIVATE', '<channel kind="wake">PRIVATE</channel>', 'PRIVATE rest'];
  const entries = texts.flatMap((text, i) => [{ type: 'queue-operation', timestamp: stamp, content: text }, turn(i + 1)]);
  fs.writeFileSync(path.join(breakdownDir, 'fixture.jsonl'), entries.map(JSON.stringify).join('\n'));
  const file = path.join(breakdownDir, 'dispositions.json');
  fs.writeFileSync(file, JSON.stringify({ items: [] }));
  const output = execFileSync(process.execPath, [path.join(__dirname, 'pm-offline-estimate.js'), '--sessions-dir', breakdownDir, '--dispositions', file], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.deepEqual(result.unmatched_other_breakdown, Object.fromEntries(['task_notification', 'system_reminder', 'hook_feedback', 'channel_other', 'rest'].map((name, i) => [name, { messages: 1, weighted_cost: i + 1 }])));
  assert(!output.includes('PRIVATE'));
} finally { fs.rmSync(breakdownDir, { recursive: true, force: true }); }

// v6: S2 hook_block breakdown by hook name and event type
const s2Mixed = failures([[
  turn(10),
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'PreToolUse:Bash hook error: bash-launch-guard: blocked command' }] } },
  turn(30),
  { type: 'system', subtype: 'stop_hook', decision: 'block', hookName: 'context-land-gate' },
  turn(50),
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'blocked by hook without identifier' }] } },
  turn(20),
]]);
assert.equal(s2Mixed.length, 1);
const hb = s2Mixed[0];
assert.equal(hb.category, 'hook_block');
assert.equal(hb.failures, 3);
assert.equal(hb.retry_turns, 3);
assert.equal(hb.weighted_cost, 100);
assert.deepEqual(hb.by_hook, [
  { hook: 'context-land-gate', event: 'Stop', failures: 1, retry_turns: 1, weighted_cost: 50 },
  { hook: 'bash-launch-guard', event: 'PreToolUse', failures: 1, retry_turns: 1, weighted_cost: 30 },
  { hook: 'unknown', event: 'other', failures: 1, retry_turns: 1, weighted_cost: 20, by_tool: { other: 1 }, by_shape: { starts_blocked: 1 } },
]);
assert.equal(hb.by_hook.reduce((s, x) => s + x.failures, 0), hb.failures);
assert.equal(hb.by_hook.reduce((s, x) => s + x.retry_turns, 0), hb.retry_turns);
assert.equal(hb.by_hook.reduce((s, x) => s + x.weighted_cost, 0), hb.weighted_cost);

const s2Extra = failures([[
  turn(1),
  { stopHookResult: { decision: 'block' } },
  turn(4),
  { type: 'user', message: { content: [{ type: 'tool_result', content: 'PreToolUse:Edit hook error: denied [orchestrator-edit-gate] use subagent' }] } },
  turn(6),
]]);
assert.deepEqual(s2Extra[0].by_hook, [
  { hook: 'orchestrator-edit-gate', event: 'PreToolUse', failures: 1, retry_turns: 1, weighted_cost: 6 },
  { hook: 'unknown', event: 'Stop', failures: 1, retry_turns: 1, weighted_cost: 4, by_tool: { other: 1 }, by_shape: { empty: 1 } },
]);

const longToken = 'secret-long-payload-that-must-never-leak-into-json-output-over-sixty-four-chars';
const secretPath = '/Users/operator/private-workspace/secret-dir/credentials.env';
const secretBody = 'PRIVATE COMMAND PAYLOAD DO NOT EMIT';
const s2Privacy = failures([[
  turn(5),
  { type: 'user', message: { content: [{ type: 'tool_result', content: `PreToolUse:Bash hook error: ${longToken} while reading ${secretPath} ${secretBody}` }] } },
  turn(10),
  { type: 'user', message: { content: [{ type: 'tool_result', content: `PreToolUse:Bash hook error: denied access to ${secretPath} ${secretBody}` }] } },
  turn(12),
  { type: 'system', subtype: 'stop_hook', decision: 'block', hookName: secretPath },
  turn(8),
]]);
const s2PrivacyJson = JSON.stringify(s2Privacy);
for (const leaked of [longToken, secretPath, 'private-workspace', 'secret-dir', 'credentials.env', secretBody]) {
  assert(!s2PrivacyJson.includes(leaked), `must not leak ${leaked}`);
}
assert.deepEqual(s2Privacy, [{
  category: 'hook_block',
  failures: 3,
  retry_turns: 3,
  weighted_cost: 30,
  by_hook: [
    { hook: 'unknown', event: 'PreToolUse', failures: 2, retry_turns: 2, weighted_cost: 22, by_tool: { Bash: 2 }, by_shape: { has_hook: 2 } },
    { hook: 'unknown', event: 'Stop', failures: 1, retry_turns: 1, weighted_cost: 8, by_tool: { other: 1 }, by_shape: { empty: 1 } },
  ],
}]);

// v7: S2 unknown hook_block breakdown by_tool and by_shape
const toolTurn = (id, name, cost = 1) => ({
  type: 'assistant',
  message: {
    usage: { input_tokens: cost },
    content: [{ type: 'tool_use', id, name, input: { cmd: 'SECRET_CMD_MARKER' } }],
  },
});
const s2UnknownBreakdown = failures([[
  toolTurn('t1', 'Bash', 1),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'PreToolUse:Bash hook error: MARKER_SHAPE_HOOK' }] } },
  toolTurn('t2', 'Edit', 2),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'BLOCKED by hook: MARKER_SHAPE_BLOCKED' }] } },
  toolTurn('t3', 'Write', 3),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'denied by hook: MARKER_SHAPE_DENIED' }] } },
  toolTurn('t4', 'Read', 4),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'not allowed by hook: MARKER_SHAPE_NOT_ALLOWED' }] } },
  toolTurn('t5', 'CustomTool', 5),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't5', content: 'hook error: missing permission MARKER_SHAPE_PERMISSION' }] } },
  turn(6),
  { type: 'system', subtype: 'stop_hook', decision: 'block' },
  turn(7),
]]);
const s2UnknownJson = JSON.stringify(s2UnknownBreakdown);
for (const marker of [
  'SECRET_CMD_MARKER',
  'MARKER_SHAPE_HOOK',
  'MARKER_SHAPE_BLOCKED',
  'MARKER_SHAPE_DENIED',
  'MARKER_SHAPE_NOT_ALLOWED',
  'MARKER_SHAPE_PERMISSION',
  'CustomTool',
]) {
  assert(!s2UnknownJson.includes(marker), `must not leak ${marker}`);
}
const preUnknown = s2UnknownBreakdown[0].by_hook.find(b => b.hook === 'unknown' && b.event === 'PreToolUse');
const otherUnknown = s2UnknownBreakdown[0].by_hook.find(b => b.hook === 'unknown' && b.event === 'other');
const stopUnknown = s2UnknownBreakdown[0].by_hook.find(b => b.hook === 'unknown' && b.event === 'Stop');
assert.deepEqual(preUnknown.by_tool, { Bash: 1 });
assert.deepEqual(preUnknown.by_shape, { has_hook: 1 });
assert.deepEqual(otherUnknown.by_tool, { Edit: 1, Write: 1, Read: 1, other: 1 });
assert.deepEqual(otherUnknown.by_shape, {
  starts_blocked: 1,
  starts_denied: 1,
  starts_not_allowed: 1,
  has_permission: 1,
});
assert.deepEqual(stopUnknown.by_tool, { other: 1 });
assert.deepEqual(stopUnknown.by_shape, { empty: 1 });
console.log('unknown breakdown tests passed');
