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

function isPlaceholderLine(line) {
  const lower = line.toLowerCase();
  return lower === 'none' || lower === 'n/a' || lower === 'no findings';
}

function isJsonLine(line) {
  return line.startsWith('{') || line.startsWith('[');
}

// Emoji is not a word character, so \b never sits between a glyph and the
// following space or end of line. Words stay on \b. Both shapes are findings.
const SEVERITY_HEADER = /^(?:[-*#>\s\d.)]*)(?:(?:🔴|🟠|🟡|🔵)(?:\s|$)|(?:Critical|Major|Minor|Suggestion)\b)/i;

// A bracketed-id severity header is a finding under the class contract. The
// header is an emoji, an English word (Critical/Major/Minor/Suggestion), or a
// Chinese word (嚴重/主要/次要/建議), any optionally bolded (**word**), with an
// optional emoji in front of the word, each followed by a bracketed id. Colon
// prose such as "Critical: ..." has no bracketed id and stays on the legacy
// line parser.
const SEVERITY_FINDING = /^(?:[-*#>\s\d.)]*)(?:(?:🔴|🟠|🟡|🔵)(?:[ \t]*(?:(?:\*\*)?(?:Critical|Major|Minor|Suggestion|嚴重|主要|次要|建議)(?:\*\*)?))?|(?:(?:\*\*)?(?:Critical|Major|Minor|Suggestion|嚴重|主要|次要|建議)(?:\*\*)?))[ \t]*\[/i;

function demandsClass(text) {
  if (/MUST-FIX/i.test(text) || /class_sites/i.test(text) || /"class"/.test(text) || /^\s*class\s*[:=]/im.test(text)) {
    return true;
  }
  return text.split(/\r?\n/).some((line) => SEVERITY_FINDING.test(line.trim()));
}

const EMOJI_SEVERITY = { '🔴': 'Critical', '🟠': 'Major', '🟡': 'Minor', '🔵': 'Suggestion' };

function severityOf(block) {
  const header = block.split(/\r?\n/).map((line) => line.trim()).find((line) => SEVERITY_HEADER.test(line));
  if (!header) return 'Major';
  const emoji = /🔴|🟠|🟡|🔵/.exec(header);
  if (emoji) return EMOJI_SEVERITY[emoji[0]];
  const word = /Critical|Major|Minor|Suggestion/i.exec(header);
  if (!word) return 'Major';
  const lower = word[0].toLowerCase();
  if (lower === 'critical') return 'Critical';
  if (lower === 'minor') return 'Minor';
  if (lower === 'suggestion') return 'Suggestion';
  return 'Major';
}

function parseClassBlock(block) {
  const classMatch = /(?:^|\n)\s*class\s*[:=]\s*([^\n]+)/i.exec(block);
  let sites = [];
  const sitesMatch = /class_sites\s*[:=]\s*([^\n]+)/i.exec(block);
  if (sitesMatch) {
    const rawSites = sitesMatch[1].trim();
    if (rawSites.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawSites);
        sites = Array.isArray(parsed) ? parsed : [];
      } catch (_err) {
        sites = [];
      }
    } else {
      sites = rawSites.split(/[\s,]+/).filter(Boolean);
    }
  }
  const klass = classMatch ? normalizeClass(classMatch[1].replace(/["'].*$/, '').trim()) : '';
  return {
    class: klass,
    class_sites: sites.map((site) => (typeof site === 'string' ? site.trim() : site)),
    text: block.trim(),
    severity: severityOf(block),
  };
}

function blockComplete(parsed) {
  return Boolean(parsed.class)
    && Array.isArray(parsed.class_sites)
    && parsed.class_sites.length > 0
    && parsed.class_sites.every((site) => isPathLine(site));
}

// null when any block lacks class or class_sites. Otherwise the finding list.
function plainClassFindings(raw) {
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (SEVERITY_HEADER.test(line.trim()) && current.some((part) => part.trim().length > 0)) {
      blocks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  const findings = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const parsed = parseClassBlock(block);
    if (!blockComplete(parsed)) return null;
    findings.push(parsed);
  }
  return findings.length > 0 ? findings : null;
}

// Text from a review block. JSON findings are schema-checked. Plain text that
// uses the class contract is schema-checked the same way. A mix of JSON and
// unstructured text is invalid, so a JSON line cannot drop the rest.
function validateReviewText(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw || isPlaceholderLine(raw)) {
    return { ok: true, json: false, findings: [] };
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const jsonLines = lines.filter((line) => isJsonLine(line));
  const otherLines = lines.filter((line) => !isJsonLine(line) && !isPlaceholderLine(line));
  if (jsonLines.length === 0) {
    if (!demandsClass(raw)) return { ok: true, json: false, findings: [] };
    const findings = plainClassFindings(raw);
    if (!findings) return { ok: false, json: true, reason: 'invalid review: finding lacks class' };
    return { ok: true, json: true, findings };
  }
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
  if (otherLines.length > 0) {
    const otherText = otherLines.join('\n');
    const extra = plainClassFindings(otherText);
    if (!extra) {
      return { ok: false, json: true, reason: 'invalid review: mixed JSON and unstructured findings' };
    }
    collected.push(...extra);
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

// A site is path:line plus a nonempty covering test, in every table shape.
function siteRecordOk(site) {
  if (typeof site === 'string') {
    const parts = site.trim().split(/\s+/);
    return parts.length >= 2 && isPathLine(parts[0]) && parts.slice(1).join(' ').trim().length > 0;
  }
  if (!site || typeof site !== 'object' || Array.isArray(site)) return false;
  const loc = typeof site.site === 'string' ? site.site : site.path;
  return isPathLine(loc) && typeof site.test === 'string' && site.test.trim().length > 0;
}

function sitesOk(sites) {
  return Array.isArray(sites) && sites.length > 0 && sites.every((site) => siteRecordOk(site));
}

function scanCovers(report, klass) {
  if (!report || typeof report !== 'object') return false;
  const scan = report.class_scan;
  const want = normalizeClass(klass);
  if (!want) return false;
  if (Array.isArray(scan)) {
    return scan.some((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      if (!sameClass(row.class, want)) return false;
      const sites = Array.isArray(row.sites) ? row.sites : row.class_sites;
      return sitesOk(sites);
    });
  }
  if (scan && typeof scan === 'object' && !Array.isArray(scan)) {
    const key = Object.keys(scan).find((name) => sameClass(name, want));
    if (!key) return false;
    return sitesOk(scan[key]);
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
  demandsClass,
  classesOf,
  missingClassScan,
  repeatedClass,
  escalateTarget,
};

if (require.main === module) main(process.argv);
