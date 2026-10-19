#!/usr/bin/env node
'use strict';
//
// qualification-metrics.js — BL-0194 P2 read side of the registry's qualification-metrics.json.
//
//   node scripts/qualification-metrics.js fetch  --from <feed url|path> [--feed-cache-dir <dir>]
//   node scripts/qualification-metrics.js status [--feed-cache-dir <dir>] [--max-age-s <n>] [--now <iso>]
//   node scripts/qualification-metrics.js order  --seats <json file> [--feed-cache-dir <dir>]
//
// fetch   reads the SIBLING document of the feed (same url/dir, qualification-metrics.json),
//         validates it against schemas/qualification-feed-v2.schema.json plus the semantic lint,
//         and caches it under <cache>/metrics/. A fetch failure exits 0 with `ok:false` — the
//         metrics are advisory, so their absence is never an error for the caller.
// status  prints fetch_age_s / producer_age_s, labels and warnings from the cache. No network.
// order   reads a JSON array of ALREADY-ADMITTED seats and prints the same seats re-ordered by
//         metrics (speed, pass rate, cost; unknown last). It cannot add or drop a seat.
//
// Authority: metrics order, they never admit (plan 2026-10-16-bl0194-qualification-registry-move.md
// sections 2 and 5). Nothing here writes a scorecard row or a strike.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib/qualification-metrics.js');
const feedLib = require('./lib/qualification-feed.js');

function parse(argv) {
  const opts = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => { i += 1; return argv[i]; };
    if (arg === '--from') opts.from = take();
    else if (arg === '--feed-cache-dir') opts.cacheDir = take();
    else if (arg === '--max-age-s') {
      const raw = take();
      opts.maxAgeS = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
      if (!Number.isFinite(opts.maxAgeS) || opts.maxAgeS < 0) {
        process.stderr.write('qualification-metrics: --max-age-s must be a finite number >= 0\n');
        process.exit(2);
      }
    }
    else if (arg === '--now') opts.now = take();
    else if (arg === '--seats') opts.seats = take();
    else { process.stderr.write(`qualification-metrics: unknown argument ${arg}\n`); process.exit(2); }
  }
  if (opts.cacheDir && opts.cacheDir.startsWith('~/')) opts.cacheDir = path.join(os.homedir(), opts.cacheDir.slice(2));
  return opts;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const cacheDir = opts.cacheDir || feedLib.defaultCacheDir();
  const now = opts.now || new Date().toISOString();
  const maxAgeS = opts.maxAgeS === undefined ? lib.DEFAULT_MAX_AGE_S : opts.maxAgeS;
  if (opts.command === 'fetch') {
    if (!opts.from) { process.stderr.write('fetch requires --from\n'); process.exit(2); }
    const r = await lib.fetchMetrics(opts.from, { cacheDir, now });
    process.stdout.write(`${JSON.stringify(r.ok ? { ok: true, manifest: r.manifest } : { ok: false, error: r.error }, null, 2)}\n`);
    if (r.ok) {
      try {
        const qualificationTrust = require('./lib/qualification-trust.js');
        if (qualificationTrust.resolveTrustMode() === 'confirm') {
          const qualificationConfirm = require('./lib/qualification-confirm.js');
          const synced = qualificationConfirm.sync({
            cacheDir,
            cwd: process.cwd(),
            nowMs: Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now),
          });
          if (!synced.ok) process.stderr.write(`qualification-feed trust: sync failed: ${synced.reason}\n`);
        }
      } catch (error) {
        process.stderr.write(`qualification-feed trust: sync failed: ${error.message}\n`);
      }
    }
    return;
  }
  if (opts.command === 'status') {
    const s = lib.readStatus({ cacheDir, now, maxAgeS });
    process.stdout.write(`${JSON.stringify({
      present: s.present,
      fetch_age_s: s.fetch_age_s,
      producer_age_s: s.producer_age_s,
      max_age_s: maxAgeS,
      labels: s.labels,
      warnings: s.warnings,
      counts: s.doc ? { seat_metrics: s.doc.seat_metrics.length, strike_events: s.doc.strike_events.length } : null,
    }, null, 2)}\n`);
    return;
  }
  if (opts.command === 'order') {
    if (!opts.seats) { process.stderr.write('order requires --seats\n'); process.exit(2); }
    const seats = JSON.parse(fs.readFileSync(opts.seats, 'utf8'));
    if (!Array.isArray(seats)) { process.stderr.write('--seats must be a JSON array\n'); process.exit(2); }
    const s = lib.readStatus({ cacheDir, now, maxAgeS });
    for (const w of s.warnings) process.stderr.write(`qualification-metrics: warning: ${w}\n`);
    process.stdout.write(`${JSON.stringify(lib.orderAdmittedSeats(seats, s.doc), null, 2)}\n`);
    return;
  }
  process.stderr.write('usage: qualification-metrics.js fetch|status|order ...\n');
  process.exit(2);
}

main().catch((error) => { process.stderr.write(`qualification-metrics: ${error.message}\n`); process.exit(1); });
