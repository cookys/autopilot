#!/usr/bin/env node
// stage-graph-cell.js — per-cell observation + judgement for the stage-graph eval (P0, plan
// docs/plans/2026-10-06-dev-flow-stage-graph.md §4 P0; rules frozen in prereg/stage-graph.{md,json}).
//
// It reads ONE claude -p stream-json transcript and extracts, in transcript order, from Bash tool_use:
//   session-mode.js set --size <S> [--bug] [--urgent]   -> the FIRST such call that did not fail
//   stage-advance.js ... --to <node>                    -> the walk (consecutive duplicates collapsed:
//                                                          a same-node update is not a transition)
//   probe-unknown.js classify ...                       -> the FIRST call; its tool_result JSON gives
//                                                          eligible_max (see "first rung" below)
// A Bash command whose paired tool_result has is_error:true is discarded (the write was refused, the
// marker did not change). A tool_use with no paired result is counted (synthetic/aborted transcripts).
//
// First rung (defined precisely): "none" when no classify call exists; otherwise the `eligible_max`
// field of the first classify result. eligible_max is signal-determined (S4 zero-hit term -> U1, all
// terms hit -> U0) and does NOT depend on consult seat qualification, so it is stable across hosts,
// unlike `recommend` (U1 vs none/not-heterogeneous). An unparseable result is "unobserved" (fails).
//
// Tool ordering is cross-checked against lib/transcript-query.js `tool-events` (the harness's own
// reader); a count mismatch fails closed. transcript-query.js is digest-frozen in prereg/FROZEN.json,
// so tool_result access and full (untruncated) commands live here instead of extending it.
//
// Usage:
//   stage-graph-cell.js --task <id> --transcript <file> [--work-done true|false] [--markers]
//     --tasks-dir <dir> / --expected <file> override the defaults (tests).
//     stdout: one JSON object (observation + judgement), or with --markers the marker_sg_* lines.
// Exit: 0 judged (a failed judgement is still exit 0) · 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const BASE = path.join(HERE, '..');
const REPO = path.join(BASE, '..', '..');

// expected first rung -> accepted observed rungs. "none" tolerates a local-only consult (U0): not
// escalating is the claim; U0 and U1 are exact because they are the discriminating cells.
const RUNG_ACCEPTS = { none: ['none', 'U0'], U0: ['U0'], U1: ['U1'] };

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line, like transcript-query */ }
  }
  return out;
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n');
  return '';
}

function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const body = text.slice(start);
  for (let end = body.length; end > 0; end -= 1) {
    if (body[end - 1] !== '}') continue;
    try { return JSON.parse(body.slice(0, end)); } catch { /* shorter */ }
  }
  return null;
}

function toolUses(file) {
  const uses = [];
  const results = new Map();
  for (const j of readJsonl(file)) {
    const content = j && j.message && j.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'tool_use') uses.push({ id: b.id || null, name: String(b.name || ''), input: b.input || {} });
      else if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { is_error: b.is_error === true, text: resultText(b.content) });
    }
  }
  return { uses, results };
}

