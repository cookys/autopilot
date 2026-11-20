#!/usr/bin/env node
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const findingClass = require('./lib/finding-class.js');

const temps = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-class-'));
  temps.push(dir);
  return dir;
}

function review(klass, sites) {
  return { findings: [{ class: klass, class_sites: sites, severity: 'Major', text: klass }] };
}

function reportFor(klass) {
  return {
    class_scan: [{ class: klass, sites: [{ site: 'a.js:1', test: 'a.test.js' }] }],
  };
}

test('review JSON missing class is invalid', () => {
  const result = findingClass.validateReview({ findings: [{ class_sites: ['a.js:1'] }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /lacks class/);
});

test('review JSON with empty class_sites is invalid', () => {
  const result = findingClass.validateReview({ findings: [{ class: 'bad-value', class_sites: [] }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /empty class_sites/);
});

test('complete review JSON is valid', () => {
  const result = findingClass.validateReview(review('bad-value', ['a.js:1', 'b.js:4']));
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings[0].class_sites, ['a.js:1', 'b.js:4']);
});

test('fix report missing class_scan names that class', () => {
  const missing = findingClass.missingClassScan({ class_scan: [] }, ['bad-value']);
  assert.equal(missing, 'bad-value');
});

test('plain-text finding without class is invalid', () => {
  const result = findingClass.validateReviewText('🟠 [id] MUST-FIX the check skips a second site');
  assert.equal(result.ok, false);
  assert.match(result.reason, /lacks class/);
});

test('severity word without MUST-FIX still requires class', () => {
  const result = findingClass.validateReviewText('Major [id] broken check');
  assert.equal(result.ok, false);
  assert.match(result.reason, /lacks class/);
});

test('emoji finding without MUST-FIX still requires class', () => {
  const result = findingClass.validateReviewText('🟠 [id] broken check');
  assert.equal(result.ok, false);
  assert.match(result.reason, /lacks class/);
});

test('legacy colon severity prose stays on the line parser', () => {
  const colon = findingClass.validateReviewText('Critical: SQL injection vulnerability\n\nMajor: Unhandled promise rejection');
  assert.equal(colon.ok, true);
  assert.equal(colon.json, false);
});

test('demandsClass recognizes every bracketed-id severity header shape', () => {
  // One row per severity level: its emoji, English word, and Chinese word.
  const levels = [
    { emoji: '🔴', word: 'Critical', zh: '嚴重' },
    { emoji: '🟠', word: 'Major', zh: '主要' },
    { emoji: '🟡', word: 'Minor', zh: '次要' },
    { emoji: '🔵', word: 'Suggestion', zh: '建議' },
  ];
  for (const { emoji, word, zh } of levels) {
    // Every required header shape, each followed by a bracketed id, must demand a class.
    const positives = [
      `${emoji} [id]`,            // emoji alone
      `${word} [id]`,             // word alone
      `${word.toLowerCase()} [id]`, // word, lowercase (case-insensitive)
      `${emoji} ${word} [id]`,    // emoji then word
      `**${word}** [id]`,         // bold word
      `${emoji} **${word}** [id]`, // emoji then bold word
      `${zh} [id]`,               // Chinese word alone
      `${emoji} ${zh} [id]`,      // emoji then Chinese word
      `**${zh}** [id]`,           // bold Chinese word
    ];
    for (const line of positives) {
      assert.equal(findingClass.demandsClass(line), true, `expected true for: ${line}`);
    }
  }
  assert.equal(findingClass.demandsClass('CRITICAL [id]'), true, 'uppercase word must match');

  // Colon prose and prose without a bracketed id must NOT demand a class.
  const negatives = [
    'Critical: text',
    'Major issue here',
    '🟠 text without id',
  ];
  for (const line of negatives) {
    assert.equal(findingClass.demandsClass(line), false, `expected false for: ${line}`);
  }
});

test('two emoji findings where only one has metadata are rejected', () => {
  const text = [
    '🟠 [id-a] first check',
    'class: emoji-split',
    'class_sites: a.js:1',
    '🟠 [id-b] second check has no metadata',
  ].join('\n');
  const result = findingClass.validateReviewText(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /lacks class/);
});

test('two emoji findings each with metadata count as two', () => {
  const text = [
    '🟠 [id-a] first',
    'class: emoji-a',
    'class_sites: a.js:1',
    '🟠 [id-b] second',
    'class: emoji-b',
    'class_sites: b.js:2',
  ].join('\n');
  const result = findingClass.validateReviewText(text);
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].class, 'emoji-a');
  assert.equal(result.findings[1].class, 'emoji-b');
});

test('plain-text finding with class and class_sites is kept', () => {
  const text = '🟠 [id] MUST-FIX skipped site\nclass: bad-value\nclass_sites: a.js:1 b.js:4';
  const result = findingClass.validateReviewText(text);
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].class, 'bad-value');
  assert.deepEqual(result.findings[0].class_sites, ['a.js:1', 'b.js:4']);
});

test('mixed JSON and unstructured text is invalid and keeps no partial findings', () => {
  const text = [
    '{"class":"bad-value","class_sites":["a.js:1"],"severity":"Major","text":"json"}',
    '🟠 [other] MUST-FIX plain sibling with no class',
  ].join('\n');
  const result = findingClass.validateReviewText(text);
  assert.equal(result.ok, false);
  assert.equal(result.findings, undefined);
  assert.match(result.reason, /mixed JSON and unstructured findings/);
});

test('string class_scan site without a covering test names that class', () => {
  const missing = findingClass.missingClassScan(
    { class_scan: [{ class: 'bad-value', sites: ['a.js:1'] }] },
    ['bad-value'],
  );
  assert.equal(missing, 'bad-value');
});

