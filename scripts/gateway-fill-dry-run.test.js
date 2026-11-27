#!/usr/bin/env node
'use strict';
require('./lib/test-git-env'); // fixture repos must not run the account's global git config

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const { laneNameFromBacklog } = require('./gateway-fill-dry-run');

const SCRIPT = path.join(__dirname, 'gateway-fill-dry-run.js');

function makeEntry({
  id,
  title,
  priority,
  engineClass,
}) {
  const lines = [
    `### ${title}`,
    `- **Id**: ${id}`,
    '- **Status**: open',
    '- **Since**: 2026-11-23',
    '- **Origin**: self',
    '- **Trigger**: when ready',
    '- **Trigger-Type**: ready',
    '- **Effort**: S',
    '- **Source**: test',
    '- **Pointer**: docs/plans/ok.md',
    '- **Done-Check**: `node scripts/gateway-fill-dry-run.test.js`',
    '- **Artifact**: code',
    '- **Needs**: none',
    '- **ms**: dry-run-test',
    '- **Used-by**: e2e',
    '- **Queued-By**: ns/c/m self',
    '- **Problem**: synthetic test problem',
    '- **Impact**: synthetic test impact',
  ];
  if (priority) {
    lines.push(`- **Priority**: ${priority}`);
  }
  if (engineClass) {
    lines.push(`- **Engine-Class**: ${engineClass}`);
  }
  return lines.join('\n');
}

// A backlog's Pointer resolves from the git root, so each synthetic repo is a real one.
function initRepo(root) {
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'ok.md'), 'ok\n');
  const r = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function writeBacklog(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = [
    '<!-- next-id: BL-0004 -->',
    '',
    ...entries,
    '',
  ].join('\n\n');
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeFill(filePath, { generatedAt, backends }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      schema: 'capacity.gateway-fill/1',
      generated_at: generatedAt,
      backends,
    }),
    'utf8'
  );
}

function runDryRun(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function runTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-fill-dry-run-'));
  try {
    // 1. laneNameFromBacklog unit checks
    assert.equal(laneNameFromBacklog('/tmp/alpha/BACKLOG.md'), 'alpha');
    assert.equal(laneNameFromBacklog('/tmp/beta/docs/BACKLOG.md'), 'beta');

    // Setup two synthetic repos: alpha/BACKLOG.md and beta/docs/BACKLOG.md
    const alphaBacklog = path.join(tmpRoot, 'alpha', 'BACKLOG.md');
    const betaBacklog = path.join(tmpRoot, 'beta', 'docs', 'BACKLOG.md');

    initRepo(path.join(tmpRoot, 'alpha'));
    initRepo(path.join(tmpRoot, 'beta'));
    writeBacklog(alphaBacklog, [
      makeEntry({ id: 'BL-0001', title: 'Alpha P2 cheap', priority: 'P2', engineClass: 'cheap' }),
      makeEntry({ id: 'BL-0002', title: 'Alpha non-cheap', priority: 'P1' }),
      makeEntry({ id: 'BL-0003', title: 'Alpha default P3 cheap', engineClass: 'cheap' }),
    ]);

    writeBacklog(betaBacklog, [
      makeEntry({ id: 'BL-0001', title: 'Beta P1 cheap', priority: 'P1', engineClass: 'cheap' }),
    ]);

    const freshFill = path.join(tmpRoot, 'fill-fresh.json');
    writeFill(freshFill, {
      generatedAt: new Date().toISOString(),
      backends: [{ name: 'grok-fast', eligible: true, quota: 2 }],
    });

    // 2. Cheap filter, priority order (P1 before P2, default P3), quota exhaustion, multi-backlog lanes, review suffix
    const res = runDryRun([
      '--backlog', alphaBacklog,
      '--backlog', betaBacklog,
      '--fill', freshFill,
    ]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n');

    const dryRunLines = lines.filter((l) => l.startsWith('DRY-RUN '));
    assert.equal(dryRunLines.length, 2, `expected 2 DRY-RUN lines, got:\n${res.stdout}`);
    assert.match(dryRunLines[0], /id=beta\/BL-0001 lane=beta backend=grok-fast .* review=回 beta 審查$/);
    assert.match(dryRunLines[1], /id=alpha\/BL-0001 lane=alpha backend=grok-fast .* review=回 alpha 審查$/);

    assert.ok(lines.includes('skip alpha/BL-0002 not_cheap'), `expected not_cheap skip in:\n${res.stdout}`);
    assert.ok(lines.includes('skip alpha/BL-0003 no_quota'), `expected no_quota skip in:\n${res.stdout}`);
    assert.ok(lines.includes('dry-run: 2 assigned, 2 skipped'), `expected summary in:\n${res.stdout}`);

    // 3. Stale signal file -> unavailable, 0 assigned, exit 0
    const staleFill = path.join(tmpRoot, 'fill-stale.json');
    writeFill(staleFill, {
      generatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      backends: [{ name: 'grok-fast', eligible: true, quota: 2 }],
    });
    const staleRes = runDryRun([
      '--backlog', alphaBacklog,
      '--fill', staleFill,
    ]);
    assert.equal(staleRes.status, 0);
    assert.equal(staleRes.stdout.trim(), 'gateway-fill unavailable: stale');

    console.log('gateway-fill-dry-run.test.js: all tests passed');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runTests();
