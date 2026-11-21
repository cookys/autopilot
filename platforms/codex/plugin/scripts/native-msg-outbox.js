#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdirp } = require('./lib/safe-mkdirp');

function resolveStateDir() {
  if (process.env.AUTOPILOT_STATE_DIR) {
    return process.env.AUTOPILOT_STATE_DIR;
  }
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, 'autopilot');
  }
  return path.join(os.homedir(), '.local', 'state', 'autopilot');
}

function outboxPath(stateDir = resolveStateDir()) {
  return path.join(stateDir, 'native-msg-outbox.jsonl');
}

function isFleetAddress(to) {
  if (typeof to !== 'string') return false;
  const parts = to.split('/');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function readRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

function acquireLock(lockPath, deadlineMs = 5000) {
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(lockPath); } catch {}
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start >= deadlineMs) {
        throw new Error(`Timed out waiting for outbox lock: ${lockPath}`);
      }
      const waitUntil = Date.now() + 25;
      while (Date.now() < waitUntil) {
        // busy-wait briefly
      }
    }
  }
}

function writeRowsAtomic(filePath, rows) {
  const dir = path.dirname(filePath);
  mkdirp(dir);
  const tmpPath = path.join(dir, `.native-msg-outbox.${process.pid}.${Date.now()}.tmp`);
  const content = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function record({ from, to, summary, ts }, stateDir = resolveStateDir()) {
  mkdirp(stateDir);
  const filePath = outboxPath(stateDir);
  const entry = {
    id: crypto.randomUUID(),
    ts: ts || new Date().toISOString(),
    from: from || 'unknown',
    to,
    summary: String(summary || '').slice(0, 120),
    replayed: false,
  };
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

function flush({ fleetBin } = {}, stateDir = resolveStateDir()) {
  const bin = fleetBin || process.env.FLEET_BIN || 'fleet';
  mkdirp(stateDir);
  const filePath = outboxPath(stateDir);
  const lockPath = path.join(stateDir, 'native-msg-outbox.lock');
  const release = acquireLock(lockPath, 5000);
  try {
    const rows = readRows(filePath);
    let changed = false;
    let sent = 0;
    let failed = 0;
    let unreplayable = 0;

    for (const row of rows) {
      if (row.replayed === true || row.unreplayable === true) continue;
      if (!isFleetAddress(row.to)) {
        row.unreplayable = true;
        changed = true;
        unreplayable++;
        continue;
      }
      const msg = `[native 補送] ${row.ts} ${row.from} → ${row.to}: ${row.summary}`;
      try {
        execFileSync(bin, ['send', row.to, msg], {
          timeout: 10000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        row.replayed = true;
        row.replayed_at = new Date().toISOString();
        changed = true;
        sent++;
      } catch {
        failed++;
      }
    }

    if (changed) {
      writeRowsAtomic(filePath, rows);
    }
    return { sent, failed, unreplayable };
  } finally {
    release();
  }
}

function status(stateDir = resolveStateDir()) {
  const rows = readRows(outboxPath(stateDir));
  let pending = 0;
  let replayed = 0;
  let unreplayable = 0;
  for (const row of rows) {
    if (row.unreplayable === true) {
      unreplayable++;
    } else if (row.replayed === true) {
      replayed++;
    } else {
      pending++;
    }
  }
  return { pending, replayed, unreplayable };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'record') {
    if (!args.to) {
      console.error('Usage: native-msg-outbox.js record --from <addr> --to <addr|session> --summary <text> [--ts ISO]');
      process.exit(2);
    }
    const entry = record({
      from: args.from || process.env.AUTOPILOT_FLEET_ADDRESS || 'unknown',
      to: args.to,
      summary: args.summary || '',
      ts: args.ts,
    });
    console.log(JSON.stringify(entry));
  } else if (cmd === 'flush') {
    const res = flush({ fleetBin: args['fleet-bin'] });
    console.log(JSON.stringify(res));
  } else if (cmd === 'status') {
    console.log(JSON.stringify(status()));
  } else {
    console.error('Usage: native-msg-outbox.js <record|flush|status> [options]');
    process.exit(2);
  }
}

module.exports = {
  resolveStateDir,
  outboxPath,
  isFleetAddress,
  readRows,
  record,
  flush,
  status,
};
