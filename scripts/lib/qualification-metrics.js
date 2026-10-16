'use strict';

/**
 * qualification-metrics.js — READ side of the registry's sibling `qualification-metrics.json`
 * (schema `model-dyno.qualification-metrics.v2`), BL-0194 P2.
 *
 * AUTHORITY (plan 2026-10-16-bl0194-qualification-registry-move.md section 2 and 5):
 *   - Metrics only ORDER seats that local evidence has already admitted. Nothing in this file
 *     admits, denies, lifts, un-admits or creates a seat. `orderAdmittedSeats` returns a
 *     permutation of its input and nothing else.
 *   - The feed's `strike_events` are disclosure: `reconcileStrikeDisclosure` reports differences
 *     and returns the local strikes untouched. A feed `qualified` with no local row admits nothing
 *     (`admissionView` is the local set, always). A row that arrived from the feed is never local
 *     evidence.
 *   - A missing, stale, hostile or unreachable document degrades to today's order. It never throws
 *     into an admission path: `loadMetrics` reports `error`, it does not raise for a fetch failure.
 *
 * Nothing here is signed or attested (ADR-0001); `digest` is a cache key.
 *
 * The admission code (engine-scorecard.js, resolve-review-loop.sh, adopt-qualification-defaults.js)
 * must never require this module; qualification-metrics.test.js enforces that.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const { validateJsonSchema, preflightJsonSource } = require('../validate-json-schema.js');
const feedLib = require('./qualification-feed.js');

const METRICS_SCHEMA_ID = 'model-dyno.qualification-metrics.v2';
const METRICS_FILE_NAME = 'qualification-metrics.json';
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_AGE_S = 7 * 24 * 3600;
const EXPIRED_ADVISORY_AGE_S = 90 * 24 * 3600;
const SEAT6_FIELDS = ['engine', 'model', 'model_version', 'runner', 'role', 'effort'];
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const METRICS_SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'qualification-feed-v2.schema.json');
const RECORD_SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'qualification-record.schema.json');

// ── canonical keys (cross-language parity with llm-playground check_qualification_feed.py) ──

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function seat6(seat) {
  const out = {};
  for (const key of SEAT6_FIELDS) out[key] = seat[key];
  return out;
}

function recordIdV1(producer, transcriptHash, seat, corpusVersion, administeredAt) {
  return sha256Hex(canonicalJson([producer, transcriptHash, seat6(seat), corpusVersion, administeredAt]));
}

function entryId(seat, kind, instrumentId, windowEnd) {
  return sha256Hex(canonicalJson([seat6(seat), kind, instrumentId, windowEnd]));
}

function strikeId(seat, effort, reason, administeredAt, recordId) {
  return sha256Hex(canonicalJson([seat, effort, reason, administeredAt, recordId]));
}

// round-half-up of num/den for non-negative integers, no floats.
function roundHalfUp(num, den) {
  return Math.floor((2 * num + den) / (2 * den));
}

// ── validation: schema layer (vendored schema) + the semantic lint the schema cannot express ──

function loadSchema(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function tsKey(ts) {
  const [base, frac = ''] = ts.slice(0, -1).split('.');
  return `${base}|${frac.padEnd(3, '0')}`;
}

function checkEntries(entries) {
  const out = [];
  const seen = new Map();
  entries.forEach((e, n) => {
    const p = `seat_metrics[${n}]`;
    if (e.entry_id !== entryId(e.seat, e.kind, e.instrument_id, e.window_end)) {
      out.push(['ENTRY_ID_MISMATCH', `${p}: entry_id is not sha256 of [seat, kind, instrument_id, window_end]`]);
    }
    if (seen.has(e.entry_id)) {
      const same = canonicalJson(seen.get(e.entry_id)) === canonicalJson(e);
      out.push([same ? 'ENTRY_ID_DUPLICATE' : 'ENTRY_ID_CONFLICT',
        `${p}: entry_id ${e.entry_id.slice(0, 12)} already used with ${same ? 'identical' : 'conflict'} payload`]);
    } else {
      seen.set(e.entry_id, e);
    }
    if (e.kind === 'benchmark_observation') out.push(...checkBenchmark(p, e));
    if (e.join.board_join === 'mapped' && !e.join.board_cell) {
      out.push(['DERIVED_MISMATCH', `${p}.join: mapped without board_cell`]);
    }
  });
  return out;
}

function checkBenchmark(p, e) {
  const out = [];
  const b = e.benchmark;
  const s = e.speed;
  const c = e.cost;
  const sm = e.sampling;
  const bad = (msg) => out.push(['DERIVED_MISMATCH', `${p}: ${msg}`]);
  // population=latest_per_task (board keeps only the newest attempt per task): n_attempts and
  // n_timeout are null, and they are NOT the count of all attempts. Attempt-based derivations are
  // skipped for null counts; the reader never substitutes a number for them.
  if (b.n_attempts === null || b.n_attempts === undefined) return out;
  if (b.n_attempts < b.n_tasks * b.n_trials) bad('n_attempts < n_tasks*n_trials');
  if (b.n_pass > b.n_attempts || (b.n_timeout !== null && b.n_timeout > b.n_attempts)) bad('n_pass or n_timeout exceeds n_attempts');
  if (b.n_timeout !== null && b.n_pass + b.n_timeout > b.n_attempts) bad('n_pass + n_timeout exceeds n_attempts');
  const wantRate = b.n_attempts ? roundHalfUp(1000 * b.n_pass, b.n_attempts) : null;
  if (b.pass_rate_permille !== wantRate) bad(`pass_rate_permille ${b.pass_rate_permille} != ${wantRate}`);
  const lo = b.ci_low_permille;
  const hi = b.ci_high_permille;
  const pr = b.pass_rate_permille;
  if ((lo === null) !== (pr === null) || (hi === null) !== (pr === null)) {
    bad('ci bounds must be null exactly when pass_rate_permille is null');
  } else if (pr !== null && !(lo >= 0 && lo <= pr && pr <= hi && hi <= 1000)) {
    bad('expect 0 <= ci_low <= pass_rate <= ci_high <= 1000');
  }
  const wantSph = s.wall_s_total ? roundHalfUp(b.n_pass * 3_600_000, s.wall_s_total) : null;
  if (s.solved_per_hour_milli !== wantSph) bad(`solved_per_hour_milli ${s.solved_per_hour_milli} != ${wantSph}`);
  if (!s.wall_s_total && s.tasks_per_hour_milli !== null) {
    bad('tasks_per_hour_milli must be null when wall_s_total is null or 0');
  }
  const [a, z] = s.speed_basis.split('..');
  if (a !== sm.window_start || z !== e.window_end || !(tsKey(a) <= tsKey(z))) {
    bad("speed_basis must be 'window_start..window_end' with window_start <= window_end");
  }
  if (sm.low_n !== (b.n_trials < 5)) bad('sampling.low_n must equal (n_trials < 5)');
  if (c.cost_total_micro !== null && c.usd_per_task_micro !== roundHalfUp(c.cost_total_micro, b.n_attempts)) {
    bad('usd_per_task_micro must be round-half-up(cost_total_micro / n_attempts)');
  }
  if (c.cost_coverage_permille > 1000) bad('cost_coverage_permille > 1000');
  if (['billed', 'estimated'].includes(c.cost_basis) && c.cost_coverage_permille === 0
    && ['usd_per_solved_micro', 'usd_per_task_micro', 'cost_total_micro'].some((k) => c[k] !== null)) {
    bad('cost amounts present with coverage 0 (unknown must be null, never a number)');
  }
  return out;
}

function checkStrikes(strikes) {
  const out = [];
  const ids = new Map();
  const lastSeq = new Map();
  const seqs = new Map();
  strikes.forEach((s, n) => {
    const p = `strike_events[${n}]`;
    if (s.strike_id !== strikeId(s.seat, s.effort, s.reason, s.administered_at, s.record_id)) {
      out.push(['STRIKE_ID_MISMATCH', `${p}: strike_id is not sha256 of [seat, effort, reason, administered_at, record_id]`]);
    }
    if (ids.has(s.strike_id)) {
      const same = canonicalJson(ids.get(s.strike_id)) === canonicalJson(s);
      out.push([same ? 'STRIKE_ID_DUPLICATE' : 'STRIKE_ID_CONFLICT', `${p}: strike_id already used`]);
    } else {
      ids.set(s.strike_id, s);
    }
    const key = JSON.stringify([s.seat.engine, s.seat.runner, s.seat.role, s.effort]);
    if (!seqs.has(key)) seqs.set(key, new Set());
    if (seqs.get(key).has(s.strike_seq)) {
      out.push(['STRIKE_SEQ_DUPLICATE', `${p}: strike_seq ${s.strike_seq} repeated for seat ${key}`]);
    } else if (s.strike_seq <= (lastSeq.get(key) || 0)) {
      out.push(['STRIKE_SEQ_ORDER', `${p}: strike_seq ${s.strike_seq} not above previous for seat ${key}`]);
    }
    seqs.get(key).add(s.strike_seq);
    lastSeq.set(key, Math.max(lastSeq.get(key) || 0, s.strike_seq));
  });
  strikes.forEach((s, n) => {
    if (s.lifted_by !== null && !ids.has(s.lifted_by)) {
      out.push(['LIFTED_BY_DANGLING', `strike_events[${n}]: lifted_by names no strike_id in this document`]);
    }
  });
  return out;
}

function checkRecordSemantics(rec) {
  if (rec.schema === 2
    && rec.record_id !== recordIdV1(rec.producer, rec.transcript_hash, rec.seat, rec.seat.corpus_version, rec.administered_at)) {
    return [['RECORD_ID_MISMATCH', 'record_id is not the v1 hash of its own fields']];
  }
  return [];
}

function parseStrict(raw, schemaFile, semantic, maxBytes, semanticFn) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
  if (maxBytes !== null && bytes.length > maxBytes) {
    return { errors: [['OVERSIZE', `${bytes.length} bytes > cap ${maxBytes}`]], doc: null };
  }
  let doc;
  try {
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    try {
      preflightJsonSource(source, 'document');
    } catch (error) {
      return { errors: [['STRICT_JSON', error.message]], doc: null };
    }
    doc = JSON.parse(source);
  } catch (error) {
    return { errors: [['BAD_JSON', error.message]], doc: null };
  }
  const result = validateJsonSchema(loadSchema(schemaFile), doc);
  if (!result.valid) return { errors: result.errors.map((m) => ['SCHEMA', String(m.message || m)]), doc };
  return { errors: semantic ? semanticFn(doc) : [], doc };
}

/** Returns { errors: [[code, message]], doc }. Empty errors = accepted. */
function validateMetrics(raw, { maxBytes = DEFAULT_MAX_BYTES, semantic = true } = {}) {
  return parseStrict(raw, METRICS_SCHEMA_PATH, semantic, maxBytes,
    (doc) => [...checkEntries(doc.seat_metrics), ...checkStrikes(doc.strike_events)]);
}

