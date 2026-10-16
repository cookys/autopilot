'use strict';

/**
 * qualification-prices.js — seat unit prices: validate, cache, look up, order.
 *
 * WHY: the implementer ladder (resolve-dispatch-topology.js) ranks by effort and then falls
 * through to latency, so seats at the same depth were indistinguishable by cost (BL-0024).
 * The price document is published by model-dyno (schema "model-dyno.model-prices.v1"); this
 * module is the READ side. Producer joins prices to autopilot seats; the reader only does
 * EXACT equality on (engine, runner, model). No substring or longest-prefix matching.
 *
 * Posture (ADR-0001): the document is untrusted input. A document that fails any check is
 * rejected whole and the previous cache stays. Nothing here is a trust claim; the cache digest
 * is a cache key. Prices are advisory ordering input: stale or missing data warns, never blocks.
 *
 * Fetching/caching reuses scripts/lib/qualification-feed.js (https-only, no redirects, bounded
 * size and time, refuses a cache inside a git work tree). Dispatch paths call only the sync
 * readers here (cache only, no network).
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const feed = require('./qualification-feed.js');
const metrics = require('./qualification-metrics.js');
const { preflightJsonSource } = require('../validate-json-schema.js');

const PRICES_SCHEMA_ID = 'model-dyno.model-prices.v1';
const DEFAULT_PRICES_URL = 'https://cookys.github.io/model-dyno/public-bundles/model-prices.json';
const PRICE_FIELDS = ['usd_per_mtok_input_micro', 'usd_per_mtok_output_micro', 'usd_per_mtok_cache_read_micro'];
const BILLING = ['metered', 'subscription'];
const BASIS = ['sourced', 'assumed'];
const MAX_PERCENT_DECODE_ROUNDS = 8;

function priceError(message) {
  const error = new Error(message);
  error.name = 'QualificationPricesError';
  return error;
}

function defaultCacheDir() {
  if (process.env.AUTOPILOT_PRICES_CACHE_DIR) return path.resolve(process.env.AUTOPILOT_PRICES_CACHE_DIR);
  return path.join(os.homedir(), '.autopilot', 'qualification-prices');
}

/** Returns a problem string, or null when `value` is an acceptable source_url. */
function sourceUrlProblem(value) {
  if (typeof value !== 'string' || value.length === 0) return 'source_url must be a non-empty string';
  if (value.includes('?') || value.includes('#')) return 'source_url must not carry a query or fragment';
  let url;
  try { url = new URL(value); } catch { return 'source_url is not a valid URL'; }
  if (url.protocol !== 'https:') return 'source_url must be https';
  if (url.username !== '' || url.password !== '') return 'source_url must not carry userinfo';
  if (url.search !== '' || url.hash !== '') return 'source_url must not carry a query or fragment';
  // Dot-segments, checked after percent-decoding to a fixed point (%2e%2e, %252e%252e, ...).
  // Both slash spellings count, since a decoded %5c is a separator to some consumers.
  // Taken from the RAW string: new URL().pathname has already collapsed `a/../x` and `%2e%2e`.
  const rawPath = /^https:\/\/[^/]*(.*)$/i.exec(value);
  let text = rawPath ? rawPath[1] : url.pathname;
  for (let round = 0; ; round += 1) {
    if (round > MAX_PERCENT_DECODE_ROUNDS) return 'source_url is percent-encoded too deeply';
    const segments = text.split(/[\\/]/);
    if (segments.some((s) => s === '.' || s === '..')) return 'source_url must not contain dot-segments';
    let decoded;
    try { decoded = decodeURIComponent(text); } catch { return 'source_url has invalid percent-encoding'; }
    if (decoded === text) break;
    text = decoded;
  }
  return null;
}

function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)); }

/**
 * Validate a parsed prices document. Throws QualificationPricesError on the first problem:
 * the whole document is refused, never partially accepted.
 */
