// # RED at bd5338c1d: node --test scripts/roundtable-window.test.js exit 1.
// tests 7, pass 0, fail 7. Each spawn of scripts/roundtable-window.js exited
// MODULE_NOT_FOUND (the seats case also died on missing scripts/lib/room-log.js).
'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'roundtable-window.js');

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-window-test-'));
  const env = { ...process.env, AUTOPILOT_ROOMS_DIR: dir };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.TMUX;
  delete env.ROUNDTABLE_SEATS;
  delete env.NO_COLOR;
  return {
    dir,
    env,
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function writeFake(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, { mode: 0o755 });
  return p;
}

function fleetFake() {
  return `#!/usr/bin/env node
const fs = require('fs');
const log = process.env.FAKE_ARGV_LOG;
fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
const handle = process.argv[3];
const fail = process.env.FAIL_HANDLES ? process.env.FAIL_HANDLES.split(',') : [];
if (fail.includes(handle)) {
  process.stderr.write(process.env.FAIL_STDERR || 'seat-down');
  process.exit(Number(process.env.FAIL_STATUS || '3'));
}
process.exit(0);
`;
}

function run(args, env, stdin) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env,
    input: stdin,
    encoding: 'utf8',
  });
  return r;
}

test('send calls fleet once per seat with one argv text argument', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const text = 'hello 討論 world\nsecond line';
    const r = run(
      ['--seats', 'ns/courier/a,ns/courier/b', 'send', 'room-a', text],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 2);
    const handles = calls.map((c) => c[1]).sort();
    assert.deepEqual(handles, ['ns/courier/a', 'ns/courier/b']);
    for (const c of calls) {
      assert.equal(c[0], 'send');
      assert.equal(c.length, 3);
      assert.equal(c[2].includes(text), true);
      assert.match(c[2], /room-a/);
      assert.match(c[2], /#1|seq.?1/);
    }
    const { readAll } = require('./lib/room-log');
    const rows = readAll('room-a', s.env);
    assert.equal(rows[0].from, 'owner');
    assert.equal(rows[0].kind, 'say');
    assert.equal(rows[0].text, text);
    assert.equal(rows.some((row) => row.kind === 'system'), false);
  } finally {
    s.cleanup();
  }
});

test('a non-zero seat exits 1, records a system row, and keeps the owner say', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const env = {
      ...s.env,
      ROUNDTABLE_FLEET_BIN: fleet,
      FAKE_ARGV_LOG: log,
      FAIL_HANDLES: 'ns/courier/bad',
      FAIL_STATUS: '3',
      FAIL_STDERR: 'relay refused 討論',
    };
    const r = run(['--seats', 'ns/courier/ok,ns/courier/bad', 'send', 'room-b', 'owner line'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ns\/courier\/bad/);
    assert.match(r.stderr, /3/);
    assert.match(r.stderr, /relay refused/);
    const { readAll } = require('./lib/room-log');
    const rows = readAll('room-b', s.env);
    assert.equal(rows.some((row) => row.kind === 'say' && row.from === 'owner' && row.text === 'owner line'), true);
    const sys = rows.find((row) => row.kind === 'system');
    assert.ok(sys);
    assert.match(sys.text, /ns\/courier\/bad/);
    assert.match(sys.text, /3/);
    assert.match(sys.text, /relay refused 討論/);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2);

    const r2 = run(
      ['--seats', 'ns/courier/bad,ns/courier/bad2', 'send', 'room-c', 'all down'],
      { ...env, FAIL_HANDLES: 'ns/courier/bad,ns/courier/bad2' },
    );
    assert.equal(r2.status, 1);
  } finally {
    s.cleanup();
  }
});

// Negative control against the real send subcommand: a fake fleet that exits
// non-zero must leave a system failure row and a non-zero process status.
// A status-ignoring send would exit 0 with no system row and fail this test.
test('a fake fleet exiting non-zero for a seat writes a system failure row and the real send exits non-zero', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['--seats', 'ns/courier/quiet', 'send', 'room-z', 'silent'],
      {
        ...s.env,
        ROUNDTABLE_FLEET_BIN: fleet,
        FAKE_ARGV_LOG: log,
        FAIL_HANDLES: 'ns/courier/quiet',
        FAIL_STATUS: '3',
        FAIL_STDERR: 'relay refused 討論',
      },
    );
    assert.notEqual(r.status, 0);
    const { readAll } = require('./lib/room-log');
    const rows = readAll('room-z', s.env);
    assert.equal(rows.some((row) => row.kind === 'say' && row.from === 'owner' && row.text === 'silent'), true);
    const sys = rows.find((row) => row.kind === 'system');
    assert.ok(sys);
    assert.match(sys.text, /ns\/courier\/quiet/);
    assert.match(sys.text, /3/);
    assert.match(sys.text, /relay refused 討論/);
  } finally {
    s.cleanup();
  }
});

