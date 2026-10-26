#!/usr/bin/env node
'use strict';
// test-analyze.js : regression + negative control for the Agent-id extraction, on the real recorded trace raw/a/a_armed.
//  green: analyze.js yields exactly ["a1b4eed44e831adb8"] and it equals the hook agent_id.
//  red:   the old whole-line regex (kept here only as the broken control) finds "below" as well, so it must NOT equal the list.
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const HERE = __dirname; let bad = 0;
const ck = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad = 1; };
const src = path.join(HERE, 'raw/a/a_armed'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'an-'));
for (const f of ['stream.jsonl', 'hook.jsonl']) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
const out = JSON.parse(cp.execFileSync('node', [path.join(HERE, 'analyze.js'), tmp, '-'], { encoding: 'utf8' }));
ck('tool_result_agent_ids is exactly ["a1b4eed44e831adb8"]', JSON.stringify(out.tool_result_agent_ids) === '["a1b4eed44e831adb8"]');
ck('agent_id_equal true', out.agent_id_equal === true);
// control: the old matcher
const old = []; for (const e of fs.readFileSync(path.join(tmp, 'stream.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((e) => e.type === 'user')) for (const m of JSON.stringify(e).matchAll(/agentId[\\":\s]+([0-9a-zA-Z]+)/g)) old.push(m[1]);
ck('red control: the old whole-line matcher also catches "below"', old.includes('below'));
ck('red control: old list differs from the fixed list', JSON.stringify([...new Set(old)]) !== JSON.stringify(out.tool_result_agent_ids));
// fake id in free text must not be picked up
const lines = fs.readFileSync(path.join(tmp, 'stream.jsonl'), 'utf8').trim().split('\n');
fs.writeFileSync(path.join(tmp, 'stream.jsonl'), lines.concat([JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'agentId: abcdef0123456789a' }] } })]).join('\n') + '\n');
const out2 = JSON.parse(cp.execFileSync('node', [path.join(HERE, 'analyze.js'), tmp, '-'], { encoding: 'utf8' }));
ck('free-text "agentId: ..." in a non-tool-result user message is ignored', JSON.stringify(out2.tool_result_agent_ids) === '["a1b4eed44e831adb8"]');
fs.rmSync(tmp, { recursive: true, force: true }); process.exit(bad);
