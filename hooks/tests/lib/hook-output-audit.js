#!/usr/bin/env node
'use strict';
/**
 * hook-output-audit — BL-0304. Which hook stdout reaches the model (https://code.claude.com/docs/en/hooks):
 *   plain exit-0 stdout: only UserPromptSubmit / UserPromptExpansion / SessionStart / PostModelSwitch
 *   everything else: stdout is parsed only when the WHOLE stream is one JSON object; plain text goes to the debug log.
 *
 * Modes:
 *   static  <hooksDir>              every stdout write site of every hook registered in <hooksDir>/hooks.json (and of the
 *                                   opt-in hooks the multiplexer runs) on a non-context event must be a JSON emitter or an
 *                                   allowlisted site. Exit 1 listing the offending file:line otherwise.
 *   dynamic <hooksDir> <home>       runs failure-escalation.js from <hooksDir> with two consecutive Bash failures and checks
 *                                   that stdout is exactly one pure additionalContext object for PostToolUse.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTEXT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'UserPromptExpansion', 'PostModelSwitch']);
const SITE = /(stdout\.write\(|console\.log\(|writeSync\(\s*1\s*,)/;
const SAFE = /(JSON\.stringify|emitAdditionalContext|additionalContextJson)/;
// file:needle -> why a non-JSON write is intended. A needle must appear on the flagged line.
const ALLOW = [
  ['state-checkpoint.js', 'Preserve the following workflow state', 'PreCompact: stdout is merged into the compaction summarizer instructions, not shown to the model (plan 2.1)'],
  ['opt-in-multiplexer.js', 'exit2Child.stdout', 'exit-2 passthrough of a child that already wrote JSON (or nothing)'],
];

function eventsByFile(hooksDir) {
  const out = new Map();
  const add = (f, ev) => { if (!out.has(f)) out.set(f, new Set()); out.get(f).add(ev); };
  const reg = JSON.parse(fs.readFileSync(path.join(hooksDir, 'hooks.json'), 'utf8'));
  for (const [ev, groups] of Object.entries(reg.hooks || reg)) {
    for (const g of groups) for (const h of g.hooks || []) {
      const m = /hooks\/([\w.-]+\.js)/.exec(h.command || '');
      if (m) add(m[1], ev);
    }
  }
  // the multiplexer's EVENT_TABLE: "  Event: [" opens a block, "{ stem: 'x'" lines are its members
  const mux = path.join(hooksDir, 'opt-in-multiplexer.js');
  if (fs.existsSync(mux)) {
    let cur = null;
    for (const line of fs.readFileSync(mux, 'utf8').split('\n')) {
      const e = /^  (\w+): \[$/.exec(line);
      if (e) { cur = e[1]; continue; }
      if (/^  \],?$/.test(line)) { cur = null; continue; }
      const s = /\{ stem: '([\w-]+)'/.exec(line);
      if (cur && s) add(`${s[1]}.js`, cur);
    }
  }
  return out;
}

function staticAudit(hooksDir) {
  const bad = [];
  for (const [file, evs] of eventsByFile(hooksDir)) {
    const nonContext = [...evs].filter((e) => !CONTEXT_EVENTS.has(e));
    if (nonContext.length === 0) continue;
    const p = path.join(hooksDir, file);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
      if (!SITE.test(line) || SAFE.test(line)) return;
      if (ALLOW.some(([f, needle]) => f === file && line.includes(needle))) return;
      bad.push(`${file}:${i + 1} [${nonContext.join(',')}] ${t.slice(0, 110)}`);
    });
  }
  return bad;
}

function dynamicAudit(hooksDir, home) {
  const hook = path.join(hooksDir, 'failure-escalation.js');
  const env = { ...process.env, HOME: home };
  delete env.AUTOPILOT_SESSION_ID; delete env.CLAUDE_CODE_SESSION_ID;
  const payload = JSON.stringify({ tool_name: 'Bash', session_id: 'ptc-audit-1', exit_code: 1, tool_output: 'boom' });
  const run = () => spawnSync(process.execPath, [hook], { input: payload, env, encoding: 'utf8' });
  const first = run();
  const second = run();
  const problems = [];
  if (first.stdout !== '') problems.push(`first failure (L0) must print nothing, got ${JSON.stringify(first.stdout)}`);
  let obj = null;
  try { obj = JSON.parse(second.stdout); } catch { problems.push(`second failure stdout is not one JSON object: ${JSON.stringify(second.stdout.slice(0, 80))}`); }
  if (obj) {
    const h = obj.hookSpecificOutput;
    if (Object.keys(obj).join() !== 'hookSpecificOutput') problems.push('extra top-level keys');
    else if (!h || h.hookEventName !== 'PostToolUse') problems.push(`hookEventName is ${h && h.hookEventName}`);
    else if (typeof h.additionalContext !== 'string' || !h.additionalContext.startsWith('[Autopilot Failure Escalation')
      || !h.additionalContext.includes('Consecutive Bash failure detected (2nd)')) problems.push('additionalContext lacks the escalation text');
  }
  if (second.status !== 0) problems.push(`exit ${second.status}`);
  return problems;
}

const [mode, dir, home] = process.argv.slice(2);
if (mode === 'static') {
  const bad = staticAudit(path.resolve(dir));
  if (bad.length) { console.log('AUDIT RED: plain stdout on a non-context event never reaches the model:\n' + bad.join('\n')); process.exit(1); }
  console.log('AUDIT GREEN (static)');
} else if (mode === 'dynamic') {
  const h = home || fs.mkdtempSync(path.join(os.tmpdir(), 'hook-output-audit-'));
  const bad = dynamicAudit(path.resolve(dir), h);
  if (bad.length) { console.log('AUDIT RED (dynamic): ' + bad.join('; ')); process.exit(1); }
  console.log('AUDIT GREEN (dynamic)');
} else { console.error('usage: static|dynamic <hooksDir> [home]'); process.exit(2); }
