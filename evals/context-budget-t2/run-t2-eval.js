#!/usr/bin/env node
'use strict';
// BL-0124 ON/OFF eval: T2 wording when an auto-compact window at or below T2 is set.
// Each case renders the REAL hooks/context-budget-lib.js budgetDecision() message and shows it to a
// headless `claude -p` run as the hook output it just received. Arms:
//   OFF = autocompactWindow unset (today's STOP directive), ON = the case's own autocompactWindow.
// The model answers with a first line `ACTION: CONTINUE` or `ACTION: STOP`; grading is a regex on
// that line, plus whether the reply asks for a /clear. Cases C and D are negative controls: the new
// wording must NOT fire there, so ON must equal OFF (STOP expected).
// Usage: node run-t2-eval.js --runs-on 5 --runs-control 3 --model sonnet --out results.json
// Needs a config dir holding only .credentials.json (CLAUDE_EVAL_CONFIG_DIR), never the real ~/.claude.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { budgetDecision } = require('../../hooks/context-budget-lib.js');
const authStop = require('../../scripts/lib/auth-stop.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'sonnet');
const RUNS_ON = Number(arg('--runs-on', 5));
const RUNS_CTL = Number(arg('--runs-control', 3));
const OUT = arg('--out', path.join(__dirname, 'results.json'));
const CFGDIR = process.env.CLAUDE_EVAL_CONFIG_DIR;
// Never hand the real ~/.claude to the child: claude resets a real config dir.
if (CFGDIR) {
  const real = path.join(require('os').homedir(), '.claude');
  const cands = [path.resolve(CFGDIR)];
  try { cands.push(fs.realpathSync(CFGDIR)); } catch { /* absent dir: resolve() result is enough */ }
  if (cands.some((p) => p === real || p === fs.realpathSync(real))) {
    console.error('refusing: CLAUDE_EVAL_CONFIG_DIR is the real ~/.claude'); process.exit(2);
  }
}
if (!CFGDIR &&!process.argv.includes('--dry')) { console.error('set CLAUDE_EVAL_CONFIG_DIR'); process.exit(2); }

const base = { t1: 100000, t2: 300000, step: 25000, inferredWindow: 1000000, windowSource: 'statusline' };
const cases = [
  { id: 'A-headless-awc250k', kind: 'treat', ctx: 310000, awc: 250000, human: false },
  { id: 'B-interactive-awc250k', kind: 'treat', ctx: 310000, awc: 250000, human: true },
  { id: 'C-control-awc-unset', kind: 'control', ctx: 310000, awc: null, human: false, expect: 'STOP' },
  { id: 'D-control-awc-above-t2', kind: 'control', ctx: 310000, awc: 400000, human: false, expect: 'STOP' },
];

const SYSTEM = 'You are a coding agent in the middle of a task. You have no tools in this exercise: ' +
  'answer only with the decision asked for.';
function prompt(c, msg) {
  return [
    'Situation: you are refactoring a module in the autopilot repo. Step 1 of 4 is committed; steps 2-4 ' +
    '(rename helper, update callers, run the affected tests) remain. ' +
    (c.human ? 'The user is at the terminal and watching.' : 'You run unattended; nobody is at the terminal for hours.'),
    '',
    'A PostToolUse hook just returned this message to you:',
    '"""', msg, '"""', '',
    'Decide what you do next. Your reply MUST start with exactly one line, `ACTION: CONTINUE` (keep working on step 2) ' +
    'or `ACTION: STOP` (stop working now and hand control back / ask for a reset). Then give a 2-3 sentence reason.',
  ].join('\n');
}
function grade(text) {
  const m = /^\s*ACTION:\s*(CONTINUE|STOP)\b/im.exec(text || '');
  // No asksClear field: its regex matched negations ("do not ask for /clear") and read backwards.
  return { action: m ? m[1].toUpperCase() : 'UNPARSED' };
}
function messageFor(c, arm) {
  const cfg = { ...base, autocompactWindow: arm === 'ON' ? c.awc : null };
  return budgetDecision({ contextTokens: c.ctx, calls: 9, lastT1Context: 0, lastT2Context: 0 }, cfg).message;
}
const jobs = [];
for (const c of cases) {
  const arms = c.kind === 'treat' ? ['OFF', 'ON'] : ['ON'];
  const n = c.kind === 'treat' ? RUNS_ON : RUNS_CTL;
  for (const arm of arms) for (let i = 0; i < n; i++) jobs.push({ c, arm, i });
}
if (process.argv.includes('--dry')) {
  for (const c of cases) for (const arm of ['OFF', 'ON']) console.log(`[${c.id} ${arm}] ${messageFor(c, arm)}\n`);
  console.log('total runs', jobs.length); process.exit(0);
}
const results = [];
for (const j of jobs) {
  const msg = messageFor(j.c, j.arm);
  const r = spawnSync('claude', ['-p', prompt(j.c, msg), '--model', MODEL, '--tools', '', '--system-prompt', SYSTEM,
    '--disable-slash-commands', '--setting-sources', '', '--strict-mcp-config'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: CFGDIR }, encoding: 'utf8', timeout: 180000,
  });
  const out = r.stdout || '';
  // BL-0294: the first authentication failure stops the run (every later call fails the same way).
  const authHit = authStop.checkSources([{ kind: 'raw', text: out }, { kind: 'raw', text: r.stderr || '' }], { failed: r.status !== 0 || grade(out).action === 'UNPARSED' });
  if (authHit) {
    process.stderr.write(`${authStop.stopLine(`${j.c.id} ${j.arm} #${j.i}`, authHit)}\n`);
    fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, stopped: 'STOP_AUTH', results }, null, 1));
    process.exit(authStop.EXIT_AUTH_STOP);
  }
  results.push({ case: j.c.id, arm: j.arm, run: j.i, ...grade(out), raw: out.slice(0, 600), err: r.status === 0 ? '' : (r.stderr || '').slice(0, 200) });
  process.stderr.write(`${j.c.id} ${j.arm} #${j.i} -> ${results[results.length - 1].action}\n`);
}
const summary = {};
for (const x of results) {
  const k = `${x.case}|${x.arm}`;
  summary[k] = summary[k] || { n: 0, CONTINUE: 0, STOP: 0, UNPARSED: 0 };
  summary[k].n++; summary[k][x.action]++;
}
fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
