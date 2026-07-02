#!/usr/bin/env node
'use strict';
// qc-metric-emit — ADDITIVE emitter that appends one QC review event to the P2.1
// measurement store (an append-only JSONL owned by llm-playground/qc-metrics/).
//
// WHY (ROADMAP P2.1): the acceptance-delegation ladder (T0→T1→T2) can only promote a
// task class when we MEASURE the QC panel's escape rate + endorsement rate. This helper
// is the write-side seam so the depth-0 QC panel run and the publish hetero-review run
// CAN record what they saw. It is STRICTLY ADDITIVE — it never gates, blocks, or alters
// any existing review verdict. If no store is configured it is a non-breaking no-op — it
// exits 0 (writing only a one-line diagnostic notice to stderr, never stdout), so wiring
// it into a review flow can never break that flow.
//
// The AUTHORITATIVE validator + calculator live in llm-playground/qc-metrics/qc_metric.py.
// This emitter does a thin fail-closed schema check (enums + required fields) so a
// malformed event never lands in the store, then appends one JSONL line. Schema:
// llm-playground/qc-metrics/schema.md.
//
// APPEND-ONLY, LAST-WRITE-WINS: the store is a log. A change reviewed across stages may be
// re-emitted under the SAME change_id (e.g. depth0 panel, then publish hetero-review with
// the escape added). The calculator collapses the log last-write-wins per change_id, so
// re-emitting the FULL event for a change_id supersedes the earlier record — it is counted
// exactly once. Re-emit the whole event, not a partial delta.
//
// USAGE:
//   Full event:
//     scripts/qc-metric-emit.js --store <path> --event '{"change_id":...}'
//   Assembled from flags:
//     scripts/qc-metric-emit.js --store <path> \
//       --change-id cf-autocite --repo codeforge --base-sha B --head-sha H \
//       --verdict pass --stage depth0_panel --lenses rust,concurrency \
//       --findings '[{"id":"x","severity":"high","lens":"concurrency","verified":"real","caught_at_stage":"publish_hetero_review"}]'
//   Store resolution order: --store  >  $QC_METRIC_STORE  >  (no-op).
//
// EXIT: 0 = appended OR no-op (no store configured); 2 = usage / schema error.

const fs = require('fs');
const path = require('path');

const STAGES = ['depth0_panel', 'publish_hetero_review', 'post_merge', 'cookys_audit'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const VERIFIED = ['real', 'false_positive', 'unverified'];
const VERDICTS = ['pass', 'fail'];
const DEFAULT_VERDICT_STAGE = 'depth0_panel';

const REQUIRED = ['change_id', 'repo', 'base_sha', 'head_sha', 'timestamp', 'lenses', 'findings', 'panel_verdict'];

class SchemaError extends Error {}

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

// --- thin fail-closed validation (mirror of qc_metric.py; python is authoritative) ---
function validateEvent(ev) {
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
    throw new SchemaError('event must be an object');
  }
  for (const f of REQUIRED) {
    if (!(f in ev)) throw new SchemaError(`missing required field: ${f}`);
  }
  for (const f of ['change_id', 'repo', 'base_sha', 'head_sha', 'timestamp']) {
    if (typeof ev[f] !== 'string' || ev[f] === '') {
      throw new SchemaError(`field ${f} must be a non-empty string`);
    }
  }
  if (!Array.isArray(ev.lenses) || !ev.lenses.every((x) => typeof x === 'string')) {
    throw new SchemaError("field 'lenses' must be a list of strings");
  }
  if (!VERDICTS.includes(ev.panel_verdict)) {
    throw new SchemaError(`panel_verdict must be one of ${VERDICTS.join('|')}`);
  }
  const verdictStage = ev.verdict_stage || DEFAULT_VERDICT_STAGE;
  if (!STAGES.includes(verdictStage)) {
    throw new SchemaError(`verdict_stage must be one of ${STAGES.join('|')}`);
  }
  if (!Array.isArray(ev.findings)) throw new SchemaError("field 'findings' must be a list");
  ev.findings.forEach((f, i) => {
    if (f === null || typeof f !== 'object') throw new SchemaError(`findings[${i}] must be an object`);
    for (const k of ['id', 'severity', 'lens', 'verified', 'caught_at_stage']) {
      if (!(k in f)) throw new SchemaError(`findings[${i}] missing field: ${k}`);
    }
    if (typeof f.id !== 'string' || f.id === '') throw new SchemaError(`findings[${i}].id must be a non-empty string`);
    if (!SEVERITIES.includes(f.severity)) throw new SchemaError(`findings[${i}].severity must be one of ${SEVERITIES.join('|')}`);
    if (typeof f.lens !== 'string' || f.lens === '') throw new SchemaError(`findings[${i}].lens must be a non-empty string`);
    if (!VERIFIED.includes(f.verified)) throw new SchemaError(`findings[${i}].verified must be one of ${VERIFIED.join('|')}`);
    if (!STAGES.includes(f.caught_at_stage)) throw new SchemaError(`findings[${i}].caught_at_stage must be one of ${STAGES.join('|')}`);
  });
  if ('escapes' in ev) {
    if (!Array.isArray(ev.escapes)) throw new SchemaError("field 'escapes' must be a list when present");
    ev.escapes.forEach((e, i) => {
      if (e === null || typeof e !== 'object' || !('defect' in e) || !('found_at_stage' in e)) {
        throw new SchemaError(`escapes[${i}] must have 'defect' and 'found_at_stage'`);
      }
      if (!STAGES.includes(e.found_at_stage)) throw new SchemaError(`escapes[${i}].found_at_stage must be one of ${STAGES.join('|')}`);
    });
  }
  if ('autonomous' in ev && typeof ev.autonomous !== 'boolean') {
    throw new SchemaError("field 'autonomous' must be a boolean when present");
  }
  if ('endorsed' in ev && !(ev.endorsed === true || ev.endorsed === false || ev.endorsed === null)) {
    throw new SchemaError("field 'endorsed' must be true, false, or null when present");
  }
  return ev;
}

