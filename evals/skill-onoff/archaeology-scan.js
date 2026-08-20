#!/usr/bin/env node
'use strict';
// archaeology-scan.js — Phase A deterministic corpus scanner for the frozen plan
// docs/plans/2026-08-20-multiturn-event-harness.md (R2', terminal-frozen).
//
// FROZEN PREDICATES — any edit after the pre-registration hash invalidates Phase A.
// Modes:
//   probe <file.jsonl>        one-file record (validity gate) — prints JSON
//   scan  <corpus-root>       Phase A: walk <root>/*/*.jsonl, print report JSON
// Zero is a DETECTION claim: "the frozen predicates detected 0 fires", never
// "the behaviour did not happen" (G2 fold e3cdea3d/537724cb).
const fs = require('fs');
const path = require('path');

const VERSION_MAX = [2, 1, 232];          // inclusive
const MODEL = 'claude-opus-5';
const MIN_TURNS = 3;
const NOT_A_TURN_PREFIX = ['Base directory for this skill:', '<', 'Caveat:'];

function versionLE(v) {
  if (typeof v !== 'string') return false;
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const p = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (p[i] < VERSION_MAX[i]) return true;
    if (p[i] > VERSION_MAX[i]) return false;
  }
  return true;
}
function userText(rec) {
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.length && c[0] && c[0].type === 'text') return c[0].text || '';
  return null; // tool_result-bearing or unknown → not a real turn
}
function isRealUserTurn(rec) {
  if (rec.type !== 'user' || rec.isSidechain === true) return false;
  const t = userText(rec);
  if (!t || !t.trim()) return false;
  return !NOT_A_TURN_PREFIX.some((p) => t.startsWith(p));
}
const writeCmd = (cmd) => cmd.includes('>') || cmd.includes('tee') || cmd.includes('cp ');
const MARKERS = {
  m1_session_sha: (b) => (b.name === 'Write' && typeof b.input?.file_path === 'string'
      && b.input.file_path.endsWith('.claude/session-start-sha'))
    || (b.name === 'Bash' && typeof b.input?.command === 'string'
      && b.input.command.includes('.claude/session-start-sha') && writeCmd(b.input.command)),
  m2_plan_doc: (b) => (b.name === 'Write' && typeof b.input?.file_path === 'string'
      && /(^|\/)docs\/plans\/[^/]+\.md$/.test(b.input.file_path))
    || (b.name === 'Bash' && typeof b.input?.command === 'string'
      && b.input.command.includes('docs/plans/') && writeCmd(b.input.command)),
  m3_project_readme: (b) => (b.name === 'Write' && typeof b.input?.file_path === 'string'
      && /docs\/projects\/[^/]+\/README\.md$/.test(b.input.file_path))
    || (b.name === 'Bash' && typeof b.input?.command === 'string'
      && b.input.command.includes('docs/projects/') && b.input.command.includes('README.md')
      && writeCmd(b.input.command)),
  m4_ff_taskcreate: (b) => b.name === 'TaskCreate'
    && /^(L-1\.6|L-5|H-9|S-scope-gate)[:\s]/.test((b.input && b.input.subject) || ''),
};

function scanFile(file) {
  const out = {
    file, real_user_turns: 0, qualifying_records: 0, devflow_engaged: false,
    eligible: false, markers: { m1_session_sha: 0, m2_plan_doc: 0, m3_project_readme: 0, m4_ff_taskcreate: 0 },
    raw: { taskcreate_any: false, skill_devflow_any: false },
    first_q_ts: null, last_q_ts: null,
  };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (isRealUserTurn(rec)) { out.real_user_turns++; continue; }
    if (rec.type !== 'assistant' || rec.isSidechain === true) continue;
    const blocks = (rec.message && Array.isArray(rec.message.content)) ? rec.message.content : [];
    for (const b of blocks) {
      if (!b || b.type !== 'tool_use') continue;
      if (b.name === 'TaskCreate') out.raw.taskcreate_any = true;
      if (b.name === 'Skill' && b.input && b.input.skill === 'autopilot:dev-flow') out.raw.skill_devflow_any = true;
    }
    const qualifies = versionLE(rec.version) && rec.message && rec.message.model === MODEL;
    if (!qualifies) continue;
    out.qualifying_records++;
    if (rec.timestamp) {
      if (!out.first_q_ts || rec.timestamp < out.first_q_ts) out.first_q_ts = rec.timestamp;
      if (!out.last_q_ts || rec.timestamp > out.last_q_ts) out.last_q_ts = rec.timestamp;
    }
    for (const b of blocks) {
      if (!b || b.type !== 'tool_use') continue;
      if (b.name === 'Skill' && b.input && b.input.skill === 'autopilot:dev-flow') out.devflow_engaged = true;
      for (const [k, pred] of Object.entries(MARKERS)) if (pred(b)) out.markers[k]++;
    }
  }
  out.eligible = out.real_user_turns >= MIN_TURNS && out.devflow_engaged;
  return out;
}

function label(firedSessions, eligibleCount) {
  if (firedSessions >= 2) return 'observed';
  if (firedSessions === 0 && eligibleCount >= 5) return 'absent';
  return 'insufficient';
}

const [mode, target] = process.argv.slice(2);
if (mode === 'probe') {
  process.stdout.write(JSON.stringify(scanFile(target), null, 2) + '\n');
} else if (mode === 'scan') {
  const sessions = [];
  for (const dir of fs.readdirSync(target)) {
    const d = path.join(target, dir);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.jsonl')) continue;
      try { sessions.push(scanFile(path.join(d, f))); } catch { /* unreadable → skip */ }
    }
  }
  const eligible = sessions.filter((s) => s.eligible && s.qualifying_records > 0);
  const summary = { scanned: sessions.length, eligible: eligible.length, per_marker: {} };
  for (const k of Object.keys(MARKERS)) {
    const fired = eligible.filter((s) => s.markers[k] > 0).length;
    summary.per_marker[k] = { sessions_fired: fired, label: label(fired, eligible.length) };
  }
  process.stdout.write(JSON.stringify({ summary, eligible_sessions: eligible }, null, 2) + '\n');
} else {
  console.error('usage: archaeology-scan.js probe <file.jsonl> | scan <corpus-root>');
  process.exit(2);
}
