#!/usr/bin/env node
'use strict';
// usage: node run.js <task-id> <rep> <out-dir>
// One paired cell: draft (author seat) -> OFF = the draft; ON = draft -> dispatch-plan-review -> revise.
// Seats: author and reviser codex gpt-6.2-sol low; reviewer agy gemini-4-hydrogen-high. No Claude, no astra/carbon/argon/fable.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { score } = require('./score');

const [task, rep, outDir] = process.argv.slice(2);
const HERE = __dirname;
const SCRIPTS = path.resolve(HERE, '../../scripts');
const cell = path.join(path.resolve(outDir), `${task}-r${rep}`);
fs.mkdirSync(cell, { recursive: true });
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, DISPATCH_QUIET: '1' }, ...opts });

function dump(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(`--- ${path.relative(dir, p)}\n${fs.readFileSync(p, 'utf8')}`); } };
  walk(dir);
  return out.join('\n');
}
function author(name, prompt) {
  const pf = path.join(cell, `${name}.prompt.txt`);
  fs.writeFileSync(pf, prompt);
  const r = sh('bash', [path.join(SCRIPTS, 'dispatch-author.sh'), '--runner', 'codex', '--model', 'gpt-6.2-sol', '--effort', 'low', '--prompt-file', pf], { timeout: 600000 });
  fs.writeFileSync(path.join(cell, `${name}.author.json`), r.stdout);
  const j = JSON.parse(r.stdout);
  if (j.status !== 'authored') throw new Error(`${name} author status ${j.status}: ${j.error}`);
  return fs.readFileSync(j.raw_log, 'utf8').trim();
}

const taskDir = path.join(HERE, 'tasks', task);
const brief = fs.readFileSync(path.join(taskDir, 'brief.md'), 'utf8');
const fixture = dump(path.join(taskDir, 'fixture'));
const draftPrompt = `You are writing an implementation plan (markdown, ordered steps) for the task below. Output only the plan text, no preamble. Do not edit anything.\n\nTASK:\n${brief}\nREPOSITORY FILES:\n${fixture}\n`;
const draft = author('draft', draftPrompt);
fs.writeFileSync(path.join(cell, 'plan.draft.md'), draft + '\n');

// scratch repo for the review (the reviewer must not see this pack's scoring files)
const repo = path.join(cell, 'repo');
fs.rmSync(repo, { recursive: true, force: true });
fs.cpSync(path.join(taskDir, 'fixture'), repo, { recursive: true });
fs.copyFileSync(path.join(cell, 'plan.draft.md'), path.join(repo, 'plan.md'));
fs.copyFileSync(path.join(HERE, 'rubric.md'), path.join(repo, 'rubric.md'));
const man = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));
man.logical_plan_id = `pr-onoff-${task}-r${rep}-${process.pid}`;
fs.writeFileSync(path.join(repo, 'manifest.json'), JSON.stringify(man, null, 2));
for (const a of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'fixture']]) sh('git', a, { cwd: repo });

const ctxFlags = [];
for (const f of fs.readdirSync(repo, { recursive: true })) { if (!f.startsWith('.git') && !['plan.md', 'rubric.md', 'manifest.json'].includes(f) && /\.(js|json|sql|md)$/.test(f)) ctxFlags.push('--context-file', f); }
const rv = sh('node', [path.join(SCRIPTS, 'dispatch-plan-review.js'), '--repo-root', repo, '--plan-file', 'plan.md', '--rubric-file', 'rubric.md',
  '--manifest-file', path.join(repo, 'manifest.json'), '--ticket', `onoff-${task}-r${rep}`, '--session-id', `onoff-${task}-r${rep}-${process.pid}`,
  '--generation', '1', '--allow-unregistered', ...ctxFlags, '--timeout', '15m', '--state-dir', path.join(cell, 'state')], { timeout: 1800000 });
fs.writeFileSync(path.join(cell, 'review.stdout.json'), rv.stdout || '');
fs.writeFileSync(path.join(cell, 'review.stderr.txt'), rv.stderr || '');

const reviewText = rv.stdout || '';
const revisePrompt = `Revise the implementation plan below so it addresses every valid finding of the review. Output only the full revised plan (markdown), no preamble. Do not edit anything.\n\nTASK:\n${brief}\nREPOSITORY FILES:\n${fixture}\nCURRENT PLAN:\n${draft}\n\nREVIEW RESULT (JSON):\n${reviewText}\n`;
const revised = author('revise', revisePrompt);
fs.writeFileSync(path.join(cell, 'plan.revised.md'), revised + '\n');

const res = { task, rep: Number(rep), review_exit: rv.status, OFF: score(task, draft), ON: score(task, revised) };
fs.writeFileSync(path.join(cell, 'cell.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res));
