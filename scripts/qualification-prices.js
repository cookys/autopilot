#!/usr/bin/env node
'use strict';

/**
 * qualification-prices.js — seat unit prices for the implementer ladder (BL-0024).
 *
 *   fetch  [--from <https-url|path>] [--if-stale-hours N] [--quiet]
 *          fetch, validate, cache. A document failing any check is rejected whole (exit 1) and
 *          the previous cache stays. Default source: model-dyno public-bundles/model-prices.json.
 *          --if-stale-hours N: do nothing if the cache was fetched less than N hours ago.
 *   status                       cache age, row count, stale rows, warnings (JSON)
 *   price --model <id> [--runner <r>] [--engine <e>]
 *          exact (engine, runner, model) lookup; engine defaults to the model id.
 *          Prints micro-USD per Mtok (input+output) or null (unknown: no row, or input/output null).
 *          effective_basis is shown as-is for reference (it dates the price, it does not rank it).
 *
 * Cache dir: $AUTOPILOT_PRICES_CACHE_DIR, else ~/.autopilot/qualification-prices (never inside a
 * git work tree). Dispatch paths never call `fetch`: resolve-dispatch-topology.js reads the
 * cache only. `fetch` runs from the SessionStart hook (detached, throttled, opt-out
 * AUTOPILOT_PRICES_FETCH=0 / config prices_fetch:false) or by hand.
 *
 * Exit: 0 ok, 1 rejected/failed fetch or unknown subcommand, 2 usage.
 * Node >= 20.10, built-ins only.
 */

const lib = require('./lib/qualification-prices.js');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--quiet') out.quiet = true;
    else if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i += 1; }
    else out._.push(a);
  }
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const cacheDir = lib.defaultCacheDir();
  if (cmd === 'fetch') {
    if (args['if-stale-hours'] !== undefined) {
      // Throttle on the newer of the last SUCCESS (fetched_at) and the last ATTEMPT, so a missing
      // file (404) or a rejected document does not reconnect on every session start.
      const hours = Number(args['if-stale-hours']);
      const last = lib.lastActivityMs(cacheDir);
      if (Number.isFinite(hours) && last !== null && Date.now() - last < hours * 3600 * 1000) return 0;
    }
    lib.recordAttempt(cacheDir);
    try {
      const r = await lib.fetchPrices(args.from || lib.DEFAULT_PRICES_URL, { cacheDir });
      if (!args.quiet) process.stdout.write(`${JSON.stringify({ ok: true, ...r }, null, 2)}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`qualification-prices: fetch rejected: ${err.message}\n`);
      return 1;
    }
  }
  if (cmd === 'status') {
    const now = new Date().toISOString();
    const cache = lib.readCache(cacheDir);
    const fresh = lib.describeFreshness(cache, now);
    const rows = cache ? cache.doc.rows : [];
    const out = {
      cache_dir: cacheDir,
      present: fresh.present,
      n_rows: rows.length,
      n_subscription_rows: rows.filter((r) => r.billing === 'subscription').length,
      n_unpriced: cache && Array.isArray(cache.doc.unpriced) ? cache.doc.unpriced.length : 0,
      n_assumed_rows: rows.filter((r) => r.effective_basis === 'assumed').length,
      manifest: cache ? cache.manifest : null,
      freshness: fresh,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return 0;
  }
  if (cmd === 'price') {
    if (!args.model) { process.stderr.write('usage: price --model <id> [--runner <r>] [--engine <e>]\n'); return 2; }
    const cache = lib.readCache(cacheDir);
    const seat = { engine: args.engine || args.model, runner: args.runner, model: args.model };
    let micro = null;
    let row = null;
    if (cache) {
      const candidates = args.runner ? cache.doc.rows.filter((r) => r.runner === args.runner) : cache.doc.rows;
      row = candidates.find((r) => r.engine === seat.engine && r.model === seat.model) || null;
      if (row) micro = lib.priceMicro(cache.index, { engine: row.engine, runner: row.runner, model: row.model });
    }
    process.stdout.write(`${JSON.stringify({ model: args.model, price_micro_per_mtok: micro, billing: row ? row.billing : null, effective_basis: row ? row.effective_basis : null }, null, 2)}\n`);
    return 0;
  }
  process.stderr.write('usage: qualification-prices.js fetch|status|price ...\n');
  return 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
  process.stderr.write(`qualification-prices: ${err.message}\n`);
  process.exitCode = 1;
});
