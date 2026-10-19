#!/usr/bin/env node
'use strict';

// Window A for roundtable (docs/plans/2026-09-19-roundtable.md §9).
// Subcommands: open, tail, input, send.
// Rooms directory: AUTOPILOT_ROOMS_DIR (scripts/lib/room-log.js).
// ROUNDTABLE_FLEET_BIN (default fleet), ROUNDTABLE_TMUX_BIN (default tmux),
// ROUNDTABLE_SEATS (comma-separated courier handles).
// No skills/roundtable/SKILL.md in this phase.
// Node built-ins only. Node >= 20.10.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const roomLog = require('./lib/room-log');

const USAGE = `roundtable-window.js — window A (tmux)

  open ROOM
      Inside tmux, open window rt-ROOM. The upper pane tails the room log.
      The lower pane (3 rows) reads one line of owner input.
  tail ROOM [--once]
      Print every complete row, then follow the file (poll every 500ms).
      Scrolling is tmux's own scrollback and copy mode.
      --once prints existing rows and exits.
  input ROOM [--seats h1,h2]
      One-line prompt. Enter appends a say from owner and fleet-sends it
      to every seat. A line ending in a backslash continues on the next
      line. An empty line is ignored. Ctrl-D or exit quits.
  send ROOM TEXT... [--seats h1,h2]
      Non-interactive append-and-send (what input uses).

  --no-color    ANSI off. NO_COLOR does the same.
  Colour is ANSI foreground only: owner one colour, system another, say default.
  No background colour and no reverse video.

Seats: --seats, else ROUNDTABLE_SEATS, else distinct from values of say rows
that are not owner or moderator. A seat is a courier handle. Empty handles
and a host-plus-pane form (the substring --local) are rejected.
`;

function colourOn(argv, env) {
  if (argv.includes('--no-color')) return false;
  if (env.NO_COLOR) return false;
  return true;
}

function paint(row, text, on) {
  if (!on) return text;
  if (row.from === 'owner') return `\x1b[36m${text}\x1b[39m`;
  if (row.kind === 'system') return `\x1b[33m${text}\x1b[39m`;
  return text;
}

function formatRow(row, on) {
  const round = row.round === undefined || row.round === null ? '' : ` round=${row.round}`;
  const header = `#${row.seq} ${row.from} ${row.kind}${round}`;
  const body = String(row.text).split('\n').map((line) => `  ${line}`).join('\n');
  return `${paint(row, `${header}\n${body}`, on)}\n`;
}

function parseCli(argv) {
  const rest = [];
  let seats = null;
  let once = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true, rest, seats, once };
    if (a === '--no-color') continue;
    if (a === '--once') { once = true; continue; }
    if (a === '--seats') {
      seats = argv[i + 1];
      i += 1;
      continue;
    }
    rest.push(a);
  }
  return { help: false, rest, seats, once };
}

function assertHandle(handle) {
  if (typeof handle !== 'string' || handle.trim() === '') {
    throw new Error('empty seat handle');
  }
  if (handle.includes('--local')) {
    throw new Error(`rejected seat handle (host-plus-pane form contains --local): ${handle}`);
  }
  if (!handle.includes('/')) {
    throw new Error(`rejected seat handle (not a courier handle): ${handle}`);
  }
  if (handle === '@team' || handle === 'fleet_wide' || handle.includes('@team')) {
    throw new Error(`rejected seat handle (broadcast): ${handle}`);
  }
}

function resolveSeats(room, cliSeats, env) {
  let raw = cliSeats;
  if (raw === null || raw === undefined) {
    if (env.ROUNDTABLE_SEATS) raw = env.ROUNDTABLE_SEATS;
  }
  let handles;
  if (raw === null || raw === undefined) {
    const seen = [];
    for (const row of roomLog.readAll(room, env)) {
      if (row.kind !== 'say') continue;
      if (row.from === 'owner' || row.from === 'moderator') continue;
      if (!seen.includes(row.from)) seen.push(row.from);
    }
    handles = seen;
  } else {
    handles = String(raw).split(',').map((s) => s.trim());
    if (handles.length === 1 && handles[0] === '') handles = [];
  }
  for (const h of handles) assertHandle(h);
  return handles;
}

function fleetBin(env) {
  return env.ROUNDTABLE_FLEET_BIN || 'fleet';
}

