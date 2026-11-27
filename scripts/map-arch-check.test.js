#!/usr/bin/env node
'use strict';
require('./lib/test-git-env'); // fixture repos must not run the account's global git config

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runMapArchCheck } = require('./map-arch-check');

function makeSandbox(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `map-arch-${name}-`));
  const repo = path.join(base, 'demo-repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  return { base, repo };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeEngine(base, scriptBody) {
  const p = path.join(base, 'fake-engine.js');
  fs.writeFileSync(p, scriptBody, 'utf8');
  return `${process.execPath} ${p}`;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('(a) fake engine returns 7 items -> keeps only 5', () => {
  const { base, repo } = makeSandbox('cap5');
  try {
    fs.writeFileSync(path.join(repo, 'ARCHITECTURE.md'), '# Arch\n\nBody\n', 'utf8');
    const items = Array.from({ length: 7 }, (_, i) => ({
      title: `T${i + 1}`,
      why: `W${i + 1}`,
      files: [`src/f${i + 1}.js`],
      recommendation: `R${i + 1}`,
    }));
    const engineCmd = writeEngine(base, `process.stdout.write(${JSON.stringify(JSON.stringify(items))});`);
    const res = runMapArchCheck({ repo, engineCmd });
    assert.equal(res.ok, true);
    assert.equal(res.candidates.length, 5);
    assert.equal(res.candidates[0].title, 'T1');
    assert.equal(res.candidates[4].title, 'T5');
    assert.equal(res.dropped, 0);
    assert.equal(res.incomplete, false);
  } finally {
    cleanup(base);
  }
});

test('(b) fake engine returns bad JSON -> ok:false and does not write file', () => {
  const { base, repo } = makeSandbox('bad-json');
  try {
    const orig = '# Arch\n\nOriginal\n';
    const mapPath = path.join(repo, 'ARCHITECTURE.md');
    fs.writeFileSync(mapPath, orig, 'utf8');
    const engineCmd = writeEngine(base, `process.stdout.write('not-json{');`);
    const res = runMapArchCheck({ repo, engineCmd, write: true });
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes('invalid_json'));
    assert.equal(fs.readFileSync(mapPath, 'utf8'), orig);
  } finally {
    cleanup(base);
  }
});

test('(c) elements missing required fields are dropped and counted in dropped', () => {
  const { base, repo } = makeSandbox('dropped');
  try {
    fs.writeFileSync(path.join(repo, 'ARCHITECTURE.md'), '# Arch\n', 'utf8');
    const items = [
      { title: 'Valid1', why: 'Because', files: ['a.js'], recommendation: 'Do A' },
      { title: 'MissingWhy', files: ['b.js'], recommendation: 'Do B' },
      { why: 'MissingTitle', recommendation: 'Do C' },
      { title: 'MissingRec', why: 'Because' },
      { title: 'Valid2', why: 'Because2', recommendation: 'Do D' },
    ];
    const engineCmd = writeEngine(base, `process.stdout.write(${JSON.stringify(JSON.stringify(items))});`);
    const res = runMapArchCheck({ repo, engineCmd });
    assert.equal(res.ok, true);
    assert.equal(res.dropped, 3);
    assert.equal(res.candidates.length, 2);
    assert.equal(res.candidates[0].title, 'Valid1');
    assert.equal(res.candidates[1].title, 'Valid2');
  } finally {
    cleanup(base);
  }
});

test('(d) input exceeding --max-input-chars -> incomplete:true', () => {
  const { base, repo } = makeSandbox('truncated');
  try {
    fs.writeFileSync(path.join(repo, 'ARCHITECTURE.md'), '# Arch\n' + 'x'.repeat(500), 'utf8');
    const items = [{ title: 'T1', why: 'W1', files: ['a.js'], recommendation: 'R1' }];
    const engineCmd = writeEngine(base, `process.stdout.write(${JSON.stringify(JSON.stringify(items))});`);
    const res = runMapArchCheck({ repo, engineCmd, maxInputChars: 100 });
    assert.equal(res.ok, true);
    assert.equal(res.incomplete, true);
  } finally {
    cleanup(base);
  }
});

test('(e) --write replaces existing 重構候選 section and preserves all other bytes', () => {
  const { base, repo } = makeSandbox('write-replace');
  try {
    const before = '# Arch\n\nIntro paragraph.\n\n';
    const after = '## Next Section\n\nKeep this exact.\n';
    const orig = before + '## 重構候選\n- old item\n\n' + after;
    const mapPath = path.join(repo, 'ARCHITECTURE.md');
    fs.writeFileSync(mapPath, orig, 'utf8');

    const items = [
      { title: 'Split', why: 'Too big', files: ['a.js', 'b.js'], recommendation: 'Extract helper' },
    ];
    const engineCmd = writeEngine(base, `process.stdout.write(${JSON.stringify(JSON.stringify(items))});`);
    const res = runMapArchCheck({ repo, engineCmd, write: true });
    assert.equal(res.ok, true);

    const updated = fs.readFileSync(mapPath, 'utf8');
    assert.ok(updated.startsWith(before));
    assert.ok(updated.endsWith(after));
    assert.ok(updated.includes('- Split：Too big（檔案：a.js, b.js）；推薦：Extract helper'));
    assert.ok(!updated.includes('- old item'));
  } finally {
    cleanup(base);
  }
});

test('(f) no ARCHITECTURE.md -> skipped: no_map', () => {
  const { base, repo } = makeSandbox('no-map');
  try {
    const engineCmd = writeEngine(base, `process.stdout.write('[]');`);
    const res = runMapArchCheck({ repo, engineCmd });
    assert.deepEqual(res, { ok: true, skipped: 'no_map' });
  } finally {
    cleanup(base);
  }
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    process.stdout.write(`PASS ${t.name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`FAIL ${t.name}: ${err.stack || err.message}\n`);
  }
}

process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
if (failed > 0) process.exit(1);
