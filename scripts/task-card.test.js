'use strict';

/**
 * Tests for scripts/task-card.js (plan 2026-10-13-workflow-snapshot-at-compaction, P2) and for the
 * snapshot reading the card back. Run: node --test scripts/task-card.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'task-card.js');
const { collect } = require('./lib/workflow-snapshot.js');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskcard-'));
  const env = { ...process.env, AUTOPILOT_TASK_CARD_DIR: dir };
  delete env.AUTOPILOT_SESSION_ID; delete env.CLAUDE_CODE_SESSION_ID; delete env.CLAUDE_SESSION_ID;
  const cli = (args, extraEnv = {}) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } });
  return { dir, cli, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('set / show / merge / clear round trip', () => {
  const s = sandbox();
  try {
    let r = s.cli(['set', '--goal', 'ship it', '--success', 'a', '--success', 'b', '--plan', 'docs/plans/x.md', '--session', 'sess-1']);
    assert.strictEqual(r.status, 0, r.stderr);
    r = s.cli(['set', '--requirement', 'fail-open', '--session', 'sess-1']);
    assert.strictEqual(r.status, 0, r.stderr);
    r = s.cli(['show', '--session', 'sess-1']);
    const c = JSON.parse(r.stdout);
    assert.strictEqual(c.goal, 'ship it');
    assert.deepStrictEqual(c.success, ['a', 'b']);
    assert.deepStrictEqual(c.requirements, ['fail-open']);
    assert.strictEqual(c.plan, 'docs/plans/x.md');
    const mode = fs.statSync(path.join(s.dir, 'sess-1.json')).mode & 0o777;
    assert.strictEqual(mode, 0o600);
    r = s.cli(['clear', '--session', 'sess-1']);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.existsSync(path.join(s.dir, 'sess-1.json')), false);
  } finally { s.cleanup(); }
});

test('field caps: goal 600, list item 300, ten items', () => {
  const s = sandbox();
  try {
    const args = ['set', '--goal', 'g'.repeat(900), '--session', 'sess-2'];
    for (let i = 0; i < 14; i++) args.push('--success', 's'.repeat(500));
    assert.strictEqual(s.cli(args).status, 0);
    const c = JSON.parse(s.cli(['show', '--session', 'sess-2']).stdout);
    assert.strictEqual(c.goal.length, 600);
    assert.strictEqual(c.success.length, 10);
    assert.strictEqual(c.success[0].length, 300);
  } finally { s.cleanup(); }
});

test('no session id and no --session is a usage error, never a cwd-keyed file', () => {
  const s = sandbox();
  try {
    const r = s.cli(['set', '--goal', 'x']);
    assert.strictEqual(r.status, 2);
    assert.deepStrictEqual(fs.readdirSync(s.dir), []);
    assert.strictEqual(s.cli(['bogus']).status, 2);
    assert.strictEqual(s.cli(['set', '--nope', 'x', '--session', 'a']).status, 2);
  } finally { s.cleanup(); }
});

test('the session id comes from the Claude Code environment and the snapshot reads the card back', () => {
  const s = sandbox();
  try {
    assert.strictEqual(s.cli(['set', '--goal', 'from env', '--requirement', 'r1'], { CLAUDE_CODE_SESSION_ID: 'env-sess' }).status, 0);
    const snap = collect({ sessionId: 'env-sess', cwd: '', dirs: { taskCard: s.dir, live: path.join(s.dir, 'nolive'), sessionMode: path.join(s.dir, 'nosm'), dispatchRuns: path.join(s.dir, 'noruns') }, git: () => null });
    assert.strictEqual(snap.sources['task card'], 'ok');
    assert.match(snap.lines.join('\n'), /task card — goal: from env/);
    assert.match(snap.lines.join('\n'), /stated requirements: r1/);
  } finally { s.cleanup(); }
});
