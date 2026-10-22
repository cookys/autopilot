// # RED at 72df15750 (unmodified room-log.js, 3 of 3 runs): node --test scripts/lib/room-log.test.js exit 1;
// the two "never opens a gap for a third process" tests failed (a rename of the lock lets a third
// process create it); the 5x40 stress test passed on base, so it is a regression guard only.
// # RED at bd5338c1d: node --test scripts/lib/room-log.test.js exit 1.
// tests 6, pass 1, fail 5. The five product tests threw MODULE_NOT_FOUND for
// scripts/lib/room-log.js. The unlocked-writer negative control passed (duplicate seq).
'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOM_LOG = path.join(__dirname, 'room-log.js');

if (process.env.ROOM_LOG_WORKER === 'append') {
  const { append } = require('./room-log');
  const room = process.env.ROOM_LOG_ROOM;
  const n = Number(process.env.ROOM_LOG_N || '25');
  for (let i = 0; i < n; i++) {
    append(room, {
      from: `ns/courier/w${process.pid}`,
      kind: 'say',
      text: `row ${process.pid} ${i} 討論`,
      reply_to: null,
    }, process.env);
  }
  process.exit(0);
}

if (process.env.ROOM_LOG_WORKER === 'unlocked') {
  const room = process.env.ROOM_LOG_ROOM;
  const dir = path.join(process.env.AUTOPILOT_ROOMS_DIR, room);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'room.jsonl');
  const go = path.join(dir, 'go');
  fs.writeFileSync(path.join(dir, `ready-${process.pid}`), '1');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(go)) {
    if (Date.now() > deadline) process.exit(2);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  let max = 0;
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try { max = Math.max(max, JSON.parse(line).seq || 0); } catch { /* torn */ }
    }
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
  const row = {
    ts: new Date().toISOString(),
    room,
    seq: max + 1,
    from: 'ns/courier/unlocked',
    kind: 'say',
    text: 'x',
    reply_to: null,
  };
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  process.exit(0);
}

function load() {
  return require(ROOM_LOG);
}

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-log-test-'));
  const env = { ...process.env, AUTOPILOT_ROOMS_DIR: dir };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  return {
    dir,
    env,
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function assertSeqExact(rows) {
  const seqs = rows.map((r) => r.seq);
  assert.equal(seqs.length, new Set(seqs).size, 'duplicate seq');
  const sorted = [...seqs].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    assert.equal(sorted[i], i + 1, `gap at ${i + 1}, saw ${sorted[i]}`);
  }
}

function spawnNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('append then readAll round-trips seq, multiline Chinese, reply_to, round, to', () => {
  const s = scratch();
  try {
    const { append, readAll, roomsDir, roomPath, validRoomId } = load();
    assert.equal(roomsDir(s.env), s.dir);
    assert.equal(validRoomId('phase-1'), true);
    assert.equal(validRoomId('Nope'), false);
    const text = '第一行\nsecond line 討論\nthird';
    const row = append('phase-1', {
      from: 'owner',
      kind: 'say',
      text,
      reply_to: null,
      round: 2,
      to: ['ns/courier/a', 'ns/courier/b'],
    }, s.env);
    assert.equal(row.seq, 1);
    assert.equal(row.text, text);
    assert.equal(row.reply_to, null);
    assert.equal(row.round, 2);
    assert.deepEqual(row.to, ['ns/courier/a', 'ns/courier/b']);
    const row2 = append('phase-1', {
      from: 'ns/courier/a',
      kind: 'relay',
      text: '回覆',
      reply_to: 1,
      round: 2,
    }, s.env);
    assert.equal(row2.seq, 2);
    assert.equal(row2.reply_to, 1);
    const rows = readAll('phase-1', s.env);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, text);
    assert.equal(Buffer.from(rows[0].text, 'utf8').equals(Buffer.from(text, 'utf8')), true);
    assert.equal(rows[1].text, '回覆');
    const raw = fs.readFileSync(roomPath('phase-1', s.env), 'utf8');
    assert.equal(raw.endsWith('\n'), true);
    assert.equal(raw.split('\n').filter((l) => l.length).length, 2);
    for (const line of raw.split('\n').filter((l) => l.length)) {
      assert.equal(line.includes('\n'), false);
      JSON.parse(line);
    }
    const { tail } = load();
    const after = tail('phase-1', 1, s.env);
    assert.equal(after.length, 1);
    assert.equal(after[0].seq, 2);
  } finally {
    s.cleanup();
  }
});

