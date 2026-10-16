'use strict';
// qualification-record-v2.js — BL-0194 P3. Builds the registry's schema-2 record from one scorecard row
// (the Node twin of llm-playground scripts/eval/import-autopilot-qualification.py v2_record_from_row).
// A row without transcript_hash / producer / observed_at is legacy and returns null: it keeps its own
// basis and is never sent. The record_id is the shared recordIdV1 (parity fixture record-id-parity.json).
const q = require('./qualification-metrics.js');

const SEAT2_KEYS = ['engine', 'model', 'model_version', 'runner', 'role', 'effort', 'family', 'version_source',
  'runner_version', 'harness_version', 'prompt_config_hash', 'corpus_version'];
const ROLE_ALIAS = { planner: 'owner', orchestrator: 'owner', verifier: 'reviewer' };

function evidenceSummary(ev) {
  if (!ev || typeof ev !== 'object' || Object.keys(ev).length === 0) return null;
  const m = ev.methodology && typeof ev.methodology === 'object' ? ev.methodology : {};
  const pick = (k) => (m[k] === undefined ? null : m[k]);
  const g = (k) => (ev[k] === undefined ? null : ev[k]);
  return {
    evidence_id: g('evidence_id'), evidence_hash: g('evidence_hash'), state: g('state'), source: g('source'),
    source_ref: g('source_ref'), scope: g('scope'), scope_hash: g('scope_hash'), identity_hash: g('identity_hash'),
    issued_at: g('issued_at'), observed_at: g('observed_at'), expires_at: g('expires_at'),
    methodology: { kind: pick('kind'), name: pick('name'), version: pick('version'), corpus_version: pick('corpus_version') },
    n_trials: Array.isArray(ev.trials) ? ev.trials.length : null,
    tier1_terminated: g('tier1_terminated'), stop_reason: g('stop_reason'), revocation: g('revocation'),
  };
}

function tsUtc(v) {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.(\d{3})Z$/, (m, ms) => (ms === '000' ? 'Z' : `.${ms}Z`)) : null;
}

/** @returns {object|null} schema-2 record, or null for a legacy row. */
function buildV2Record(row, { originHostClass = 'cloud-api', now } = {}) {
  if (!row || typeof row !== 'object') return null;
  const es = row.evidence_store && typeof row.evidence_store === 'object' ? row.evidence_store : {};
  const ev = evidenceSummary(row.evidence);
  const adm = tsUtc(ev && (ev.observed_at || ev.issued_at));
  if (!es.transcript_hash || !es.producer || !adm) return null;
  let role = row.role;
  let alias = null;
  if (ROLE_ALIAS[role]) { alias = role; role = ROLE_ALIAS[role]; }
  const raw = { ...row, role };
  const seat = {};
  for (const k of SEAT2_KEYS) {
    const v = k === 'role' ? role : row[k];
    if (v !== undefined && v !== null && v !== '') seat[k] = v;
  }
  if (!('effort' in seat)) seat.effort = null;
  if (!seat.model || !seat.model_version || !seat.corpus_version || !seat.prompt_config_hash) return null;
  if (alias) raw.role_alias_of = alias;
  const recordId = q.recordIdV1(es.producer, es.transcript_hash, seat, seat.corpus_version, adm);
  return {
    schema: 2,
    record_id: recordId,
    record_id_basis: 'v1:producer,transcript_hash,seat,corpus_version,administered_at',
    source: { kind: 'autopilot-outbox', file: 'engine-scorecard/scorecard.jsonl' },
    seat,
    verdict: {
      status: row.status, capability_score: row.capability_score === undefined ? null : row.capability_score,
      quality: row.quality === undefined ? null : row.quality, date: row.date,
      qualified_at: row.qualified_at === undefined ? null : row.qualified_at,
      expires: row.expires === undefined ? null : row.expires,
    },
    evidence: ev,
    cost: row.cost === undefined ? null : row.cost,
    latency: row.latency === undefined ? null : row.latency,
    raw,
    imported_at: now || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    importer: 'autopilot-outbox@1',
    producer: es.producer,
    transcript_hash: es.transcript_hash,
    administered_at: adm,
    origin_host_class: originHostClass,
  };
}

/** Strike submission for a failing record (the registry assigns strike_seq). */
function buildStrikeSubmission(record, reason) {
  const s = record.seat;
  return {
    seat: { engine: s.engine, runner: s.runner, role: s.role },
    effort: s.effort === undefined ? null : s.effort,
    reason, record_id: record.record_id, administered_at: record.administered_at,
  };
}

module.exports = { buildV2Record, buildStrikeSubmission, evidenceSummary };
