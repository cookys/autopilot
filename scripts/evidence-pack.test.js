#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { buildPack, showPack, parseNotes } = require('./evidence-pack');

function git(cwd, args) {
  return execFileSync(
    'git',
    ['-C', cwd, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8' }
  ).trim();
}

test('buildPack: fixture repo with high-risk path, normal path, and notes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-pack-test-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q', '-b', 'feat/ev-test']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-q', '-m', 'base']);
    const base = git(repo, ['rev-parse', 'HEAD']);

    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scripts', 'pace-select.js'), 'line1\nline2\n');
    fs.writeFileSync(path.join(repo, 'normal.txt'), 'hello\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'changes']);
    const head = git(repo, ['rev-parse', 'HEAD']);

    const notesPath = path.join(tmp, 'notes.md');
    fs.writeFileSync(notesPath, [
      '## Tests',
      '0 node scripts/evidence-pack.test.js',
      '0 bash scripts/sync-all.sh --check',
      '',
      '## Risk',
      'medium',
      'Touches pace-select.js which governs runner selection.',
    ].join('\n'));

    const outPath = path.join(tmp, 'pack.json');
    const pack = buildPack({
      repo,
      base,
      head,
      runId: 'run-123',
      fleetTask: '01M7ZKZ8D4511JJ451P71J73R3',
      notes: notesPath,
      out: outPath,
    });

    assert.equal(pack.schema, 'autopilot.evidence-pack/1');
    assert.equal(pack.fleet_task, '01M7ZKZ8D4511JJ451P71J73R3');
    assert.equal(pack.run_id, 'run-123');
    assert.equal(pack.branch, 'feat/ev-test');
    assert.equal(pack.base, base);
    assert.equal(pack.head, head);
    assert.equal(pack.files.length, 2);
    assert.equal(pack.diff_lines, 3);
    assert.deepEqual(pack.high_risk_paths, ['scripts/pace-select.js']);
    assert.equal(pack.tests_green, true);
    assert.equal(pack.tests.length, 2);
    assert.deepEqual(pack.tests[0], { cmd: 'node scripts/evidence-pack.test.js', rc: 0 });
    assert.deepEqual(pack.risk, {
      level: 'medium',
      note: 'Touches pace-select.js which governs runner selection.',
    });
    assert.equal(fs.existsSync(outPath), true);

    const summary = showPack(outPath);
    const lineCount = summary.trimEnd().split('\n').length;
    assert.ok(lineCount <= 15, `expected <= 15 lines, got ${lineCount}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildPack: missing notes produces tests [], tests_green false, risk null', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-pack-missing-'));
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q', '-b', 'feat/missing-notes']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'base']);
    const base = git(repo, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\nb\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'edit']);
    const head = git(repo, ['rev-parse', 'HEAD']);

    const outPath = path.join(tmp, 'pack.json');
    const pack = buildPack({
      repo,
      base,
      head,
      runId: 'run-missing',
      notes: path.join(tmp, 'does-not-exist.md'),
      out: outPath,
    });

    assert.deepEqual(pack.tests, []);
    assert.equal(pack.tests_green, false);
    assert.equal(pack.risk, null);
    assert.deepEqual(pack.high_risk_paths, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseNotes: non-zero rc sets tests_green false', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-pack-fail-'));
  try {
    const notesPath = path.join(tmp, 'notes.md');
    fs.writeFileSync(notesPath, '## Tests\n1 npm test\n## Risk\nhigh\nTest failed.\n');
    const parsed = parseNotes(notesPath);
    assert.equal(parsed.tests_green, false);
    assert.deepEqual(parsed.tests, [{ cmd: 'npm test', rc: 1 }]);
    assert.deepEqual(parsed.risk, { level: 'high', note: 'Test failed.' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