test('eight writers times 25 rows yield seq 1..200', async () => {
  const s = scratch();
  try {
    const kids = [];
    for (let i = 0; i < 8; i++) {
      kids.push(spawnNode([__filename], {
        ...s.env,
        ROOM_LOG_WORKER: 'append',
        ROOM_LOG_ROOM: 'atomic-room',
        ROOM_LOG_N: '25',
      }));
    }
    const done = await Promise.all(kids);
    for (const d of done) assert.equal(d.code, 0, d.stderr);
    const { readAll } = load();
    const rows = readAll('atomic-room', s.env);
    assert.equal(rows.length, 200);
    assertSeqExact(rows);
    const raw = fs.readFileSync(path.join(s.dir, 'atomic-room', 'room.jsonl'), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      JSON.parse(line);
    }
  } finally {
    s.cleanup();
  }
});

test('negative control: unlocked writers duplicate seq and the exact-seq assertion throws', async () => {
  const s = scratch();
  try {
    const room = 'unlocked-room';
    const dir = path.join(s.dir, room);
    fs.mkdirSync(dir, { recursive: true });
    const kids = [];
    for (let i = 0; i < 8; i++) {
      kids.push(spawnNode([__filename], {
        ...s.env,
        ROOM_LOG_WORKER: 'unlocked',
        ROOM_LOG_ROOM: room,
      }));
    }
    const readyDeadline = Date.now() + 10000;
    while (fs.readdirSync(dir).filter((n) => n.startsWith('ready-')).length < 8) {
      if (Date.now() > readyDeadline) throw new Error('workers did not ready');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    fs.writeFileSync(path.join(dir, 'go'), '1');
    const done = await Promise.all(kids);
    for (const d of done) assert.equal(d.code, 0, d.stderr);
    const raw = fs.readFileSync(path.join(dir, 'room.jsonl'), 'utf8');
    const rows = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.throws(() => assertSeqExact(rows), /duplicate seq|gap at/);
  } finally {
    s.cleanup();
  }
});

test('trailing partial line is ignored; malformed middle line is skipped', () => {
  const s = scratch();
  try {
    const { append, readAll, roomPath } = load();
    append('partial-room', { from: 'owner', kind: 'say', text: '完整', reply_to: null }, s.env);
    append('partial-room', { from: 'owner', kind: 'system', text: 'also', reply_to: null }, s.env);
    const file = roomPath('partial-room', s.env);
    fs.appendFileSync(file, '{"seq":99,"text":"no newline yet"}');
    const rows = readAll('partial-room', s.env);
    assert.equal(rows.length, 2);
    assert.equal(rows.some((r) => r.seq === 99), false);
    const naive = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length);
    assert.notEqual(naive.length, rows.length);
    assert.equal(naive.length, 3);

    const mid = path.join(s.dir, 'bad-room');
    fs.mkdirSync(mid, { recursive: true });
    const badFile = path.join(mid, 'room.jsonl');
    fs.writeFileSync(badFile, [
      JSON.stringify({ ts: 't', room: 'bad-room', seq: 1, from: 'owner', kind: 'say', text: 'ok', reply_to: null }),
      '{this is not json',
      JSON.stringify({ ts: 't', room: 'bad-room', seq: 2, from: 'owner', kind: 'say', text: 'ok2', reply_to: null }),
      '',
    ].join('\n'));
    const kept = readAll('bad-room', s.env);
    assert.equal(kept.length, 2);
    assert.equal(kept.malformed >= 1, true);
    assert.equal(kept[0].text, 'ok');
    assert.equal(kept[1].text, 'ok2');
  } finally {
    s.cleanup();
  }
});

test('validation rejects bad room id, bad kind, and empty text', () => {
  const s = scratch();
  try {
    const { append } = load();
    assert.throws(() => append('Bad_Room', { from: 'owner', kind: 'say', text: 'x', reply_to: null }, s.env), /room id/i);
    assert.throws(() => append('ok-room', { from: 'owner', kind: 'shout', text: 'x', reply_to: null }, s.env), /kind/i);
    assert.throws(() => append('ok-room', { from: 'owner', kind: 'say', text: '', reply_to: null }, s.env), /text/i);
  } finally {
    s.cleanup();
  }
});