function validateRecord(raw, { semantic = true } = {}) {
  return parseStrict(raw, RECORD_SCHEMA_PATH, semantic, null, checkRecordSemantics);
}

// ── ages ──

/**
 * Age of an ISO timestamp. Missing/unparsable => 'unknown'; later than `now` => 'clock-skew'.
 * @returns {{ age_s: number|null, label: 'ok'|'unknown'|'clock-skew' }}
 */
function ageOf(iso, nowMs) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return { age_s: null, label: 'unknown' };
  const age = Math.floor((nowMs - t) / 1000);
  if (age < 0) return { age_s: null, label: 'clock-skew' };
  return { age_s: age, label: 'ok' };
}

/**
 * Status of a cached metrics document. Pure: warnings are derived here, from the two ages.
 * Past maxAgeS either age => a warning, the document is STILL served; past 90 days the label is
 * `expired-advisory`, still served. Never blocks.
 */
function describeAges(manifest, nowIso, { maxAgeS = DEFAULT_MAX_AGE_S } = {}) {
  const nowMs = Date.parse(nowIso);
  const fetched = ageOf(manifest && manifest.fetched_at, nowMs);
  const producer = ageOf(manifest && manifest.generated_at, nowMs);
  const warnings = [];
  const labels = [];
  for (const [name, a] of [['fetch', fetched], ['producer', producer]]) {
    if (a.label !== 'ok') labels.push(`${name}_age:${a.label}`);
    if (a.age_s !== null && (maxAgeS === 0 || a.age_s > maxAgeS)) {
      warnings.push(`${name}_age_s ${a.age_s} exceeds max_age_s ${maxAgeS}: metrics are stale, still used for ordering only`);
    }
    if (a.age_s !== null && a.age_s > EXPIRED_ADVISORY_AGE_S) labels.push(`${name}_age:expired-advisory`);
  }
  return {
    fetch_age_s: fetched.age_s,
    producer_age_s: producer.age_s,
    fetch_age_label: fetched.label,
    producer_age_label: producer.label,
    labels,
    warnings,
  };
}

