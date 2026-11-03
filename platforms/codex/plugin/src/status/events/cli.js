'use strict';

// src/status/events/cli.js - the `autopilot status events` command line (operator console A1 E4, plan "E4 step 1").
//
//   runEventsCli(argv, { stdout, stderr, cwd, env, stdin }) -> exit code (0 or 2, never anything else)
//   syncStdout()                                            -> a stdout writer that finishes before process.exit (no 64 KiB pipe truncation)
//   main(argv)                                              -> the fast path used by bin/autopilot.js and src/status/cli.js: process.exit
//
// Flags: [--since <cursor|ISO-8601|0|->] [--limit N] [--kinds k1,k2] [--project <project_key>] [--review-ledger <dir>]... [--json]
// Exit codes: 0 for an envelope (with or without warnings); 2 for a usage error, `bad_cursor`, `project_unresolved`, `project_mismatch`.
// Under --json every exit-2 path prints the error object {"schema":"autopilot.events/1","error":{"code":...}} on stdout.
// A failure outside collectEvents' own catch (and any uncaught exception or unhandled rejection) is caught here and ends in
// exit 0 with events [], the input cursor unchanged and one `internal_error` warning: the command never ends in Node's exit 1.
// This module requires only collectEvents (which lazily loads the readers), so the bin fast path stays light.

const fs = require('fs');

const SCHEMA = 'autopilot.events/1';
const FLAGS_WITH_VALUE = new Set(['--since', '--limit', '--kinds', '--project', '--review-ledger']);

function syncStdout() {
  return {
    write(text) {
      const buf = Buffer.from(String(text), 'utf8');
      let off = 0;
      while (off < buf.length) {
        try {
          off += fs.writeSync(1, buf, off, buf.length - off);
        } catch (error) {
          if (error && error.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1 + Math.floor(Math.random() * 10)); continue; }
          if (error && error.code === 'EPIPE') return true;
          throw error;
        }
      }
      return true;
    },
  };
}

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { since: undefined, limit: undefined, kinds: undefined, project: undefined, reviewLedgers: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (!FLAGS_WITH_VALUE.has(a)) throw new UsageError(`unknown status events argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith('--') && a !== '--since')) throw new UsageError(`${a} requires a value`);
    i += 1;
    if (a === '--since') out.since = v;
    else if (a === '--kinds') out.kinds = v;
    else if (a === '--project') out.project = v;
    else if (a === '--review-ledger') { if (v === '') throw new UsageError('--review-ledger requires a value'); out.reviewLedgers.push(v); }
    else if (a === '--limit') {
      if (!/^[1-9][0-9]*$/.test(v) || Number(v) > 10000) throw new UsageError('--limit must be an integer 1..10000');
      out.limit = Number(v);
    }
  }
  return out;
}

function summaryOf(event) {
  const data = event && event.data && typeof event.data === 'object' ? event.data : {};
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    if (parts.length >= 3) break;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${String(v).replace(/\s+/g, ' ').slice(0, 40)}`);
  }
  return parts.join(' ');
}

function renderTable(envelope, stdout, stderr) {
  for (const e of envelope.events) {
    stdout.write(`${e.kind}\t${e.ts}\t${String(e.id).slice(0, 24)}\t${summaryOf(e)}\n`);
  }
  stdout.write(`next cursor: ${envelope.cursor}\n`);
  if (envelope.has_more) stdout.write('has_more: true\n');
  for (const w of envelope.warnings) stderr.write(`warning ${w.source}:${w.code}${w.detail ? ` (${w.detail})` : ''}${w.count > 1 ? ` x${w.count}` : ''}\n`);
}

function readStdinLine(stdin) {
  if (typeof stdin === 'string') return stdin.split('\n')[0].trim();
  return fs.readFileSync(0, 'utf8').split('\n')[0].trim();
}

function runEventsCli(argv, { stdout = syncStdout(), stderr = process.stderr, cwd = process.cwd(), env = process.env, stdin } = {}) {
  const errorOut = (code, message, json) => {
    stderr.write(`status events: ${message || code}\n`);
    if (json) stdout.write(`${JSON.stringify({ schema: SCHEMA, error: { code } })}\n`);
    return 2;
  };
  const json = argv.includes('--json');
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) return errorOut('usage', error.message, json);
    throw error;
  }
  let since = args.since;
  if (since === '-') {
    try { since = readStdinLine(stdin); } catch (_error) { since = ''; }
    if (since === '') return errorOut('bad_cursor', 'no cursor on stdin', json);
  }
  const inputCursorText = typeof since === 'string' && since !== '0' ? since : '';

  const emitFallback = () => {
    const envelope = {
      schema: SCHEMA, generated_at: new Date().toISOString(), project: { project_key: '', repo_name: '' }, events: [], cursor: inputCursorText,
      has_more: false, sources: [], warnings: [{ source: 'cli', code: 'internal_error', detail: 'Error', count: 1 }],
    };
    if (json) stdout.write(`${JSON.stringify(envelope)}\n`);
    else renderTable(envelope, stdout, stderr);
    return 0;
  };
  const onFatal = () => { try { emitFallback(); } catch (_e) { /* nothing left to do */ } process.exit(0); };
  process.on('uncaughtException', onFatal);
  process.on('unhandledRejection', onFatal);
  try {
    const { collectEvents, exitCodeOf } = require('./index');
    const result = collectEvents({
      cwd, env, home: env.HOME, since, limit: args.limit, kinds: args.kinds, projectKey: args.project, reviewLedgers: args.reviewLedgers,
    });
    if (exitCodeOf(result) === 2) return errorOut(result.error.code, result.error.code, json);
    if (json) stdout.write(`${JSON.stringify(result)}\n`);
    else renderTable(result, stdout, stderr);
    return 0;
  } catch (_error) {
    try { return emitFallback(); } catch (_inner) { stdout.write(`{"schema":"${SCHEMA}","generated_at":"${new Date().toISOString()}","project":{"project_key":"","repo_name":""},"events":[],"cursor":"","has_more":false,"sources":[],"warnings":[{"source":"cli","code":"internal_error","detail":"Error","count":1}]}\n`); return 0; }
  } finally {
    process.removeListener('uncaughtException', onFatal);
    process.removeListener('unhandledRejection', onFatal);
  }
}

// The bin fast path: argv = what follows `status events`.
function main(argv) {
  return runEventsCli(argv, { stdout: syncStdout(), stderr: process.stderr, cwd: process.cwd(), env: process.env });
}

module.exports = { runEventsCli, syncStdout, main, parseArgs };