function validatePrices(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw priceError('prices document must be a JSON object');
  if (doc.schema !== PRICES_SCHEMA_ID) throw priceError(`prices schema must be "${PRICES_SCHEMA_ID}"`);
  if (!isNonEmptyString(doc.generated_at) || !Number.isFinite(Date.parse(doc.generated_at))) {
    throw priceError('generated_at must be an ISO timestamp');
  }
  if (doc.stale_after_days !== undefined && !(Number.isSafeInteger(doc.stale_after_days) && doc.stale_after_days > 0)) {
    throw priceError('stale_after_days must be a positive integer');
  }
  if (!Array.isArray(doc.rows)) throw priceError('rows must be an array');
  const seen = new Set();
  doc.rows.forEach((row, i) => {
    const at = `rows[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw priceError(`${at} must be an object`);
    for (const k of ['engine', 'runner', 'model']) {
      if (!isNonEmptyString(row[k])) throw priceError(`${at}.${k} must be a non-empty string`);
    }
    if (row.model_ref !== undefined && typeof row.model_ref !== 'string') throw priceError(`${at}.model_ref must be a string`);
    for (const f of PRICE_FIELDS) {
      const v = row[f];
      if (v === null) continue;
      if (!(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)) {
        throw priceError(`${at}.${f} must be a non-negative integer (below 2^53) or null`);
      }
    }
    if (!BILLING.includes(row.billing)) throw priceError(`${at}.billing must be metered or subscription`);
    if (!BASIS.includes(row.effective_basis)) throw priceError(`${at}.effective_basis must be sourced or assumed`);
    if (!isNonEmptyString(row.effective)) throw priceError(`${at}.effective must be a non-empty string`);
    if (!isDay(row.verified)) throw priceError(`${at}.verified must be a YYYY-MM-DD date`);
    const problem = sourceUrlProblem(row.source_url);
    if (problem) throw priceError(`${at}: ${problem}`);
    const key = seatKey(row.engine, row.runner, row.model);
    if (seen.has(key)) throw priceError(`${at} duplicates seat ${row.engine}/${row.runner}/${row.model}`);
    seen.add(key);
  });
  return doc;
}

function seatKey(engine, runner, model) {
  return JSON.stringify([engine, runner, model]);
}

function parsePrices(body) {
  let doc;
  try {
    preflightJsonSource(body, 'prices document');
    doc = JSON.parse(body);
  } catch (err) {
    throw priceError(`prices document is not valid JSON (${err.message})`);
  }
  return validatePrices(doc);
}

/** Index rows by exact (engine, runner, model). */
function indexPrices(doc) {
  const map = new Map();
  for (const row of doc.rows) map.set(seatKey(row.engine, row.runner, row.model), row);
  return map;
}

/**
 * Unit price in micro-USD per Mtok (input + output) for one seat, or null when unknown.
 * Unknown: no exact row, `assumed` basis, or either of input/output is null. Never 0 for unknown.
 * A subscription row uses its retail-converted price (shared quota is not free).
 */
function priceMicro(index, seat) {
  if (!index || !seat) return null;
  const row = index.get(seatKey(seat.engine, seat.runner, seat.model || seat.engine));
  if (!row || row.effective_basis !== 'sourced') return null;
  const inp = row.usd_per_mtok_input_micro;
  const out = row.usd_per_mtok_output_micro;
  if (typeof inp !== 'number' || typeof out !== 'number') return null;
  return inp + out;
}

/** Sort key: known price ascending, unknown last (same semantics as engine-scorecard costSortValue). */
function sortValue(index, seat) {
  const p = priceMicro(index, seat);
  return p === null ? Infinity : p;
}

function pricesFile(cacheDir, digest) {
  return path.join(cacheDir, digest, 'prices.json');
}

/** Persist a validated document: <cache>/<digest>/prices.json plus current.json. Atomic renames. */
function writeCache(cacheDir, body, bytes, doc, origin, nowIso) {
  const root = path.resolve(cacheDir);
  feed.assertOutsideGit(root, 'qualification prices cache');
  const digest = feed.sha256(bytes);
  const dir = path.join(root, digest);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = pricesFile(root, digest);
  if (!fs.existsSync(file)) {
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const manifest = {
    schema_version: 1,
    digest,
    origin,
    fetched_at: nowIso,
    generated_at: doc.generated_at,
    stale_after_days: doc.stale_after_days === undefined ? null : doc.stale_after_days,
    n_rows: doc.rows.length,
  };
  const current = path.join(root, 'current.json');
  const tmp = `${current}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, current);
  return manifest;
}

/**
 * Fetch, validate, cache. A rejected document leaves the previous cache untouched (the throw
 * happens before any write).
 */
async function fetchPrices(from, { cacheDir = defaultCacheDir(), fetchImpl = globalThis.fetch, now = new Date().toISOString() } = {}) {
  const { body, bytes, origin } = await feed.readFeedSource(from, { fetchImpl });
  const doc = parsePrices(body);
  const previous = feed.readCurrentManifest(cacheDir);
  const manifest = writeCache(cacheDir, body, bytes, doc, origin, now);
  return { manifest, changed: previous ? previous.digest !== manifest.digest : null };
}

/**
 * Read the current cache synchronously (no network). Re-validates the stored bytes and checks
 * their digest. Returns null when there is no usable cache.
 */
function readCache(cacheDir = defaultCacheDir()) {
  try {
    const root = path.resolve(cacheDir);
    const manifest = feed.readCurrentManifest(root);
    if (!manifest || !/^[0-9a-f]{64}$/.test(String(manifest.digest))) return null;
    const bytes = fs.readFileSync(pricesFile(root, manifest.digest));
    if (feed.sha256(bytes) !== manifest.digest) return null;
    const doc = parsePrices(bytes.toString('utf8'));
    return { manifest, doc, index: indexPrices(doc) };
  } catch {
    return null;
  }
}

const DAY_S = 24 * 3600;

/**
 * Freshness. Staleness of a row is verified + stale_after_days (the publisher's number); with no
 * stale_after_days the metrics default applies. Warnings only: stale prices are still served.
 */
function describeFreshness(cache, nowIso) {
  if (!cache) return { present: false, warnings: ['no price cache: ladder keeps its current ordering (run: node scripts/qualification-prices.js fetch)'] };
  const { manifest, doc } = cache;
  const maxAgeS = doc.stale_after_days ? doc.stale_after_days * DAY_S : metrics.DEFAULT_MAX_AGE_S;
  const ages = metrics.describeAges(manifest, nowIso, { maxAgeS });
  const nowMs = Date.parse(nowIso);
  const staleRows = doc.rows.filter((r) => (nowMs - Date.parse(`${r.verified}T00:00:00Z`)) / 1000 > maxAgeS);
  const warnings = ages.warnings.slice();
  if (staleRows.length > 0) {
    warnings.push(`${staleRows.length} of ${doc.rows.length} rows verified more than ${Math.round(maxAgeS / DAY_S)} days ago: still used for ordering`);
  }
  return {
    present: true,
    labels: ages.labels,
    fetch_age_s: ages.fetch_age_s,
    producer_age_s: ages.producer_age_s,
    max_age_s: maxAgeS,
    stale_rows: staleRows.length,
    warnings,
  };
}

module.exports = {
  PRICES_SCHEMA_ID,
  DEFAULT_PRICES_URL,
  defaultCacheDir,
  sourceUrlProblem,
  validatePrices,
  parsePrices,
  indexPrices,
  priceMicro,
  sortValue,
  fetchPrices,
  readCache,
  describeFreshness,
};
