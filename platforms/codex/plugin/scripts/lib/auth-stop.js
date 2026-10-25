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
// WHAT COUNTS AS AN AUTH FAILURE -- two layers, every phrase traced to a real runner output (file:line):
//  (1) STRUCTURED, any JSON object (a whole file, or one line of a log):
//        error.type or type == "authentication_error"        Anthropic error envelope, hooks/tests/endpoints-cli.test.sh:162
//        status / api_error_status / http_status == 401      scripts/dispatch-hetero.sh capture_structured_provider_error
//                                                            (reads api_error_status), src/readiness/probe.js:50 ('401' -> auth_failed)
//        is_error result / error / error.message / message   text of those fields goes through layer (2)
//  (2) TEXT, STRONG phrases (searched in raw stderr, in plain lines of a mixed log, and in the JSON error fields above):
//        failed to authenticate; oauth session|token expired; authentication_failed
//            evals/orchestration/run-p2-batch.js:53 AUTH_RE, evals/skill-onoff/run-skill-onoff-eval.sh:471 AUTH_RE
//        authentication_error                                hooks/tests/endpoints-cli.test.sh:162
//        please run /login; not logged in; login required / log in required
//            run-skill-onoff-eval.sh:471, scripts/probe-skill-frontmatter-portability.sh:78, scripts/qualification-review-provider.js:1208
//        a 401 in an HTTP or API-error context: "API Error: 401", "HTTP 401", "status 401", "status code 401", "api_error_status":401,
//            "401 Unauthorized"                              scripts/qualification-review-provider.js:1214, hooks/tests/t14-gate-batch.test.sh:89,
//                                                            hooks/tests/skill-onoff-failfast.test.sh:22, scripts/qualification-review-provider.test.js:2158
//      WEAK phrases (searched in raw stderr and in JSON error fields only, NOT in plain lines of a mixed log, where candidate
//      code or model prose may quote them):
//        invalid api key (no /login needed); token (has) expired; authentication failed|required; authorization failed
//            run-skill-onoff-eval.sh:471, probe-skill-frontmatter-portability.sh:78, hooks/tests/probe-engine-capability.test.sh:119,
//            hooks/tests/engine-capability-state.test.sh:120
//    Deliberately NOT matched: bare "authentication", "unauthorized", "forbidden", "author" (ordinary prose, and 403/429 failures that are
//    not a dead credential), a bare number 401 ("exit code 401"), and a permission_error / 403.
//
// Three ways to read a source:
//   raw        every line is error text (a stderr file): strong and weak phrases are searched in all of it.
//   structured a mixed log (stream-json / dispatch JSON / agent log): JSON is read through layer (1) and its error fields;
//              a plain-text line is searched for STRONG phrases only. Model prose inside JSON assistant messages is never searched.
//   dispatch   a dispatch-hetero / dispatch-review result: read as structured, then the files named by its agent_log / raw_log
//              fields are read as structured too (the runner's own authentication error lives there, not in the result JSON).
//
// CLI:  node auth-stop.js check [--id ID] [--stderr FILE]... [--log FILE]... [--dispatch FILE]... [--text STR]...
//   exit 0 = no auth failure, 6 = auth failure (stop line on stderr), 2 = usage. Missing files are skipped.
// Library: isAuthFailure, scanText, checkSources, stopLine, EXIT_AUTH_STOP.

const fs = require('fs');

const EXIT_AUTH_STOP = 6;

