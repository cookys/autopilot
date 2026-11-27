'use strict';
// M12: a dispatch body that quotes a plan sha gets --expect-revision carried automatically.
// HOOK_UNDER_TEST overrides the hook path (used for the negative control mutant).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = process.env.HOOK_UNDER_TEST || path.join(__dirname, '..', '..', 'hooks', 'fleet-dispatch-class.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'exprev-home-'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

function run(task) {
  const payload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__fleet__dispatch',
    tool_input: { to: 'ns/courier/worker', task, size: 'M' },
  };
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, HOME },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

const BASE = 'Engine: sonnet\nRole: plan-reviewer\nSize: M\n';
const CMD = 'Run node scripts/dispatch-plan-review.js --plan-file docs/plans/x.md';

test('body quoting a sha -> --expect-revision present', () => {
  const out = run(`${BASE}Plan: docs/plans/x.md@abc1234\n${CMD}`);
  assert.match(out, /--expect-revision abc1234/);
});

test('body without a sha -> flag absent', () => {
  const out = run(`${BASE}Plan: plan-first\n${CMD}`);
  assert.doesNotMatch(out, /--expect-revision/);
});

test('explicit flag is preserved, not duplicated', () => {
  const out = run(`${BASE}Plan: docs/plans/x.md@abc1234\nRun node scripts/dispatch-plan-review.js --expect-revision def5678 --plan-file docs/plans/x.md`);
  assert.match(out, /--expect-revision def5678/);
  assert.doesNotMatch(out, /--expect-revision abc1234/);
});