// # RED at 9c64ad8da: stale reclaim unlinked by path after the stat, so a lock
// recreated in that window was deleted; a torn tail was concatenated onto the
// next row; roomsDir fell back to "/"; writeSync was attempted at most twice.
test('stale reclaim keeps a lock recreated before removal and seqs stay unique', () => {
  const s = scratch();
  try {
    const { append, readAll, roomPath } = load();
    const room = 'race-room';
    const dir = path.join(s.dir, room);
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'room.jsonl.lock');
    fs.writeFileSync(lock, 'stale-token');
    const old = new Date(Date.now() - 10000);
    fs.utimesSync(lock, old, old);
    const freshToken = `fresh-${process.pid}-${Date.now()}`;
    let committed = false;
    const row = append(room, {
      from: 'owner', kind: 'say', text: 'after race', reply_to: null,
    }, s.env, {
      afterStaleJudgement(lockFile) {
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, freshToken);
        const now = new Date();
        fs.utimesSync(lockFile, now, now);
      },
      onContended(lockFile) {
        assert.equal(fs.readFileSync(lockFile, 'utf8'), freshToken);
        const file = roomPath(room, s.env);
        const competitor = {
          ts: new Date().toISOString(),
          room,
          seq: 1,
          from: 'ns/courier/competitor',
          kind: 'say',
          text: 'held the fresh lock',
          reply_to: null,
        };
        fs.appendFileSync(file, `${JSON.stringify(competitor)}\n`);
        fs.unlinkSync(lockFile);
        committed = true;
      },
    });
    assert.equal(committed, true);
    assert.equal(row.seq, 2);
    const rows = readAll(room, s.env);
    assert.equal(rows.length, 2);
    assertSeqExact(rows);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    s.cleanup();
  }
});

test('eight writers times 25 rows yield seq 1..200 when a stale lock is already present', async () => {
  const s = scratch();
  try {
    const room = 'stale-atomic-room';
    const dir = path.join(s.dir, room);
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'room.jsonl.lock');
    fs.writeFileSync(lock, 'already-stale');
    const old = new Date(Date.now() - 10000);
    fs.utimesSync(lock, old, old);
    const kids = [];
    for (let i = 0; i < 8; i++) {
      kids.push(spawnNode([__filename], {
        ...s.env,
        ROOM_LOG_WORKER: 'append',
        ROOM_LOG_ROOM: room,
        ROOM_LOG_N: '25',
      }));
    }
    const done = await Promise.all(kids);
    for (const d of done) assert.equal(d.code, 0, d.stderr);
    const { readAll } = load();
    const rows = readAll(room, s.env);
    assert.equal(rows.length, 200);
    assertSeqExact(rows);
  } finally {
    s.cleanup();
  }
});

test('append repairs a torn tail so the new row is readable and the fragment counts', () => {
  const s = scratch();
  try {
    const { append, readAll, roomPath } = load();
    const room = 'torn-room';
    const dir = path.join(s.dir, room);
    fs.mkdirSync(dir, { recursive: true });
    const file = roomPath(room, s.env);
    const first = {
      ts: 't', room, seq: 1, from: 'owner', kind: 'say', text: 'whole', reply_to: null,
    };
    fs.writeFileSync(file, `${JSON.stringify(first)}\n{"seq":99,"text":"tor`);
    const row = append(room, { from: 'owner', kind: 'say', text: 'after torn', reply_to: null }, s.env);
    assert.equal(row.seq, 2);
    assert.equal(row.text, 'after torn');
    const rows = readAll(room, s.env);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].text, 'after torn');
    assert.equal(rows.malformed, 1);
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.endsWith('\n'), true);
    assert.equal(raw.includes('{"seq":99,"text":"tor\n'), true);
  } finally {
    s.cleanup();
  }
});

test('roomsDir throws when AUTOPILOT_ROOMS_DIR, HOME, and USERPROFILE are unset', () => {
  const { roomsDir } = load();
  assert.throws(
    () => roomsDir({}),
    (err) => {
      assert.match(err.message, /AUTOPILOT_ROOMS_DIR/);
      assert.match(err.message, /HOME/);
      assert.match(err.message, /USERPROFILE/);
      return true;
    },
  );
  const home = path.join(os.tmpdir(), 'room-log-home');
  assert.doesNotThrow(() => roomsDir({ HOME: home }));
  assert.equal(roomsDir({ HOME: home }), path.join(home, '.autopilot', 'rooms'));
});

test('append writes the whole row when each write call accepts at most 3 bytes', () => {
  const s = scratch();
  try {
    const { append, roomPath } = load();
    let calls = 0;
    const text = 'partial-write 討論 row that is longer than six bytes';
    const row = append('short-write', {
      from: 'owner', kind: 'say', text, reply_to: null,
    }, s.env, {
      writeSync(fd, buf, offset, length) {
        calls += 1;
        const n = Math.min(3, length);
        return fs.writeSync(fd, buf, offset, n);
      },
    });
    assert.equal(row.text, text);
    const raw = fs.readFileSync(roomPath('short-write', s.env), 'utf8');
    const lines = raw.split('\n').filter((l) => l.length);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]).text, text);
    assert.ok(calls >= 4, `expected a short-write loop, calls=${calls}`);
  } finally {
    s.cleanup();
  }
});