const STRONG = [
  /failed to authenticate/i,
  /oauth (?:session|token) (?:has )?expired/i,
  /authentication_(?:failed|error)/i,
  /please run \/login/i,
  /\bnot logged in\b/i,
  /\blog ?in required\b/i,
  /(?:\bapi error|\bhttp(?:\/[\d.]+)?|\bstatus(?: code)?|\bapi_error_status|\bhttp_status|\bstatuscode)["']?\s*[:=]?\s*["']?401\b/i,
  /\b401\s+unauthori[sz]ed\b/i,
  /\bunauthori[sz]ed\b[^\n]{0,24}\b401\b/i,
];
const WEAK = [
  /invalid[ _-]?(?:api[ _-]?)?key/i,
  /\btoken (?:has )?expired\b/i,
  /\bauthentication (?:failed|required)\b/i,
  /\bauthori[sz]ation failed\b/i,
];
const AUTH_PATTERNS = STRONG.concat(WEAK);

const snippet = (x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 160);

function matchLine(line, weak) {
  for (const re of STRONG) if (re.test(line)) return snippet(line);
  if (weak) for (const re of WEAK) if (re.test(line)) return snippet(line);
  return null;
}

// Layer (1) on one parsed object; error-field text goes through layer (2) with weak phrases on.
function structuredObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const e = o.error && typeof o.error === 'object' ? o.error : null;
  if (o.type === 'authentication_error' || (e && e.type === 'authentication_error')) return 'authentication_error';
  for (const holder of [o, e]) {
    if (!holder) continue;
    for (const k of ['status', 'api_error_status', 'http_status', 'statusCode']) {
      if (Number(holder[k]) === 401 && holder[k] !== null && holder[k] !== '' && holder[k] !== false) return `${k}=401 ${snippet(o.result || o.error && o.error.message || '')}`.trim();
    }
  }
  const fields = [];
  if (o.is_error === true && typeof o.result === 'string') fields.push(o.result);
  if (typeof o.error === 'string') fields.push(o.error);
  if (e && typeof e.message === 'string') fields.push(e.message);
  if (o.type === 'error' && typeof o.message === 'string') fields.push(o.message);
  for (const f of fields) { const m = matchLine(f, true); if (m) return m; }
  return null;
}

function parseJson(t) { try { return JSON.parse(t); } catch (_e) { return undefined; } }

/** @returns {string|null} first matching snippet. opts.structured selects the mixed-log reading. */
function scanText(text, opts) {
  const structured = !!(opts && opts.structured);
  if (typeof text !== 'string' || text === '') return null;
  if (structured) {
    const whole = parseJson(text.trim());
    if (whole && typeof whole === 'object') return structuredObject(whole);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!structured) { const m = matchLine(line, true); if (m) return m; continue; }
    const o = parseJson(line);
    const m = o && typeof o === 'object' ? structuredObject(o) : matchLine(line, false);
    if (m) return m;
  }
  return null;
}

const isAuthFailure = (text, opts) => scanText(text, opts) !== null;

// File paths a dispatch result names for the runner's own log.
function followedLogs(text) {
  const out = [];
  const take = (o) => { if (o && typeof o === 'object') for (const k of ['agent_log', 'raw_log']) if (typeof o[k] === 'string' && o[k]) out.push(o[k]); };
  const whole = parseJson(String(text).trim());
  if (whole && typeof whole === 'object') take(whole);
  else for (const line of String(text).split(/\r?\n/)) take(parseJson(line));
  return out;
}

/** sources: [{ kind: 'raw'|'structured'|'dispatch', path } | { kind, text }]. Returns { source, match } or null. */
function checkSources(sources) {
  for (const s of sources) {
    let text = s.text;
    if (text === undefined) { try { text = fs.readFileSync(s.path, 'utf8'); } catch (_e) { continue; } }
    const m = scanText(text, { structured: s.kind !== 'raw' });
    if (m) return { source: s.path || '(text)', match: m };
    if (s.kind === 'dispatch') {
      for (const f of followedLogs(text)) {
        let t; try { t = fs.readFileSync(f, 'utf8'); } catch (_e) { continue; }
        const m2 = scanText(t, { structured: true });
        if (m2) return { source: f, match: m2 };
      }
    }
  }
  return null;
}

const stopLine = (id, hit) => `STOP_AUTH after ${id}: ${hit.match}`;

function main(argv) {
  if (argv[0] !== 'check') { process.stderr.write('usage: auth-stop.js check [--id ID] [--stderr FILE]... [--log FILE]... [--dispatch FILE]... [--text STR]...\n'); return 2; }
  let id = '?'; const sources = [];
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (v === undefined) { process.stderr.write(`auth-stop.js: ${k} needs a value\n`); return 2; }
    if (k === '--id') id = v;
    else if (k === '--stderr') sources.push({ kind: 'raw', path: v });
    else if (k === '--log') sources.push({ kind: 'structured', path: v });
    else if (k === '--dispatch') sources.push({ kind: 'dispatch', path: v });
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
