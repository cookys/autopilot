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
// WHAT COUNTS AS AN AUTH FAILURE -- decided from the CALL, not from the stream:
//  (1) STRUCTURED fields decide on their own (any call, any stream): a JSON object (a whole file or one line) whose
//      type or error.type is "authentication_error", or whose status / api_error_status / http_status is 401
//        hooks/tests/endpoints-cli.test.sh:162 (Anthropic envelope), scripts/dispatch-hetero.sh capture_structured_provider_error
//        (reads api_error_status), src/readiness/probe.js:50 ('401' -> auth_failed)
//  (2) TEXT phrases count ONLY WHEN THE CALL FAILED (the caller says so: non-zero exit code, no valid result, or a dispatch result
//      whose status is not committed / no_op / reviewed). A call that succeeded is never an auth failure, whatever its text says
//      (a normal answer may quote "invalid api key"). When the call failed, a phrase anywhere in any of its outputs counts; there is
//      no stdout / stderr / log distinction, so merged or split streams judge the same. ONE table, every row traced to file:line:
//        failed to authenticate; oauth session|token expired; authentication_failed
//            evals/orchestration/run-p2-batch.js:53 AUTH_RE, evals/skill-onoff/run-skill-onoff-eval.sh:471 AUTH_RE
//        authentication_error                                   hooks/tests/endpoints-cli.test.sh:162
//        please run /login; not logged in                       run-skill-onoff-eval.sh:471, probe-skill-frontmatter-portability.sh:78
//        login required / log in required                       scripts/qualification-review-provider.js:1208, probe-skill-frontmatter-portability.sh:78
//        please log in                                          scripts/qualification-review-provider.test.js:2157 ("Please log in to continue.")
//        authentication error / failed / required               qualification-review-provider.test.js:2172, hooks/tests/orchestration-eval.test.sh:578
//                                                               ("Authentication failed: token expired"), probe-skill-frontmatter-portability.sh:78
//        authorization failed                                   hooks/tests/probe-engine-capability.test.sh:119, engine-capability-state.test.sh:120
//        invalid api key (no /login needed)                     run-skill-onoff-eval.sh:471, probe-skill-frontmatter-portability.sh:78
//        token (has) expired                                    run-skill-onoff-eval.sh:471, qualification-review-provider.test.js:2158
//        a 401 in an HTTP or API-error context ("API Error: 401", "HTTP 401", "status 401", "api_error_status":401, "401 Unauthorized")
//                                                               qualification-review-provider.js:1214 and .test.js:2158, hooks/tests/t14-gate-batch.test.sh:89
//      Not in the table on purpose: bare "authentication", "unauthorized", "forbidden", "author", a bare number 401 ("exit code 401"),
//      permission_error and 403 (a failed call with those texts is an ordinary failure and the batch carries on).
//
// A dispatch source (dispatch-hetero / dispatch-review result) also reads the files its agent_log / raw_log fields name.
//
// CLI:  node auth-stop.js check [--id ID] (--failed 0|1 | --failed-from FILE)... [--stderr FILE]... [--log FILE]...
//                               [--dispatch FILE]... [--text STR]...
//   --failed N        the call's own failure signal (1 = failed). --failed-from FILE: a dispatch result counts as failed unless its
//                     status is committed / no_op / reviewed. Several are OR-ed; at least one is required (exit 2 otherwise).
//   exit 0 = no auth failure, 6 = auth failure (stop line on stderr), 2 = usage. Missing files are skipped.
// Library: callFailed, scanText, checkSources, stopLine, EXIT_AUTH_STOP.

const fs = require('fs');

const EXIT_AUTH_STOP = 6;

const AUTH_PATTERNS = [
  /failed to authenticate/i,
  /oauth (?:session|token) (?:has )?expired/i,
  /authentication_(?:failed|error)/i,
  /please run \/login/i,
  /\bnot logged in\b/i,
  /\blog ?in required\b/i,
  /\bplease log ?in\b/i,
  /\bauthentication (?:error|failed|required)\b/i,
  /\bauthori[sz]ation failed\b/i,
  /invalid[ _-]?(?:api[ _-]?)?key/i,
  /\btoken (?:has )?expired\b/i,
  /(?:\bapi error|\bhttp(?:\/[\d.]+)?|\bstatus(?: code)?|\bapi_error_status|\bhttp_status|\bstatuscode)["']?\s*[:=]?\s*["']?401\b/i,
  /\b401\s+unauthori[sz]ed\b/i,
  /\bunauthori[sz]ed\b[^\n]{0,24}\b401\b/i,
];

const snippet = (x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 160);

function matchLine(line) {
  for (const re of AUTH_PATTERNS) if (re.test(line)) return snippet(line);
  return null;
}

// Layer (1): structured fields only, valid for any call.
function structuredObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const e = o.error && typeof o.error === 'object' ? o.error : null;
  if (o.type === 'authentication_error' || (e && e.type === 'authentication_error')) return 'authentication_error';
  for (const holder of [o, e]) {
    if (!holder) continue;
    for (const k of ['status', 'api_error_status', 'http_status', 'statusCode']) {
      if (holder[k] !== null && holder[k] !== '' && holder[k] !== false && Number(holder[k]) === 401) return `${k}=401 ${snippet(o.result || (e && e.message) || '')}`.trim();
    }
  }
  return null;
}