function sendText(room, text, cliSeats, env) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('empty text');
  }
  const seats = resolveSeats(room, cliSeats, env);
  const row = roomLog.append(room, {
    from: 'owner',
    kind: 'say',
    text,
    reply_to: null,
    to: seats,
  }, env);
  const wire = `${room} #${row.seq}\n${text}`;
  const bin = fleetBin(env);
  let failed = false;
  for (const handle of seats) {
    const r = spawnSync(bin, ['send', handle, wire], { encoding: 'utf8' });
    const stderr = (r.stderr || '') + (r.error ? r.error.message : '');
    const status = r.error ? (r.status == null ? 'spawn-failed' : r.status) : r.status;
    if (r.error || status !== 0) {
      failed = true;
      const note = `send failed handle=${handle} status=${status} stderr=${stderr.trim()}`;
      roomLog.append(room, {
        from: 'moderator',
        kind: 'system',
        text: note,
        reply_to: row.seq,
        to: [handle],
      }, env);
      process.stderr.write(`${note}\n`);
    }
  }
  return failed ? 1 : 0;
}

function cmdTail(room, once, env, argv) {
  const on = colourOn(argv, env);
  let last = 0;
  const paintRows = (rows) => {
    for (const row of rows) {
      process.stdout.write(formatRow(row, on));
      if (row.seq > last) last = row.seq;
    }
  };
  paintRows(roomLog.readAll(room, env));
  if (once) return 0;
  const timer = setInterval(() => {
    try {
      paintRows(roomLog.tail(room, last, env));
    } catch (err) {
      process.stderr.write(`tail: ${err.message}\n`);
    }
  }, 500);
  if (typeof timer.unref === 'function') {
    // keep the process alive: do not unref
  }
  fs.watchFile(roomLog.roomPath(room, env), { interval: 500 }, () => {
    try { paintRows(roomLog.tail(room, last, env)); } catch { /* next tick */ }
  });
  return null;
}

function cmdOpen(room, env) {
  if (!env.TMUX) {
    process.stderr.write('roundtable-window: open must run inside tmux (TMUX is unset). Scrolling is tmux scrollback and copy mode.\n');
    return 2;
  }
  const tmux = env.ROUNDTABLE_TMUX_BIN || 'tmux';
  const self = path.resolve(process.argv[1]);
  const node = process.execPath;
  const name = `rt-${room}`;
  const created = spawnSync(tmux, ['new-window', '-n', name, node, self, 'tail', room], { encoding: 'utf8' });
  if (created.error || created.status !== 0) {
    process.stderr.write(created.stderr || (created.error && created.error.message) || 'tmux new-window failed\n');
    return created.status || 1;
  }
  const split = spawnSync(tmux, ['split-window', '-t', name, '-v', '-l', '3', node, self, 'input', room], { encoding: 'utf8' });
  if (split.error || split.status !== 0) {
    process.stderr.write(split.stderr || (split.error && split.error.message) || 'tmux split-window failed\n');
    return split.status || 1;
  }
  return 0;
}

function cmdInput(room, cliSeats, env, argv) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  let buf = '';
  let exitCode = 0;
  rl.prompt();
  rl.on('line', (line) => {
    if (buf === '' && line === 'exit') {
      rl.close();
      return;
    }
    if (line.endsWith('\\')) {
      buf += `${line.slice(0, -1)}\n`;
      rl.prompt();
      return;
    }
    const text = buf + line;
    buf = '';
    if (text.length === 0) {
      rl.prompt();
      return;
    }
    try {
      const code = sendText(room, text, cliSeats, env);
      if (code !== 0) exitCode = code;
    } catch (err) {
      exitCode = 1;
      process.stderr.write(`${err.message}\n`);
    }
    rl.prompt();
  });
  rl.on('close', () => {
    process.exit(exitCode);
  });
  void argv;
  return null;
}

function main(argv, env) {
  const cli = parseCli(argv);
  if (cli.help || cli.rest.length === 0) {
    process.stdout.write(USAGE);
    return cli.help ? 0 : 2;
  }
  const [cmd, room, ...textParts] = cli.rest;
  if (!room) {
    process.stderr.write('missing ROOM\n');
    process.stdout.write(USAGE);
    return 2;
  }
  try {
    if (cmd === 'open') return cmdOpen(room, env);
    if (cmd === 'tail') return cmdTail(room, cli.once, env, argv);
    if (cmd === 'send') {
      const text = textParts.join(' ');
      return sendText(room, text, cli.seats, env);
    }
    if (cmd === 'input') return cmdInput(room, cli.seats, env, argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
  process.stderr.write(`unknown subcommand: ${cmd}\n`);
  process.stdout.write(USAGE);
  return 2;
}

if (require.main === module) {
  const code = main(process.argv.slice(2), process.env);
  if (code !== null && code !== undefined) process.exit(code);
}

module.exports = { main, formatRow, sendText };
