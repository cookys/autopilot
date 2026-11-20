#!/usr/bin/env node
'use strict';

// Finding-class normaliser and the two gates that use it:
// a review finding must name its class and every site; a later round that
// brings the same class back means the previous round was incomplete.

function normalizeClass(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sameClass(a, b) {
  const left = normalizeClass(a);
  const right = normalizeClass(b);
  return left.length > 0 && left === right;
}

function isPathLine(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.includes(':');
}

function findingList(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object' && Array.isArray(doc.findings)) return doc.findings;
  return null;
}

// Returns { ok:true, findings } or { ok:false, reason }.
// A document that is not a findings JSON object/array is not this check (ok, findings empty
// only when the caller already decided it is review JSON).
function validateReview(doc) {
  const list = findingList(doc);
  if (!list) {
    return { ok: false, reason: 'invalid review: findings JSON is missing a findings array' };
  }
  const findings = [];
  for (let i = 0; i < list.length; i += 1) {
    const finding = list[i];
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      return { ok: false, reason: `invalid review: finding ${i} is not an object` };
    }
    const klass = normalizeClass(finding.class);
    if (!klass) {
      return { ok: false, reason: 'invalid review: finding lacks class' };
    }
    if (!Array.isArray(finding.class_sites) || finding.class_sites.length === 0
      || finding.class_sites.some((site) => !isPathLine(site))) {
      return { ok: false, reason: 'invalid review: finding has empty class_sites' };
    }
    findings.push({
      ...finding,
      class: klass,
      class_sites: finding.class_sites.map((site) => site.trim()),
    });
  }
  return { ok: true, findings };
}

// Text from a review block. Non-JSON finding lines are left to the existing
// line parser (ok, json:false). A JSON finding object or a findings array is
// schema-checked here.
function validateReviewText(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'n/a' || raw.toLowerCase() === 'no findings') {
    return { ok: true, json: false, findings: [] };
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const jsonLines = lines.filter((line) => line.startsWith('{') || line.startsWith('['));
  if (jsonLines.length === 0) return { ok: true, json: false, findings: [] };
  const collected = [];
  for (const line of jsonLines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_err) {
      return { ok: false, json: true, reason: 'invalid review: finding JSON did not parse' };
    }
    const list = findingList(parsed);
    const asFindings = list || (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && (Object.prototype.hasOwnProperty.call(parsed, 'class') || Object.prototype.hasOwnProperty.call(parsed, 'class_sites'))
      ? [parsed]
      : null);
    if (!asFindings) {
      return { ok: false, json: true, reason: 'invalid review: finding JSON has no findings' };
    }
    const checked = validateReview(asFindings);
    if (!checked.ok) return { ok: false, json: true, reason: checked.reason };
    collected.push(...checked.findings);
  }
  return { ok: true, json: true, findings: collected };
}

function classesOf(doc) {
  const checked = Array.isArray(doc) || (doc && Array.isArray(doc.findings))
    ? validateReview(doc)
    : { ok: false };
  if (checked.ok) return [...new Set(checked.findings.map((f) => f.class))];
  const list = findingList(doc) || [];
  const out = [];
  for (const finding of list) {
    const klass = finding && normalizeClass(finding.class);
    if (klass && !out.includes(klass)) out.push(klass);
  }
  return out;
}

function scanCovers(report, klass) {
  if (!report || typeof report !== 'object') return false;
  const scan = report.class_scan;
  const want = normalizeClass(klass);
  if (!want) return false;
  if (Array.isArray(scan)) {
    return scan.some((row) => {
      if (!row || typeof row !== 'object') return false;
      if (!sameClass(row.class, want)) return false;
      const sites = Array.isArray(row.sites) ? row.sites : row.class_sites;
      return Array.isArray(sites) && sites.length > 0 && sites.every((site) => {
        if (typeof site === 'string') return isPathLine(site);
        return site && isPathLine(site.site) && typeof site.test === 'string' && site.test.trim().length > 0;
      });
    });
  }
  if (scan && typeof scan === 'object') {
    const key = Object.keys(scan).find((name) => sameClass(name, want));
    if (!key) return false;
    const sites = scan[key];
    return Array.isArray(sites) && sites.length > 0;
  }
  return false;
}

// First given class whose report has no class_scan row. null when every class is covered.
function missingClassScan(report, classes) {
  for (const klass of classes) {
    const norm = normalizeClass(klass);
    if (!norm) continue;
    if (!scanCovers(report, norm)) return norm;
  }
  return null;
}

// First class present in both rounds, normalised. null when round 2 is a different class.
function repeatedClass(previous, next) {
  const prior = new Set(classesOf(previous));
  for (const klass of classesOf(next)) {
    if (prior.has(klass)) return klass;
  }
  return null;
}

function escalateTarget(currentEngine, ladder) {
  const current = String(currentEngine || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rungs = (Array.isArray(ladder) ? ladder : String(ladder || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
  const next = rungs.find((rung) => !current.includes(rung));
  return next || 'lane-seat';
}

function readJson(filePath, fs) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main(argv) {
  const fs = require('fs');
  const cmd = argv[2];
  if (cmd === 'validate-review-text') {
    const text = argv[3] ? fs.readFileSync(argv[3], 'utf8') : fs.readFileSync(0, 'utf8');
    const result = validateReviewText(text);
    if (!result.ok) {
      process.stderr.write(`${result.reason}\n`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (cmd === 'validate-review') {
    const doc = readJson(argv[3], fs);
    const result = validateReview(doc);
    if (!result.ok) {
      process.stderr.write(`${result.reason}\n`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, classes: result.findings.map((f) => f.class) })}\n`);
    process.exit(0);
  }
  process.stderr.write('usage: finding-class.js validate-review <file> | validate-review-text [file]\n');
  process.exit(2);
}

module.exports = {
  normalizeClass,
  sameClass,
  validateReview,
  validateReviewText,
  classesOf,
  missingClassScan,
  repeatedClass,
  escalateTarget,
};

if (require.main === module) main(process.argv);
