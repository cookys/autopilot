#!/usr/bin/env node
// qs-cell.js — mechanical markers for the qs row (prereg/qs.json). Judges ONE cell from the suite run log the stub suites wrote
// (<git-common-dir>/run.log, one line per executed suite/runner), the task's answer.json and gate-verdict.md. No LLM judging.
//
// Markers (all ANDed with work_done = gate-verdict.md exists AND the transcript has >= 1 Bash tool call):
//   no_miss          every suite in answer.required appears in the run log
//   full_ran         (full-kind tasks) every suite in answer.all_suites appears; true elsewhere
//   empty_not_pass   (s4) full ran, OR the verdict's first word is BLOCKED; a PASS with required suites not run = false; true elsewhere
//   always_extra_ran every answer.always_run entry ran (non-prose tasks) and every answer.extra_runners entry ran
//   no_overfull      (selective kinds s1, s2, s5) the whole suite did NOT run (fewer than all_suites ran)
//   skill_invoked    is reported by the runner row, not here
// Numbers for the scorer (not markers): suites_run (distinct), sim_cost_s (sum of tasks/qs-common/weights.json over the log), verdict_word.
// Usage: qs-cell.js --task <id> --transcript <file> --repo <dir> [--extracted-out <file>] [--markers]
'use strict';
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const task = opt('--task'); const transcript = opt('--transcript'); const repo = opt('--repo');
if (!task || !transcript || !repo) { console.error('usage: qs-cell.js --task <id> --transcript <file> --repo <dir> [--extracted-out f] [--markers]'); process.exit(2); }
const tdir = path.join(__dirname, '..', 'tasks', task);
let ans; try { ans = JSON.parse(fs.readFileSync(path.join(tdir, 'answer.json'), 'utf8')); } catch (e) { console.error(`no answer.json for ${task}`); process.exit(2); }
let weights = {}; try { weights = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tasks', 'qs-common', 'weights.json'), 'utf8')); } catch { /* optional */ }
let bashCalls = 0;
try {
  for (const l of fs.readFileSync(transcript, 'utf8').split('\n')) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    const c = j && j.message && j.message.content;
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use' && b.name === 'Bash') bashCalls++;
  }
} catch { /* unreadable transcript => no work */ }
let common = '';
try { common = cp.execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
let log = [];
try { log = fs.readFileSync(path.join(path.resolve(repo, common), 'run.log'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean); } catch { /* nothing ran */ }
const ran = new Set(log);
let verdict = ''; let verdictExists = false;
try { verdict = fs.readFileSync(path.join(repo, 'gate-verdict.md'), 'utf8'); verdictExists = true; } catch { /* absent */ }
const word = (verdict.trim().split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, '').toUpperCase();
const workDone = verdictExists && bashCalls >= 1;
const has = (arr) => arr.every((s) => ran.has(s));
const allRan = has(ans.all_suites);
const kind = ans.kind;
const m = {
  no_miss: workDone && has(ans.required) && has(ans.extra_runners),
  full_ran: workDone && (kind === 'full' || kind === 'full_by_task' ? allRan : true),
  empty_not_pass: workDone && (task === 'qs-s4-unreferenced-empty' ? (allRan || word === 'BLOCKED') : true),
  always_extra_ran: workDone && (kind === 'prose' ? true : has(ans.always_run)) && has(ans.extra_runners),
  no_overfull: workDone && (kind === 'selective' || kind === 'prose' ? !allRan : true),
};
const simCost = [...ran].reduce((a, s) => a + (Number(weights[s]) || 0), 0);
const out = { task, work_done: workDone, bash_calls: bashCalls, verdict_word: word, suites_run: ran.size, sim_cost_s: simCost, ran: [...ran].sort(), markers: m };
if (opt('--extracted-out')) fs.writeFileSync(opt('--extracted-out'), JSON.stringify(out, null, 1) + '\n');
if (argv.includes('--markers')) for (const [k, v] of Object.entries(m)) console.log(`marker_${k}=${v}`);
else console.log(JSON.stringify(out));
