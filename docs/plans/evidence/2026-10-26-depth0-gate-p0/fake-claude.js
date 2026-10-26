#!/usr/bin/env node
'use strict';
// Fake claude for the dry run: NEVER contacts any API. Emits stream-json (init/assistant/result) and runs the
// Stop / SubagentStop hooks it finds in --settings, $CLAUDE_CONFIG_DIR/settings.json (or $HOME/.claude/settings.json
// when CLAUDE_CONFIG_DIR is unset), honouring --setting-sources project (user settings skipped).
// Env: FAKE_COST (total_cost_usd, default 0.01), FAKE_LOG (appends one line per invocation).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const a = process.argv.slice(2);
const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const sid = val('--session-id') || 'fake-session-' + process.pid;
const settingsFile = val('--settings');
const srcs = val('--setting-sources');
const cfg = process.env.CLAUDE_CONFIG_DIR;
const cfgFiles = fs.existsSync(cfg || '/nonexistent') ? fs.readdirSync(cfg).sort() : null;
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: a, config_dir: cfg || null, config_files: cfgFiles, home: process.env.HOME, cwd: process.cwd() }) + '\n');
const prompt = fs.readFileSync(0, 'utf8');
const files = [];
if (settingsFile) files.push(['cli', settingsFile]);
if (cfg) files.push(['config-dir', path.join(cfg, 'settings.json')]);
else if (!(srcs || '').split(',').includes('project') || (srcs || '').includes('user')) files.push(['user', path.join(process.env.HOME, '.claude', 'settings.json')]);
function hooksFor(event) {
  const cmds = [];
  for (const [, f] of files) { try { const s = JSON.parse(fs.readFileSync(f, 'utf8')); for (const m of (s.hooks && s.hooks[event]) || []) for (const h of m.hooks || []) cmds.push(h.command); } catch (e) {} }
  return cmds;
}
function runHooks(event, extra) {
  let block = null;
  for (const c of hooksFor(event)) {
    const r = cp.spawnSync('sh', ['-c', c], { input: JSON.stringify(Object.assign({ session_id: sid, hook_event_name: event, cwd: process.cwd(), stop_hook_active: false }, extra)), encoding: 'utf8' });
    try { const o = JSON.parse(r.stdout); if (o.decision === 'block') block = o.reason; } catch (e) {}
  }
  return block;
}
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const msg = (t) => ({ type: 'assistant', session_id: sid, message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
emit({ type: 'system', subtype: 'init', session_id: sid, model: 'fake-haiku' });
let text = 'OK';
if (/Agent tool/.test(prompt)) {
  const aid = 'a' + Math.random().toString(16).slice(2, 18);
  emit({ type: 'assistant', session_id: sid, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_fake', name: 'Agent', input: { prompt: 'DONE' } }] } });
  let b = runHooks('SubagentStop', { agent_id: aid, agent_type: 'general-purpose' });
  if (b) runHooks('SubagentStop', { agent_id: aid, agent_type: 'general-purpose', stop_hook_active: true });
  emit({ type: 'user', session_id: sid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake', content: [{ type: 'text', text: 'DONE\nagentId: ' + aid }] }] } });
  text = 'FINISHED';
}
emit(msg(text));
const blk = runHooks('Stop', {});
if (blk) { emit(msg('ALPHA')); runHooks('Stop', { stop_hook_active: true }); }
emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: blk ? 'ALPHA' : text, total_cost_usd: parseFloat(process.env.FAKE_COST || '0.01') });
