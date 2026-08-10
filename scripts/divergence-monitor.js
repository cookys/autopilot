#!/usr/bin/env node
'use strict';

/**
 * divergence-monitor.js — measure shadow-vs-legacy decision agreement per entry point.
 *
 * WHY THIS EXISTS
 * ---------------
 * Promotion of the Owner Kernel from shadow to authority currently has no evidence behind
 * it. "The shadow agrees with legacy" is asserted, not measured. This records the pairs so
 * the claim can be checked, and refuses to let absence of data read as agreement.
 *
 * THE DISTINCTION THAT MAKES IT HONEST
 * ------------------------------------
 * Today the shadow runtime knows its own decision; nothing holds both sides at once. A
 * monitor that quietly treated a shadow-only observation as a matching pair would report
 * perfect agreement forever and would be worse than having no monitor, because it would
 * carry the authority of a measurement.
 *
 * So observations are of two kinds and are never conflated:
 *
 *   paired       both decisions present  -> counts toward `samples`
 *   shadow_only  legacy side absent      -> counted separately, funds nothing
 *
 * Only `samples` can support a promotion. `shadow_only` observations are visible so the
 * gap is obvious rather than invisible.
 *
 * A divergence is "explained" ONLY when the recorder supplied a reason. The monitor never
 * infers one — an inferred explanation is how a real disagreement becomes a footnote.
 *
 * USAGE
 *   node scripts/divergence-monitor.js record --path <entry> --shadow <decision>
 *        [--legacy <decision>] [--reason <text>] [--run-id <id>] [--store <file>]
 *   node scripts/divergence-monitor.js report [--path <entry>] [--store <file>] [--json]
 *   node scripts/divergence-monitor.js promotion-readiness --path <entry> [--store <file>] [--json]
 *
 * EXIT CODES
 *   0  ok
 *   1  promotion-readiness: the path is NOT ready
 *   2  usage error
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_STORE = path.join(os.homedir(), '.autopilot', 'divergence', 'observations.jsonl');
const ENTRY_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

function fail(message, code = 2) {
  process.stderr.write(`divergence-monitor: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${fs.readFileSync(__filename, 'utf8').split('\n').slice(4, 42).join('\n')}\n`);
    process.exit(command ? 0 : 2);
  }
  const options = { command, store: DEFAULT_STORE, json: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { options.json = true; continue; }
    const value = argv[i + 1];
    switch (arg) {
      case '--path': case '--shadow': case '--legacy': case '--reason':
      case '--run-id': case '--store': {
        if (value === undefined || value.startsWith('--')) fail(`missing value for ${arg}`);
        const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        options[key] = value;
        i += 1;
        break;
      }
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function readObservations(storePath) {
  let raw;
  try {
    raw = fs.readFileSync(storePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  raw.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (_error) {
      // A corrupt line is surfaced, never silently skipped: silently dropping rows would
      // shrink the denominator and make agreement look better than it is.
      rows.push({ __corrupt: true, line_number: index + 1 });
    }
  });
  return rows;
}

function recordObservation(options) {
  if (!options.path || !ENTRY_PATTERN.test(options.path)) {
    fail('record requires --path matching /^[A-Za-z0-9._:\\/-]{1,128}$/');
  }
  if (typeof options.shadow !== 'string' || options.shadow.length === 0) {
    fail('record requires --shadow <decision>');
  }
  const hasLegacy = typeof options.legacy === 'string' && options.legacy.length > 0;
  const row = {
    schema_version: 1,
    entry_path: options.path,
    shadow_decision: options.shadow,
    legacy_decision: hasLegacy ? options.legacy : null,
    kind: hasLegacy ? 'paired' : 'shadow_only',
    agreed: hasLegacy ? options.shadow === options.legacy : null,
    // A reason only means anything on a divergence; recording one elsewhere is harmless
    // but never converts a shadow_only observation into evidence.
    reason: typeof options.reason === 'string' && options.reason.length > 0 ? options.reason : null,
    run_id: typeof options.runId === 'string' ? options.runId : null,
    recorded_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(options.store), { recursive: true });
  const fd = fs.openSync(options.store, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return row;
}

function summarize(rows, entryPath) {
  // A corrupt row has no readable entry_path, so filtering by path would drop it — and
  // dropping it is exactly the failure this counter exists to prevent. An unreadable row
  // could belong to ANY path, so it counts against every path query. Conservative on
  // purpose: an unreadable denominator must not be reported as a clean one.
  const corrupt = rows.filter((r) => r.__corrupt).length;
  const clean = (entryPath ? rows.filter((r) => r.entry_path === entryPath) : rows)
    .filter((r) => !r.__corrupt);
  const paired = clean.filter((r) => r.kind === 'paired');
  const shadowOnly = clean.filter((r) => r.kind === 'shadow_only');
  const divergences = paired.filter((r) => r.agreed === false);
  const unexplained = divergences.filter((r) => typeof r.reason !== 'string' || r.reason.length === 0);
  return {
    entry_path: entryPath || null,
    samples: paired.length,
    agreements: paired.filter((r) => r.agreed === true).length,
    divergences: divergences.length,
    unexplained: unexplained.length,
    shadow_only: shadowOnly.length,
    corrupt_rows: corrupt,
  };
}

/**
 * A path is promotion-ready only with real paired evidence and nothing unexplained.
 *
 * `samples: 0` is explicitly NOT ready. That is the whole point: an unexercised path has
 * produced no evidence, and "no disagreements observed" across zero observations is not a
 * statement about the path — it is a statement about the absence of testing.
 */
