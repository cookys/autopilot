'use strict';

/**
 * Tests for scripts/lesson-lint.js. Run: node scripts/lesson-lint.test.js
 * Temp dirs only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'lesson-lint.js');
const NOW = '2026-11-15T00:00:00Z';
const ULID = '01M7DMQ082CTRGZCTD2BGF5GNC';

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-lint-')); }
function memo(dir, file, { type = 'feedback', created, mechanism, nested = false } = {}) {
  const f = [];
  if (created) f.push(`created: ${created}`);
  if (mechanism) f.push(`mechanism: ${mechanism}`);
  const meta = nested ? `metadata:\n${[`type: ${type}`, ...f].map((l) => `  ${l}`).join('\n')}` : [`type: ${type}`, ...f].join('\n');
  fs.writeFileSync(path.join(dir, file), `---\nname: ${file.replace('.md', '')}\ndescription: d\n${meta}\n---\nbody text\n`);
}
function check(dir) {
  const r = spawnSync('node', [SCRIPT, 'check', '--dir', dir, '--now', NOW, '--json'], { encoding: 'utf8', stdin: 'ignore' });
  return { status: r.status, out: JSON.parse(r.stdout) };
}
function codes(res) { return res.out.findings.map((f) => `${f.file}:${f.code}`); }
function hook(dir, transcriptLines) {
  const tp = path.join(dir, 'transcript.jsonl.txt');
  fs.writeFileSync(tp, transcriptLines.map((l) => JSON.stringify(l)).join('\n'));
  const r = spawnSync('node', [SCRIPT, 'stop-hook', '--dir', dir], {
    input: JSON.stringify({ transcript_path: tp, session_id: 's', stop_hook_active: true }), encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
const userAt = (iso) => ({ type: 'user', timestamp: iso, message: { role: 'user', content: 'hi' } });

test('clean file', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-11-10', mechanism: 'scripts/foo.js' });
  const r = check(d); assert.equal(r.status, 0); assert.deepEqual(r.out.findings, []); assert.deepEqual(r.out.files, ['a.md']);
});

test('nested metadata is read', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-11-10', mechanism: 'hooks/x.js', nested: true });
  assert.equal(check(d).status, 0);
});

test('missing created', () => {
  const d = mk(); memo(d, 'a.md', { mechanism: 'scripts/foo.js' });
  const r = check(d); assert.equal(r.status, 1); assert.deepEqual(codes(r), ['a.md:missing_created']);
});

test('missing mechanism, young: not overdue', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-11-10' });
  assert.deepEqual(codes(check(d)), ['a.md:missing_mechanism']);
});

test('missing mechanism, 15 days old: overdue', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-10-31' });
  assert.deepEqual(codes(check(d)), ['a.md:missing_mechanism', 'a.md:overdue']);
});

test('ULID mechanism valid, old file not overdue', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-09-01', mechanism: ULID });
  assert.equal(check(d).status, 0);
});

test('non-feedback and MEMORY.md ignored', () => {
  const d = mk(); memo(d, 'u.md', { type: 'user' }); memo(d, 'MEMORY.md', {});
  const r = check(d); assert.equal(r.status, 0); assert.deepEqual(r.out.files, []);
});

test('stop-hook blocks on file edited this turn without mechanism', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-11-14' });
  const old = new Date('2026-11-14T00:00:00Z'); fs.utimesSync(path.join(d, 'a.md'), old, old);
  const fresh = new Date(); fs.utimesSync(path.join(d, 'a.md'), fresh, fresh);
  const r = hook(d, [userAt('2020-01-01T00:00:00Z')]);
  assert.equal(r.out.decision, 'block'); assert.match(r.out.reason, /a\.md/); assert.match(r.out.reason, /mechanism/);
});

test('stop-hook passes when file edited this turn has mechanism', () => {
  const d = mk(); memo(d, 'a.md', { created: '2026-11-14', mechanism: 'scripts/foo.js' });
  assert.equal(hook(d, [userAt('2020-01-01T00:00:00Z')]).out, null);
});

test('stop-hook passes for young file edited before the last user message', () => {
  const d = mk(); memo(d, 'a.md', { created: new Date().toISOString().slice(0, 10) });
  const r = hook(d, [userAt('2999-01-01T00:00:00Z')]);
  assert.equal(r.status, 0); assert.equal(r.out, null);
});

test('stop-hook blocks on overdue even when the file was not touched this turn', () => {
  const d = mk(); memo(d, 'a.md', { created: '2020-01-01' });
  const r = hook(d, [userAt('2999-01-01T00:00:00Z')]);
  assert.equal(r.out.decision, 'block'); assert.match(r.out.reason, /a\.md/);
});

test('stop-hook fails open on unreadable dir', () => {
  const r = spawnSync('node', [SCRIPT, 'stop-hook', '--dir', '/nonexistent-lesson-dir'], { input: '{}', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
});

test('usage error exits 2', () => {
  assert.equal(spawnSync('node', [SCRIPT, 'check'], { encoding: 'utf8' }).status, 2);
});
