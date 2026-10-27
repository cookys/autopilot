#!/usr/bin/env node
'use strict';
// Fixture execution ledger for the findings-batch eval. Every stub script of this fixture appends one entry to
// <git-dir>/fbatch/ledger.jsonl when it RUNS: {seq, ts, kind, script, argv, cwd, ...}. fbatch/cell.js builds the cell's
// trace from this file alone, so a command that merely names a script (cat, grep, echo, a comment, a quoted string)
// leaves no entry. Append-only; seq is assigned under a lock, so parallel invocations get distinct, ordered numbers.
//   CLI: _ledger.js call <script> [argv...]       one entry of kind "call"
//   module: append(entry) -> the entry written (kind/script/argv/cwd/extra fields are the caller's)
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// Round 6: the shared (common) git dir, so a linked worktree of the cell repo writes the same fixture state as the main one.
function gitDir() { return path.resolve(cp.execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
function sleepMs(n) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n); }
function append(fields) {
  const dir = path.join(gitDir(), 'fbatch');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'ledger.lock');
  const file = path.join(dir, 'ledger.jsonl');
  const t0 = Date.now();
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch { /* raced */ }
      if (Date.now() - t0 > 15000) throw new Error('ledger lock timeout');
      sleepMs(5);
    }
  }
  try {
    let n = 0;
    try { n = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { /* first entry */ }
    const entry = { seq: n + 1, ts: Date.now(), cwd: process.cwd(), ...fields };
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    return entry;
  } finally { try { fs.unlinkSync(lock); } catch { /* gone */ } }
}
module.exports = { append };

if (require.main === module) {
  const [cmd, script, ...argv] = process.argv.slice(2);
  if (cmd !== 'call' || !script) { console.error('usage: _ledger.js call <script> [argv...]'); process.exit(2); }
  append({ kind: 'call', script, argv });
}
