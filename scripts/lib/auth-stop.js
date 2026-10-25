#!/usr/bin/env node
'use strict';
// auth-stop.js -- shared "first authentication failure stops the whole paid batch" helper (BL-0294).
//
// A paid batch that calls a model once per id must not keep calling after the credential is dead:
// every later id fails the same way and burns budget or retries. This module decides whether ONE
// finished call failed on authentication, and gives every batch the same stop behaviour: the line
//   STOP_AUTH after <id>: <matched text>
// on stderr and exit code 6 (the code evals/orchestration/run-p2-batch.js already uses for STOP_AUTH).
//
// WHAT COUNTS AS AN AUTH FAILURE (each phrase comes from a real output, not a guess):
//   "Failed to authenticate", "OAuth session expired", "authentication_failed"
//       evals/orchestration/run-p2-batch.js AUTH_RE (claude -p stderr / run.log)
//   "Invalid API key - Please run /login", "Not logged in", "OAuth token has expired"
//       evals/skill-onoff/run-skill-onoff-eval.sh AUTH_RE and hooks/tests/skill-onoff-failfast.test.sh
//       (claude -p stream-json `result` line with is_error true)
//   "401 Unauthorized"   hooks/tests/t14-gate-batch.test.sh (HTTP status line from the provider)
//   {"is_error":true,"api_error_status":401}   the claude envelope field scripts/dispatch-hetero.sh reads
// Deliberately NOT matched: the bare words "authentication", "unauthorized", "forbidden", "author"
// (they occur in ordinary model prose and in 403/429 failures that are not a dead credential).
//
// Two ways to read a source:
//   raw        every line is error text (a stderr file): the phrases are searched in all of it.
//   structured a mixed log (stream-json / dispatch JSON / agent log): a line that parses as JSON counts
//              only through its error fields (is_error result, type error, error string,
//              api_error_status 401); a plain-text line is searched like raw text. Model prose inside
//              JSON assistant messages is never searched.
//
// CLI:  node auth-stop.js check [--id ID] [--stderr FILE]... [--log FILE]... [--text STR]...
//   exit 0 = no auth failure, 6 = auth failure (stop line on stderr), 2 = usage. Missing files are skipped.
// Library: isAuthFailure, scanText, checkSources, stopLine, EXIT_AUTH_STOP.

const fs = require('fs');

const EXIT_AUTH_STOP = 6;

const AUTH_PATTERNS = [
  /failed to authenticate/i,
  /oauth (?:session|token) (?:has )?expired/i,
  /authentication_failed/i,
  /invalid[ _-]?(?:api[ _-]?)?key[^\n]{0,40}\/login/i,
  /please run \/login/i,
  /\bnot logged in\b/i,
  /\b401\b[^\n]{0,24}\bunauthori[sz]ed\b/i,
  /\bunauthori[sz]ed\b[^\n]{0,24}\b401\b/i,
];

const snippet = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 160);

/** @returns {string|null} the matched line (trimmed) or null */
function matchLine(line) {
  for (const re of AUTH_PATTERNS) if (re.test(line)) return snippet(line);
  return null;
}

function structuredLine(line) {
  let o;
  try { o = JSON.parse(line); } catch (_e) { return matchLine(line); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return matchLine(line);
  if (o.is_error === true && Number(o.api_error_status) === 401) return `api_error_status=401 ${snippet(o.result || '')}`.trim();
  const fields = [];
  if (o.is_error === true && typeof o.result === 'string') fields.push(o.result);
  if (typeof o.error === 'string') fields.push(o.error);
  if (o.error && typeof o.error === 'object' && typeof o.error.message === 'string') fields.push(o.error.message);
  if (o.type === 'error' && typeof o.message === 'string') fields.push(o.message);
  for (const f of fields) { const m = matchLine(f); if (m) return m; }
  return null;
}

/** @returns {string|null} first matching snippet. opts.structured selects the mixed-log reading. */
function scanText(text, opts) {
  const structured = !!(opts && opts.structured);
  if (typeof text !== 'string' || text === '') return null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = structured ? structuredLine(line) : matchLine(line);
    if (m) return m;
  }
  return null;
}

const isAuthFailure = (text, opts) => scanText(text, opts) !== null;

/** sources: [{ kind: 'raw'|'structured', path } | { kind, text }]. Returns { source, match } or null. */
function checkSources(sources) {
  for (const s of sources) {
    let text = s.text;
    if (text === undefined) { try { text = fs.readFileSync(s.path, 'utf8'); } catch (_e) { continue; } }
    const m = scanText(text, { structured: s.kind === 'structured' });
    if (m) return { source: s.path || '(text)', match: m };
  }
  return null;
}

const stopLine = (id, hit) => `STOP_AUTH after ${id}: ${hit.match}`;

function main(argv) {
  if (argv[0] !== 'check') { process.stderr.write('usage: auth-stop.js check [--id ID] [--stderr FILE]... [--log FILE]... [--text STR]...\n'); return 2; }
  let id = '?'; const sources = [];
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (v === undefined) { process.stderr.write(`auth-stop.js: ${k} needs a value\n`); return 2; }
    if (k === '--id') id = v;
    else if (k === '--stderr') sources.push({ kind: 'raw', path: v });
    else if (k === '--log') sources.push({ kind: 'structured', path: v });
    else if (k === '--text') sources.push({ kind: 'raw', text: v });
    else { process.stderr.write(`auth-stop.js: unknown option ${k}\n`); return 2; }
  }
  const hit = checkSources(sources);
  if (!hit) return 0;
  process.stderr.write(`${stopLine(id, hit)}\n`);
  return EXIT_AUTH_STOP;
}

module.exports = { EXIT_AUTH_STOP, AUTH_PATTERNS, isAuthFailure, scanText, checkSources, stopLine };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
