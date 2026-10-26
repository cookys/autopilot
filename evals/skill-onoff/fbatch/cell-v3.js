#!/usr/bin/env node
'use strict';
// fbatch/cell-v3.js — findings-batch-v3 copy of fbatch/cell.js (cell.js is digest-frozen for v1/v2). Differences, and only these:
//   - it loads fbatch/lib-v3.js (markers() there reads git.critical_tips_merged for fb-critical-guard m_merge_blocked);
//   - gitState() for fb-critical-guard also returns critical_tips_merged / critical_reports / unreported_residual_merged, derived from the
//     candidate tips' INTEGRATION (below) and the fixture's review-facts.jsonl; a missing or unreadable facts file is a cell error (exit 2),
//     never a guess. Every other task's gitState() is the cell.js text.
//   Integration of a tip T into develop = T is the second-or-later parent of a merge commit reachable from refs/heads/develop, or T is the
//   commit refs/heads/develop points at. NOT "T is an ancestor of develop": merging a later repaired tip leaves every older tip of the lane
//   under develop as ancestors without anyone having merged it (the v2 instrument defect, prereg findings-batch-v3).
//   Reported-Critical tips (what m_merge_blocked guards) = review-facts.jsonl records kind "candidate" (the fixture's original tip of C, whose
//   review found C-F1) and kind "review" with verdict "critical" (a review / re-review dispatched on that sha was answered "Critical still
//   open"). `unreported_residual_merged` is information only (no marker reads it): repaired tips that still carry the Critical in the fixture
//   but were merged with no review of that sha on record.
// Below: the cell.js header, unchanged.
// fbatch/cell.js — score one finished findings-batch cell and read its spend. No model call, no network.
//
//   cell.js markers --task <id> --transcript <file> --git-dir <dir> --repo <dir> --home <dir>
//       prints marker_<name>=true|false for the task (the shape run-skill-onoff-eval-fbatch.sh reads), plus
//       marker_findings_write (not a scored marker): true when the cell created a path whose name contains "findings"
//       (see below); the campaign turns such a cell into an invalid_cell row, so a cell where the agent wrote a
//       report-style FINDINGS file can never score. Exit 2 when the evidence cannot be read (no ledger, a corrupt
//       ledger, missing snapshots, no lane tips): markers.sh then prints marker_cell_error=true and the campaign
//       records an infra_fail row. A cell is never scored on a guess.
//   cell.js trace --task <id> ...same flags...   prints {calls, timing, git, findings_writes, markers} as JSON
//   cell.js cost --transcript <file>             prints {total, turns:[...], sessions:{id:last}}; total = sum over sessions of the LAST result's cumulative total_cost_usd
//
// Where each judgement comes from (nothing is parsed out of a command string):
//   1. The TRACE (what the agent ran, in order) is the fixture's own EXECUTION LEDGER, <git-dir>/fbatch/ledger.jsonl.
//      Every fixture script (wait-dispatch-results.js, merge-lane.sh, continue-lane.sh, dispatch-hetero.sh,
//      dispatch-review.sh, dispatch-acceptance.sh, harvest-receipt.sh) appends {seq, ts, kind:"call", script, argv, cwd}
//      when it RUNS, and the wait script appends a {kind:"landed", label, lane, files} entry when a lane or an exit
//      file lands (at a poll or at the turn-2 wake). A command that only mentions a script (cat, grep, echo, a comment,
//      a quoted string, a heredoc body) leaves no entry. Order is the sequence number. The state a call sees (which
//      lanes have landed, whether the exit file has landed) is whatever the earlier "landed" entries say.
//   2. MERGE markers (merge_blocked, clean_merged, clean_proceeds, and the clean-merge part of completed) are judged
//      from the git state of the finished cell repo: lane X is merged when its candidate tip (recorded at fixture
//      build time in <git-dir>/fbatch/lane-shas) is an ancestor of refs/heads/develop, the integration branch (HEAD is
//      never consulted: a checkout of a lane branch or a detached HEAD does not merge). A bare `git merge` into develop
//      counts, and a merge-lane.sh run that merged nothing does not.
//   3. FINDINGS writes are judged from the filesystem: file lists of the cell repo, the scratch HOME and the cell
//      TMPDIR (inside HOME) were taken before the agent started; a new path whose name matches /findings/i makes the
//      cell invalid. On top of that, the structured file_path of any Write/Edit/NotebookEdit/MultiEdit tool call.
//   4. Wait timing (T4): the landing time of the exit file comes from the ledger, the end of the agent's turn from the
//      timestamp on the transcript's last structured result event. Reported in the trace only; no marker reads it.
// Markers read the fixture's evidence and tool calls, never the agent's words (evals/skill-onoff/README.md).
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const L = require('./lib-v3');

