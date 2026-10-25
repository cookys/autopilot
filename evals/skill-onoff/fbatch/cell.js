#!/usr/bin/env node
'use strict';
// fbatch/cell.js — turn a real `claude -p` stream-json transcript of one findings-batch cell into the trace
// fbatch/lib.js scores, and read the cell's spend. No model call, no network.
//
//   cell.js markers --task <id> --transcript <file> [--turn1 <file>] [--git-dir <dir>]
//       prints marker_<name>=true|false for the task (the shape run-skill-onoff-eval-bpack.sh reads), plus
//       marker_findings_write (not a scored marker): true when any tool call wrote a file whose name contains
//       "findings" (README "Limits of the --check-arms FINDINGS lint"); the campaign turns such a cell into an
//       invalid_cell row, so a cell where the agent wrote a report-style FINDINGS file can never score.
//       Exit 3 when the replayed poll count disagrees with the fixture's own counter (the cell cannot be judged).
//       --require-counter (what the task markers.sh pass, with an explicit --git-dir): a missing counter is exit 3.
//       --emit-refusal: on any exit-3 refusal also print marker_cell_refused=true (see the comment at the refusal).
//   cell.js trace --task <id> --transcript <file> [--turn1 <file>]   prints the trace JSON
//   cell.js cost --transcript <file>                                 prints {total, turns:[...]}
//
// Markers read TOOL CALLS only, never the agent's words (evals/skill-onoff/README.md). The event shape is the one
// lib/transcript-query.js reads (assistant message.content[] tool_use blocks); this module keeps the full command
// text because transcript-query truncates Bash commands to 200 chars.
//
// State at each call is replayed, not read from disk: the fixture's only clock is the poll count of
// scripts/wait-dispatch-results.js (stub), so "landed" / "exit present" at call i is a pure function of how many
// poll invocations precede it, plus the turn-2 wake (turn2.sh lands everything). The fixture counts its polls in
// <git-dir>/fbatch/waits; when that final count differs from the replay (a loop or a failed shell, say) the cell is
// refused (exit 3 -> infra_fail marker_error) instead of scored on a guess.
//
// Every decision about a Bash command string goes through ONE tokenizer, fbatch/shell-parse.js (quotes and
// backslash escapes honoured, redirections separated from words, $(...) / backticks / `bash -c '...'` parsed
// recursively, wrappers such as env/timeout/xargs stripped). A simple command whose program is a reader (cat, grep,
// ls, echo ...) is a read, not an invocation (":read <word>"); `node -e '<code>'` is inline code (":inline node"),
// whose text never matches a marker. A poll is counted only when the executed program or script IS
// wait-dispatch-results.js. lib.js then matches its regexes on the normalised command text produced here.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const L = require('./lib');
const SH = require('./shell-parse');

// One Bash command string -> normalised calls (execution order).
function callsOf(commandText) {
  return SH.parseShell(String(commandText || '')).map((cmd) => SH.describe(cmd)).filter((d) => d.kind !== 'empty');
}

// ---- transcript ----------------------------------------------------------------------------
function readEvents(file) {
  const tools = [];
  const costs = [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Error(`unreadable transcript: ${file}`); }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j && j.type === 'result' && typeof j.total_cost_usd === 'number' && Number.isFinite(j.total_cost_usd) && j.total_cost_usd >= 0) costs.push(j.total_cost_usd);
    const content = j && j.message && j.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) if (b && b.type === 'tool_use') tools.push({ name: String(b.name || ''), input: b.input || {} });
  }
  return { tools, costs };
}

