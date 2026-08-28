'use strict';
// Run: node --test scripts/check-foreman-polling.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractBashCommands, analyzeCommands } = require('./check-foreman-polling.js');

function jsonl(command) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
    },
  });
}

test('extracts Bash tool_use from JSONL', () => {
  const text = `${jsonl('git status')}\n${jsonl('sleep 240')}\n`;
  const cmds = extractBashCommands(text);
  assert.deepEqual(cmds, ['git status', 'sleep 240']);
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
