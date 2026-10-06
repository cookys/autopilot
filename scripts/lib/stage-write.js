'use strict';

// stage-write.js — the one place a rail records its stage-graph position (plan §2.7 Writers / P3).
//
//   stageWrite({ to, unit?, families? }) -> { code, reason }
//
// Spawns scripts/stage-advance.js (override: AUTOPILOT_STAGE_ADVANCE_BIN — a .js path runs under node, any
// other path is executed directly) with --to / --unit / --review-families. Fail-open by contract: it never
// throws and never changes the caller's exit code. On a non-zero stage-advance exit it prints exactly ONE
// stderr line `stage-advance: <exit> <reason>` and returns the code, with one exception: exit 2 (no unexpired
// marker for this session) is silent. After the first failure the rail's later writes are skipped, so a run
// prints at most one line. Rails run outside dev-flow sessions routinely (research-to-ship plan
// reviews, qualification exams, every rail test), where "no marker" is the normal case, not a fault.
//
// Families on a review node must be the families of seats whose review COMPLETED (transport ok + verdict
// parsed). Planned / manifest families are never passed here. familyOfEngine mirrors family_of() in
// scripts/resolve-review-loop.sh (hooks/tests/rail-stage-writers.test.sh pins the two against each other).
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_BIN = path.join(__dirname, '..', 'stage-advance.js');
const GRAPH_JSON = path.join(__dirname, '..', '..', 'references', 'stage-graph.json');
const TIMEOUT_MS = 30000;
// One diagnostic line per rail run: once a write has failed (or found no marker), the rail's later writes are
// skipped — a refused entry makes the completion update refuse for the same reason, so it would only repeat it.
let failed = false;

function familyOfEngine(engine) {
  const e = String(engine || '').toLowerCase();
  if (/gpt|codex|o1|o3|o4/.test(e)) return 'openai';
  if (/claude|opus|sonnet|haiku/.test(e)) return 'anthropic';
  if (/qwen|qwq/.test(e)) return 'alibaba';
  if (/gemini|flash|bison/.test(e)) return 'google';
  if (/grok|composer/.test(e)) return 'xai';
  if (/minimax|abab/.test(e)) return 'minimax';
  if (/glm|zhipu/.test(e)) return 'zhipu';
  if (/kimi|moonshot/.test(e)) return 'moonshot';
  return 'unknown';
}

// Sorted, de-duplicated, comma-joined family ids; '' when none (the caller then skips the same-node update).
function familiesArg(families) {
  return [...new Set((families || []).filter((f) => typeof f === 'string' && f))].sort().join(',');
}

function reasonFrom(code, stdout, stderr) {
  try {
    const o = JSON.parse(String(stdout || '').trim());
    if (o && typeof o.reason === 'string' && o.reason) return o.reason;
    if (o && o.bump_to) return `size bump required (to ${o.bump_to})`;
  } catch { /* not JSON */ }
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1].replace(/^stage-advance:\s*/u, '') : '';
  return last || `exited ${code}`;
}

function stageWrite({ to, unit, families } = {}) {
  if (failed) return { code: 0, reason: 'skipped after an earlier failure in this run', skipped: true };
  const bin = process.env.AUTOPILOT_STAGE_ADVANCE_BIN || DEFAULT_BIN;
  const args = ['--to', to];
  if (unit) args.push('--unit', unit);
  if (families !== undefined) {
    const f = familiesArg(families);
    if (!f) return { code: 0, reason: 'no completed families; nothing to write', skipped: true };
    args.push('--review-families', f);
  }
  const isJs = /\.js$/u.test(bin);
  let r;
  try {
    r = spawnSync(isJs ? process.execPath : bin, isJs ? [bin, ...args] : args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
    });
  } catch (e) {
    r = { error: e };
  }
  if (r.error || r.status === null) {
    const why = r.error ? r.error.message : `terminated by ${r.signal}`;
    failed = true;
    process.stderr.write(`stage-advance: spawn ${String(why).replace(/\s+/g, ' ')}\n`);
    return { code: -1, reason: String(why) };
  }
  if (r.status === 0) return { code: 0, reason: '' };
  failed = true;
  const reason = reasonFrom(r.status, r.stdout, r.stderr).replace(/\s+/g, ' ');
  if (r.status !== 2) process.stderr.write(`stage-advance: ${r.status} ${reason}\n`);
  return { code: r.status, reason };
}

// `kind:i/N:label` for the session's size, or null when the size has no unit kind / no marker. The kind comes
// from references/stage-graph.json for the marker's size (XL = deliverable, S/M/L = phase), never hard-coded,
// so an l5 campaign on an L task does not trip stage-advance's unit-kind rule.
function unitArg(index, total, label) {
  try {
    if (!(Number.isInteger(index) && index >= 1 && Number.isInteger(total) && total >= index)) return null;
    const sessionMode = require('../session-mode');
    const marker = sessionMode.readSessionRecord();
    if (!marker || !marker.size) return null;
    const graph = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'));
    const kind = graph.sizes && graph.sizes[marker.size] && graph.sizes[marker.size].unit_kind;
    if (!kind) return null;
    const text = [...String(label || '')].slice(0, 64).join('');
    return `${kind}:${index}/${total}:${text}`;
  } catch {
    return null;
  }
}

module.exports = { stageWrite, familyOfEngine, familiesArg, unitArg };