// ---- post-run FINDINGS-write check (the real protection behind the --check-arms lint) -----------------------
// A write target is: Write/Edit/NotebookEdit/MultiEdit file_path; a Bash redirect target (> or >>); the arguments of
// tee/touch/install; the destination (last argument) of cp/mv/ln. Case-insensitive "findings" anywhere in the target.
// Not detectable from the command text, and so a known limit: a file written by a program the agent runs
// (python -c, node -e, a script it wrote first).
const FW = /findings/i;
function findingsWrites(tools) {
  const hits = [];
  for (const t of tools) {
    if (['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(t.name)) {
      const p = String(t.input.file_path || t.input.notebook_path || '');
      if (FW.test(p)) hits.push(`${t.name} ${p}`);
      continue;
    }
    if (t.name !== 'Bash') continue;
    for (const cmd of SH.parseShell(String(t.input.command || ''))) {
      for (const r of cmd.redirs) if (SH.WRITE_OPS.has(r.op) && FW.test(r.target)) hits.push(`redirect ${r.target}`);
      const w = SH.unwrap(cmd.words);
      if (!w.length) continue;
      const name = SH.base(w[0]);
      const args = w.slice(1).filter((a) => !a.startsWith('-'));
      if (['tee', 'touch', 'install'].includes(name)) for (const a of args) if (FW.test(a)) hits.push(`${name} ${a}`);
      if (['cp', 'mv', 'ln'].includes(name) && args.length && FW.test(args[args.length - 1])) hits.push(`${name} ${args[args.length - 1]}`);
      if (name === 'git' && args[0] === 'mv' && args.length > 1 && FW.test(args[args.length - 1])) hits.push(`git mv ${args[args.length - 1]}`);
      if (name === 'sed' && w.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) for (const a of args) if (FW.test(a)) hits.push(`sed -i ${a}`);
      if (name === 'dd') for (const a of w) if (/^of=/.test(a) && FW.test(a)) hits.push(`dd ${a}`);
    }
  }
  return hits;
}

function landedSet(fx, waits, turn2) {
  const s = new Set(fx.landed0 || []);
  if (fx.pending && (turn2 || waits >= fx.landAfterWaits)) s.add(fx.pending);
  return [...s].sort();
}

// tools: every tool_use in order; turn1Count: how many of them belong to turn 1 (null = single turn).
function buildTrace(taskId, tools, turn1Count = null) {
  const fx = L.FIXTURES[taskId];
  if (!fx) throw new Error(`unknown task ${taskId}`);
  const calls = [];
  let waits = 0;
  tools.forEach((t, idx) => {
    if (t.name !== 'Bash') return;
    const turn2 = turn1Count !== null && idx >= turn1Count;
    for (const d of callsOf(t.input.command)) {
      calls.push({ tool: 'Bash', command: d.command, landed: landedSet(fx, waits, turn2), exists: { exit: fx.exitAfterWaits !== undefined ? waits >= fx.exitAfterWaits : undefined } });
      if (d.kind === 'run' && d.program === 'wait-dispatch-results.js') waits++;
    }
  });
  return { calls, waits, fx };
}
function cellMarkers(taskId, transcript, turn1) {
  const ev = readEvents(transcript);
  const turn1Count = turn1 && fs.existsSync(turn1) ? readEvents(turn1).tools.length : null;
  const { calls, waits, fx } = buildTrace(taskId, ev.tools, turn1Count);
  const m = L.markers(taskId, calls, fx);
  return { markers: Object.fromEntries(L.MARKERS[taskId].map((k) => [k, m[k] === true])), calls, waits, findings_writes: findingsWrites(ev.tools) };
}
function transcriptCost(file) {
  const { costs } = readEvents(file);
  return { total: Number(costs.reduce((a, b) => a + b, 0).toFixed(6)), turns: costs };
}

module.exports = { callsOf, buildTrace, cellMarkers, transcriptCost, readEvents, findingsWrites };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const die = (m, code = 2) => { console.error(`cell.js: ${m}`); process.exit(code); };
  const transcript = val('--transcript');
  if (!transcript) die('usage: cell.js markers|trace|cost --transcript <file> [--task <id>] [--turn1 <file>] [--git-dir <dir>]');
  try {
    if (cmd === 'cost') { process.stdout.write(`${JSON.stringify(transcriptCost(transcript))}\n`); process.exit(0); }
    const task = val('--task');
    if (!task || !L.FIXTURES[task]) die(`unknown or missing --task: ${task}`);
    const r = cellMarkers(task, transcript, val('--turn1'));
    if (cmd === 'trace') { process.stdout.write(`${JSON.stringify(r)}\n`); process.exit(0); }
    if (cmd !== 'markers') die(`unknown command: ${cmd}`);
    let gitDir = val('--git-dir');
    if (!gitDir) { try { gitDir = cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { gitDir = ''; } }
    const wf = gitDir ? path.join(gitDir, 'fbatch', 'waits') : '';
    // run-skill-onoff-eval-bpack.sh takes the exit status of its marker subshell, whose last command is an `if`, so a
    // non-zero exit of markers.sh is swallowed. --emit-refusal therefore also prints a marker the campaign turns
    // into an infra_fail marker_error row.
    const refuse = (msg) => { if (argv.includes('--emit-refusal')) process.stdout.write('marker_cell_refused=true\n'); die(msg, 3); };
    if (argv.includes('--require-counter') && !(wf && fs.existsSync(wf))) refuse(`--require-counter: the fixture poll counter is missing (git dir '${gitDir}'); refusing to score a cell whose state cannot be checked`);
    if (wf && fs.existsSync(wf)) {
      const real = parseInt(fs.readFileSync(wf, 'utf8'), 10);
      if (real !== r.waits) refuse(`replayed ${r.waits} wait polls but the fixture counted ${real}: the trace cannot place the state of every call (a loop, or a command that failed in the shell); refusing to score`);
    }
    for (const [k, v] of Object.entries(r.markers)) process.stdout.write(`marker_${k}=${v}\n`);
    process.stdout.write(`marker_findings_write=${r.findings_writes.length > 0}\n`);
    if (r.findings_writes.length) console.error(`cell.js: FINDINGS-named write(s): ${r.findings_writes.join('; ')}`);
  } catch (e) { die(e.message); }
}
