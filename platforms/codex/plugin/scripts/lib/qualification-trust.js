'use strict';

/**
 * qualification-trust.js — BL-0194 P6 stage A. The gate for a cached
 * qualification-metrics document, and the qualification_feed.trust config key.
 *
 * This module does not admit a seat. Callers treat ok:false as no feed.
 * Every call re-reads and re-hashes. Nothing is remembered between calls.
 * The producer's advertised digest is never the expected value.
 *
 * Node >= 20.10, built-ins plus the existing qualification libs.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { TextDecoder } = require('util');
const { configPath } = require('./config-path.js');
const { preflightJsonSource } = require('../validate-json-schema.js');
const { generatedAtAge } = require('./qualification-feed.js');
const metrics = require('./qualification-metrics.js');

const TRUST_VALUES = new Set(['auto', 'confirm', 'off']);
const MAX_AGE_DAYS = 30;

function resolveTrustMode(opts = {}) {
  const file = opts.configFile || configPath({ home: opts.home, env: opts.env || process.env });
  let raw;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw = cfg && cfg.qualification_feed ? cfg.qualification_feed.trust : undefined;
  } catch {
    raw = undefined;
  }
  if (raw === undefined || raw === null || raw === '') return 'auto';
  if (TRUST_VALUES.has(raw)) return raw;
  process.stderr.write(
    `qualification-feed trust: unrecognised qualification_feed.trust ${JSON.stringify(raw)}; treating it as off\n`,
  );
  return 'off';
}

function reject(step, reason) {
  process.stderr.write(`qualification-feed gate REJECTED ${step}: ${reason}\n`);
  return { ok: false, doc: null, manifest: null, reasons: [`${step}: ${reason}`] };
}

function recordObjects(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => recordObjects(item, out));
    return;
  }
  if (typeof node.schema === 'number' && Object.prototype.hasOwnProperty.call(node, 'record_id')) out.push(node);
  for (const value of Object.values(node)) recordObjects(value, out);
}

function gate(cacheDir, nowMs) {
  try {
    // Same root as metricsCacheRoot in qualification-metrics.js: <cacheDir>/metrics.
    const root = path.join(path.resolve(cacheDir), 'metrics');
    const currentPath = path.join(root, 'current.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
    } catch (error) {
      return reject('manifest', `current.json is missing or unreadable (${error.message})`);
    }
    if (!manifest || typeof manifest.digest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.digest)) {
      return reject('manifest', 'current.json digest is not 64 hex characters');
    }
    const file = path.join(root, manifest.digest, 'metrics.json');
    const dirName = path.basename(path.dirname(file));
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch (error) {
      return reject('recorded-digest', `cached metrics.json is missing (${error.message})`);
    }
    const recomputed = crypto.createHash('sha256').update(bytes).digest('hex');
    if (recomputed !== manifest.digest || dirName !== manifest.digest) {
      return reject('recorded-digest', `recomputed sha256 ${recomputed} does not equal recorded identity ${manifest.digest}`);
    }
    let source;
    let doc;
    try {
      source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      preflightJsonSource(source, 'qualification feed');
      doc = JSON.parse(source);
    } catch (error) {
      return reject('strict-json', error.message);
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.schema !== metrics.METRICS_SCHEMA_ID) {
      return reject('schema', `unsupported schema id ${JSON.stringify(doc && doc.schema)}`);
    }
    const forValidation = { ...doc };
    delete forValidation.digest;
    delete forValidation.digest_basis;
    const validated = metrics.validateMetrics(Buffer.from(JSON.stringify(forValidation)), { semantic: true });
    if (validated.errors.length) {
      const detail = validated.errors.slice(0, 3).map(([code, message]) => `${code}: ${message}`).join('; ');
      return reject('semantics', detail);
    }
    const records = [];
    recordObjects(doc, records);
    for (const rec of records) {
      const checked = metrics.validateRecord(JSON.stringify(rec), { semantic: true });
      if (checked.errors.length) {
        const detail = checked.errors.slice(0, 3).map(([code, message]) => `${code}: ${message}`).join('; ');
        return reject('semantics', detail);
      }
    }
    if (!Number.isFinite(nowMs)) return reject('freshness', 'malformed');
    const age = generatedAtAge(doc.generated_at, nowMs, MAX_AGE_DAYS);
    if (!age.ok) return reject('freshness', age.reason);
    return { ok: true, doc, manifest, reasons: [] };
  } catch (error) {
    return reject('read', error.message);
  }
}

function usableQualificationRows(gateResult) {
  if (!gateResult || gateResult.ok !== true || !gateResult.doc || !Array.isArray(gateResult.doc.seat_metrics)) return [];
  const rows = [];
  for (const entry of gateResult.doc.seat_metrics) {
    if (!entry || entry.kind !== 'qualification' || !entry.qualification || entry.qualification.status !== 'qualified') continue;
    rows.push({
      seat: entry.seat,
      record_id: entry.qualification.record_id,
      content_digest: crypto.createHash('sha256').update(metrics.canonicalJson(entry)).digest('hex'),
    });
  }
  return rows;
}

module.exports = {
  resolveTrustMode,
  gate,
  usableQualificationRows,
  generatedAtAge,
};