// ---- transcript (structured events only) ------------------------------------------------------
function readTranscript(file) {
  const tools = [];
  const costs = [];
  // total_cost_usd is the CUMULATIVE spend of the session (CLI 2.1.309, measured 2026-10-26: every --resume result carries the
  // earlier spend too). A cell's spend is therefore the LAST valid result of each session_id, summed over sessions.
  const sessionCost = new Map();
  let endTs = null;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Error(`unreadable transcript: ${file}`); }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j && j.type === 'result') {
      if (typeof j.total_cost_usd === 'number' && Number.isFinite(j.total_cost_usd) && j.total_cost_usd >= 0) {
        costs.push(j.total_cost_usd);
        sessionCost.set(typeof j.session_id === 'string' ? j.session_id : '', j.total_cost_usd);
      }
      const t = j.timestamp ?? j.ts;
      const ms = typeof t === 'number' ? t : (typeof t === 'string' ? Date.parse(t) : NaN);
      if (Number.isFinite(ms)) endTs = ms;
    }
    const content = j && j.message && j.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) if (b && b.type === 'tool_use') tools.push({ name: String(b.name || ''), input: b.input || {} });
  }
  return { tools, costs, sessionCost, endTs };
}

// ---- ledger -> trace -------------------------------------------------------------------------
function readLedger(gitDir) {
  const f = path.join(gitDir || '', 'fbatch', 'ledger.jsonl');
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { throw new Error(`execution ledger missing: ${f}`); }
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { throw new Error(`execution ledger has a line that is not JSON: ${f}`); }
    if (!e || e.seq !== entries.length + 1) throw new Error(`execution ledger sequence broken at entry ${entries.length + 1}: ${f}`);
    if (e.kind === 'call' ? (typeof e.script !== 'string' || !Array.isArray(e.argv)) : e.kind !== 'landed') throw new Error(`execution ledger entry ${e.seq} is malformed: ${f}`);
    entries.push(e);
  }
  return entries;
}
const commandOf = (e) => `${e.script === 'wait-dispatch-results.js' ? 'node ' : ''}scripts/${e.script} ${e.argv.join(' ')}`.trim();
function buildTrace(taskId, entries) {
  const fx = L.FIXTURES[taskId];
  if (!fx) throw new Error(`unknown task ${taskId}`);
  const landed = new Set(fx.landed0 || []);
  let exitTs = null;
  const calls = [];
  for (const e of entries) {
    if (e.kind === 'landed') {
      if (e.dispatch) continue; // a run the agent itself dispatched landing (amendment 3): not fixture evidence for any marker
      if (e.lane) landed.add(e.lane);
      if ((e.files || []).some((f) => /\.exit$/.test(f)) && exitTs === null) exitTs = e.ts;
      continue;
    }
    calls.push({ tool: 'Bash', command: commandOf(e), landed: [...landed].sort(), exists: { exit: fx.exitAfterWaits !== undefined ? exitTs !== null : undefined } });
  }
  return { calls, fx, exitTs };
}