function promotionReadiness(summary) {
  const reasons = [];
  if (summary.samples === 0) {
    reasons.push('no paired observations: zero samples cannot fund a promotion; '
      + `${summary.shadow_only} shadow-only observation(s) recorded, which prove nothing about agreement`);
  }
  if (summary.unexplained > 0) {
    reasons.push(`${summary.unexplained} unexplained divergence(s) must be explained or resolved`);
  }
  if (summary.corrupt_rows > 0) {
    reasons.push(`${summary.corrupt_rows} corrupt observation row(s); the denominator is not trustworthy`);
  }
  return { ready: reasons.length === 0, blocking_reasons: reasons };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'record') {
    const row = recordObservation(options);
    process.stdout.write(options.json ? `${JSON.stringify(row)}\n`
      : `recorded ${row.kind} observation for ${row.entry_path}\n`);
    return;
  }

  if (options.command === 'report') {
    const rows = readObservations(options.store);
    const summary = summarize(rows, options.path);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ schema_version: 1, store: options.store, ...summary }, null, 2)}\n`);
      return;
    }
    process.stdout.write(`divergence report${summary.entry_path ? ` — ${summary.entry_path}` : ' — all paths'}\n`);
    process.stdout.write(`  samples (paired):  ${summary.samples}\n`);
    process.stdout.write(`  agreements:        ${summary.agreements}\n`);
    process.stdout.write(`  divergences:       ${summary.divergences}\n`);
    process.stdout.write(`  unexplained:       ${summary.unexplained}\n`);
    process.stdout.write(`  shadow-only:       ${summary.shadow_only}  (funds no promotion)\n`);
    if (summary.corrupt_rows > 0) process.stdout.write(`  corrupt rows:      ${summary.corrupt_rows}\n`);
    return;
  }

  if (options.command === 'promotion-readiness') {
    if (!options.path) fail('promotion-readiness requires --path <entry>');
    const rows = readObservations(options.store);
    const summary = summarize(rows, options.path);
    const readiness = promotionReadiness(summary);
    const report = { schema_version: 1, ...summary, ...readiness };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`promotion readiness — ${options.path}: ${readiness.ready ? 'READY' : 'NOT READY'}\n`);
      for (const reason of readiness.blocking_reasons) process.stdout.write(`  - ${reason}\n`);
    }
    if (!readiness.ready) process.exitCode = 1;
    return;
  }

  fail(`unknown command: ${options.command}`);
}

if (require.main === module) main();

module.exports = { summarize, promotionReadiness, readObservations, DEFAULT_STORE };
