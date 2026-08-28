#!/usr/bin/env node
'use strict';

/**
 * resolve-scaffold-tier.js — capability-indexed scaffold tier resolution (four-layer P1,
 * docs/plans/2026-08-16-four-layer-redesign.md D4; tier definitions and prompt skeletons:
 * references/scaffold-tiers.md — the single canonical home).
 *
 * Maps {runner, model, role[, effort]} to a scaffold tier from recorded qualification
 * evidence. FAIL-CLOSED: T2 (maximum scaffolding) for missing, unknown, requalify-
 * required (mechanical no-confidence threshold, never a date), conflicting, or
 * malformed evidence — tiers are earned, never assumed.
 *
 *   T0  fresh + complete qualification for this role  (contract-only prompt)
 *   T1  fresh + partial  qualification for this role  (contract + obligation checklist)
 *   T2  everything else                                (full prescribed process)
 *
 * Evidence source: the engine scorecard (~/.autopilot/engine-scorecard/scorecard.jsonl),
 * the house qualification record written by engine-qualify. FRESHNESS IS EVIDENCE-
 * DERIVED, NEVER CALENDAR-DERIVED (BLOCKER 2, 2026-08-22 review repair — the fourth
 * calendar tooth on a production path; Board ruling: "同一個模型不需要日期授權" /
 * references/strike-decay.md). A row is "fresh" when the SEAT's (engine+runner+role)
 * strike-decay admission projection — the SAME projection scripts/engine-scorecard.js
 * computes for every other admission consumer (resolve-review-loop.sh,
 * dispatch-contract.js) — is `qualified` (i.e. NOT `requalify_required`, and not
 * `no_record`). `expires` is never compared to `now` anywhere below; a past-expires
 * qualified row stays T0/T1-eligible and an expiry-less row is no longer punished for
 * lacking a date. Within this one source the LATEST admission-fresh row per tuple is
 * authoritative for QUALITY (complete/partial/unqualified) — an append-only store
 * accumulates requalification history, and supersession is not disagreement. The
 * canonical conflicting→T2 rule concerns two SOURCES disagreeing; it applies once
 * engine-capability-state joins as the higher-precedence input. Imported/provisional
 * priors never lift above T2. Malformed lines are skipped (and can only push toward
 * T2, never away from it).
 *
 * Usage:
 *   node scripts/resolve-scaffold-tier.js --runner <r> --model <m> --role <role>
 *        [--effort <e>] [--now <ISO>] [--scorecard <path>]
 * Output: JSON {tier, rationale, evidence_refs, inputs} on stdout; exit 0.
 * Exit 2 on usage error. Resolution NEVER throws an engine out — it only sizes prompts.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');


function usage(msg) {
  process.stderr.write(`resolve-scaffold-tier: ${msg}\n`);
  process.exit(2);
}

const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!/^--(runner|model|role|effort|now|scorecard)$/.test(key)) usage(`unknown arg: ${key}`);
    if (val === undefined) usage(`${key} needs a value`);
    args[key.slice(2)] = val;
  }
}
for (const req of ['runner', 'model', 'role']) if (!args[req]) usage(`--${req} is required`);

const now = args.now ? Date.parse(args.now) : Date.now();
if (!Number.isFinite(now)) usage('--now must be ISO-8601');
const storePath = args.scorecard
  || path.join(os.homedir(), '.autopilot', 'engine-scorecard', 'scorecard.jsonl');

// BLOCKER 2: reuse scripts/engine-scorecard.js's admission projection (the ONLY
// admission authority per references/strike-decay.md) rather than a third hand-rolled
// copy of the fold. That module resolves its own store paths from
// ENGINE_SCORECARD_DIR/ENGINE_CAPABILITY_DIR at REQUIRE time, so ENGINE_SCORECARD_DIR
// is pinned here to this process's own --scorecard directory BEFORE the require —
// guaranteeing the projection reads the exact same store this file's local match-scan
// below reads, never a stray inherited env var. ENGINE_CAPABILITY_DIR (the strikes
// store) is left to the caller/environment, exactly like every other admission
// consumer (resolve-review-loop.sh, dispatch-contract.js).
process.env.ENGINE_SCORECARD_DIR = path.dirname(storePath);
let engineScorecard = null;
try {
  // eslint-disable-next-line global-require
  engineScorecard = require('./engine-scorecard');
} catch {
  // Requiring it is impractical only if the module itself is broken/missing — that
  // is itself a fail-closed condition (seatAdmission stays null below => T2).
  engineScorecard = null;
}

// Seat-level (engine+runner+role — NOT effort-scoped, per strike-decay.md's pair
// scoping) admission projection, computed ONCE. `args.model` is the same vendor
// engine identity dispatch-hetero.sh hands to `--engine` at the strike writer
// (scripts/dispatch-hetero.sh seat_strike_capture) and to this script's own
// `--model` — same seat, same token.
let seatAdmission = null;
if (engineScorecard) {
  try {
    const engineTok = engineScorecard.engineToken(args.model);
    const runnerTok = engineScorecard.seatToken(args.runner);
    const roleTok = engineScorecard.normalizeRole(args.role, { allowLegacy: true });
    if (engineTok && runnerTok && roleTok) {
      seatAdmission = engineScorecard.computeSeatProjection(engineTok, runnerTok, roleTok, now).projection;
    }
  } catch {
    seatAdmission = null; // fail closed — no admission info => not fresh
  }
}

function emit(tier, rationale, refs) {
  process.stdout.write(`${JSON.stringify({
    tier,
    rationale,
    evidence_refs: refs,
    inputs: {
      runner: args.runner, model: args.model, role: args.role,
      effort: args.effort || null,
      scorecard: storePath, freshness: 'seat-admission-projection',
    },
  }, null, 2)}\n`);
  process.exit(0);
}

let lines = [];
try {
  lines = fs.readFileSync(storePath, 'utf8').split('\n');
} catch {
  emit('T2', 'no scorecard store — unknown engine fails closed to maximum scaffolding', []);
}

const matches = [];
let malformed = 0;
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i].trim();
  if (!line) continue;
  let row;
  try { row = JSON.parse(line); } catch { malformed += 1; continue; }
  if (row.runner !== args.runner || row.model !== args.model || row.role !== args.role) continue;
  if (args.effort && row.effort && row.effort !== args.effort) continue;
  matches.push({ row, ref: { path: storePath, line: i + 1 } });
}

if (matches.length === 0) {
  emit('T2', `no qualification row for ${args.runner}/${args.model} role=${args.role}${malformed ? ` (${malformed} malformed line(s) skipped)` : ''} — fails closed`, []);
}

// BLOCKER 2 fix: fresh = the SEAT's admission projection says `qualified` — never a
// per-row `expires` comparison. `row` is accepted for signature symmetry with the old
// per-row predicate and because a future per-row admission source could need it, but
// admission_status is a SEAT property (engine+runner+role), identical for every row
// sharing that tuple, so every row here shares the same verdict.
function isFresh(_row) {
  return !!seatAdmission && seatAdmission.admission_status === 'qualified';
}
function isImportedPrior(row) {
  return row.version_source === 'imported' || row.provisional === true
    || (typeof row.source === 'string' && /import/i.test(row.source));
}
function qualityOf(row) {
  // complete: full corpus pass, zero critical false-passes, score >= 1
  // partial:  qualified score with an incomplete corpus or missing quality block details
  const q = row.quality || {};
  const score = Number(row.capability_score);
  if (!Number.isFinite(score) || score < 1) return 'unqualified';
  if (Number(q.false_pass_critical) > 0) return 'unqualified';
  const cp = typeof q.corpus_pass === 'string' ? q.corpus_pass.match(/^(\d+)\/(\d+)$/) : null;
  if (cp && cp[1] === cp[2] && Number(cp[2]) > 0) return 'complete';
  return 'partial';
}

const fresh = matches.filter((m) => isFresh(m.row) && !isImportedPrior(m.row));
const refs = (list) => list.map((m) => m.ref);

if (fresh.length === 0) {
  const priors = matches.filter((m) => isImportedPrior(m.row));
  emit('T2',
    priors.length === matches.length
      ? 'only imported/provisional priors exist — priors never lift above T2'
      : 'qualification evidence exists but the seat currently requires requalification (mechanical no-confidence threshold) or has no admissible baseline — fails closed (calendar dates are advisory only, never decide authority)',
    refs(matches));
}

// The scorecard is append-only, so file order is event order and the LAST fresh
// row is the current qualification state (supersession, not disagreement). The
// reference's conflicting→T2 rule is about two SOURCES disagreeing on the same
// tuple+role; it returns here when engine-capability-state joins as the
// higher-precedence evidence input (references/scaffold-tiers.md, precedence list).
const latest = fresh[fresh.length - 1];
const quality = qualityOf(latest.row);
if (quality === 'complete') {
  emit('T0', 'fresh, complete role qualification — contract-only scaffolding', refs([latest]));
}
if (quality === 'partial') {
  emit('T1', 'fresh but partial role qualification — contract plus obligation checklist', refs([latest]));
}
emit('T2', 'latest fresh record is unqualified for this role — fails closed', refs([latest]));