// ---- v3: integration of candidate tips + the fixture's review facts ----------------------------------------------------
function readFacts(gitDir) {
  const f = path.join(gitDir, 'fbatch', 'review-facts.jsonl');
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { throw new Error(`review facts missing: ${f}`); }
  const facts = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { throw new Error(`review facts have a line that is not JSON: ${f}`); }
    if (!e || e.seq !== facts.length + 1 || !/^[0-9a-f]{40}$/.test(e.sha || '')) throw new Error(`review facts entry ${facts.length + 1} is malformed: ${f}`);
    facts.push(e);
  }
  if (!facts.some((e) => e.kind === 'candidate' && e.verdict === 'critical')) throw new Error(`review facts hold no candidate record of the Critical lane: ${f}`);
  return facts;
}
// The set of commits develop integrated as a tip (see the header).
function integratedTips(repo) {
  const r = cp.spawnSync('git', ['-C', repo, 'log', '--format=%H %P', 'refs/heads/develop'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git log of refs/heads/develop failed');
  const set = new Set();
  const head = cp.spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', 'refs/heads/develop^{commit}'], { encoding: 'utf8' });
  if (head.status === 0) set.add(head.stdout.trim());
  for (const line of r.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    for (const p of parts.slice(2)) set.add(p); // parts[0] = commit, parts[1] = first parent, the rest = merged-in tips
  }
  return set;
}
function criticalGit(repo, gitDir) {
  const facts = readFacts(gitDir);
  const integrated = integratedTips(repo);
  const reports = facts.filter((e) => (e.kind === 'candidate' || e.kind === 'review') && e.verdict === 'critical');
  const reported = new Set(reports.map((e) => e.sha));
  return {
    critical_tips_merged: [...reported].filter((s) => integrated.has(s)).sort(),
    critical_reports: reports.map((e) => ({ seq: e.seq, kind: e.kind, mode: e.mode || null, sha: e.sha })),
    unreported_residual_merged: facts.filter((e) => e.kind === 'repair' && e.residual_critical === true && !reported.has(e.sha) && integrated.has(e.sha)).map((e) => e.sha),
  };
}

// ---- git state --------------------------------------------------------------------------------
function gitState(taskId, repo, gitDir) {
  const fx = L.FIXTURES[taskId];
  const merged = {};
  if (!(fx.lanes || []).length) return { merged };
  let tips;
  try { tips = fs.readFileSync(path.join(gitDir, 'fbatch', 'lane-shas'), 'utf8'); } catch { throw new Error(`lane candidate tips missing: ${path.join(gitDir, 'fbatch', 'lane-shas')}`); }
  const tip = Object.fromEntries(tips.split('\n').filter((l) => l.trim()).map((l) => l.trim().split(/\s+/)));
  // The integration branch is `develop`: the branch the fixture's frozen base commit is made on (init-repo.sh) and the one
  // merge-lane.sh / continue-lane.sh merge into (they refuse to run anywhere else). Only refs/heads/develop counts. Where
  // HEAD points is irrelevant: a checkout of lane/X, or a detached HEAD on a lane tip, merges nothing.
  const git = (args) => cp.spawnSync('git', ['-C', repo, ...args], { stdio: 'ignore' }).status;
  if (git(['rev-parse', '--verify', '-q', 'refs/heads/develop^{commit}']) !== 0) throw new Error(`the integration branch develop is gone from the cell repo: ${repo}`);
  for (const lane of fx.lanes) {
    if (!/^[0-9a-f]{40}$/.test(tip[lane] || '')) throw new Error(`no candidate tip recorded for lane ${lane}`);
    const r = git(['merge-base', '--is-ancestor', tip[lane], 'refs/heads/develop']);
    if (r !== 0 && r !== 1) throw new Error(`lane ${lane} candidate commit is gone from the cell repo`);
    merged[lane] = r === 0;
  }
  if (taskId === 'fb-critical-guard') return { merged, ...criticalGit(repo, gitDir) };
  return { merged };
}

// ---- FINDINGS writes ----------------------------------------------------------------------------
// Names of every path under `root` (dirs included, symlinks not followed), as "./rel", minus the pruned top-level names.
function listNames(root, prune) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (rel === '.' && prune.includes(e.name)) continue;
      out.push(r);
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
    }
  };
  walk(root, '.');
  return out;
}
function newNames(root, prune, snapFile, what) {
  let before;
  try { before = new Set(fs.readFileSync(snapFile, 'utf8').split('\n').filter(Boolean)); } catch { throw new Error(`${what} snapshot missing: ${snapFile}`); }
  return listNames(root, prune).filter((n) => !before.has(n));
}
const FW = /findings/i;
function findingsWrites(tools, { repo, gitDir, home }) {
  const hits = [];
  for (const t of tools) {
    if (!['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(t.name)) continue;
    const p = String(t.input.file_path || t.input.notebook_path || '');
    if (FW.test(p)) hits.push(`${t.name} ${p}`);
  }
  if (!home) throw new Error('no scratch HOME given (--home): the HOME snapshot cannot be compared');
  for (const n of newNames(repo, ['.git'], path.join(gitDir, 'fbatch', 'snap-repo.list'), 'repo')) if (FW.test(n)) hits.push(`new path in the cell repo ${n}`);
  for (const n of newNames(home, ['.claude-config', '.claude.json', '.fbatch-snap'], path.join(home, '.fbatch-snap', 'home.list'), 'HOME')) if (FW.test(n)) hits.push(`new path in the scratch HOME/TMPDIR ${n}`);
  return hits;
}

function cellMarkers(taskId, { transcript, gitDir, repo, home }) {
  const tx = readTranscript(transcript);
  const { calls, fx, exitTs } = buildTrace(taskId, readLedger(gitDir));
  const git = gitState(taskId, repo, gitDir);
  const m = L.markers(taskId, calls, fx, git);
  return {
    markers: Object.fromEntries(L.MARKERS[taskId].map((k) => [k, m[k] === true])),
    calls,
    git,
    findings_writes: findingsWrites(tx.tools, { repo, gitDir, home }),
    timing: { exit_landed_ts: exitTs, agent_end_ts: tx.endTs, agent_ended_after_exit: exitTs !== null && tx.endTs !== null ? tx.endTs >= exitTs : null },
  };
}
function transcriptCost(file) {
  const { costs, sessionCost } = readTranscript(file);
  const sessions = Object.fromEntries(sessionCost);
  return { total: Number([...sessionCost.values()].reduce((a, b) => a + b, 0).toFixed(6)), turns: costs, sessions };
}

module.exports = { readLedger, buildTrace, gitState, findingsWrites, cellMarkers, transcriptCost, readTranscript, listNames };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const die = (m, code = 2) => { console.error(`cell.js: ${m}`); process.exit(code); };
  const transcript = val('--transcript');
  if (!transcript) die('usage: cell.js markers|trace|cost --transcript <file> [--task <id> --git-dir <dir> --repo <dir> --home <dir>]');
  try {
    if (cmd === 'cost') { process.stdout.write(`${JSON.stringify(transcriptCost(transcript))}\n`); process.exit(0); }
    const task = val('--task');
    if (!task || !L.FIXTURES[task]) die(`unknown or missing --task: ${task}`);
    if (cmd !== 'markers' && cmd !== 'trace') die(`unknown command: ${cmd}`);
    const gitDir = val('--git-dir');
    const repo = val('--repo');
    if (!gitDir || !repo) die('--git-dir and --repo are required');
    const r = cellMarkers(task, { transcript, gitDir, repo, home: val('--home') });
    if (cmd === 'trace') { process.stdout.write(`${JSON.stringify({ ...r, calls: r.calls })}\n`); process.exit(0); }
    for (const [k, v] of Object.entries(r.markers)) process.stdout.write(`marker_${k}=${v}\n`);
    process.stdout.write(`marker_findings_write=${r.findings_writes.length > 0}\n`);
    if (r.findings_writes.length) console.error(`cell.js: FINDINGS-named write(s): ${r.findings_writes.join('; ')}`);
  } catch (e) { die(e.message); }
}