// ── cache: <cacheDir>/metrics/<digest>/metrics.json + <cacheDir>/metrics/current.json ──

function metricsCacheRoot(cacheDir) {
  return path.join(path.resolve(cacheDir), 'metrics');
}

/** The sibling document of a feed: same URL or directory, basename qualification-metrics.json. */
function siblingMetricsSource(feedFrom) {
  if (typeof feedFrom !== 'string' || feedFrom.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(feedFrom)) {
    const url = new URL(feedFrom);
    url.pathname = url.pathname.replace(/[^/]*$/, METRICS_FILE_NAME);
    url.search = '';
    url.hash = '';
    return url.toString();
  }
  return path.join(path.dirname(path.resolve(expandTilde(feedFrom))), METRICS_FILE_NAME);
}

function expandTilde(p) {
  if (p === '~' || p.startsWith('~/')) return path.join(require('os').homedir(), p.slice(1));
  return p;
}

function readCurrent(cacheDir) {
  const file = path.join(metricsCacheRoot(cacheDir), 'current.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readCachedDocument(cacheDir) {
  const manifest = readCurrent(cacheDir);
  if (!manifest || typeof manifest.digest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.digest)) return null;
  try {
    const bytes = fs.readFileSync(path.join(metricsCacheRoot(cacheDir), manifest.digest, 'metrics.json'));
    // A cache entry is re-validated on every read: the cache is a file on disk, not a trusted store.
    const { errors, doc } = validateMetrics(bytes);
    if (errors.length) return { manifest, doc: null, errors };
    return { manifest, doc, errors: [] };
  } catch {
    return null;
  }
}

