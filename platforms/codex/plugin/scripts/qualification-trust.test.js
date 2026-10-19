'use strict';
// Run: node --test scripts/qualification-trust.test.js
//
// # RED at 40c843823198fd608705e7b075b2fa93b5b4a6e5:
// well-formed-with-one-bad-qualification-entry: ignored validateMetrics errors; the bad entry_id document passed the gate (ok true). Reverted.
// unsupported-schema-version: dropped the schema-id equality; stderr became semantics SCHEMA instead of REJECTED schema. Reverted.
// cache-bytes-tampered-after-download: skipped the recomputed-sha256 comparison; the tampered cache passed (ok true). Reverted.
// stale-generated-at: skipped the freshness rejection; a generated_at older than 30 days passed the gate (ok true). Reverted.
// non-strict-json: skipped preflightJsonSource; the BOM no longer said "not supported JSON at offset 0", and the lone surrogate failed later as semantics STRICT_JSON. Reverted.
//
// BL-0194 P6 stage A. Temp home and cache only. No network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const FIX = path.join(REPO, 'hooks', 'tests', 'fixtures', 'qualification-registry');
const metrics = require('./lib/qualification-metrics.js');
const trust = require('./lib/qualification-trust.js');

const NOW_ISO = '2026-10-16T12:00:00Z';
const NOW_MS = Date.parse(NOW_ISO);

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qt-${prefix}-`));
}

function baseDoc() {
  const doc = JSON.parse(fs.readFileSync(path.join(FIX, 'metrics-qualification-and-strikes.valid.json'), 'utf8'));
  doc.generated_at = '2026-10-16T09:00:00Z';
  return doc;
}

function writeCacheBytes(cacheDir, bytes, generatedAt) {
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const root = path.join(cacheDir, 'metrics', digest);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'metrics.json'), bytes);
  const manifest = {
    schema_version: 1,
    digest,
    origin: 'file://test',
    fetched_at: NOW_ISO,
    generated_at: generatedAt,
    n_seat_metrics: 0,
    n_strike_events: 0,
  };
  fs.writeFileSync(path.join(cacheDir, 'metrics', 'current.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return digest;
}

function cacheDoc(doc) {
  const cacheDir = tmp('cache');
  const bytes = Buffer.from(JSON.stringify(doc));
  writeCacheBytes(cacheDir, bytes, doc.generated_at);
  return cacheDir;
}

function capture(fn) {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    lines.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return orig(chunk, ...rest);
  };
  try {
    const result = fn();
    return { result, stderr: lines.join('') };
  } finally {
    process.stderr.write = orig;
  }
}

test('well-formed-with-one-bad-qualification-entry', () => {
  const doc = baseDoc();
  const good = JSON.parse(JSON.stringify(doc.seat_metrics.find((e) => e.kind === 'qualification')));
  good.window_end = '2026-10-13T10:00:00Z';
  good.entry_id = metrics.entryId(good.seat, good.kind, good.instrument_id, good.window_end);
  const bad = JSON.parse(JSON.stringify(good));
  bad.entry_id = '0'.repeat(64);
  doc.seat_metrics.push(good, bad);
  const cacheDir = cacheDoc(doc);
  const { result, stderr } = capture(() => trust.gate(cacheDir, NOW_MS));
  assert.equal(result.ok, false);
  assert.equal(result.doc, null);
  assert.match(stderr, /^qualification-feed gate REJECTED /);
  assert.deepEqual(trust.usableQualificationRows(result), []);
});

test('unsupported-schema-version', () => {
  const doc = baseDoc();
  doc.schema = 'model-dyno.qualification-metrics.v9';
  const cacheDir = cacheDoc(doc);
  const { result, stderr } = capture(() => trust.gate(cacheDir, NOW_MS));
  assert.equal(result.ok, false);
  assert.match(stderr, /^qualification-feed gate REJECTED schema/);
  assert.deepEqual(trust.usableQualificationRows(result), []);
});

test('cache-bytes-tampered-after-download', () => {
  const cacheDir = cacheDoc(baseDoc());
  const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, 'metrics', 'current.json'), 'utf8'));
  const file = path.join(cacheDir, 'metrics', manifest.digest, 'metrics.json');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /build-qualification-feed\.py@2/);
  fs.writeFileSync(file, text.replace('build-qualification-feed.py@2', 'build-qualification-feed.py@3'));
  const { result, stderr } = capture(() => trust.gate(cacheDir, NOW_MS));
  assert.equal(result.ok, false);
  assert.equal(result.doc, null);
  assert.match(stderr, /^qualification-feed gate REJECTED /);
  assert.match(stderr, /recorded-digest/);
  assert.deepEqual(trust.usableQualificationRows(result), []);
});

test('cache-first-read-records-digest', () => {
  const cacheDir = cacheDoc(baseDoc());
  const first = trust.gate(cacheDir, NOW_MS);
  const second = trust.gate(cacheDir, NOW_MS);
  assert.equal(first.ok, true, JSON.stringify(first.reasons));
  assert.equal(second.ok, true, JSON.stringify(second.reasons));
  const rows = trust.usableQualificationRows(second);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record_id, 'b3f8f8cc5513e6db676ecd651626937e1def738457dc7806266854c5730f6a8f');
  assert.equal(rows[0].content_digest, crypto.createHash('sha256').update(metrics.canonicalJson(
    second.doc.seat_metrics.find((e) => e.kind === 'qualification'),
  )).digest('hex'));
});

test('stale-generated-at', () => {
  const doc = baseDoc();
  doc.generated_at = '2026-09-01T00:00:00Z';
  const cacheDir = cacheDoc(doc);
  const { result, stderr } = capture(() => trust.gate(cacheDir, NOW_MS));
  assert.equal(result.ok, false);
  assert.match(stderr, /^qualification-feed gate REJECTED /);
  assert.match(stderr, /stale/);

  const day = 86400000;
  const now = Date.parse('2026-10-16T00:00:00Z');
  assert.equal(trust.generatedAtAge('not-a-date', now, 30).reason, 'malformed');
  assert.equal(trust.generatedAtAge(null, now, 30).reason, 'malformed');
  assert.equal(trust.generatedAtAge('2026-11-01T00:00:00Z', now, 30).reason, 'future');
  assert.equal(trust.generatedAtAge('2026-09-15T00:00:00Z', now, 30).reason, 'stale');
  const exact = trust.generatedAtAge('2026-09-16T00:00:00Z', now, 30);
  assert.equal(exact.ok, true);
  assert.equal(exact.age_days, 30);
  assert.equal(trust.generatedAtAge(new Date(now - 30 * day - 1).toISOString(), now, 30).ok, false);
});

test('non-strict-json', () => {
  const valid = Buffer.from(JSON.stringify(baseDoc()));
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]);
  const bomCache = tmp('cache');
  writeCacheBytes(bomCache, bom, '2026-10-16T09:00:00Z');
  const bomRun = capture(() => trust.gate(bomCache, NOW_MS));
  assert.equal(bomRun.result.ok, false);
  assert.match(bomRun.stderr, /strict-json/);
  assert.match(bomRun.stderr, /not supported JSON at offset 0/);

  const surrogate = Buffer.from(JSON.stringify(baseDoc()).replace(
    '"build-qualification-feed.py@2"',
    '"\\uD800"',
  ));
  const surCache = tmp('cache');
  writeCacheBytes(surCache, surrogate, '2026-10-16T09:00:00Z');
  const surRun = capture(() => trust.gate(surCache, NOW_MS));
  assert.equal(surRun.result.ok, false);
  assert.match(surRun.stderr, /strict-json/);
});

test('advertised-digest-not-trusted', () => {
  const doc = baseDoc();
  doc.digest = 'ab'.repeat(32);
  doc.digest_basis = 'producer-internal-subset';
  const bytes = Buffer.from(JSON.stringify(doc));
  const cacheDir = tmp('cache');
  const recorded = writeCacheBytes(cacheDir, bytes, doc.generated_at);
  assert.notEqual(doc.digest, recorded);
  const result = trust.gate(cacheDir, NOW_MS);
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
  assert.equal(result.manifest.digest, recorded);
  assert.equal(trust.usableQualificationRows(result).length, 1);
});

test('trust-mode', () => {
  const home = tmp('home');
  const env = {};
  assert.equal(trust.resolveTrustMode({ home, env }), 'auto');
  const file = path.join(home, '.autopilot', 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const value of ['auto', 'confirm', 'off']) {
    fs.writeFileSync(file, JSON.stringify({ qualification_feed: { trust: value } }));
    assert.equal(trust.resolveTrustMode({ home, env }), value);
  }
  fs.writeFileSync(file, JSON.stringify({ qualification_feed: { trust: 'sometimes' } }));
  const { result, stderr } = capture(() => trust.resolveTrustMode({ home, env }));
  assert.equal(result, 'off');
  assert.match(stderr, /off/);
  assert.match(stderr, /sometimes/);
});

test('shared-age-function-used', () => {
  const src = fs.readFileSync(path.join(__dirname, 'build-qualification-defaults.js'), 'utf8');
  assert.match(src, /generatedAtAge/);
  assert.match(src, /require\('\.\/lib\/qualification-feed\.js'\)/);
  const recipeSrc = path.join(REPO, 'references', 'official-qualification-defaults.recipe.json');
  const work = tmp('recipe');
  const recipe = path.join(work, 'recipe.json');
  const base = JSON.parse(fs.readFileSync(recipeSrc, 'utf8'));
  base.snapshot = { digest: 'd', generated_at: '2026-09-17T00:00:00Z', feed_schema: null };
  fs.writeFileSync(recipe, JSON.stringify(base));
  const run = spawnSync('node', [
    path.join(__dirname, 'build-qualification-defaults.js'),
    '--check-snapshot-age', '--recipe', recipe, '--now', '2026-10-16T00:00:00Z',
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '{"status":"ok","generated_at":"2026-09-17T00:00:00Z","age_days":29,"max_days":30}\n');
  delete base.snapshot;
  fs.writeFileSync(recipe, JSON.stringify(base));
  const none = spawnSync('node', [
    path.join(__dirname, 'build-qualification-defaults.js'),
    '--check-snapshot-age', '--recipe', recipe, '--now', '2026-10-16T00:00:00Z',
  ], { encoding: 'utf8' });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '{"status":"no-snapshot"}\n');
});
