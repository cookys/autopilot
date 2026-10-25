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
// A Bash command is split into simple commands (quote-aware; heredoc bodies skipped). A simple command whose
// leading word is a reader (cat, grep, ls, echo ...) is a read, not an invocation: it is kept as ":read <word>" so it
// matches no marker, because `cat scripts/merge-lane.sh` is not a merge.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const L = require('./lib');

const READERS = new Set(['cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'less', 'more', 'ls', 'wc', 'stat', 'file', 'diff', 'cmp', 'echo', 'printf', 'test', '[', '[[', 'find', 'tree', 'sed', 'awk', 'jq', 'which', 'type', 'realpath', 'basename', 'dirname', 'pwd', 'date', 'true', 'false', 'read', 'sort', 'uniq', 'cut', 'tr', 'tee']);
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'time', '{', '(']);

// ---- shell splitting ---------------------------------------------------------------------
function simples(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  const pend = [];
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      cur += ch;
      if (ch === '\\' && q === '"') { cur += cmd[++i] || ''; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '\\') { cur += ch + (cmd[++i] || ''); continue; }
    if (ch === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      let j = i + 2;
      if (cmd[j] === '-') j++;
      while (cmd[j] === ' ' || cmd[j] === '\t') j++;
      let delim = '';
      if (cmd[j] === "'" || cmd[j] === '"') {
        const close = cmd.indexOf(cmd[j], j + 1);
        if (close > 0) { delim = cmd.slice(j + 1, close); j = close + 1; }
      } else {
        let k = j;
        while (k < cmd.length && /[\w]/.test(cmd[k])) k++;
        delim = cmd.slice(j, k); j = k;
      }
      if (delim) { pend.push(delim); cur += cmd.slice(i, j); i = j - 1; continue; }
    }
    if (ch === '\n') {
      flush();
      let at = i + 1;
      while (pend.length) {
        const d = pend.shift();
        for (;;) {
          if (at >= cmd.length) break;
          let e = cmd.indexOf('\n', at);
          if (e < 0) e = cmd.length;
          const line = cmd.slice(at, e);
          at = e + 1;
          if (line.trim() === d) break;
        }
      }
      i = at - 1;
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|') { flush(); continue; }
    cur += ch;
  }
  flush();
  return out;
}
// Leading word of a simple command after assignments, control keywords and grouping characters.
function leading(seg) {
  const toks = seg.replace(/^[({]+\s*/, '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || KEYWORDS.has(toks[i]))) i++;
  const w = (toks[i] || '').replace(/^['"]|['"]$/g, '');
  return { word: w.slice(w.lastIndexOf('/') + 1), rest: toks.slice(i).join(' ') };
}
function classify(seg) {
  const { word, rest } = leading(seg);
  if (READERS.has(word)) return `:read ${word}`;
  return rest || seg;
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
    for (const seg of simples(String(t.input.command || ''))) {
      const re = /(?:^|[^<>&\d])\d*>>?\s*(['"]?)([^\s;|&<>'"]+)\1/g;
      let m;
      while ((m = re.exec(seg))) if (FW.test(m[2])) hits.push(`redirect ${m[2]}`);
      const { word, rest } = leading(seg);
      const args = rest.split(/\s+/).slice(1).map((a) => a.replace(/^['"]|['"]$/g, '')).filter((a) => a && !a.startsWith('-'));
      if (['tee', 'touch', 'install'].includes(word)) for (const a of args) if (FW.test(a)) hits.push(`${word} ${a}`);
      if (['cp', 'mv', 'ln'].includes(word) && args.length && FW.test(args[args.length - 1])) hits.push(`${word} ${args[args.length - 1]}`);
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
    for (const seg of simples(String(t.input.command || ''))) {
      const command = classify(seg);
      calls.push({ tool: 'Bash', command, landed: landedSet(fx, waits, turn2), exists: { exit: fx.exitAfterWaits !== undefined ? waits >= fx.exitAfterWaits : undefined } });
      if (/wait-dispatch-results\.js/.test(command)) waits++;
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

module.exports = { simples, classify, buildTrace, cellMarkers, transcriptCost, readEvents, findingsWrites };

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
    if (wf && fs.existsSync(wf)) {
      const real = parseInt(fs.readFileSync(wf, 'utf8'), 10);
      if (real !== r.waits) die(`replayed ${r.waits} wait polls but the fixture counted ${real}: the trace cannot place the state of every call (a loop, or a command that failed in the shell); refusing to score`, 3);
    }
    for (const [k, v] of Object.entries(r.markers)) process.stdout.write(`marker_${k}=${v}\n`);
    process.stdout.write(`marker_findings_write=${r.findings_writes.length > 0}\n`);
    if (r.findings_writes.length) console.error(`cell.js: FINDINGS-named write(s): ${r.findings_writes.join('; ')}`);
  } catch (e) { die(e.message); }
}