function queryEventCount(file) {
  const r = cp.spawnSync('node', [path.join(HERE, 'transcript-query.js'), file, 'tool-events'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).length;
}

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

function extract(file) {
  const { uses, results } = toolUses(file);
  const obs = { set: null, set_calls: 0, walk_raw: [], walk: [], rung: 'none', classify_called: false, error: null };
  const qn = queryEventCount(file);
  if (qn === null || qn !== uses.length) {
    obs.error = `tool_use count mismatch (reader ${qn} vs parsed ${uses.length})`;
    return obs;
  }
  for (const u of uses) {
    if (u.name !== 'Bash') continue;
    const cmd = String(u.input.command || '');
    const res = u.id ? results.get(u.id) : null;
    const refused = !!(res && res.is_error);
    // session-mode set
    for (const m of cmd.matchAll(/session-mode\.js["']?\s+set\b([^\n;&|]*)/g)) {
      if (refused) continue;
      const sz = m[1].match(/--size(?:=|\s+)["']?(XS|S|M|L|XL)["']?(?=\s|$)/);
      if (!sz) continue;
      obs.set_calls += 1;
      if (!obs.set) obs.set = { size: sz[1], bug: /(^|\s)--bug(\s|$)/.test(m[1]), urgent: /(^|\s)--urgent(\s|$)/.test(m[1]) };
    }
    // stage-advance
    for (const m of cmd.matchAll(/stage-advance\.js["']?([^\n;&|]*)/g)) {
      if (refused) continue;
      const to = m[1].match(/--to(?:=|\s+)["']?([a-z][a-z-]*)["']?(?=\s|$)/);
      if (to) obs.walk_raw.push(to[1]);
    }
    // first classify
    if (!obs.classify_called && /probe-unknown\.js["']?\s+classify\b/.test(cmd) && !refused) {
      obs.classify_called = true;
      const j = res ? firstJsonObject(res.text) : null;
      obs.rung = j && typeof j.eligible_max === 'string' ? j.eligible_max : 'unobserved';
    }
  }
  for (const n of obs.walk_raw) if (obs.walk[obs.walk.length - 1] !== n) obs.walk.push(n);
  return obs;
}

function judge(answer, expectedCell, obs, workDone) {
  const j = { size: false, bug: false, urgent: false, walk: false, rung: false, work: workDone === true };
  if (obs.error) return { ...j, pass: false };
  if (obs.set) {
    j.size = obs.set.size === answer.size;
    j.bug = obs.set.bug === answer.bug;
    j.urgent = obs.set.urgent === answer.urgent;
  }
  const need = answer.horizon_index + 1;
  const want = expectedCell.walk.slice(0, need);
  j.walk = obs.walk.length >= need && want.every((n, i) => obs.walk[i] === n);
  j.rung = (RUNG_ACCEPTS[answer.first_rung] || []).includes(obs.rung);
  j.pass = j.size && j.bug && j.urgent && j.walk && j.rung && j.work;
  return j;
}

function loadKey(taskId, tasksDir, expectedFile) {
  const answer = JSON.parse(fs.readFileSync(path.join(tasksDir, taskId, 'answer.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const cell = expected.cells.find((c) => c.id === answer.cell);
  if (!cell) throw new Error(`answer.json cell not in expected.json: ${answer.cell}`);
  return { answer, cell };
}

// answer.json must agree with its expected.json cell (a stale key cannot silently score)
function validateKey(answer, cell) {
  const errs = [];
  if (!SIZES.includes(answer.size)) errs.push('size not a size');
  if (cell.size !== answer.size) errs.push('size != cell.size');
  if (cell.bug !== answer.bug) errs.push('bug != cell.bug');
  if (cell.urgent !== answer.urgent) errs.push('urgent != cell.urgent');
  if (cell.research !== answer.research) errs.push('research != cell.research');
  if (cell.units !== answer.units) errs.push('units != cell.units');
  if (!Number.isInteger(answer.horizon_index) || answer.horizon_index < 0 || answer.horizon_index >= cell.walk.length) errs.push('horizon_index out of walk');
  else if (cell.walk[answer.horizon_index] !== answer.horizon_node) errs.push('horizon_node != walk[horizon_index]');
  if (!(answer.first_rung in RUNG_ACCEPTS)) errs.push('first_rung unknown');
  if (typeof answer.horizon_justification !== 'string' || answer.horizon_justification.length < 20) errs.push('horizon_justification missing');
  return errs;
}

module.exports = { extract, judge, loadKey, validateKey, RUNG_ACCEPTS, SIZES };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const task = opt('--task');
  const tr = opt('--transcript');
  if (!task || !tr) { console.error('usage: stage-graph-cell.js --task <id> --transcript <file> [--work-done true|false] [--markers]'); process.exit(2); }
  const tasksDir = opt('--tasks-dir') || path.join(BASE, 'tasks');
  const expectedFile = opt('--expected') || path.join(REPO, 'hooks', 'tests', 'fixtures', 'stage-graph', 'expected.json');
  let key;
  let obs;
  try { key = loadKey(task, tasksDir, expectedFile); obs = extract(tr); } catch (e) { console.error(`stage-graph-cell: ${e.message}`); process.exit(2); }
  const j = judge(key.answer, key.cell, obs, opt('--work-done') === 'true');
  if (argv.includes('--markers')) {
    // every marker is ANDed with work_done, so a no-op cell (e.g. no stage calls, rung "none") scores false everywhere
    for (const k of ['size', 'bug', 'urgent', 'walk', 'rung', 'work', 'pass']) console.log(`marker_sg_${k}=${j[k] === true && j.work === true ? 'true' : 'false'}`);
  } else {
    console.log(JSON.stringify({ task, cell: key.answer.cell, observed: obs, judged: j }));
  }
}
