#!/usr/bin/env node
'use strict';
// wait-dispatch-results — block until detached dispatches have landed their exit files.
//
// PROBLEM (chatgpt-tunnel-host, 2026-09-12, defect (B)): a foreman that dispatched N hands
// through the detached rails had no primitive to wait for them — it polled `ls` in a Bash
// loop (the exact spin foreman-guard exists to stop) and could not tell "not finished" from
// "never started". The contract it needed already exists: every detached rail
// (scripts/lib/dispatch-detach.sh, dispatch-hetero.sh's EXIT_FILE) lands
//   <ledger>.results/<run_id>.<stage>.exit          — the worker's exit code, written LAST,
//   <ledger>.results/<run_id>.<stage>.result.json   — the durable result
// atomically (tmp + rename). This tool is the wait side of that contract and nothing more.
//
// USAGE:
//   wait-dispatch-results.js --ledger <path> --expect <run_id>.<stage> [--expect …]
//                            [--timeout <secs>] [--poll <secs>] [--json]
//   --results-dir <dir>   use an explicit results dir instead of "<ledger>.results"
//
// OUTPUT (stdout, one JSON object):
//   { "complete": bool, "results_dir": "…", "waited_secs": n,
//     "done":    [ { "key", "exit_code", "exit_file", "result_file", "result_present" } ],
//     "missing": [ "<key>", … ] }
// EXIT: 0 every expected key landed; 1 timeout — `missing` names what never landed;
//       2 usage / cannot run. The exit code of each hand is DATA in `done[]`, never this
//       tool's exit: a hand that failed still LANDED, and the caller reads its result.
//
// TRUST: the presence of an .exit file is the rail's own write (dispatch-detach.sh line
// `printf "%s" "$rc" > "$DD_EXIT.tmp.$$" && mv …`), not a worker claim. An .exit file whose
// content is not an integer is reported as landed with exit_code null — the file exists, the
// rail is what wrote it, and the caller decides what a malformed code means.

const fs = require('fs');
const path = require('path');

function usage(msg) {
  process.stderr.write(`wait-dispatch-results: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { ledger: null, resultsDir: null, expect: [], timeout: 3600, poll: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    const need = () => { if (v === undefined) usage(`${k} needs a value`); i += 1; return v; };
    if (k === '--ledger') out.ledger = need();
    else if (k === '--results-dir') out.resultsDir = need();
    else if (k === '--expect') out.expect.push(need());
    else if (k === '--timeout') out.timeout = Number(need());
    else if (k === '--poll') out.poll = Number(need());
    else if (k === '--json') { /* default; accepted for symmetry with the other rails */ }
    else if (k === '--help' || k === '-h') { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n') + '\n'); process.exit(0); }
    else usage(`unknown argument: ${k}`);
  }
  if (!out.ledger && !out.resultsDir) usage('--ledger <path> (or --results-dir <dir>) is required');
  if (out.expect.length === 0) usage('at least one --expect <run_id>.<stage> is required');
  for (const e of out.expect) {
    if (!/^[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+$/.test(e) || e.includes('/') || e.includes('..')) usage(`--expect must be <run_id>.<stage> (got: ${e})`);
  }
  if (!Number.isFinite(out.timeout) || out.timeout < 0) usage('--timeout must be a non-negative number of seconds');
  if (!Number.isFinite(out.poll) || out.poll <= 0) usage('--poll must be a positive number of seconds');
  if (!out.resultsDir) out.resultsDir = `${out.ledger}.results`;
  return out;
}

function readExit(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return undefined; }
  const t = raw.trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

function snapshot(dir, keys) {
  const done = [];
  const missing = [];
  for (const key of keys) {
    const exitFile = path.join(dir, `${key}.exit`);
    const resultFile = path.join(dir, `${key}.result.json`);
    const code = readExit(exitFile);
    if (code === undefined) { missing.push(key); continue; }
    done.push({ key, exit_code: code, exit_file: exitFile, result_file: resultFile, result_present: fs.existsSync(resultFile) });
  }
  return { done, missing };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();
  let snap = snapshot(opts.resultsDir, opts.expect);
  while (snap.missing.length > 0 && (Date.now() - started) / 1000 < opts.timeout) {
    const remaining = opts.timeout - (Date.now() - started) / 1000;
    await sleep(Math.max(0, Math.min(opts.poll, remaining)) * 1000);
    snap = snapshot(opts.resultsDir, opts.expect);
  }
  const complete = snap.missing.length === 0;
  process.stdout.write(JSON.stringify({
    complete,
    results_dir: opts.resultsDir,
    waited_secs: Math.round((Date.now() - started) / 100) / 10,
    done: snap.done,
    missing: snap.missing,
  }) + '\n');
  process.exit(complete ? 0 : 1);
}

main().catch((e) => { process.stderr.write(`wait-dispatch-results: ${e && e.message ? e.message : e}\n`); process.exit(2); });
