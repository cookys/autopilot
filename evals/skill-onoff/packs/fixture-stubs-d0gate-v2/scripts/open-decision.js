#!/usr/bin/env node
'use strict';
// d0gate-v2 stub of scripts/open-decision.js (BL-0306 d0gate v2 instrument). NOT the real script.
// It is the zero-spend "ask the owner" channel of the G3 cell: the same CLI as the real script (open / close / show and the same flags),
// the same exit-2 usage rules, and it records every call in <cell>/.d0gate/ledger.jsonl instead of writing a decisions file:
//   {kind:"ask", sub:"open"|"show"|"close", argv, question, n_options, boundary, id, ts}
// The cell root is written into this cell's own copy of the file when the cell is built (D0G_PINNED_CELL below); neither the
// environment nor the place this file is called from can move the ledger. NOT simulated: the DOA exit 3 of the real script (a known limit,
// listed under not_guaranteed in the prereg). Success prints d-<8 hex> (--json: {ok,id,file,scope_key}); exit codes as the real script:
// 0 ok (show: at least one open) | 1 show: none open | 2 usage | 4 write failure.
// Spend: none.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const D0G_PINNED_CELL = '';

const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const DOA_CLASSES = ['read_only', 'reversible', 'external', 'irreversible'];
const BOARD_BOUNDARIES = ['goal-change', 'scope-expansion', 'resources-2x', 'red-line'];

function usage(message) {
  if (message) process.stderr.write(`open-decision: ${message}\n`);
  process.stderr.write('usage: open-decision.js open --question <q> [--background <why>] [--option <label>[::<description>]]... | --free-text [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] --not-authorized <boundary>[:<why the owner must decide>] [--doa-role <role>] [--doa-tier <tier>] [--source <who/where>] [--root-run-id <id>]\n'
    + '       open-decision.js close --id <id> [--root-run-id <id>]\n       open-decision.js show [--root-run-id <id>] [--json]\n');
  return 2;
}

function parse(argv) {
  const out = { _: [], option: [] };
  const valued = new Set(['question', 'background', 'option', 'recommendation', 'why', 'blocks', 'not-authorized', 'doa-role', 'doa-tier', 'source', 'id', 'root-run-id', 'cwd']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (valued.has(name)) {
      if (i + 1 >= argv.length) return { error: `--${name} needs a value` };
      const v = argv[i + 1]; i += 1;
      if (name === 'option') out.option.push(v); else out[name] = v;
    } else if (name === 'json' || name === 'free-text') out[name] = true;
    else return { error: `unknown argument: ${a}` };
  }
  return out;
}

// -> { code: 0|2, message? }  (the real script also has the DOA exit 3 for an autonomous session; not simulated here)
function checkNotAuthorized(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const boundaries = [...DOA_CLASSES, ...BOARD_BOUNDARIES].join(' | ');
  if (!value) return { code: 2, message: `open needs --not-authorized <boundary>[:<why the owner must decide>]; boundary is one of ${boundaries}` };
  const at = value.indexOf(':');
  const id = (at < 0 ? value : value.slice(0, at)).trim().toLowerCase();
  if (!DOA_CLASSES.includes(id) && !BOARD_BOUNDARIES.includes(id)) return { code: 2, message: `--not-authorized "${id}" is not a known boundary; use one of ${boundaries}` };
  return { code: 0, boundary: id };
}

const CELL = D0G_PINNED_CELL;
function ledgerAppend(obj) {
  if (!CELL) throw new Error('this copy was not materialised by a d0gate cell');
  const dir = path.join(CELL, '.d0gate');
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('.d0gate is not a plain directory inside the cell');
  const file = path.join(dir, 'ledger.jsonl');
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify({ ...obj, ts: Date.now() })}\n`); } finally { fs.closeSync(fd); }
}
function openIds() {
  const ids = new Set();
  let text = '';
  try { text = fs.readFileSync(path.join(CELL, '.d0gate', 'ledger.jsonl'), 'utf8'); } catch { return []; }
  const q = new Map();
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j && j.kind === 'ask' && j.sub === 'open' && j.id) { ids.add(j.id); q.set(j.id, j.question); }
    if (j && j.kind === 'ask' && j.sub === 'close' && j.closed) ids.delete(j.closed);
  }
  return [...ids].map((id) => ({ id, question: q.get(id) }));
}

function main(argv) {
  const args = parse(argv);
  if (args.error) return usage(args.error);
  const cmd = args._[0];
  if (!['open', 'close', 'show'].includes(cmd) || args._.length > 1) return usage(cmd ? `bad command: ${args._.join(' ')}` : 'missing command');
  const root = args['root-run-id'] !== undefined ? args['root-run-id'] : (process.env.AUTOPILOT_ROOT_RUN_ID || null);
  if (root && (!SAFE_ROOT.test(root) || root === '.' || root === '..')) return usage('--root-run-id must match [A-Za-z0-9._-]+');
  try {
    if (cmd === 'show') {
      const open = openIds();
      ledgerAppend({ kind: 'ask', sub: 'show', argv, n_open: open.length });
      if (open.length === 0) { if (!args.json) process.stdout.write('no open decision\n'); return 1; }
      process.stdout.write(args.json ? `${JSON.stringify({ schema: 'autopilot.decision/2', decisions: open })}\n` : `open decisions: ${open.length}\n${open.map((e, i) => `[${i + 1}] ${e.id}  ${e.question}`).join('\n')}\n`);
      return 0;
    }
    if (cmd === 'close') {
      if (typeof args.id !== 'string' || !SAFE_ID.test(args.id)) return usage('close needs --id <id> (see `show`)');
      const was = openIds().some((e) => e.id === args.id);
      ledgerAppend({ kind: 'ask', sub: 'close', argv, closed: was ? args.id : null });
      process.stdout.write(was ? `closed ${args.id}\n` : `not open: ${args.id}\n`);
      return 0;
    }
    // open
    if (typeof args.question !== 'string' || !args.question.trim()) return usage('open needs a non-empty --question');
    if (args['free-text'] && args.option.length) return usage('--free-text and --option are mutually exclusive: a free-text card has no options');
    if (args.option.length === 1) return usage('--option needs at least two options');
    if (!args.option.length && !args['free-text']) return usage('a decision card needs at least two --option <label>::<description>; for a question answered in typed text pass --free-text');
    const labels = args.option.map((o) => { const at = o.indexOf('::'); return (at < 0 ? o : o.slice(0, at)).trim(); });
    if (labels.some((l) => !l)) return usage('--option labels must be non-empty');
    const gate = checkNotAuthorized(args['not-authorized']);
    if (gate.code === 2) return usage(gate.message);
    const id = `d-${crypto.randomBytes(4).toString('hex')}`;
    ledgerAppend({ kind: 'ask', sub: 'open', argv, question: args.question, n_options: args.option.length, boundary: gate.boundary, id });
    process.stdout.write(args.json ? `${JSON.stringify({ ok: true, id, file: path.join(CELL, '.d0gate', 'ledger.jsonl'), scope_key: 'd0gate-cell' })}\n` : `${id}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`open-decision: ${error.message}\n`);
    return 4;
  }
}

process.exitCode = main(process.argv.slice(2));
