#!/usr/bin/env node
'use strict';

/**
 * next-pick.js — deterministic auto-pick over written queues
 * (autonomous-brain-integration P5; plan: docs/plans/2026-08-17-autonomous-brain-integration.md).
 *
 * Governance: picking is a PROXY DECISION — it lands in the decision ledger with
 * a materialized pick-record, and replay recomputes from that record, never from
 * live state (G2 adjudication B9). Auto-pick selects ONLY from written queues;
 * mid-session ideas enter the queue first and compete (anti scope-invention).
 *
 * Ask-first predicate — decidable from data that exists (G2 B10):
 *   at pick time: effort L or H, OR the row carries a `board` tag,
 *                 OR class is `hard-problem` (pinned to depth-0, never dispatched).
 *   at preflight: the picked unit's diff-scope declaration touching qc-gate
 *                 protected paths converts the pick to ask-first
 *                 (check-blueprint-conformance.js territory, not this script's).
 * Irreversible/outward ACTIONS are execution-gated by standing red lines
 * (exec-boundary, confirm-first), not a pick-time predicate.
 *
 * Deterministic ranking (pure function of the materialized inputs):
 *   1. user class weight desc (preferences.class_weights — the user's habit
 *      OUTRANKS every system signal among eligible candidates, KR6)
 *   2. staleness desc (age_days)
 *   3. smaller effort first (S > Fix > M)
 *   4. title lexicographic (total order — no ties survive)
 *
 * Modes:
 *   parse --backlog <file>
 *     Mechanically extracts candidate rows from docs/BACKLOG.md active entries:
 *     {title, effort, tags, source}. effort = first S|M|L|H|Fix token of the
 *     Effort field; tags gains "board" when that field mentions Board.
 *   pick --candidates <file> --preferences <file> [--readiness <file>]
 *        [--ledger <file>] [--decision-id <id>] [--round <n>]
 *     candidates: JSON array [{title, effort, tags[], class, age_days, source}]
 *     preferences: {class_weights: {<class>: <number>}}
 *     Emits {pick, ask_first_queue, pick_record}; with --ledger, appends the
 *     kind:pick row (decision-ledger.js contract) carrying the full record.
 *
 * Exit: 0 ok (also when no candidate is auto-eligible — pick is null) · 2 usage.
 * Node >= 20.10 built-ins.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EFFORT_RANK = { S: 3, Fix: 2, M: 1 };

function usage(message) {
  process.stderr.write(`next-pick: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (!['parse', 'pick'].includes(mode)) usage('mode must be parse|pick');
  const opts = { mode, round: null };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    if (arg === '--backlog') opts.backlog = value;
    else if (arg === '--candidates') opts.candidates = value;
    else if (arg === '--preferences') opts.preferences = value;
    else if (arg === '--readiness') opts.readiness = value;
    else if (arg === '--ledger') opts.ledger = value;
    else if (arg === '--decision-id') opts.decisionId = value;
    else if (arg === '--round') opts.round = Number(value);
    else if (arg === '--brain-status') opts.brainStatus = value;
    else if (arg === '--seat-class') opts.seatClass = value;
    else if (arg === '--seat-engine') opts.seatEngine = value;
    else if (arg === '--qualification-override') opts.qualificationOverride = value;
    else usage(`unknown argument: ${arg}`);
    i += 1;
  }
  if (mode === 'parse' && !opts.backlog) usage('parse requires --backlog');
  if (mode === 'pick' && (!opts.candidates || !opts.preferences)) {
    usage('pick requires --candidates and --preferences');
  }
  if (opts.seatClass && !['incumbent', 'candidate'].includes(opts.seatClass)) {
    usage('--seat-class must be incumbent|candidate');
  }
  if (opts.brainStatus && !opts.seatClass) usage('--brain-status requires --seat-class');
  if (opts.qualificationOverride && !opts.seatEngine) {
    usage('--qualification-override requires --seat-engine (the override binds to the seated engine)');
  }
  return opts;
}

// P7/KR4 (plan 2026-08-17-brain-seat-exam-suite P4): auto-pick is a governed path.
// A seated brain without standing (no_record or requalification_required) either
// admits on the explicit per-invocation override (loud, EVIDENCE-FREE) or, for a
// candidate seat, refuses the auto-pick outright; the incumbent seat annotates
// loudly per Board 2026-08-16 advisory bootstrap semantics.
function checkBrainSeat(opts) {
  if (!opts.brainStatus) return null;
  let status;
  try {
    status = JSON.parse(fs.readFileSync(opts.brainStatus, 'utf8'));
  } catch (err) {
    usage(`--brain-status unreadable: ${opts.brainStatus}`);
  }
  const standing = status && status.status === 'qualified';
  if (standing) return { seat_class: opts.seatClass, status: status.status, admission: 'admitted' };
  if (opts.qualificationOverride && fs.existsSync(opts.qualificationOverride)) {
    try {
      const doc = JSON.parse(fs.readFileSync(opts.qualificationOverride, 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      // The override binds to the EXACT seated engine — an override written for one
      // engine never admits another (QC 2026-08-17, cross-path parity with the
      // resolver's identity-bound check).
      const match = doc && doc.schema === 1 && Array.isArray(doc.overrides)
        ? doc.overrides.find((o) => o && o.role === 'owner'
          && o.engine === opts.seatEngine
          && typeof o.reason === 'string' && o.reason.trim()
          && typeof o.expires === 'string' && o.expires >= today)
        : null;
      if (match) {
        process.stderr.write(`next-pick: brain seat (${opts.seatClass}) runs on an EVIDENCE-FREE operator override (reason: ${match.reason}; expires ${match.expires})\n`);
        return { seat_class: opts.seatClass, status: status ? status.status : 'status_unavailable', admission: 'override_admitted' };
      }
    } catch { /* unreadable override never admits */ }
  }
  if (opts.seatClass === 'candidate') {
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      artifact_type: 'next_pick_result',
      error: 'brain_seat_refused',
      brain_seat: { seat_class: 'candidate', status: status ? status.status : 'status_unavailable', admission: 'refused' },
      legal_paths: [
        'standing exam pass: engine-qualify.sh brain',
        'per-invocation override: --qualification-override (role owner)',
      ],
    }, null, 1)}\n`);
    process.exit(1);
  }
  process.stderr.write(`next-pick: brain seat (incumbent) has NO standing qualification (status ${status ? status.status : 'status_unavailable'}) — advisory per Board 2026-08-16 bootstrap semantics; sit the exam or provide an override\n`);
  return { seat_class: 'incumbent', status: status ? status.status : 'status_unavailable', admission: 'advisory' };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseBacklog(opts) {
  let raw;
  try {
    raw = fs.readFileSync(opts.backlog, 'utf8');
  } catch (err) {
    usage(`--backlog unreadable: ${opts.backlog}`);
  }
  const rows = [];
  const sections = raw.split(/^### /mu).slice(1);
  for (const section of sections) {
    const title = section.split('\n')[0].trim();
    if (!title || title.startsWith('<')) continue; // template stub
    const effortMatch = section.match(/\*\*Effort\*\*:\s*([^\n]*)/u);
    const sourceMatch = section.match(/\*\*Source\*\*:\s*([^\n]*)/u);
    const effortText = effortMatch ? effortMatch[1].trim() : '';
    const tokenMatch = effortText.match(/\b(S|M|L|H|Fix)\b/u);
    const tags = [];
    if (/board/iu.test(effortText)) tags.push('board');
    rows.push({
      title,
      effort: tokenMatch ? tokenMatch[1] : 'unknown',
      tags,
      class: 'standard-impl',
      age_days: null,
      source: sourceMatch ? sourceMatch[1].trim() : '',
    });
  }
  process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
}

function askFirstReason(row) {
  if (row.effort === 'L' || row.effort === 'H') return `effort ${row.effort}`;
  if (Array.isArray(row.tags) && row.tags.includes('board')) return 'board tag';
  if (row.class === 'hard-problem') return 'hard-problem class is pinned to depth-0';
  if (row.effort === 'unknown') return 'effort not machine-readable';
  return null;
}

function pick(opts) {
  const brainSeat = checkBrainSeat(opts);
  let candidates;
  let preferences;
  try {
    candidates = JSON.parse(fs.readFileSync(opts.candidates, 'utf8'));
    preferences = JSON.parse(fs.readFileSync(opts.preferences, 'utf8'));
  } catch (err) {
    usage('candidates/preferences unreadable or invalid JSON');
  }
  if (!Array.isArray(candidates)) usage('candidates must be a JSON array');
  const weights = (preferences && preferences.class_weights) || {};
  const readiness = opts.readiness && fs.existsSync(opts.readiness)
    ? JSON.parse(fs.readFileSync(opts.readiness, 'utf8'))
    : {};

  const askFirst = [];
  const eligible = [];
  for (const row of candidates) {
    const reason = askFirstReason(row);
    if (reason) askFirst.push({ title: row.title, reason });
    else eligible.push(row);
  }
  eligible.sort((a, b) => {
    const wa = Number(weights[a.class]) || 0;
    const wb = Number(weights[b.class]) || 0;
    if (wa !== wb) return wb - wa;
    const sa = Number(a.age_days) || 0;
    const sb = Number(b.age_days) || 0;
    if (sa !== sb) return sb - sa;
    const ea = EFFORT_RANK[a.effort] || 0;
    const eb = EFFORT_RANK[b.effort] || 0;
    if (ea !== eb) return eb - ea;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });

  const pickRecord = {
    candidates_digest: sha256(JSON.stringify(candidates)),
    preferences_digest: sha256(JSON.stringify(preferences)),
    readiness_snapshot: readiness,
  };
  const chosen = eligible.length > 0 ? eligible[0] : null;
  const result = {
    schema_version: 1,
    artifact_type: 'next_pick_result',
    pick: chosen,
    ask_first_queue: askFirst,
    pick_record: pickRecord,
    ...(brainSeat ? { brain_seat: brainSeat } : {}),
  };
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);

  if (opts.ledger && chosen) {
    const row = {
      decision_id: opts.decisionId || `pick-${sha256(JSON.stringify([pickRecord, chosen.title])).slice(0, 12)}`,
      round: Number.isFinite(opts.round) ? opts.round : null,
      row_title: chosen.title,
      pick_record: pickRecord,
      rationale: `top auto-eligible by class weight ${weights[chosen.class] || 0} (${chosen.class}), age ${chosen.age_days || 0}d, effort ${chosen.effort}`,
    };
    const append = spawnSync('node', [
      path.join(__dirname, 'decision-ledger.js'),
      'append', '--ledger', opts.ledger, '--kind', 'pick', '--json', JSON.stringify(row),
    ], { encoding: 'utf8' });
    if (append.status !== 0) {
      process.stderr.write(`next-pick: ledger append failed: ${append.stderr}`);
      process.exit(1);
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'parse') parseBacklog(opts);
  else pick(opts);
}

main();
