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

// rule-capture rule (fake transcripts only)
const U = (text, ts = '2026-11-15T00:00:01Z') => ({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });
const A = (...blocks) => ({ type: 'assistant', message: { role: 'assistant', content: blocks } });
const T = (text) => ({ type: 'text', text });
const TU = (name, input = {}) => ({ type: 'tool_use', name, input });
const RULE = '花錢的在給我吧';
function cap(lines, active = true) {
  const d = mk(); const tp = path.join(d, 't.jsonl.txt');
  fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n'));
  const r = spawnSync('node', [SCRIPT, 'stop-hook', '--dir', d], {
    input: JSON.stringify({ transcript_path: tp, stop_hook_active: active }), encoding: 'utf8',
  });
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

test('rule-capture: marker and no capture blocks, prints marker only', () => {
  const o = cap([U(RULE), A(T('好'))]);
  assert.equal(o.decision, 'block'); assert.match(o.reason, /操作員這句像是規則/); assert.match(o.reason, /\[在給我\]$/);
  assert.ok(!o.reason.includes(RULE));
});
test('rule-capture: CLAUDE.md edit passes', () => {
  assert.equal(cap([U(RULE), A(TU('Edit', { file_path: '/x/repo/CLAUDE.md' }))]), null);
});
test('rule-capture: fleet dispatch passes', () => {
  assert.equal(cap([U(RULE), A(TU('mcp__fleet__dispatch', {}))]), null);
});
test('rule-capture: [no-rule: reason] passes, empty reason blocks', () => {
  assert.equal(cap([U(RULE), A(T('[no-rule: 只是問句]'))]), null);
  assert.equal(cap([U(RULE), A(T('[no-rule: ]'))]).decision, 'block');
});
test('rule-capture: no marker passes', () => {
  assert.equal(cap([U('現在幾點'), A(T('好'))]), null);
});
test('rule-capture: stop_hook_active is not a bypass', () => {
  assert.equal(cap([U(RULE), A(T('好'))], true).decision, 'block');
});
test('rule-capture: marker in an earlier turn does not count', () => {
  assert.equal(cap([U(RULE, '2026-11-15T00:00:01Z'), A(T('好')), U('現在幾點', '2026-11-15T00:00:09Z'), A(T('好'))]), null);
});
test('rule-capture: skills path, memory mechanism, ledger decision and tool_result-only user entries', () => {
  assert.equal(cap([U(RULE), A(TU('Write', { file_path: '/x/skills/a/SKILL.md' }))]), null);
  assert.equal(cap([U(RULE), A(TU('Write', { file_path: '/m/a.md', content: '---\nmechanism: scripts/a.js\n---' }))]), null);
  assert.equal(cap([U(RULE), A(TU('Bash', { command: 'bash ledger.sh decision add' }))]), null);
  const tr = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } };
  assert.equal(cap([U(RULE), A(TU('Bash', { command: 'ls' })), tr, A(T('好'))]).decision, 'block');
});

function capLog(lines) {
  const d = mk(); const tp = path.join(d, 't.jsonl.txt'); const log = path.join(d, 'sub', 'cap.jsonl');
  fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n'));
  spawnSync('node', [SCRIPT, 'stop-hook', '--dir', d], {
    input: JSON.stringify({ transcript_path: tp, session_id: 'sess1' }), encoding: 'utf8', env: { ...process.env, AUTOPILOT_RULE_CAPTURE_LOG: log },
  });
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
}
test('rule-capture log: block, no_rule, pass, no marker', () => {
  const b = capLog([U(RULE), A(T('好'))]);
  assert.equal(b.length, 1); assert.equal(b[0].schema, 'rule-capture-log/1'); assert.equal(b[0].outcome, 'block');
  assert.equal(b[0].marker, '在給我'); assert.equal(b[0].session_id, 'sess1'); assert.ok(!JSON.stringify(b[0]).includes(RULE));
  const n = capLog([U(RULE), A(T('[no-rule: x]'))]);
  assert.equal(n.length, 1); assert.equal(n[0].outcome, 'no_rule'); assert.equal(n[0].no_rule_reason, 'x');
  const p = capLog([U(RULE), A(TU('Edit', { file_path: '/x/repo/CLAUDE.md' }))]);
  assert.equal(p.length, 1); assert.equal(p[0].outcome, 'pass'); assert.equal(p[0].pass_by, 'claude_md');
  assert.equal(capLog([U('現在幾點'), A(T('好'))]).length, 0);
});
test('rule-capture log failure does not change the result', () => {
  const d = mk(); const tp = path.join(d, 't.jsonl.txt');
  fs.writeFileSync(tp, [U(RULE), A(T('好'))].map((l) => JSON.stringify(l)).join('\n'));
  const r = spawnSync('node', [SCRIPT, 'stop-hook', '--dir', d], {
    input: JSON.stringify({ transcript_path: tp }), encoding: 'utf8', env: { ...process.env, AUTOPILOT_RULE_CAPTURE_LOG: tp + '/x/y' },
  });
  assert.equal(JSON.parse(r.stdout).decision, 'block'); assert.match(r.stderr, /log failed/);
});
