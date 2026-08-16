#!/usr/bin/env node
'use strict';

/**
 * resolve-scaffold-tier.js — capability-indexed scaffold tier resolution (four-layer P1,
 * docs/plans/2026-08-16-four-layer-redesign.md D4; tier definitions and prompt skeletons:
 * references/scaffold-tiers.md — the single canonical home).
 *
 * Maps {runner, model, role[, effort]} to a scaffold tier from recorded qualification
 * evidence. FAIL-CLOSED: T2 (maximum scaffolding) for missing, unknown, stale,
 * conflicting, or malformed evidence — tiers are earned, never assumed.
 *
 *   T0  fresh + complete qualification for this role  (contract-only prompt)
 *   T1  fresh + partial  qualification for this role  (contract + obligation checklist)
 *   T2  everything else                                (full prescribed process)
 *
 * Evidence source: the engine scorecard (~/.autopilot/engine-scorecard/scorecard.jsonl),
 * the house qualification record written by engine-qualify. Freshness follows the
 * canonical rule in references/scaffold-tiers.md: the record's own `expires` field is
 * the cutoff, and a record without one is STALE (fail-closed) — house rows have
 * carried `expires` since the first onboarding run. Within this one source the
 * LATEST fresh row per tuple is authoritative — an append-only store accumulates
 * requalification history, and supersession is not disagreement. The canonical
 * conflicting→T2 rule concerns two SOURCES disagreeing; it applies once
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

function emit(tier, rationale, refs) {
  process.stdout.write(`${JSON.stringify({
    tier,
    rationale,
    evidence_refs: refs,
    inputs: {
      runner: args.runner, model: args.model, role: args.role,
      effort: args.effort || null,
      scorecard: storePath, freshness: 'record-expires',
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

function isFresh(row) {
  const t = Date.parse(row.expires || '');
  return Number.isFinite(t) && t > now;
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
      : 'qualification evidence exists but is stale (expired or expiry-less) — fails closed',
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
