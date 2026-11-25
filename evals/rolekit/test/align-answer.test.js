'use strict';
// Instrument alignment (PM 01M89TFH3D). The planner and explorer prompts say "the repository under input/" and the explorer kit asks for
// "the question number", so a correct answer names paths as input/<path> and q as "1"; the stamped checker grades <path> and "q1".
// Each case runs the runner's alignAnswer and then the real checker. Before alignAnswer the first two scored 0 ("not under the repo",
// "found mismatch"); the third and fourth prove a really wrong path or question still fails after alignment.
const test = require('node:test');
const assert = require('node:assert');
if (!process.env.AUTOPILOT_FLEET_TASK) process.env.AUTOPILOT_FLEET_TASK = '01M894HX0M2ERTZ1V5HVKFCSNK';
const { alignAnswer } = require('../run-pilot.js');
const { runCheck } = require('./helpers.js');

const sub = (id, scope, extra = {}) => ({ id, goal: 'g', scope, input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: [], ...extra });
const risks = [{ risk: 'r', disposition: 'accepted', note: 'n' }];
const graded = (role, id, ans, aligned = true) => runCheck(role, id, aligned ? alignAnswer(role, JSON.stringify(ans)) : ans);

test('planner: scopes written as input/<path> fail raw and pass once aligned', () => {
  const plan = { summary: 's', subtasks: [sub('a', ['input/lib/hooks.js']), sub('b', ['./input/cli.js'], { depends_on: ['a'] }), sub('c', ['input/docs/hooks.md'], { depends_on: ['a'] })], risks };
  const raw = graded('planner', 'd8-l-two-phase', plan, false);
  assert.strictEqual(raw.rc, 1); assert.match(raw.out.detail, /not under the repo/);
  assert.strictEqual(graded('planner', 'd8-l-two-phase', plan).rc, 0);
});
test('explorer: q "1" / 2 and input/<path> files fail raw and pass once aligned', () => {
  const id = 't15-cache-invalidation';
  const ans = { answers: [
    { q: '1', found: true, citations: [{ file: 'input/keys.py', line: 8, quote: 'return (record["id"],)' }] },
    { q: 2, found: true, citations: [{ file: 'input/store.py', line: 17, quote: 'self._cache = {}' }] },
    { q: 'q3', found: false, citations: [] }] };
  assert.strictEqual(graded('explorer', id, ans, false).rc, 1);
  assert.strictEqual(graded('explorer', id, ans).rc, 0);
});
test('a path that is not in the repo, a wrong file and a wrong question still fail after alignment', () => {
  const missing = { summary: 's', subtasks: [sub('a', ['input/nope/zzz.js']), sub('b', ['cli.js'], { depends_on: ['a'] }), sub('c', ['docs/hooks.md'], { depends_on: ['a'] })], risks };
  assert.strictEqual(graded('planner', 'd8-l-two-phase', missing).rc, 1);
  const id = 't15-cache-invalidation';
  const base = () => ({ answers: [
    { q: '1', found: true, citations: [{ file: 'input/keys.py', line: 8, quote: 'return (record["id"],)' }] },
    { q: '2', found: true, citations: [{ file: 'input/store.py', line: 17, quote: 'self._cache = {}' }] },
    { q: '3', found: false, citations: [] }] });
  const wrongFile = base(); wrongFile.answers[0].citations[0].file = 'input/store.py';
  assert.strictEqual(graded('explorer', id, wrongFile).rc, 1);
  const wrongQ = base(); wrongQ.answers[0].q = '9';
  assert.strictEqual(graded('explorer', id, wrongQ).rc, 1);
});
test('alignAnswer leaves other roles and unparseable text untouched', () => {
  assert.strictEqual(alignAnswer('reviewer', '{"q":"1"}'), '{"q":"1"}');
  assert.strictEqual(alignAnswer('explorer', 'not json'), 'not json');
});
