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
    issued_at: g('issued_at'), observed_at: g('observed_at'),
    methodology: { kind: pick('kind'), name: pick('name'), version: pick('version'), corpus_version: pick('corpus_version') },
    n_trials: Array.isArray(ev.trials) ? ev.trials.length : null,
    tier1_terminated: g('tier1_terminated'), stop_reason: g('stop_reason'), revocation: g('revocation'),
  };
}

function daysInMonth(year, month) {
  if (month === 2) return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Same gate as llm-playground v2_record_from_row. The rule mirrors llm-playground ts_utc
// (truncation to milliseconds): YYYY-MM-DDTHH:MM:SS(.f 1-9)?(Z|+HH:MM|-HH:MM) or date-only YYYY-MM-DD.
// Impossible calendar dates throw. Non-strings stay null. Output is UTC, millisecond precision, .000 dropped.
function tsUtc(v) {
  if (typeof v !== 'string') return null;
  const bad = () => { throw new Error(`tsUtc: rejected ${JSON.stringify(v)}`); };
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const mo = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) bad();
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(v);
  if (!m) bad();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  const frac = m[7] || '';
  const zone = m[8];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) bad();
  let offMin = 0;
  if (zone !== 'Z') {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 23 || om > 59) bad();
    offMin = (zone[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const ms3 = frac ? Number((frac + '000').slice(0, 3)) : 0;
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi - offMin, s, ms3);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const base = `${p(dt.getUTCFullYear(), 4)}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
  const milli = dt.getUTCMilliseconds();
  return milli === 0 ? `${base}Z` : `${base}.${p(milli, 3)}Z`;
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

module.exports = { buildV2Record, buildStrikeSubmission, evidenceSummary, tsUtc };
