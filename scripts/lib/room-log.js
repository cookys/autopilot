'use strict';

// Room log for roundtable (§6 of docs/plans/2026-09-19-roundtable.md).
// One JSON object per line in <rooms>/<room-id>/room.jsonl.
// AUTOPILOT_ROOMS_DIR replaces the rooms directory (default $HOME/.autopilot/rooms).
// Node built-ins only. Node >= 20.10.

const fs = require('fs');
const path = require('path');

const KINDS = new Set(['say', 'relay', 'system']);
const ROOM_RE = /^[a-z0-9-]+$/;
const STALE_MS = 5000;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}

function roomsDir(env) {
  const e = env || process.env;
  if (e.AUTOPILOT_ROOMS_DIR) return e.AUTOPILOT_ROOMS_DIR;
  const home = e.HOME || e.USERPROFILE || '/';
  return path.join(home, '.autopilot', 'rooms');
}

function validRoomId(id) {
  return typeof id === 'string' && ROOM_RE.test(id);
}

function assertRoom(room) {
  if (!validRoomId(room)) {
    throw new Error(`invalid room id: ${JSON.stringify(room)}`);
  }
}

function roomPath(room, env) {
  assertRoom(room);
  return path.join(roomsDir(env), room, 'room.jsonl');
}

function parseComplete(text) {
  const rows = [];
  let malformed = 0;
  if (!text) return { rows, malformed };
  const end = text.endsWith('\n') ? text.length - 1 : text.lastIndexOf('\n');
  if (end < 0) return { rows, malformed };
  const body = text.slice(0, end);
  if (!body) return { rows, malformed };
  for (const line of body.split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || typeof row.seq !== 'number') {
        malformed += 1;
        continue;
      }
      rows.push(row);
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

function readAll(room, env) {
  const file = roomPath(room, env);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') {
      const empty = [];
      empty.malformed = 0;
      return empty;
    }
    throw err;
  }
  const parsed = parseComplete(text);
  parsed.rows.malformed = parsed.malformed;
  return parsed.rows;
}

function tail(room, afterSeq, env) {
  const n = Number(afterSeq) || 0;
  return readAll(room, env).filter((row) => row.seq > n);
}

function nextSeq(rows) {
  let max = 0;
  for (const row of rows) {
    if (Number.isInteger(row.seq) && row.seq > max) max = row.seq;
  }
  return max + 1;
}

function acquireLock(lockFile) {
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = Date.now() - fs.statSync(lockFile).mtimeMs; } catch { continue; }
      if (age >= STALE_MS) {
        try { fs.unlinkSync(lockFile); } catch { /* lost the race */ }
        continue;
      }
      if (Date.now() - start > 15000) {
        throw new Error(`room log lock busy: ${lockFile}`);
      }
      sleepMs(15 + Math.floor(Math.random() * 20));
    }
  }
}

function append(room, fields, env) {
  assertRoom(room);
  const kind = fields && fields.kind;
  if (!KINDS.has(kind)) throw new Error(`invalid kind: ${JSON.stringify(kind)}`);
  const text = fields.text;
  if (typeof text !== 'string' || text.length === 0) throw new Error('empty text');
  const from = fields.from;
  if (typeof from !== 'string' || from.length === 0) throw new Error('missing from');
  const dir = path.join(roomsDir(env), room);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'room.jsonl');
  const lockFile = path.join(dir, 'room.jsonl.lock');
  acquireLock(lockFile);
  try {
    let existing = '';
    try { existing = fs.readFileSync(file, 'utf8'); } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const { rows } = parseComplete(existing);
    const seq = nextSeq(rows);
    const stored = {
      ts: new Date().toISOString(),
      room,
      seq,
      from,
      kind,
      text,
      reply_to: fields.reply_to === undefined ? null : fields.reply_to,
    };
    if (fields.round !== undefined) stored.round = fields.round;
    if (fields.to !== undefined) stored.to = fields.to;
    const line = `${JSON.stringify(stored)}\n`;
    const fd = fs.openSync(file, 'a');
    try {
      const buf = Buffer.from(line, 'utf8');
      const n = fs.writeSync(fd, buf, 0, buf.length);
      if (n !== buf.length) {
        fs.writeSync(fd, buf, n, buf.length - n);
      }
    } finally {
      fs.closeSync(fd);
    }
    return stored;
  } finally {
    try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
  }
}

module.exports = {
  roomsDir,
  roomPath,
  validRoomId,
  append,
  readAll,
  tail,
};
