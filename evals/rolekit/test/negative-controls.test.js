'use strict';
// One bad-output control (and, beside it, a good output so the control cannot pass vacuously) for every task of every
// machine check. README.md "Negative controls" lists these test names. No model, no binary beyond node.
const test = require('node:test');
const assert = require('node:assert');
const { runCheck } = require('./helpers.js');

const rev = (file, line, claim, sev = 'major', verdict = 'FIX-THEN-SHIP') => ({ verdict, findings: [{ severity: sev, file, line, claim }] });

test('negctl reviewer kb-05: a finding about something else, and SHIP-AS-IS, fail; the real finding passes', () => {
  const f = 'scripts/check-node-report.sh';
  assert.strictEqual(runCheck('reviewer', 'kb-05', rev(f, 123, 'off-by-one: >= rejects a valid end line equal to the last line')).rc, 0);
  assert.strictEqual(runCheck('reviewer', 'kb-05', rev(f, 123, 'variable names are unclear')).rc, 1);
  assert.strictEqual(runCheck('reviewer', 'kb-05', rev(f, 123, 'off-by-one: >= rejects the last line', 'major', 'SHIP-AS-IS')).rc, 1);
});
test('negctl reviewer kb-09: a vague claim citing a line outside every hunk fails; the real finding passes', () => {
  const f = 'scripts/check-node-report.sh';
  assert.strictEqual(runCheck('reviewer', 'kb-09', rev(f, 82, "removing '// empty' makes jq print the literal null, bypassing the non-empty guard")).rc, 0);
  assert.strictEqual(runCheck('reviewer', 'kb-09', rev(f, 5, "removing '// empty' makes jq print the literal null, bypassing the non-empty guard")).rc, 1);
  assert.strictEqual(runCheck('reviewer', 'kb-09', rev(f, 82, 'consider adding a comment')).rc, 1);
});

const plan = (scope1, scope2, extra = {}) => ({ summary: 's', risks: [{ risk: 'r', disposition: 'deferred', note: 'n' }], subtasks: [
  { id: 'a', goal: 'g', scope: scope1, input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: [] },
  { id: 'b', goal: 'g', scope: scope2, input: 'i', output: 'o', acceptance: ['bash run-tests.sh'], boundaries: 'b', depends_on: ['a'], ...extra }] });
for (const id of ['d2-l-multimodule', 'dc-l-api']) {
  test(`negctl planner ${id}: a plan that skips docs/, or has an empty acceptance list, fails; a covering plan passes`, () => {
    assert.strictEqual(runCheck('planner', id, plan(['lib/plugins.js', 'docs/plugins.md'], ['cli.js'])).rc, 0);
    assert.strictEqual(runCheck('planner', id, plan(['lib/plugins.js'], ['cli.js'])).rc, 1);
    assert.strictEqual(runCheck('planner', id, plan(['lib/plugins.js', 'docs/plugins.md'], ['cli.js'], { acceptance: [] })).rc, 1);
  });
}
test('negctl planner d8-l-two-phase: stages without a dependency edge fail', () => {
  const p = plan(['lib/hooks.js', 'docs/hooks.md'], ['cli.js']); p.subtasks[1].depends_on = [];
  assert.strictEqual(runCheck('planner', 'd8-l-two-phase', p).rc, 1);
});

const dbg = (file, line, claim) => ({ evidence: [{ cmd: 'x', observation: 'y' }], hypotheses: [{ claim: 'h1', file, line, status: 'refuted', evidence_ref: 0 }, { claim: 'h2', file, line, status: 'confirmed', evidence_ref: 0 }], root_cause: { file, line, claim } });
test('negctl debugger t11-boundary-fix: blaming main.py fails; the pager off-by-one passes', () => {
  assert.strictEqual(runCheck('debugger', 't11-boundary-fix', dbg('lib/pager.py', 14, 'off-by-one: end - 1 on the last page')).rc, 0);
  assert.strictEqual(runCheck('debugger', 't11-boundary-fix', dbg('main.py', 9, 'off-by-one in the caller')).rc, 1);
});
test('negctl debugger t15-cache-invalidation: blaming service.py (the decoy) fails; the cache key passes', () => {
  assert.strictEqual(runCheck('debugger', 't15-cache-invalidation', dbg('keys.py', 8, 'the cache key uses only the id, so a changed role collapses onto the stale entry')).rc, 0);
  assert.strictEqual(runCheck('debugger', 't15-cache-invalidation', dbg('service.py', 26, 'the stale cache is returned here')).rc, 1);
});
test('negctl debugger t4-config-layer: the parser decoy fails (also covered in checks.test.js)', () => {
  assert.strictEqual(runCheck('debugger', 't4-config-layer', dbg('lib/parser.js', 4, 'precedence is broken by the parser')).rc, 1);
});

const exp = (cites) => ({ answers: cites });
test('negctl explorer t4-config-layer: citing the right file with a made-up line text fails; real citations pass', () => {
  const good = exp([
    { q: 'q1', found: true, citations: [{ file: 'lib/config.js', line: 17, quote: 'const resolved = Object.assign({}, env, defaults, override);' }] },
    { q: 'q2', found: true, citations: [{ file: 'lib/parser.js', line: 6, quote: 'return JSON.parse(content);' }] },
    { q: 'q3', found: false, citations: [] }]);
  assert.strictEqual(runCheck('explorer', 't4-config-layer', good).rc, 0);
  const bad = JSON.parse(JSON.stringify(good)); bad.answers[0].citations[0].quote = 'const merged = deepMerge(a, b);';
  assert.strictEqual(runCheck('explorer', 't4-config-layer', bad).rc, 1);
});
test('negctl explorer t11-boundary-fix: inventing a database connection (found=true for the absent thing) fails', () => {
  const good = exp([
    { q: 'q1', found: true, citations: [{ file: 'lib/pager.py', line: 1, quote: 'def paginate(items, page_num, page_size):' }] },
    { q: 'q2', found: true, citations: [{ file: 'main.py', line: 9, quote: 'result = paginate(items, page_num, page_size)' }] },
    { q: 'q3', found: false, citations: [] }]);
  assert.strictEqual(runCheck('explorer', 't11-boundary-fix', good).rc, 0);
  const bad = JSON.parse(JSON.stringify(good)); bad.answers[2] = { q: 'q3', found: true, citations: [{ file: 'main.py', line: 1, quote: 'import sys' }] };
  assert.strictEqual(runCheck('explorer', 't11-boundary-fix', bad).rc, 1);
});