function parseJson(t) { try { return JSON.parse(t); } catch (_e) { return undefined; } }

/** @returns {string|null} first match. opts.failed: the call failed, so text phrases count too. */
function scanText(text, opts) {
  const failed = !!(opts && opts.failed);
  if (typeof text !== 'string' || text === '') return null;
  const whole = parseJson(text.trim());
  if (whole && typeof whole === 'object') { const m = structuredObject(whole); if (m) return m; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const o = line.trim().startsWith('{') ? parseJson(line) : undefined;
    const m = o && typeof o === 'object' ? structuredObject(o) : null;
    if (m) return m;
    if (failed) { const t = matchLine(line); if (t) return t; }
  }
  return null;
}

const OK_STATUS = new Set(['committed', 'no_op', 'reviewed']);
/** Did a dispatch result report failure? Unparseable or status-less output counts as failed. */
function callFailed(text) {
  let last;
  for (const line of String(text).split(/\r?\n/)) { const o = parseJson(line.trim()); if (o && typeof o === 'object' && typeof o.status === 'string') last = o; }
  if (!last) { const w = parseJson(String(text).trim()); if (w && typeof w === 'object' && typeof w.status === 'string') last = w; }
  return !last || !OK_STATUS.has(last.status);
}

// File paths a dispatch result names for the runner's own log.
function followedLogs(text) {
  const out = [];
  const take = (o) => { if (o && typeof o === 'object') for (const k of ['agent_log', 'raw_log']) if (typeof o[k] === 'string' && o[k]) out.push(o[k]); };
  const whole = parseJson(String(text).trim());
  if (whole && typeof whole === 'object') take(whole);
  else for (const line of String(text).split(/\r?\n/)) take(parseJson(line));
  return out;
}

/** sources: [{ kind: 'raw'|'dispatch', path } | { kind, text }]; opts.failed = the call failed. Returns { source, match } or null. */
function checkSources(sources, opts) {
  for (const s of sources) {
    let text = s.text;
    if (text === undefined) { try { text = fs.readFileSync(s.path, 'utf8'); } catch (_e) { continue; } }
    const m = scanText(text, opts);
    if (m) return { source: s.path || '(text)', match: m };
    if (s.kind === 'dispatch') {
      for (const f of followedLogs(text)) {
        let t; try { t = fs.readFileSync(f, 'utf8'); } catch (_e) { continue; }
        const m2 = scanText(t, opts);
        if (m2) return { source: f, match: m2 };
      }
    }
  }
  return null;
}

const stopLine = (id, hit) => `STOP_AUTH after ${id}: ${hit.match}`;

function main(argv) {
  const usage = () => { process.stderr.write('usage: auth-stop.js check [--id ID] (--failed 0|1 | --failed-from FILE)... [--stderr F]... [--log F]... [--dispatch F]... [--text S]...\n'); return 2; };
  if (argv[0] !== 'check') return usage();
  let id = '?'; let failed = null; const sources = [];
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (v === undefined) return usage();
    if (k === '--id') id = v;
    else if (k === '--failed') { if (v !== '0' && v !== '1') return usage(); failed = (failed || false) || v === '1'; }
    else if (k === '--failed-from') { let t = ''; try { t = fs.readFileSync(v, 'utf8'); } catch (_e) { /* unreadable: counts as failed */ } failed = (failed || false) || callFailed(t); }
    else if (k === '--stderr' || k === '--log') sources.push({ kind: 'raw', path: v });
    else if (k === '--dispatch') sources.push({ kind: 'dispatch', path: v });
    else if (k === '--text') sources.push({ kind: 'raw', text: v });
    else return usage();
  }
  if (failed === null) return usage();
  const hit = checkSources(sources, { failed });
  if (!hit) return 0;
  process.stderr.write(`${stopLine(id, hit)}\n`);
  return EXIT_AUTH_STOP;
}

module.exports = { EXIT_AUTH_STOP, AUTH_PATTERNS, callFailed, scanText, checkSources, stopLine };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
