#!/usr/bin/env node
'use strict';
require('./lib/test-git-env'); // fixture repos must not run the account's global git config

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { buildPack, showPack, parseNotes, loadHighRiskGlobs, matchHighRiskPaths } = require('./evidence-pack');

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

test('matchHighRiskPaths: table of dispatch/pin/lock paths and non-matches', () => {
  const globs = loadHighRiskGlobs();
  const shouldMatch = [
    'scripts/dispatch-review.sh',
    'scripts/dispatch-author.sh',
    'scripts/dispatch-plan-review.js',
    'scripts/resolve-dispatch.sh',
    'scripts/lib/runner-pins.js',
    'scripts/lib/broker-run-pace.js',
    'scripts/lib/cn-model-dispatch-gate.js',
    'hooks/dispatch-model-guard.js',
  ];
  for (const p of shouldMatch) {
    assert.deepEqual(matchHighRiskPaths([p], globs), [p], `expected ${p} to match high-risk globs`);
  }
  const shouldNotMatch = ['README.md', 'docs/x.md'];
  for (const p of shouldNotMatch) {
    assert.deepEqual(matchHighRiskPaths([p], globs), [], `expected ${p} not to match high-risk globs`);
  }
});

function makeTestRepo(tmp, files) {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'feat/ev-merge']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);

  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(repo, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'changes']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  return { repo, base, head };
}

test('buildPack: (a) two rc=0 tests, Risk low, no high-risk path -> mergeable true', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-a-'));
  try {
    const { repo, base, head } = makeTestRepo(tmp, { 'normal.txt': 'ok\n' });
    const notesPath = path.join(tmp, 'notes.md');
    fs.writeFileSync(notesPath, '## Tests\n0 node a.test.js\n0 node b.test.js\n\n## Risk\nlow\nSafe change.\n');
    const pack = buildPack({ repo, base, head, runId: 'r-a', notes: notesPath, runner: 'codex', out: path.join(tmp, 'pack.json') });
    assert.equal(pack.mergeable, true);
    assert.deepEqual(pack.mergeable_reasons, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildPack: (b) one rc=1 -> mergeable false with reason tests_not_green', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-b-'));
  try {
    const { repo, base, head } = makeTestRepo(tmp, { 'normal.txt': 'ok\n' });
    const notesPath = path.join(tmp, 'notes.md');
    fs.writeFileSync(notesPath, '## Tests\n0 node a.test.js\n1 node b.test.js\n\n## Risk\nlow\nOne failed.\n');
    const pack = buildPack({ repo, base, head, runId: 'r-b', notes: notesPath, runner: 'codex', out: path.join(tmp, 'pack.json') });
    assert.equal(pack.mergeable, false);
    assert.ok(pack.mergeable_reasons.includes('tests_not_green'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildPack: (c) high-risk path -> mergeable false with reason high_risk_paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-c-'));
  try {
    const { repo, base, head } = makeTestRepo(tmp, { 'scripts/dispatch-review.sh': 'echo hi\n' });
    const notesPath = path.join(tmp, 'notes.md');
    fs.writeFileSync(notesPath, '## Tests\n0 node a.test.js\n\n## Risk\nlow\nSafe.\n');
    const pack = buildPack({ repo, base, head, runId: 'r-c', notes: notesPath, runner: 'codex', out: path.join(tmp, 'pack.json') });
    assert.equal(pack.mergeable, false);
    assert.ok(pack.mergeable_reasons.includes('high_risk_paths'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildPack: (d) no notes file -> mergeable false with reasons tests_not_green and risk_missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-d-'));
  try {
    const { repo, base, head } = makeTestRepo(tmp, { 'normal.txt': 'ok\n' });
    const pack = buildPack({ repo, base, head, runId: 'r-d', notes: path.join(tmp, 'missing.md'), runner: 'codex', out: path.join(tmp, 'pack.json') });
    assert.equal(pack.mergeable, false);
    assert.ok(pack.mergeable_reasons.includes('tests_not_green'));
    assert.ok(pack.mergeable_reasons.includes('risk_missing'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildPack: (e) non-Claude runner -> claude_usage.claude_tokens 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-e-'));
  try {
    const { repo, base, head } = makeTestRepo(tmp, { 'normal.txt': 'ok\n' });
    const notesPath = path.join(tmp, 'notes.md');
    fs.writeFileSync(notesPath, '## Tests\n0 node a.test.js\n\n## Risk\nlow\nSafe.\n');
    const pack = buildPack({ repo, base, head, runId: 'r-e', notes: notesPath, runner: 'grok', out: path.join(tmp, 'pack.json') });
    assert.deepEqual(pack.claude_usage, { runner: 'grok', claude_tokens: 0 });
    assert.equal(pack.mergeable, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dispatch-hetero.sh: prompt banners include AUTOPILOT_EVIDENCE_NOTES instruction', () => {
  const src = fs.readFileSync(path.join(__dirname, 'dispatch-hetero.sh'), 'utf8');
  assert.ok(src.includes('AUTOPILOT_EVIDENCE_NOTES'), 'dispatch-hetero.sh should reference AUTOPILOT_EVIDENCE_NOTES');
  assert.ok(src.includes('## Tests') && src.includes('## Risk'), 'dispatch-hetero.sh should instruct ## Tests and ## Risk sections');
});
