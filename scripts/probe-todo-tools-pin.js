#!/usr/bin/env node
'use strict';
// probe-todo-tools-pin.js — single-call deterministic probe: do the task tools
// (TaskCreate family) actually reach a headless claude session launched from THIS
// directory's environment?
//
// Why: CC >= 2.1.233 gates the task tools OFF on 5-era models (statsig tengu_rosy_wren,
// default false) unless CLAUDE_CODE_ENABLE_TODO_TOOLS=1 reaches the session — killing
// every dev-flow forcing function silently. The pin ships via .claude/settings.json
// (v2.34.23/24). A settings file existing is not evidence it is wired (see
// references/evidence-discipline.md); this probe IS the wiring check: 1 live call,
// mechanical prompt, parse the stream for the tool firing.
//
// Usage:
//   node scripts/probe-todo-tools-pin.js                # expect PRESENT → exit 0
//   node scripts/probe-todo-tools-pin.js --expect-absent  # planted red → exit 0 iff absent
//   [--model sonnet] [--timeout-seconds 300] [--cwd DIR] [--claude-bin claude]
//
// Exit: 0 expectation met · 1 expectation contradicted · 2 indeterminate (spawn/timeout/
// no recognizable signal). The negative arm needs the caller to strip the pin (run from a
// cwd whose settings do not set it AND with the env var unset) — the probe does not mutate
// the environment it is measuring.
const { spawnSync } = require('child_process');

const PROMPT = 'If a tool exists that creates a task (for example TaskCreate), call it to '
  + 'create one task titled pin-probe-task and report the tool\'s exact name. If none '
  + 'exists, say NO_TASK_TOOL. Do nothing else.';

const opts = { model: 'sonnet', timeoutSeconds: 300, cwd: process.cwd(), claudeBin: 'claude', expectAbsent: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--expect-absent') opts.expectAbsent = true;
  else if (a === '--model') opts.model = argv[++i];
  else if (a === '--timeout-seconds') opts.timeoutSeconds = Number(argv[++i]);
  else if (a === '--cwd') opts.cwd = argv[++i];
  else if (a === '--claude-bin') opts.claudeBin = argv[++i];
  else if (a === '-h' || a === '--help') { console.log('see header of this file'); process.exit(0); }
  else { console.error(`unknown argument: ${a}`); process.exit(2); }
}
if (!Number.isSafeInteger(opts.timeoutSeconds) || opts.timeoutSeconds < 1) {
  console.error('--timeout-seconds must be a positive integer'); process.exit(2);
}

const run = spawnSync(opts.claudeBin, [
  '-p', '--model', opts.model, '--output-format', 'stream-json', '--verbose', PROMPT,
], { cwd: opts.cwd, encoding: 'utf8', timeout: opts.timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024 });

if (run.error || run.signal) {
  console.error(`indeterminate: ${run.error ? run.error.message : `killed by ${run.signal}`}`);
  process.exit(2);
}
let sawTaskCreate = false;
let sawNoTaskTool = false;
for (const line of String(run.stdout || '').split('\n')) {
  if (!line.trim()) continue;
  let rec; try { rec = JSON.parse(line); } catch { continue; }
  const blocks = rec && rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
  for (const b of blocks) {
    if (b && b.type === 'tool_use' && b.name === 'TaskCreate') sawTaskCreate = true;
    if (b && b.type === 'text' && typeof b.text === 'string' && b.text.includes('NO_TASK_TOOL')) sawNoTaskTool = true;
  }
  if (rec && rec.type === 'result' && typeof rec.result === 'string' && rec.result.includes('NO_TASK_TOOL')) sawNoTaskTool = true;
}
const present = sawTaskCreate;
const absent = !sawTaskCreate && sawNoTaskTool;
if (!present && !absent) {
  console.error('indeterminate: neither a TaskCreate tool_use nor NO_TASK_TOOL observed');
  process.exit(2);
}
const expectationMet = opts.expectAbsent ? absent : present;
console.log(JSON.stringify({
  expectation: opts.expectAbsent ? 'absent' : 'present',
  observed: present ? 'present' : 'absent',
  ok: expectationMet,
}));
process.exit(expectationMet ? 0 : 1);
