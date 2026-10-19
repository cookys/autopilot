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
      ['send', 'room-a', '--seats', 'ns/courier/a,ns/courier/b', text],
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
    const r = run(['send', 'room-b', '--seats', 'ns/courier/ok,ns/courier/bad', 'owner line'], env);
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
      ['send', 'room-c', '--seats', 'ns/courier/bad,ns/courier/bad2', 'all down'],
      { ...env, FAIL_HANDLES: 'ns/courier/bad,ns/courier/bad2' },
    );
    assert.equal(r2.status, 1);
  } finally {
    s.cleanup();
  }
});

test('exit 0 is not a detected failure; a status-ignoring copy fails the system-row assertion', () => {
  const s = scratch();
  try {
    const log = path.join(s.dir, 'argv.log');
    const fleet = writeFake(s.dir, 'fleet', fleetFake());
    const r = run(
      ['send', 'room-z', '--seats', 'ns/courier/quiet', 'silent'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.equal(r.status, 0, r.stderr);
    const { readAll } = require('./lib/room-log');
    const rows = readAll('room-z', s.env);
    assert.equal(rows.some((row) => row.kind === 'system'), false);
    // The script only knows the fleet process exit status. A fake that exits 0
    // without delivering is indistinguishable from a real send.

    function failureRowAssertion(outcome, handle, status, stderrText) {
      const sys = outcome.system.find((row) => row.text.includes(handle)
        && row.text.includes(String(status))
        && row.text.includes(stderrText));
      if (!sys) throw new Error('missing system row for failed seat');
      if (!outcome.owner) throw new Error('missing owner say');
      return sys;
    }
    // Copy of the send bookkeeping with the status check deleted.
    function statusIgnoringSend(results) {
      const outcome = { owner: true, system: [] };
      for (const result of results) {
        if (result.status !== 0 && result.status !== 0) {
          // status is ignored on purpose: the condition above is a no-op
          // because both sides compare equal only when we record, and we do not.
        }
        void result;
      }
      return outcome;
    }
    const real = {
      owner: true,
      system: [{ text: 'send failed ns/courier/bad status 3 stderr relay refused 討論' }],
    };
    assert.doesNotThrow(() => failureRowAssertion(real, 'ns/courier/bad', 3, 'relay refused 討論'));
    const ignored = statusIgnoringSend([
      { handle: 'ns/courier/ok', status: 0, stderr: '' },
      { handle: 'ns/courier/bad', status: 3, stderr: 'relay refused 討論' },
    ]);
    assert.throws(
      () => failureRowAssertion(ignored, 'ns/courier/bad', 3, 'relay refused 討論'),
      /missing system row/,
    );
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
      ['send', 'room-d', '--seats', 'host--local-pane', 'no'],
      { ...s.env, ROUNDTABLE_FLEET_BIN: fleet, FAKE_ARGV_LOG: log },
    );
    assert.notEqual(local.status, 0);
    assert.match(local.stderr, /--local/);

    const empty = run(
      ['send', 'room-e', '--seats', 'ns/courier/a,', 'no'],
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
    assert.match(r.stdout, /\x1b\[36m/);
    assert.match(r.stdout, /\x1b\[33m/);
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