test('object-map class_scan rejects an invalid row and names the class', () => {
  const missing = findingClass.missingClassScan(
    { class_scan: { 'bad-value': [{}] } },
    ['bad-value'],
  );
  assert.equal(missing, 'bad-value');
});

test('object-map class_scan accepts path:line plus a nonempty test', () => {
  const missing = findingClass.missingClassScan(
    { class_scan: { 'Bad Value': [{ site: 'a.js:1', test: 'a.test.js' }] } },
    ['bad-value'],
  );
  assert.equal(missing, null);
});

test('normaliser collapses Bad Value, bad_value, and bad-value', () => {
  assert.equal(findingClass.normalizeClass('Bad Value'), 'bad-value');
  assert.equal(findingClass.normalizeClass('bad_value'), 'bad-value');
  assert.equal(findingClass.normalizeClass('bad-value '), 'bad-value');
  assert.equal(findingClass.sameClass('Bad Value', 'bad_value'), true);
});

const CLASSES = ['bad-value', 'missing-field', 'stale-age', 'old-format', 'display-surface'];

test('five classes escalate when round 2 repeats the class; a different class does not', () => {
  for (const klass of CLASSES) {
    const repeated = findingClass.repeatedClass(
      review(klass, ['a.js:1']),
      review(klass, ['b.js:9']),
    );
    assert.equal(repeated, klass);
    assert.equal(`same_class_repeat:${repeated}`, `same_class_repeat:${klass}`);
  }
  const other = findingClass.repeatedClass(
    review('bad-value', ['a.js:1']),
    review('missing-field', ['c.js:2']),
  );
  assert.equal(other, null);
  const folded = findingClass.repeatedClass(
    review('Bad Value', ['a.js:1']),
    review('bad_value', ['b.js:2']),
  );
  assert.equal(folded, 'bad-value');
});

test('fix-round CLI rejects a missing class_scan and escalates a repeated class', () => {
  const dir = tempDir();
  const ledger = path.join(dir, 'ledger');
  const reviewPath = path.join(dir, 'review.json');
  const reportPath = path.join(dir, 'report.json');
  const prevPath = path.join(dir, 'prev.json');
  const loop = path.join(__dirname, 'hetero-review-loop.js');
  const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir };

  function run(args) {
    return spawnSync(process.execPath, [loop, 'fix-round', '--ledger', ledger, '--phase', 'p', ...args], {
      encoding: 'utf8',
      env,
    });
  }

  fs.writeFileSync(reviewPath, JSON.stringify({ findings: [{ class_sites: ['a.js:1'] }] }));
  fs.writeFileSync(reportPath, JSON.stringify(reportFor('bad-value')));
  let res = run(['--generation', '1', '--review', reviewPath, '--report', reportPath, '--implementer-engine', 'grok']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /lacks class/);

  fs.writeFileSync(reviewPath, JSON.stringify(review('bad-value', [])));
  res = run(['--generation', '1', '--review', reviewPath, '--report', reportPath, '--implementer-engine', 'grok']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /empty class_sites/);

  fs.writeFileSync(reviewPath, JSON.stringify(review('bad-value', ['a.js:1'])));
  fs.writeFileSync(reportPath, JSON.stringify({ note: 'no scan' }));
  res = run(['--generation', '1', '--review', reviewPath, '--report', reportPath, '--implementer-engine', 'grok']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /missing class_scan for bad-value/);
  const rejected = JSON.parse(fs.readFileSync(path.join(ledger, 'review-p', 'class-gate.json'), 'utf8'));
  assert.equal(rejected.merged, false);
  assert.equal(rejected.missing_class, 'bad-value');

  fs.writeFileSync(reportPath, JSON.stringify(reportFor('bad-value')));
  for (const klass of CLASSES) {
    fs.writeFileSync(prevPath, JSON.stringify(review(klass, ['a.js:1'])));
    fs.writeFileSync(reviewPath, JSON.stringify(review(klass, ['b.js:9'])));
    fs.writeFileSync(reportPath, JSON.stringify(reportFor(klass)));
    res = run([
      '--generation', '2', '--review', reviewPath, '--report', reportPath,
      '--prev', prevPath, '--implementer-engine', 'grok', '--ladder', 'grok,other-engine',
    ]);
    assert.equal(res.status, 0, res.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(ledger, 'review-p', 'class-gate.json'), 'utf8'));
    assert.equal(state.reason, `same_class_repeat:${klass}`);
    assert.equal(state.to, 'other-engine');
    assert.notEqual(state.to, state.from);
    const brief = fs.readFileSync(path.join(ledger, 'review-p', 'g2', 'hands-brief.md'), 'utf8');
    assert.match(brief, new RegExp(`Class ${klass} sites`));
    assert.match(brief, /class_scan/);
    assert.match(brief, /other-engine/);
  }

  fs.writeFileSync(prevPath, JSON.stringify(review('bad-value', ['a.js:1'])));
  fs.writeFileSync(reviewPath, JSON.stringify(review('missing-field', ['c.js:3'])));
  fs.writeFileSync(reportPath, JSON.stringify(reportFor('missing-field')));
  res = run([
    '--generation', '2', '--review', reviewPath, '--report', reportPath,
    '--prev', prevPath, '--implementer-engine', 'grok', '--ladder', 'grok,other-engine',
  ]);
  assert.equal(res.status, 0, res.stderr);
  const quiet = JSON.parse(fs.readFileSync(path.join(ledger, 'review-p', 'class-gate.json'), 'utf8'));
  assert.equal(quiet.status, 'accepted');
  assert.equal(quiet.reason, undefined);
});
