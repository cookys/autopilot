'use strict';
// P2a: lane-switch arg parsing, dry-run printer, manifest and journal. Fixture home in a temp dir; nothing is spawned.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { main } = require('./lane-switch.js');
const { writeManifest, readManifest } = require('./lib/lane-manifest.js');
const { appendJournal, journalFile } = require('./lib/switch-journal.js');

const TOOL = path.join(__dirname, 'lane-switch.js');
function fx() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lswt-'));
  const base = path.join(home, '.config', 'autopilot');
  return { home, base };
}
function run(f, argv) {
  const lines = []; const errs = [];
  const code = main(argv, { home: f.home, baseDir: f.base, out: (s) => lines.push(s), err: (s) => errs.push(s), now: '2026-11-11T00:00:00.000Z' });
  return { code, lines, errs };
}
const REC = { lane: 'l1', pane: 'lanes:1.0', cwd: '/work/x', seat: 'x--claude', session_id: 'sid-123', model: 'opus', launch_flags: ['--mcp-config=/shared/fleet.json'], profile: 'stranity' };

test('no --order: exit 2, no journal, no manifest read', () => {
  const f = fx();
  const r = run(f, ['--lane', 'l1', '--profile', 'cookys', '--dry-run']);
  assert.strictEqual(r.code, 2);
  assert.match(r.errs.join(), /--order/);
  assert.ok(!fs.existsSync(journalFile(f.base)));
});
test('non-dry-run refuses with exit 3', () => {
  const f = fx();
  const r = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE']);
  assert.strictEqual(r.code, 3);
  assert.match(r.errs.join(), /P2 execution not enabled in P2a/);
  assert.ok(!fs.existsSync(journalFile(f.base)));
});
test('usage errors: unknown arg, bad lane, bad profile', () => {
  const f = fx();
  assert.strictEqual(run(f, ['--bogus']).code, 2);
  assert.strictEqual(run(f, ['--lane', '../x', '--profile', 'p', '--order', 'abcd']).code, 2);
  assert.strictEqual(run(f, ['--lane', 'l', '--profile', 'a b', '--order', 'abcd']).code, 2);
});
test('dry-run prints steps 1-8 and rollback, journals one row, writes nothing else', () => {
  const f = fx();
  writeManifest(f.base, REC);
  const r = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE', '--dry-run']);
  assert.strictEqual(r.code, 0);
  const txt = r.lines.join('\n');
  for (const n of ['1 before', '2 handoff', '3 stop', '4 collect+copy', '5 start', '6 dev-channel', '7 after', '8 confirm', 'rollback']) assert.ok(txt.includes(`[${n}]`), n);
  assert.match(txt, /claude --resume sid-123 --mcp-config=\/shared\/fleet.json/);
  assert.match(txt, new RegExp(`CLAUDE_CONFIG_DIR=${f.home}/.claude-profiles/cookys claude`));
  assert.match(txt, /-u AUTOPILOT_ACCOUNT/);
  assert.ok(!/CODEFORGE_DATA_DIR=/.test(txt));
  assert.match(txt, /--profile 'stranity' --order '01M70ABCDE'/);
  const rows = fs.readFileSync(journalFile(f.base), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].step, rows[0].order, rows[0].from, rows[0].to], ['dry-run', '01M70ABCDE', 'stranity', 'cookys']);
  assert.strictEqual(fs.statSync(journalFile(f.base)).mode & 0o777, 0o600);
});
test('dry-run to home unsets CLAUDE_CONFIG_DIR; missing manifest prints placeholders', () => {
  const f = fx();
  const r = run(f, ['--lane', 'l9', '--profile', 'home', '--order', 'abcd1234', '--dry-run']);
  assert.strictEqual(r.code, 0);
  const txt = r.lines.join('\n');
  assert.match(txt, /-u CLAUDE_CONFIG_DIR claude --resume <session id>/);
  assert.match(txt, /placeholders/);
});
test('subprocess run with injected base dir: refuses without --order, spawns nothing', () => {
  const f = fx();
  const r = cp.spawnSync(process.execPath, [TOOL, '--lane', 'l1', '--profile', 'p'], { env: { ...process.env, AUTOPILOT_LANE_BASE_DIR: f.base }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(r.status, 2);
});

// lane-manifest negative controls
test('manifest: 0600 on write, round trip, prompt-text field rejected, wrong mode rejected', () => {
  const f = fx();
  const file = writeManifest(f.base, REC);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepStrictEqual(readManifest(f.base, 'l1'), REC);
  assert.throws(() => writeManifest(f.base, { ...REC, prompt: 'do the thing' }), /manifest_field_rejected:prompt/);
  assert.throws(() => writeManifest(f.base, { ...REC, launch_flags: ['fix the bug please'] }), /launch_flags/);
  fs.chmodSync(file, 0o644);
  assert.throws(() => readManifest(f.base, 'l1'), /manifest_mode_not_0600/);
  assert.strictEqual(readManifest(f.base, 'nolane'), null);
});
// switch-journal negative controls
test('journal: e-mail-shaped and token-shaped values rejected, nothing written', () => {
  const f = fx();
  const ok = { order: 'abcd1234', lane: 'l1', step: 's', outcome: 'ok' };
  assert.throws(() => appendJournal(f.base, { ...ok, detail: 'who@example.com' }), /email_shaped/);
  assert.throws(() => appendJournal(f.base, { ...ok, detail: 'sk-ant-oat01-abcdefghijkl' }), /token_shaped/);
  assert.throws(() => appendJournal(f.base, { ...ok, detail: 'A'.repeat(48) }), /token_shaped/);
  assert.throws(() => appendJournal(f.base, { ...ok, extra: 'x' }), /field_rejected/);
  assert.ok(!fs.existsSync(journalFile(f.base)));
  appendJournal(f.base, ok);
  assert.strictEqual(fs.readFileSync(journalFile(f.base), 'utf8').trim().split('\n').length, 1);
});

// profsw-fix1 finding 1: steps 1 and 4 target the OLD profile
test('steps 1 and 4 use the old (non-home) profile dir and never set CODEFORGE_DATA_DIR', () => {
  const f = fx();
  writeManifest(f.base, REC);
  const txt = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE', '--dry-run']).lines.join('\n');
  const old = `${f.home}/.claude-profiles/stranity`;
  assert.match(txt, new RegExp(`-u AUTOPILOT_ACCOUNT CLAUDE_CONFIG_DIR=${old} claude auth status --json`));
  assert.match(txt, new RegExp(`env -u CODEFORGE_DATA_DIR CLAUDE_CONFIG_DIR=${old} codeforge usage collect`));
});
test('steps 1 and 4 for a home source unset CLAUDE_CONFIG_DIR; no manifest uses a placeholder', () => {
  const f = fx();
  writeManifest(f.base, { ...REC, profile: 'home' });
  let txt = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE', '--dry-run']).lines.join('\n');
  assert.match(txt, /-u AUTOPILOT_ACCOUNT -u CLAUDE_CONFIG_DIR claude auth status --json/);
  assert.match(txt, /env -u CODEFORGE_DATA_DIR -u CLAUDE_CONFIG_DIR codeforge usage collect/);
  assert.ok(!/\.claude codeforge/.test(txt));
  txt = run(f, ['--lane', 'l9', '--profile', 'cookys', '--order', '01M70ABCDE', '--dry-run']).lines.join('\n');
  assert.match(txt, /CLAUDE_CONFIG_DIR=<old profile dir> claude auth status --json/);
  assert.match(txt, /env -u CODEFORGE_DATA_DIR CLAUDE_CONFIG_DIR=<old profile dir> codeforge usage collect/);
});

// finding 2: order shape and journal-before-print
test('order starting with - is a usage error; token-shaped order prints nothing', () => {
  const f = fx();
  writeManifest(f.base, REC);
  let r = run(f, ['--order', '--lane', 'l1', '--profile', 'cookys', '--dry-run']);
  assert.strictEqual(r.code, 2);
  r = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', '-abcd1234', '--dry-run']);
  assert.strictEqual(r.code, 2);
  r = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', 'sk-ant-oat01-abcdefghijkl', '--dry-run']);
  assert.strictEqual(r.code, 4);
  assert.deepStrictEqual(r.lines, []);
  assert.ok(!fs.existsSync(journalFile(f.base)));
});

// finding 3: manifest validation and quoting
test('manifest: type checks, whitespace-free fields, prompt flags and newlines rejected', () => {
  const f = fx();
  assert.throws(() => writeManifest(f.base, { ...REC, profile: 123 }), /profile_invalid/);
  assert.throws(() => writeManifest(f.base, { ...REC, lane: undefined }), /lane_invalid/);
  assert.throws(() => writeManifest(f.base, { ...REC, lane: 5 }), /lane_invalid/);
  for (const k of ['pane', 'seat', 'session_id', 'model']) {
    assert.throws(() => writeManifest(f.base, { ...REC, [k]: '' }), new RegExp(`manifest_value:${k}`));
    assert.throws(() => writeManifest(f.base, { ...REC, [k]: 'do the thing' }), new RegExp(`manifest_value:${k}`));
  }
  for (const fl of ['-p', '--print', '--prompt=hi', '--system-prompt', '--append-system-prompt=be nice', '-p=x', '--mcp-config=a\nb']) {
    assert.throws(() => writeManifest(f.base, { ...REC, launch_flags: [fl] }), /launch_flags/, fl);
  }
  writeManifest(f.base, REC);
});
test('start line quotes session_id', () => {
  const f = fx();
  writeManifest(f.base, { ...REC, session_id: 'a;b$c' });
  const txt = run(f, ['--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE', '--dry-run']).lines.join('\n');
  assert.ok(txt.includes(`claude --resume '\\''a;b$c'\\''`), txt);
  // every plan line (Step 5 and the RB rollback alike) must never carry the sid unquoted after --resume
  for (const line of txt.split('\n')) assert.ok(!line.includes('claude --resume a;b$c'), line);
  assert.ok(txt.split('\n').some((l) => l.startsWith('RB ')), 'RB line present');
});
