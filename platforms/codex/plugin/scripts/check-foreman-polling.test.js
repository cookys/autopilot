'use strict';
// Run: node --test scripts/check-foreman-polling.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractBashCommands, analyzeCommands } = require('./check-foreman-polling.js');

function jsonl(command, run_in_background = false) {
  const input = { command };
  if (run_in_background) {
    input.run_in_background = true;
  }
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Bash', input }],
    },
  });
}

test('extracts Bash tool_use from JSONL', () => {
  const text = `${jsonl('git status')}\n${jsonl('sleep 240', true)}\n`;
  const cmds = extractBashCommands(text);
  assert.deepEqual(cmds, [
    { command: 'git status', run_in_background: false },
    { command: 'sleep 240', run_in_background: true },
  ]);
});

test('GREEN: two git Bash calls', () => {
  const r = analyzeCommands(['git status', 'git diff'], 'x');
  assert.equal(r.verdict, 'GREEN');
  assert.equal(r.counts.bash, 2);
});

test('RED: three sleep >=30', () => {
  const r = analyzeCommands(['sleep 30', 'sleep 240; echo waited', 'sleep 90'], 'x');
  assert.equal(r.verdict, 'RED');
  assert.ok(r.reasons.some((s) => s.startsWith('sleep_loop')));
  assert.equal(r.counts.sleep_ge_30, 3);
});

test('GREEN: sleep 2 does not count', () => {
  const r = analyzeCommands(['sleep 2', 'sleep 2', 'sleep 2'], 'x');
  assert.equal(r.verdict, 'GREEN');
  assert.equal(r.counts.sleep_ge_30, 0);
});

test('RED: cat /tasks/*.output', () => {
  const r = analyzeCommands(
    ['cat /tmp/claude/sess/tasks/leaf.output'],
    'x',
  );
  assert.equal(r.verdict, 'RED');
  assert.ok(r.reasons.some((s) => s.startsWith('leaf_output_read')));
});

test('RED: tail of tasks output', () => {
  const r = analyzeCommands(
    ['tail -12 /tmp/x/tasks/abc.output'],
    'x',
  );
  assert.equal(r.verdict, 'RED');
});

test('GREEN: grep of .output is not a listed reader', () => {
  const r = analyzeCommands(
    ['grep FAIL /tmp/x/tasks/abc.output'],
    'x',
  );
  assert.equal(r.verdict, 'GREEN');
});

test('RED: bash cap 41', () => {
  const cmds = Array.from({ length: 41 }, (_, i) => `echo ${i}`);
  const r = analyzeCommands(cmds, 'x');
  assert.equal(r.verdict, 'RED');
  assert.ok(r.reasons.some((s) => s.startsWith('bash_cap')));
});

test('GREEN: background until-loop with sleep >=30', () => {
  const r = analyzeCommands([
    { command: 'until [ -f /tmp/done ]; do sleep 30; done', run_in_background: true },
    { command: 'until test -f /tmp/ok; do sleep 60; done', run_in_background: true },
    'git status',
  ], 'x');
  assert.equal(r.verdict, 'GREEN');
  assert.equal(r.counts.sleep_ge_30, 0);
  assert.equal(r.counts.bash, 3);
});

test('RED: foreground sleep x 3', () => {
  const r = analyzeCommands([
    { command: 'sleep 30', run_in_background: false },
    { command: 'sleep 60', run_in_background: false },
    { command: 'sleep 120', run_in_background: false },
  ], 'x');
  assert.equal(r.verdict, 'RED');
  assert.ok(r.reasons.some((s) => s.startsWith('sleep_loop')));
  assert.equal(r.counts.sleep_ge_30, 3);
});

