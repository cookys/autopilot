'use strict';
// lane-switch: arg parsing, dry-run printer, and the execute path. Fixture home in a temp dir.
// External commands are stubbed. Nothing here opens a credential file or prints an e-mail.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { main, startLine } = require('./lane-switch.js');
const { writeManifest, readManifest } = require('./lib/lane-manifest.js');
const { appendJournal, journalFile } = require('./lib/switch-journal.js');
const { claudeAccount } = require('./lib/account-alias.js');
const { handoffPath } = require('./resolve-repo-placement.js');

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
test('subprocess execute with no manifest exits 1, not the removed P2a refusal', () => {
  const f = fx();
  const r = cp.spawnSync(process.execPath, [TOOL, '--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE'], { env: { ...process.env, AUTOPILOT_LANE_BASE_DIR: f.base, HOME: f.home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /manifest/);
  assert.ok(!/P2 execution not enabled/.test(r.stderr));
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
const T0 = '2026-11-13T04:00:00.000Z';
const SECRET = 'sk-ant-oat01-abcdefghijkl';
const DROP_KEYS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AUTOPILOT_ACCOUNT', 'CODEFORGE_DATA_DIR'];
const SWITCH_ARGV = ['--lane', 'l1', '--profile', 'cookys', '--order', '01M70ABCDE'];
let envGate = Promise.resolve();
function lockEnv(fn) {
  const run = envGate.then(fn, fn);
  envGate = run.then(() => {}, () => {});
  return run;
}
function plant(f) {
  writeManifest(f.base, REC);
  const transcript = path.join(f.home, '.claude-profiles', 'stranity', 'projects', '-work-x', 'sid-123.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '{"type":"user"}\n');
  fs.mkdirSync(path.join(f.home, '.claude-profiles', 'cookys'), { recursive: true });
  const hp = handoffPath('/work/x', 'manual', f.home);
  fs.mkdirSync(path.dirname(hp), { recursive: true });
  fs.writeFileSync(hp, 'ready\n');
  fs.utimesSync(hp, new Date('2099-01-01T00:00:00Z'), new Date('2099-01-01T00:00:00Z'));
}
function marker(c) {
  const base = path.basename(c.bin);
  const line = c.args.join(' ');
  if (base === 'fleet' && c.args[0] === 'peers') return 'peers';
  if (base === 'fleet' && c.args[0] === 'send') return 'send';
  if (base === 'tmux' && line.includes('pane_current_path')) return 'cwd';
  if (base === 'tmux' && line.includes('pane_current_command')) return 'cmd';
  if (base === 'tmux' && c.args.includes('/exit')) return 'exit';
  if (base === 'tmux' && c.args.includes('C-c')) return 'int';
  if (base === 'tmux' && line.includes('--resume')) {
    if (line.includes('/cookys')) return 'resume:new';
    if (line.includes('/stranity')) return 'resume:old';
    return 'resume';
  }
  if (base === 'claude') return 'auth';
  if (base === 'codeforge') return 'collect';
  if (base === 'accept-dev-channel-prompt.sh') return 'accept';
  if (c.args[0] === '-e') return 'alias';
  return `other:${base}`;
}
function journalRows(base) {
  return fs.readFileSync(journalFile(base), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
// One stubbed world. phase before: seat live. /exit moves to release (directory row gone,
// shell is bash). A --resume send moves to up (same seat, no -2). shellNever keeps the
// command on claude so a skipped shell wait would still start, because the seat is already gone.
function world(f, opt) {
  const options = opt || {};
  const calls = [];
  const lines = [];
  const errs = [];
  let phase = 'before';
  let peersN = 0;
  let t = Date.parse(T0);
  const run = (bin, args, opts) => {
    const argv = [...args];
    calls.push({ bin, args: argv, env: opts && opts.env });
    const line = argv.join(' ');
    const base = path.basename(String(bin));
    if (base === 'fleet' && argv[0] === 'peers') {
      peersN += 1;
      if (options.seatOffline && phase === 'before' && peersN === 1) {
        return { status: 0, stdout: JSON.stringify({ members: [{ member: 'x--claude', state: 'offline' }] }), stderr: '' };
      }
      if (phase === 'release') return { status: 0, stdout: JSON.stringify({ members: [] }), stderr: '' };
      return { status: 0, stdout: JSON.stringify({ members: [{ member: 'x--claude', state: 'live', activity: 'idle' }] }), stderr: '' };
    }
    if (base === 'fleet' && argv[0] === 'send') return { status: 0, stdout: '', stderr: '' };
    if (base === 'tmux' && argv[0] === 'display' && line.includes('pane_current_path')) return { status: 0, stdout: '/work/x\n', stderr: '' };
    if (base === 'tmux' && argv[0] === 'display' && line.includes('pane_current_command')) {
      const cmd = options.shellNever ? 'claude' : (phase === 'release' ? 'bash' : 'claude');
      return { status: 0, stdout: `${cmd}\n`, stderr: '' };
    }
    if (base === 'tmux' && argv[0] === 'send-keys') {
      if (argv.includes('/exit')) phase = 'release';
      else if (line.includes('--resume')) phase = 'up';
      return { status: 0, stdout: '', stderr: '' };
    }
    if (base === 'claude') return { status: 0, stdout: '{"loggedIn":true,"loginExpiresAt":"2099-01-01T00:00:00.000Z"}', stderr: '' };
    if (base === 'codeforge') return { status: 0, stdout: '', stderr: '' };
    if (base === 'accept-dev-channel-prompt.sh') return { status: options.acceptStatus == null ? 0 : options.acceptStatus, stdout: '', stderr: '' };
    if (argv[0] === '-e') {
      const env = options.aliasMismatch
        ? { HOME: f.home, CLAUDE_CONFIG_DIR: path.join(f.home, '.claude-profiles', 'stranity') }
        : (opts && opts.env);
      return { status: 0, stdout: claudeAccount(env), stderr: '' };
    }
    throw new Error(`unexpected ${bin} ${line}`);
  };
  return {
    calls, lines, errs,
    go(argv) {
      return lockEnv(async () => {
        const saved = {};
        for (const k of DROP_KEYS) saved[k] = process.env[k];
        process.env.CLAUDE_CODE_OAUTH_TOKEN = SECRET;
        process.env.ANTHROPIC_API_KEY = SECRET;
        process.env.ANTHROPIC_AUTH_TOKEN = SECRET;
        process.env.AUTOPILOT_ACCOUNT = 'team';
        process.env.CODEFORGE_DATA_DIR = '/tmp/cf-data';
        try {
          return await main(argv, {
            home: f.home, baseDir: f.base, out: (s) => lines.push(s), err: (s) => errs.push(s),
            now: () => t, sleep: async (ms) => { t += ms; }, fs, run,
          });
        } finally {
          for (const k of DROP_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
          }
        }
      });
    },
  };
}
function assertScrubbed(f, w) {
  const pub = w.lines.join('\n') + w.errs.join('\n') + fs.readFileSync(journalFile(f.base), 'utf8');
  assert.ok(!pub.includes(SECRET), 'secret reached stdout, stderr or the journal');
  assert.ok(!pub.includes('@'), 'e-mail shape in stdout, stderr or the journal');
  for (const c of w.calls) {
    const argv = c.args.join(' ');
    assert.ok(!argv.includes(SECRET) && !argv.includes('@'), argv);
    assert.ok(c.env && typeof c.env === 'object');
    for (const k of DROP_KEYS) assert.ok(!Object.prototype.hasOwnProperty.call(c.env, k), k);
  }
}

// Negative control (evidence-discipline §58), shown red first.
// Captured red, before execute() waited on #{pane_current_command}:
//   node --test --test-name-pattern 'shell never returns' scripts/lane-switch.test.js
//   exited 1. AssertionError at this test: actual 3 !== expected 1.
//   main returned 3 ("P2 execution not enabled in P2a"); no --resume was reached.
// Sharpened after that capture: the handoff file is dated 2099 (the wait succeeds)
// and fleet peers is empty once /exit has been sent. A build that skips the shell
// wait therefore sees the seat free and sends claude --resume, which this assertion
// rejects. The pane command stays claude for the whole run.
test('negative control: shell never returns exits 1 and does not start', { timeout: 20000 }, async () => {
  const f = fx();
  plant(f);
  const w = world(f, { shellNever: true });
  const code = await w.go(SWITCH_ARGV);
  assert.strictEqual(code, 1);
  assert.ok(w.errs.includes('stop'), w.errs.join('\n'));
  assert.ok(w.calls.some((c) => c.args.includes('/exit')));
  assert.ok(!w.calls.some((c) => c.args.join(' ').includes('--resume')), 'must not start');
  assert.ok(!w.calls.some((c) => marker(c) === 'collect' || marker(c) === 'accept'));
  assert.strictEqual(readManifest(f.base, 'l1').profile, 'stranity');
  assertScrubbed(f, w);
});
test('execute: happy path runs steps in order and prints the confirm command', { timeout: 20000 }, async () => {
  const f = fx();
  plant(f);
  const w = world(f);
  const code = await w.go(SWITCH_ARGV);
  assert.strictEqual(code, 0, w.errs.join('\n'));
  assert.deepStrictEqual(w.calls.map(marker), [
    'peers', 'cwd', 'auth', 'auth', 'send', 'peers', 'exit', 'cmd', 'peers',
    'collect', 'resume:new', 'accept', 'peers', 'cwd', 'auth', 'alias',
  ]);
  const cookysDir = path.join(f.home, '.claude-profiles', 'cookys');
  const resume = w.calls.find((c) => marker(c) === 'resume:new');
  const expectCmd = `cd /work/x && ${startLine(cookysDir, 'sid-123', REC.launch_flags)}`;
  assert.strictEqual(resume.args[3], expectCmd);
  assert.ok(expectCmd.includes('-u AUTOPILOT_ACCOUNT'));
  assert.ok(!expectCmd.includes('CODEFORGE_DATA_DIR='));
  const acc = w.calls.find((c) => marker(c) === 'accept');
  assert.deepStrictEqual(acc.args, ['--pane', 'lanes:1.0', '--timeout', '90']);
  const alias = claudeAccount({ HOME: f.home, CLAUDE_CONFIG_DIR: cookysDir });
  assert.match(w.lines.join('\n'), new RegExp(`lane-switch-confirm\\.js --lane l1 --since ${T0.replace(/[.]/g, '\\.')} --alias ${alias}`));
  assert.deepStrictEqual(journalRows(f.base).map((r) => r.step), [
    'before:seat', 'before:pane-cwd', 'before:transcript', 'before:current-auth', 'before:cost-row', 'before:target-auth',
    'handoff-send', 'handoff-wait', 'stop', 'seat-release', 'collect-copy', 'start', 'dev-channel', 'after', 'confirm',
  ]);
  const saved = readManifest(f.base, 'l1');
  assert.strictEqual(saved.profile, 'cookys');
  assert.strictEqual(saved.session_id, 'sid-123');
  assertScrubbed(f, w);
});
test('execute: preflight seat offline changes nothing', { timeout: 20000 }, async () => {
  const f = fx();
  plant(f);
  const w = world(f, { seatOffline: true });
  const code = await w.go(SWITCH_ARGV);
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(w.errs, ['seat']);
  assert.ok(!w.calls.some((c) => ['exit', 'collect', 'accept', 'alias', 'resume:new', 'resume:old'].includes(marker(c))));
  const rows = journalRows(f.base);
  assert.strictEqual(rows.find((r) => r.step === 'before:seat').outcome, 'fail');
  assert.ok(!rows.some((r) => r.step === 'handoff-send'));
  assert.strictEqual(readManifest(f.base, 'l1').profile, 'stranity');
  assertScrubbed(f, w);
});
test('execute: dev-channel prompt failure reverses onto the old profile', { timeout: 20000 }, async () => {
  const f = fx();
  plant(f);
  const w = world(f, { acceptStatus: 1 });
  const code = await w.go(SWITCH_ARGV);
  assert.strictEqual(code, 1);
  assert.ok(w.errs.includes('dev-channel'), w.errs.join('\n'));
  const marks = w.calls.map(marker);
  const started = marks.indexOf('resume:new');
  const interrupted = marks.indexOf('int');
  const reversed = marks.indexOf('resume:old');
  assert.ok(started >= 0 && interrupted > started && reversed > interrupted, marks.join(','));
  assert.ok(marks.filter((m) => m === 'exit').length >= 2);
  assert.strictEqual(readManifest(f.base, 'l1').profile, 'stranity');
  assertScrubbed(f, w);
});
test('execute: alias mismatch after start reverses and reports one line', { timeout: 20000 }, async () => {
  const f = fx();
  plant(f);
  const w = world(f, { aliasMismatch: true });
  const code = await w.go(SWITCH_ARGV);
  assert.strictEqual(code, 1);
  assert.match(w.errs.join('\n'), /換訂閱失敗/);
  assert.match(w.errs.join('\n'), /別名/);
  assert.ok(w.calls.map(marker).includes('resume:old'));
  assert.strictEqual(readManifest(f.base, 'l1').profile, 'stranity');
  assert.deepStrictEqual(w.lines, []);
  assertScrubbed(f, w);
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