function writeCache(cacheDir, bytes, doc, from, nowIso) {
  const root = metricsCacheRoot(cacheDir);
  feedLib.assertOutsideGit(root, 'qualification metrics cache');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const dir = path.join(root, digest);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'metrics.json');
  if (!fs.existsSync(file)) {
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  // generated_at comes from the DOCUMENT, so refetching an old document keeps reporting its old
  // producer age; fetched_at is when WE fetched.
  const manifest = {
    schema_version: 1,
    digest,
    origin: from,
    fetched_at: nowIso,
    generated_at: doc.generated_at,
    n_seat_metrics: doc.seat_metrics.length,
    n_strike_events: doc.strike_events.length,
  };
  const cur = path.join(root, 'current.json');
  const tmpCur = `${cur}.tmp.${process.pid}`;
  fs.writeFileSync(tmpCur, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpCur, cur);
  return manifest;
}

/**
 * Fetch the sibling metrics document of `feedFrom`, validate, cache. NEVER throws: any failure
 * returns `{ ok: false, error }` and the caller keeps whatever `readStatus` finds in the cache.
 * Never adopts, never writes a scorecard or a strike.
 */
async function fetchMetrics(feedFrom, {
  cacheDir = feedLib.defaultCacheDir(),
  fetchImpl = globalThis.fetch,
  now = new Date().toISOString(),
} = {}) {
  try {
    const from = siblingMetricsSource(feedFrom);
    if (!from) return { ok: false, error: 'no feed source to derive the metrics document from' };
    const { bytes, origin } = await feedLib.readFeedSource(from, { fetchImpl });
    const { errors, doc } = validateMetrics(bytes);
    if (errors.length) {
      return { ok: false, error: `metrics document rejected: ${errors.map(([c, m]) => `${c}: ${m}`).slice(0, 3).join('; ')}` };
    }
    const manifest = writeCache(cacheDir, bytes, doc, origin, now);
    return { ok: true, manifest, doc };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

/** Cache-only status (no network). `doc` is null when nothing usable is cached. */
function readStatus({ cacheDir = feedLib.defaultCacheDir(), now = new Date().toISOString(), maxAgeS = DEFAULT_MAX_AGE_S } = {}) {
  const cached = readCachedDocument(cacheDir);
  if (!cached) {
    return { present: false, doc: null, manifest: null, fetch_age_s: null, producer_age_s: null, labels: ['absent'], warnings: [], errors: [] };
  }
  if (!cached.doc) {
    return { present: false, doc: null, manifest: cached.manifest, fetch_age_s: null, producer_age_s: null, labels: ['cache-invalid'], warnings: [], errors: cached.errors };
  }
  const ages = describeAges({ ...cached.manifest, generated_at: cached.doc.generated_at }, now, { maxAgeS });
  return { present: true, doc: cached.doc, manifest: cached.manifest, ...ages, errors: [] };
}

// ── use 1: ordering among ALREADY-ADMITTED seats ──

function seatMatches(admitted, entrySeat) {
  for (const key of SEAT6_FIELDS) {
    if (admitted[key] === undefined) continue;
    if (admitted[key] !== entrySeat[key]) return false; // effort null !== 'default'
  }
  return true;
}

/**
 * Benchmark rows after the reader's dedupe rule: one row per (board_cell, instrument_id,
 * window_end), because one board cell appears once per seat that maps to it. Unmapped rows are
 * dropped (shown elsewhere, never ranked). Deterministic: lowest entry_id wins a cell.
 */
function dedupeBenchmarkRows(doc) {
  const byCell = new Map();
  const rows = doc.seat_metrics
    .filter((e) => e.kind === 'benchmark_observation' && e.join.board_join === 'mapped')
    .sort((a, b) => (a.entry_id < b.entry_id ? -1 : 1));
  for (const e of rows) {
    const key = JSON.stringify([e.join.board_cell, e.instrument_id, e.window_end]);
    if (!byCell.has(key)) byCell.set(key, e);
  }
  return [...byCell.values()];
}

// Newest row by window_end.
function latestOf(rows) {
  let best = null;
  for (const e of rows) if (!best || tsKey(e.window_end) > tsKey(best.window_end)) best = e;
  return best;
}

/**
 * The benchmark observation for ONE seat. Dedupe is for aggregating, not for lookup: a board cell
 * appears once per seat mapped to it, and collapsing those rows would leave every seat but one
 * without data. So: the seat's own benchmark row first; else the observation of the board cell the
 * seat is mapped to (any mapped entry of that seat names the cell). Unmapped seats get nothing.
 */
function metricFor(seat, doc) {
  const mapped = doc.seat_metrics.filter((e) => e.join.board_join === 'mapped' && seatMatches(seat, e.seat));
  const own = latestOf(mapped.filter((e) => e.kind === 'benchmark_observation'));
  if (own) return own;
  const cells = new Set(mapped.map((e) => e.join.board_cell));
  return latestOf(dedupeBenchmarkRows(doc).filter((e) => cells.has(e.join.board_cell)));
}

/**
 * Order already-admitted seats by metrics: speed (solved/hour, high first), pass rate (high
 * first), cost per solved (low first). null = unknown: after every known value, never 0. Ties and
 * seats without a metrics row keep their input order. The result is a PERMUTATION of `admitted`:
 * same length, same objects. With `doc` null the result equals the input order.
 */
function orderAdmittedSeats(admitted, doc) {
  const input = admitted.slice();
  if (!doc) return input;
  const keyed = input.map((seat, index) => {
    const e = metricFor(seat, doc);
    return {
      seat,
      index,
      speed: e ? e.speed.solved_per_hour_milli : null,
      pass: e ? e.benchmark.pass_rate_permille : null,
      cost: e ? e.cost.usd_per_solved_micro : null,
    };
  });
  const desc = (a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  };
  const asc = (a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  };
  keyed.sort((x, y) => desc(x.speed, y.speed) || desc(x.pass, y.pass) || asc(x.cost, y.cost) || x.index - y.index);
  return keyed.map((k) => k.seat);
}

// ── use 2: authority rules (plan section 5) ──

/**
 * What the metrics document says about seats vs. what the LOCAL store holds. Report only.
 * `local_admitted` is the input, verbatim: a feed `qualified` with no local row is listed as
 * `feed_only_claims` and admits nothing.
 */
function admissionView(localAdmittedSeats, doc) {
  const local = localAdmittedSeats.slice();
  const claims = doc
    ? doc.seat_metrics.filter((e) => e.kind === 'qualification' && e.qualification.status === 'qualified')
    : [];
  const feedOnly = claims
    .filter((e) => !local.some((s) => seatMatches(s, e.seat)))
    .map((e) => ({ seat: e.seat, record_id: e.qualification.record_id }));
  return { local_admitted: local, feed_only_claims: feedOnly };
}

/**
 * Compare feed strike_events with LOCAL strikes. Disclosure only: `local` is returned as given
 * (same array, same objects), never merged, lifted or rewritten. A feed lift (`lifted_by`) of a
 * strike the local store holds is reported as `feed_lifts_local`, nothing more.
 */
function reconcileStrikeDisclosure(localStrikes, strikeEvents, localStrikeId = (s) => s.strike_id) {
  const localIds = new Set(localStrikes.map(localStrikeId));
  const feedIds = new Set(strikeEvents.map((s) => s.strike_id));
  return {
    local: localStrikes,
    feed_only: strikeEvents.filter((s) => !localIds.has(s.strike_id)).map((s) => s.strike_id),
    local_only: [...localIds].filter((id) => id !== undefined && !feedIds.has(id)),
    feed_lifts_local: strikeEvents.filter((s) => s.lifted_by !== null && localIds.has(s.strike_id)).map((s) => s.strike_id),
  };
}

module.exports = {
  METRICS_SCHEMA_ID,
  METRICS_FILE_NAME,
  DEFAULT_MAX_AGE_S,
  EXPIRED_ADVISORY_AGE_S,
  canonicalJson,
  recordIdV1,
  entryId,
  strikeId,
  roundHalfUp,
  validateMetrics,
  validateRecord,
  ageOf,
  describeAges,
  siblingMetricsSource,
  fetchMetrics,
  readStatus,
  dedupeBenchmarkRows,
  metricFor,
  orderAdmittedSeats,
  admissionView,
  reconcileStrikeDisclosure,
};