test('a stale lock file does not block append', () => {
  const s = scratch();
  try {
    const { append, roomPath } = load();
    const dir = path.join(s.dir, 'stale-room');
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'room.jsonl.lock');
    fs.writeFileSync(lock, 'leftover');
    const old = new Date(Date.now() - 10000);
    fs.utimesSync(lock, old, old);
    const row = append('stale-room', { from: 'owner', kind: 'say', text: 'after stale', reply_to: null }, s.env);
    assert.equal(row.seq, 1);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.readFileSync(roomPath('stale-room', s.env), 'utf8').includes('after stale'), true);
  } finally {
    s.cleanup();
  }
});

// BL-0252 (a): a release or reclaim must never take another holder's live lock
// out of the lock path, even for an instant. A third process that creates the
// lock in that gap would hold it together with the holder that was moved aside.
function withRenameProbe(lockFile, log, fn) {
  const realRename = fs.renameSync;
  const probe = lockGapProbe(lockFile, log);
  fs.renameSync = function patched(from, to) {
    const r = realRename.call(fs, from, to);
    if (from === lockFile) probe();
    return r;
  };
  try { fn(); } finally { fs.renameSync = realRename; }
}

function lockGapProbe(lockFile, log) {
  return () => {
    let fd;
    try {
      fd = fs.openSync(lockFile, 'wx');
      log.push('third process created the lock while a live holder was moved aside');
      fs.closeSync(fd);
      fs.unlinkSync(lockFile);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  };
}

test('release of a lock reclaimed by another holder never opens a gap for a third process', () => {
  const s = scratch();
  try {
    const { append } = load();
    const room = 'release-gap-room';
    const dir = path.join(s.dir, room);
    const lock = path.join(dir, 'room.jsonl.lock');
    const holderB = `B-${process.pid}-live`;
    const gaps = [];
    let swapped = false;
    withRenameProbe(lock, gaps, () => {
    append(room, { from: 'owner', kind: 'say', text: 'A holds, B reclaims', reply_to: null }, s.env, {
      writeSync(fd, buf, off, len) {
        if (!swapped) {
          swapped = true;
          // B reclaimed A's lock as stale and now holds it with a fresh mtime.
          fs.unlinkSync(lock);
          fs.writeFileSync(lock, holderB);
        }
        return fs.writeSync(fd, buf, off, len);
      },
    });
    });
    assert.deepEqual(gaps, []);
    assert.equal(fs.readFileSync(lock, 'utf8'), holderB, 'B must still hold the lock after A released');
  } finally {
    s.cleanup();
  }
});

test('reclaim that meets a freshly recreated lock never opens a gap for a third process', () => {
  const s = scratch();
  try {
    const { append } = load();
    const room = 'reclaim-gap-room';
    const dir = path.join(s.dir, room);
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'room.jsonl.lock');
    fs.writeFileSync(lock, 'stale-token');
    const old = new Date(Date.now() - 10000);
    fs.utimesSync(lock, old, old);
    const gaps = [];
    const freshToken = `fresh-${process.pid}`;
    let contended = 0;
    withRenameProbe(lock, gaps, () => {
    append(room, { from: 'owner', kind: 'say', text: 'reclaim gap', reply_to: null }, s.env, {
      afterStaleJudgement(lockFile) {
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, freshToken);
      },
      onContended(lockFile) {
        if (++contended === 1) fs.unlinkSync(lockFile);
      },
    });
    });
    assert.deepEqual(gaps, []);
  } finally {
    s.cleanup();
  }
});

test('five writers times 40 rows keep seq exact and rows whole under contention', async () => {
  const s = scratch();
  try {
    const kids = [];
    for (let i = 0; i < 5; i++) {
      kids.push(spawnNode([__filename], {
        ...s.env,
        ROOM_LOG_WORKER: 'append',
        ROOM_LOG_ROOM: 'stress-room',
        ROOM_LOG_N: '40',
      }));
    }
    const done = await Promise.all(kids);
    for (const d of done) assert.equal(d.code, 0, d.stderr);
    const { readAll } = load();
    const rows = readAll('stress-room', s.env);
    assert.equal(rows.length, 200);
    assertSeqExact(rows);
    const raw = fs.readFileSync(path.join(s.dir, 'stress-room', 'room.jsonl'), 'utf8');
    for (const line of raw.split('\n')) if (line) JSON.parse(line);
    const left = fs.readdirSync(path.join(s.dir, 'stress-room')).filter((n) => n.startsWith('room.jsonl.lock'));
    assert.deepEqual(left, []);
  } finally {
    s.cleanup();
  }
});