test('seats default to say-row handles; --local and empty handles are rejected', () => {
  const s = scratch();
  try {
    const { append } = require('./lib/room-log');
    append('room-d', { from: 'owner', kind: 'say', text: 'earlier', reply_to: null }, s.env);
    append('room-d', { from: 'moderator', kind: 'say', text: 'mod', reply_to: null }, s.env);
    append('room-d', { from: 'ns/courier/seat1', kind: 'say', text: 'ready', reply_to: null }, s.env);
    append('room-d', { from: 'ns/courier/seat2', kind: 'relay', text: 'not a say', reply_to: null }, s.env);
    append('room-d', { from: 'ns/courier/seat1', kind: 'say', text: 'again', reply_to: null }, s.env);
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['send', 'room-d', 'follow up'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(calls.map((c) => c[1]).sort(), ['ns/courier/seat1']);

    const local = run(
      ['--seats', 'host--local-pane', 'send', 'room-d', 'no'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.notEqual(local.status, 0);
    assert.match(local.stderr, /--local/);

    const empty = run(
      ['--seats', 'ns/courier/a,', 'send', 'room-e', 'no'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /empty/i);
  } finally {
    s.cleanup();
  }
});

test('tail --once prints header and indent, no background or reverse, NO_COLOR has no ESC', () => {
  const s = scratch();
  try {
    const { append } = require('./lib/room-log');
    append('room-t', { from: 'owner', kind: 'say', text: '擁有者\n第二行', reply_to: null, round: 1 }, s.env);
    append('room-t', { from: 'moderator', kind: 'system', text: '系統列', reply_to: null }, s.env);
    append('room-t', { from: 'ns/courier/seat1', kind: 'say', text: '席位說', reply_to: null }, s.env);
    const r = run(['tail', 'room-t', '--once'], s.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /#1 owner say/);
    assert.match(r.stdout, /round/);
    assert.match(r.stdout, /\n {2}擁有者\n {2}第二行/);
    assert.match(r.stdout, /系統列/);
    assert.match(r.stdout, /席位說/);
    assert.equal(/\x1b\[4\d*m/.test(r.stdout), false);
    assert.equal(/\x1b\[10\d*m/.test(r.stdout), false);
    assert.equal(/\x1b\[7m/.test(r.stdout), false);
    const { OWNER_FG, ATTENTION_FG } = require('./roundtable-window');
    assert.match(r.stdout, new RegExp(OWNER_FG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(r.stdout, new RegExp(ATTENTION_FG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(r.stdout.includes('\x1b[36m'), false);
    const plain = run(['tail', 'room-t', '--once'], { ...s.env, NO_COLOR: '1' });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.includes('\x1b'), false);
    const flagged = run(['tail', 'room-t', '--once', '--no-color'], s.env);
    assert.equal(flagged.stdout.includes('\x1b'), false);
    const help = run(['--help'], s.env);
    assert.match(`${help.stdout}${help.stderr}`, /scrollback|copy mode/i);
  } finally {
    s.cleanup();
  }
});

// # RED at 51e68c71e: node --test scripts/roundtable-window.test.js exit 1.
// not ok wrap and owner colour: OWNER_FG is undefined (paint is still ESC[36m cyan) and
// formatRow ignores the column count, so the mixed line is one unwrapped body line.
test('wrap and owner colour: a mixed line stays inside the column count, indent on every continuation, wide chars whole; owner ANSI is the shared here-role constant', () => {
  const { formatRow, OWNER_FG } = require('./roundtable-window');
  // Same meaning as window B PALETTE.here (theme key claude). Nearest plain ANSI foreground.
  assert.equal(OWNER_FG, '\x1b[38;5;173m');
  // inner width 8: seven ASCII then 中 (width 2) must break before 中, never cut it.
  const text = '1234567中文' + 'Z'.repeat(24);
  const row = { seq: 3, from: 'owner', kind: 'say', text, reply_to: null };
  const painted = formatRow(row, true, 10);
  assert.match(painted, new RegExp(OWNER_FG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const plain = painted.replace(/\x1b\[[0-9;]*m/g, '');
  const content = plain.split('\n').filter((l) => /^ {2}/.test(l));
  assert.ok(content.length > 1, plain);
  for (const l of content) {
    let w = 0;
    for (const ch of l) {
      const cp = ch.codePointAt(0);
      w += cp >= 0x4e00 && cp <= 0x9fff ? 2 : 1;
    }
    assert.ok(w <= 10, JSON.stringify(l) + ' width ' + w);
  }
  assert.equal(content.map((l) => l.slice(2)).join(''), text);
  const zhong = content.find((l) => l.includes('中'));
  assert.ok(zhong);
  assert.equal(zhong.includes('7'), false);
  assert.equal(/\x1b\[4\d*m/.test(painted), false);
  assert.equal(/\x1b\[10\d*m/.test(painted), false);
  assert.equal(/\x1b\[7m/.test(painted), false);
  assert.equal(painted.includes('\x1b[36m'), false);
});

test('open inside TMUX splits a window; outside TMUX exits 2', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'tmux.log');
    const tmux = writeFake(s.dir, 'tmux', `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`);
    const inside = run(['open', 'room-o'], {
      ...s.env,
      TMUX: '/tmp/tmux-fake/default,1,0',
      ROUNDTABLE_TMUX_BIN: tmux,
      TMUX_ARGV_LOG: log,
    });
    assert.equal(inside.status, 0, inside.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const flat = calls.map((c) => c.join(' '));
    assert.equal(flat.some((line) => line.includes('new-window') && line.includes('rt-room-o') && line.includes('tail') && line.includes('roundtable-window.js')), true);
    assert.equal(flat.some((line) => line.includes('split-window') && line.includes('input') && line.includes('3') && line.includes('roundtable-window.js')), true);
    const outside = run(['open', 'room-o'], { ...s.env, ROUNDTABLE_TMUX_BIN: tmux, TMUX_ARGV_LOG: log });
    assert.equal(outside.status, 2);
    assert.match(outside.stderr, /tmux/i);
  } finally {
    s.cleanup();
  }
});

test('input joins a backslash continuation and sends one say', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const child = spawn(process.execPath, [SCRIPT, 'input', 'room-i', '--seats', 'ns/courier/a'], {
      env: { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    });
    child.stdin.write('hello \\\n討論 line\n');
    child.stdin.end();
    const r = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    void r;
    const done = new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b) => { stdout += b; });
      child.stderr.on('data', (b) => { stderr += b; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    return done.then((res) => {
      assert.equal(res.code, 0, res.stderr);
      const { readAll } = require('./lib/room-log');
      const rows = readAll('room-i', s.env);
      assert.equal(rows[0].text, 'hello \n討論 line');
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(calls.length, 1);
      assert.equal(calls[0][2].includes('hello \n討論 line'), true);
      s.cleanup();
    });
  } catch (err) {
    s.cleanup();
    throw err;
  }
});

// A divider line is U+2500 repeated to `columns`, optionally wrapped in one foreground SGR.
// Background (40–49, 100–107, 48) and reverse (7) are rejected. Plain mode allows no ESC.
function assertDividerLine(blob, columns) {
  const lines = String(blob).split('\n');
  const hit = lines.find((l) => l.replace(/\x1b\[[0-9;]*m/g, '') === '\u2500'.repeat(columns));
  assert.ok(hit, `no divider of length ${columns} in ${JSON.stringify(blob)}`);
  const body = hit.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(body.length, columns);
  assert.equal(body, '\u2500'.repeat(columns));
  if (hit.includes('\x1b')) {
    const seqs = hit.match(/\x1b\[[0-9;]*m/g) || [];
    assert.ok(seqs.length > 0);
    for (const seq of seqs) {
      assert.equal(/\x1b\[(?:\d+;)*4\dm/.test(seq), false, seq);
      assert.equal(/\x1b\[(?:\d+;)*10[0-7]m/.test(seq), false, seq);
      assert.equal(/\x1b\[48[;m]/.test(seq), false, seq);
      assert.equal(/\x1b\[7m/.test(seq), false, seq);
      assert.match(seq, /^\x1b\[(?:3[0-9]|9[0-7]|38;5;\d+|38;2;\d+;\d+;\d+)m$/);
    }
  }
}

// # RED at 916010ab9: node --test scripts/roundtable-window.test.js exit 1.
// not ok input divider: no divider of length 80 in "> " (input prints only the prompt).
function readPrompt(args, env) {
  const child = spawn(process.execPath, [SCRIPT, ...args], { env });
  let stdout = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('input prompt timed out: ' + JSON.stringify(stdout)));
    }, 2000);
    child.stdout.on('data', (b) => {
      stdout += b;
      if (!stdout.includes('>')) return;
      clearTimeout(timer);
      child.kill();
      resolve(stdout);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('input prompt prints a divider of the column count in foreground only; NO_COLOR has zero ESC', async () => {
  const columns = 80;
  const s = scratch();
  try {
    const stdout = await readPrompt(['input', 'room-div', '--seats', 'ns/courier/a'], s.env);
    assertDividerLine(stdout, columns);
    assert.match(stdout, /\x1b\[90m/);
    assert.ok(stdout.indexOf('\u2500') < stdout.indexOf('>'));
    const plainOut = await readPrompt(
      ['input', 'room-div', '--no-color', '--seats', 'ns/courier/a'],
      { ...s.env, NO_COLOR: '1' },
    );
    assertDividerLine(plainOut, columns);
    assert.equal(plainOut.includes('\x1b'), false);
    const noColor = await readPrompt(
      ['input', 'room-div', '--seats', 'ns/courier/a'],
      { ...s.env, NO_COLOR: '1' },
    );
    assert.equal(noColor.includes('\x1b'), false);
    assert.throws(() => assertDividerLine('\u2500'.repeat(columns - 1) + '\n> ', columns));
  } finally {
    s.cleanup();
  }
});

// # RED at 6edf1678b: node --test scripts/roundtable-window.test.js — send ROOM --help
// printed usage and exited 0 without calling fleet; --no-color and --seats inside
// the body were consumed as options (text dropped the words, seats changed).
test('send body --help is delivered and recorded; it does not print usage', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['--seats', 'ns/courier/a', 'send', 'room-help', '--help'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.includes('roundtable-window.js — window A'), false);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].includes('--help'), true);
    const { readAll } = require('./lib/room-log');
    const rows = readAll('room-help', s.env);
    assert.equal(rows[0].text, '--help');
  } finally {
    s.cleanup();
  }
});

test('send body keeps --no-color verbatim in the row and the fleet argv', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const text = 'see --no-color please';
    const r = run(
      ['--seats', 'ns/courier/a', 'send', 'room-nc', 'see', '--no-color', 'please'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].includes(text), true);
    const { readAll } = require('./lib/room-log');
    assert.equal(readAll('room-nc', s.env)[0].text, text);
  } finally {
    s.cleanup();
  }
});

test('send body --seats does not change recipients and is kept verbatim', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const text = '--seats ns/courier/evil extra';
    const r = run(
      ['--seats', 'ns/courier/a', 'send', 'room-seats', '--seats', 'ns/courier/evil', 'extra'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'ns/courier/a');
    assert.equal(calls[0][2].includes(text), true);
    const { readAll } = require('./lib/room-log');
    assert.equal(readAll('room-seats', s.env)[0].text, text);
  } finally {
    s.cleanup();
  }
});

test('send -- ROOM text delivers the text after the end-of-options marker', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['--seats', 'ns/courier/a', 'send', '--', 'room-dd', 'after marker'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const { readAll } = require('./lib/room-log');
    assert.equal(readAll('room-dd', s.env)[0].text, 'after marker');
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'ns/courier/a');
    assert.equal(calls[0][2].includes('after marker'), true);
  } finally {
    s.cleanup();
  }
});

test('options before the subcommand still apply: --no-color tail ROOM --once', () => {
  const s = scratch();
  try {
    const { append } = require('./lib/room-log');
    append('room-opt', { from: 'owner', kind: 'say', text: 'plain', reply_to: null }, s.env);
    const r = run(['--no-color', 'tail', 'room-opt', '--once'], s.env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /plain/);
    assert.equal(r.stdout.includes('\x1b'), false);
  } finally {
    s.cleanup();
  }
});

test('a seat handle that starts with a dash is rejected', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['--seats', '-ns/courier/a', 'send', 'room-dash', 'nope'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /-/);
    assert.equal(fs.existsSync(log), false);
  } finally {
    s.cleanup();
  }
});

test('a room.jsonl from value that starts with a dash is not a seat and is named in a system row', () => {
  const s = scratch();
  try {
    const { append, readAll } = require('./lib/room-log');
    append('room-from', { from: '--to/x', kind: 'say', text: 'bad from', reply_to: null }, s.env);
    append('room-from', { from: 'ns/courier/ok', kind: 'say', text: 'good', reply_to: null }, s.env);
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['send', 'room-from', 'follow'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(calls.map((c) => c[1]), ['ns/courier/ok']);
    const rows = readAll('room-from', s.env);
    const sys = rows.find((row) => row.kind === 'system');
    assert.ok(sys);
    assert.match(sys.text, /skip/i);
    assert.match(sys.text, /--to\/x/);
  } finally {
    s.cleanup();
  }
});

test('no resolved seats records the row, prints one stderr line, and exits 0', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['send', 'room-empty', 'alone'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.match(r.stderr, /recorded/);
    assert.match(r.stderr, /nobody/);
    assert.equal(fs.existsSync(log), false);
    const { readAll } = require('./lib/room-log');
    const rows = readAll('room-empty', s.env);
    assert.equal(rows[0].text, 'alone');
    assert.equal(rows[0].from, 'owner');
  } finally {
    s.cleanup();
  }
});

test('open with a bad room id exits non-zero and does not call tmux', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'tmux.log');
    const tmux = writeFake(s.dir, 'tmux', `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`);
    const r = run(['open', 'Bad Room'], {
      ...s.env,
      TMUX: '/tmp/tmux-fake/default,1,0',
      ROUNDTABLE_TMUX_BIN: tmux,
      TMUX_ARGV_LOG: log,
    });
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(log), false);
  } finally {
    s.cleanup();
  }
});

// BL-0252 follow-ups (b), (c), (d).
// # RED at d880aceb4: node --test scripts/roundtable-window.test.js exit 1, 3 new tests fail:
// duplicate skipped-seat rows appended on a second send; stale room.jsonl.lock.reclaim-*/release-*
// files survive an append; USAGE lacks `send [--seats ...]` and `input ROOM [--once]`.
test('a second send does not append another skipped-seat row for the same from value', () => {
  const s = scratch();
  try {
    const { append, readAll } = require('./lib/room-log');
    append('room-dup', { from: '--to/x', kind: 'say', text: 'bad from', reply_to: null }, s.env);
    append('room-dup', { from: 'ns/courier/ok', kind: 'say', text: 'good', reply_to: null }, s.env);
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const env = { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log };
    assert.equal(run(['send', 'room-dup', 'one'], env).status, 0);
    assert.equal(run(['send', 'room-dup', 'two'], env).status, 0);
    const sys = readAll('room-dup', s.env).filter((row) => row.kind === 'system' && /skipped seat --to\/x/.test(row.text));
    assert.equal(sys.length, 1);
  } finally {
    s.cleanup();
  }
});

test('append sweeps old reclaim-/release- lock leftovers and keeps fresh ones', () => {
  const s = scratch();
  try {
    const { append } = require('./lib/room-log');
    const dir = path.join(s.dir, 'room-sweep');
    fs.mkdirSync(dir, { recursive: true });
    const oldFiles = ['room.jsonl.lock.reclaim-999999991-aa', 'room.jsonl.lock.release-999999992-bb'].map((n) => path.join(dir, n));
    const fresh = path.join(dir, 'room.jsonl.lock.reclaim-999999993-cc');
    const other = path.join(dir, 'notes.txt');
    for (const f of [...oldFiles, fresh, other]) fs.writeFileSync(f, 'x');
    const past = new Date(Date.now() - 10 * 60 * 1000);
    for (const f of oldFiles) fs.utimesSync(f, past, past);
    append('room-sweep', { from: 'owner', kind: 'say', text: 'hi', reply_to: null }, s.env);
    for (const f of oldFiles) assert.equal(fs.existsSync(f), false, f);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(other), true);
  } finally {
    s.cleanup();
  }
});

test('USAGE documents send --seats and input --once', () => {
  const r = run(['--help'], process.env);
  assert.match(r.stdout, /send \[--seats h1,h2\] ROOM TEXT/);
  assert.match(r.stdout, /input ROOM \[--seats h1,h2\] \[--once\]/);
});

// # RED at fae019ded: node --test scripts/roundtable-window.test.js exit 1; the parked file named
// with this live pid and an old mtime (what rename/link inherit from the original lock) was deleted.
test('append keeps an old-mtime parked file whose mover pid is alive', () => {
  const s = scratch();
  try {
    const { append } = require('./lib/room-log');
    const dir = path.join(s.dir, 'room-live');
    fs.mkdirSync(dir, { recursive: true });
    const parked = path.join(dir, `room.jsonl.lock.reclaim-${process.pid}-dd`);
    fs.writeFileSync(parked, 'x');
    const past = new Date(Date.now() - 2 * 60 * 1000);
    fs.utimesSync(parked, past, past);
    append('room-live', { from: 'owner', kind: 'say', text: 'hi', reply_to: null }, s.env);
    assert.equal(fs.existsSync(parked), true);
  } finally {
    s.cleanup();
  }
});
