#!/usr/bin/env node
'use strict';
// analyze.js <run-dir> <expected-session-id|-> : reads stream.jsonl + hook.jsonl, prints one JSON object (also written to run.json).
const fs = require('fs'), path = require('path');
const dir = process.argv[2], expectSid = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const readJl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return { unparsed: l }; } }); } catch (e) { return []; } };
const stream = readJl(path.join(dir, 'stream.jsonl')), hooks = readJl(path.join(dir, 'hook.jsonl'));
const init = stream.find((e) => e.type === 'system' && e.subtype === 'init');
const results = stream.filter((e) => e.type === 'result');
const last = results[results.length - 1];
const cost = last && typeof last.total_cost_usd === 'number' ? last.total_cost_usd : 0;
const blocks = hooks.filter((h) => h.decision === 'block');
const stopCalls = hooks.filter((h) => h.event === 'Stop'), subCalls = hooks.filter((h) => h.event === 'SubagentStop');
const texts = stream.filter((e) => e.type === 'assistant').map((e) => JSON.stringify(e.message && e.message.content));
const idxBlock = hooks.findIndex((h) => h.decision === 'block');
const refired = idxBlock >= 0 && hooks.slice(idxBlock + 1).some((h) => h.event === hooks[idxBlock].event && h.stdin && h.stdin.stop_hook_active === true);
const continued = idxBlock >= 0 && (texts.some((t) => /ALPHA/.test(t)) || refired);
const o = {
  dir: path.basename(dir), session_id_init: init && init.session_id, expected_session_id: expectSid,
  hook_calls: hooks.length, stop_calls: stopCalls.length, subagent_stop_calls: subCalls.length,
  first_fire_calls_by_wiring: hooks.filter((h) => h.stdin && h.stdin.stop_hook_active !== true).reduce((m, h) => { const k = h.event + '/' + h.wired_by; m[k] = (m[k] || 0) + 1; return m; }, {}),
  blocked: blocks.length, continued_after_block: continued, decisions: hooks.map((h) => h.event + ':' + h.wired_by + ':' + h.decision),
  hook_stdin_session_ids: [...new Set(hooks.map((h) => h.stdin && h.stdin.session_id))],
  hook_stdin_matches_expected: expectSid ? hooks.length > 0 && hooks.every((h) => h.stdin && h.stdin.session_id === expectSid) : null,
  hook_wall_ms: hooks.map((h) => h.hook_wall_ms), stdin_has_cwd: hooks.map((h) => !!(h.stdin && h.stdin.cwd)), stdin_cwd_exists: hooks.map((h) => h.stdin_cwd_exists),
  hook_stdin_keys: [...new Set(hooks.flatMap((h) => Object.keys(h.stdin || {})))].sort(),
  result_text: last && last.result, is_error: last ? last.is_error : null, total_cost_usd: cost,
};
// subagent id comparison
const hookAgentIds = [...new Set(subCalls.map((h) => h.stdin && h.stdin.agent_id).filter(Boolean))];
const resultLines = stream.filter((e) => e.type === 'user').map((e) => JSON.stringify(e));
const agentToolIds = []; for (const l of resultLines) { for (const m of l.matchAll(/agentId[\\":\s]+([0-9a-zA-Z]+)/g)) agentToolIds.push(m[1]); }
o.hook_agent_ids = hookAgentIds; o.tool_result_agent_ids = [...new Set(agentToolIds)];
o.agent_id_equal = hookAgentIds.length > 0 && o.tool_result_agent_ids.length > 0 ? hookAgentIds.some((x) => o.tool_result_agent_ids.includes(x)) : null;
o.parent_session_in_subagent_hook = subCalls.length ? subCalls.every((h) => h.stdin && h.stdin.session_id === (init && init.session_id)) : null;
o.plugin_hook_events_seen = stream.filter((e) => e.type === 'system' && /hook/.test(e.subtype || '')).length;
fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(o, null, 2) + '\n');
process.stdout.write(JSON.stringify(o) + '\n');
