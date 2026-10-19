'use strict';

// Room log for roundtable (§6 of docs/plans/2026-09-19-roundtable.md).
// One JSON object per line in <rooms>/<room-id>/room.jsonl.
// AUTOPILOT_ROOMS_DIR replaces the rooms directory (default $HOME/.autopilot/rooms).
// Node built-ins only. Node >= 20.10.

const crypto = require('crypto');
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
  const home = e.HOME || e.USERPROFILE;
  if (!home) {
    throw new Error('AUTOPILOT_ROOMS_DIR is unset and neither HOME nor USERPROFILE is set');
  }
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

function writeAll(fd, buf, writeSync) {
  const write = writeSync || fs.writeSync;
  let off = 0;
  while (off < buf.length) {
    const n = write(fd, buf, off, buf.length - off);
    if (!Number.isInteger(n) || n <= 0) throw new Error('room log short write');
    off += n;
  }
}

function holderToken() {
  return `${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
}

// Put parked back at lockFile only when that path is free. link fails with
// EEXIST instead of overwriting. If the path is taken, drop parked: the mover
// lost the lock, and the path's holder stays the only one.
function restoreOrDrop(parked, lockFile) {
  try {
    fs.linkSync(parked, lockFile);
  } catch {
    try { fs.unlinkSync(parked); } catch { /* already gone */ }
    return;
  }
  try { fs.unlinkSync(parked); } catch { /* canonical name still holds the inode */ }
}

function releaseLock(lockFile, token) {
  const parked = `${lockFile}.release-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try { fs.renameSync(lockFile, parked); } catch { return; }
  let cur = null;
  try { cur = fs.readFileSync(parked, 'utf8'); } catch { /* raced away */ }
  if (cur === token) {
    try { fs.unlinkSync(parked); } catch { /* already gone */ }
    return;
  }
  restoreOrDrop(parked, lockFile);
}

function acquireLock(lockFile, hooks) {
  const token = holderToken();
  const start = Date.now();
  const busyMs = (hooks && hooks.maxBusyMs) || 15000;
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      try {
        writeAll(fd, Buffer.from(token, 'utf8'));
      } catch (err) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
        try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
        throw err;
      }
      fs.closeSync(fd);
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let judged;
      try { judged = fs.statSync(lockFile); } catch { continue; }
      if (Date.now() - judged.mtimeMs < STALE_MS) {
        if (Date.now() - start > busyMs) throw new Error(`room log lock busy: ${lockFile}`);
        if (hooks && typeof hooks.onContended === 'function') hooks.onContended(lockFile);
        sleepMs(15 + Math.floor(Math.random() * 20));
        continue;
      }
      let judgedToken;
      try { judgedToken = fs.readFileSync(lockFile, 'utf8'); } catch { continue; }
      let again;
      try { again = fs.statSync(lockFile); } catch { continue; }
      if (again.ino !== judged.ino || Date.now() - again.mtimeMs < STALE_MS) continue;
      if (hooks && typeof hooks.afterStaleJudgement === 'function') {
        hooks.afterStaleJudgement(lockFile, { token: judgedToken, ino: again.ino, mtimeMs: again.mtimeMs });
      }
      const parked = `${lockFile}.reclaim-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      try { fs.renameSync(lockFile, parked); } catch { continue; }
      let parkedStat;
      let parkedToken;
      try {
        parkedStat = fs.statSync(parked);
        parkedToken = fs.readFileSync(parked, 'utf8');
      } catch {
        continue;
      }
      if (parkedStat.ino === again.ino && parkedToken === judgedToken) {
        try { fs.unlinkSync(parked); } catch { /* reclaimed by name */ }
        continue;
      }
      restoreOrDrop(parked, lockFile);
    }
  }
}

function append(room, fields, env, hooks) {
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
  const token = acquireLock(lockFile, hooks);
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
      const writeSync = hooks && hooks.writeSync;
      if (existing.length > 0 && !existing.endsWith('\n')) {
        writeAll(fd, Buffer.from('\n', 'utf8'), writeSync);
      }
      writeAll(fd, Buffer.from(line, 'utf8'), writeSync);
    } finally {
      fs.closeSync(fd);
    }
    return stored;
  } finally {
    releaseLock(lockFile, token);
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