// Build an event object from parsed CLI flags.
function buildEvent(opts) {
  const ev = {
    change_id: opts['change-id'],
    repo: opts.repo,
    base_sha: opts['base-sha'],
    head_sha: opts['head-sha'],
    timestamp: opts.timestamp || nowIso(),
    lenses: opts.lenses ? String(opts.lenses).split(',').map((s) => s.trim()).filter(Boolean) : [],
    panel_verdict: opts.verdict,
    findings: opts.findings ? JSON.parse(opts.findings) : [],
  };
  if (opts.stage) ev.verdict_stage = opts.stage;
  if (opts.escapes) ev.escapes = JSON.parse(opts.escapes);
  if ('autonomous' in opts) ev.autonomous = opts.autonomous === true || opts.autonomous === 'true';
  if ('endorsed' in opts) {
    ev.endorsed = opts.endorsed === 'null' ? null : opts.endorsed === true || opts.endorsed === 'true';
  }
  return ev;
}

// Resolve the store path: explicit --store, then $QC_METRIC_STORE, else null (no-op).
function resolveStore(opts, env) {
  return opts.store || env.QC_METRIC_STORE || null;
}

// Append one validated event as a JSONL line. Returns the resolved store path.
function emit(storePath, event) {
  validateEvent(event);
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const keys = Object.keys(event).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = event[k];
  fs.appendFileSync(storePath, JSON.stringify(ordered) + '\n', 'utf8');
  return storePath;
}

// --- CLI ---
function parseArgv(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'autonomous') { opts.autonomous = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { opts[key] = true; } else { opts[key] = next; i++; }
  }
  return opts;
}

function main(argv, env, out, err) {
  env = env || process.env;
  out = out || ((s) => process.stdout.write(s + '\n'));
  err = err || ((s) => process.stderr.write(s + '\n'));
  const opts = parseArgv(argv);

  if (opts.help) {
    out('qc-metric-emit.js — append one QC review event to the P2.1 store (additive).');
    out('  --store <path> | $QC_METRIC_STORE   target JSONL store (no store => no-op)');
    out('  --event <json>                       full event object, OR assemble from flags:');
    out('  --change-id --repo --base-sha --head-sha --verdict pass|fail');
    out('  --stage <verdict_stage> --lenses a,b --findings <json> --escapes <json>');
    out('  --autonomous --endorsed true|false|null --timestamp <iso>');
    return 0;
  }

  const store = resolveStore(opts, env);
  if (!store) {
    err('qc-metric-emit: no store configured ($QC_METRIC_STORE or --store) — no-op.');
    return 0; // additive: never break the caller's review flow
  }

  let event;
  try {
    event = opts.event ? JSON.parse(opts.event) : buildEvent(opts);
  } catch (e) {
    err(`qc-metric-emit: cannot build event: ${e.message}`);
    return 2;
  }
  try {
    emit(store, event);
  } catch (e) {
    err(`qc-metric-emit: schema error: ${e.message}`);
    return 2;
  }
  out(`qc-metric-emit: appended change_id=${event.change_id} to ${store}`);
  return 0;
}

module.exports = { validateEvent, buildEvent, resolveStore, emit, parseArgv, main, SchemaError, STAGES, SEVERITIES, VERIFIED, VERDICTS };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
