#!/usr/bin/env node
'use strict';

/**
 * scripts/cost-digest.js
 *
 * Reads a cost ledger JSONL file and prints a per-day x tier x model x session spend table.
 *
 * CLI:
 *   node scripts/cost-digest.js [--file <path>] [--since <N days, default 7>] [--today] [--by day|model|session|tier] [--json]
 *   node scripts/cost-digest.js --help
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * tierOf(model)
 * Case-insensitive substring match, first match wins:
 *   fable or mythos -> brain
 *   opus            -> brain
 *   sonnet          -> hands
 *   haiku           -> hands-cheap
 *   anything else   -> other
 */
function tierOf(model) {
  if (typeof model !== 'string') {
    return 'other';
  }
  const m = model.toLowerCase();
  if (m.includes('fable') || m.includes('mythos')) {
    return 'brain';
  }
  if (m.includes('opus')) {
    return 'brain';
  }
  if (m.includes('sonnet')) {
    return 'hands';
  }
  if (m.includes('haiku')) {
    return 'hands-cheap';
  }
  return 'other';
}

function printUsageAndExit(code) {
  const usageText = `Usage: node scripts/cost-digest.js [options]

Options:
  --file <path>              Path to costs.jsonl (defaults to $AUTOPILOT_COSTS_FILE or ~/.claude/metrics/costs.jsonl)
  --since <N>                Include rows within last N days (inclusive of today, default: 7)
  --today                    Include only rows matching today's UTC day (shorthand; overrides --since)
  --by <day|model|session|tier>
                             Grouping mode (default: day)
  --json                     Output JSON instead of text table
  --help                     Print usage information and exit 0
`;
  if (code === 0) {
    process.stdout.write(usageText);
  } else {
    process.stderr.write(usageText);
  }
  process.exit(code);
}

function resolveTilde(filePath) {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function getUtcIsoDay(date) {
  return date.toISOString().slice(0, 10);
}

function computeSinceDay(nDays, now) {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - (nDays - 1));
  return getUtcIsoDay(d);
}

function parseArgs(argv) {
  const args = {
    file: null,
    since: 7,
    today: false,
    by: 'day',
    json: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0);
    } else if (arg === '--file') {
      if (i + 1 >= argv.length) {
        process.stderr.write('Error: --file requires a path argument\n');
        process.exit(2);
      }
      args.file = argv[++i];
    } else if (arg === '--since') {
      if (i + 1 >= argv.length) {
        process.stderr.write('Error: --since requires an integer argument\n');
        process.exit(2);
      }
      const val = argv[++i];
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed < 0 || String(parsed) !== val.trim()) {
        process.stderr.write(`Error: invalid value for --since: ${val}\n`);
        process.exit(2);
      }
      args.since = parsed;
    } else if (arg === '--today') {
      args.today = true;
    } else if (arg === '--by') {
      if (i + 1 >= argv.length) {
        process.stderr.write('Error: --by requires a mode argument\n');
        process.exit(2);
      }
      const mode = argv[++i];
      if (!['day', 'model', 'session', 'tier'].includes(mode)) {
        process.stderr.write(`Error: invalid value for --by: ${mode}\n`);
        process.exit(2);
      }
      args.by = mode;
    } else if (arg === '--json') {
      args.json = true;
    } else {
      process.stderr.write(`Error: unknown option: ${arg}\n`);
      process.exit(2);
    }
  }

  return args;
}

function run() {
  const args = parseArgs(process.argv);

  const defaultFilePath = process.env.AUTOPILOT_COSTS_FILE || '~/.claude/metrics/costs.jsonl';
  const rawFilePath = args.file || defaultFilePath;
  const resolvedPath = resolveTilde(rawFilePath);

  const now = new Date();
  const todayDay = getUtcIsoDay(now);
  let sinceDay = '';

  if (args.today) {
    sinceDay = todayDay;
  } else {
    sinceDay = computeSinceDay(args.since, now);
  }

  if (!fs.existsSync(resolvedPath)) {
    process.stderr.write(`Warning: cost ledger file not found: ${resolvedPath}\n`);
    if (args.json) {
      const output = {
        schema_version: 1,
        file: resolvedPath,
        since: sinceDay,
        skipped_lines: 0,
        days: []
      };
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    } else {
      if (args.by === 'session') {
        process.stdout.write('day        session   cwd                  sessions turns input      output     cache_read cost_usd\n');
      } else if (args.by === 'tier') {
        process.stdout.write('day        tier        sessions turns input      output     cache_read cost_usd\n');
      } else {
        process.stdout.write('day        tier        model                          sessions turns input      output     cache_read cost_usd\n');
      }
    }
    process.exit(0);
  }

  let content = '';
  try {
    content = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    process.stderr.write(`Error reading file ${resolvedPath}: ${err.message}\n`);
    process.exit(1);
  }

  const lines = content.split('\n');
  let skippedLines = 0;
  const validRows = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      skippedLines++;
      continue;
    }

    if (!parsed.ts || typeof parsed.ts !== 'string') {
      skippedLines++;
      continue;
    }

    if (typeof parsed.cost_usd !== 'number' || isNaN(parsed.cost_usd)) {
      skippedLines++;
      continue;
    }

    const d = new Date(parsed.ts);
    if (isNaN(d.getTime())) {
      skippedLines++;
      continue;
    }

    const day = getUtcIsoDay(d);
    parsed._day = day;
    parsed._tier = tierOf(parsed.model);
    validRows.push(parsed);
  }

  // Filter rows based on date window
  const filteredRows = validRows.filter((r) => {
    if (args.today) {
      return r._day === todayDay;
    }
    return r._day >= sinceDay && r._day <= todayDay;
  });

  if (args.json) {
    // Grouping by day x <args.by> — 'day'/'model' -> tier+model, 'tier' -> tier
    // only, 'session' -> the FULL (untruncated) session id.
    const byMode = args.by;
    const dayMap = new Map();

    for (const r of filteredRows) {
      let dObj = dayMap.get(r._day);
      if (!dObj) {
        dObj = {
          day: r._day,
          total_usd: 0,
          brain_usd: 0,
          brain_share: 0,
          groups: new Map()
        };
        dayMap.set(r._day, dObj);
      }

      dObj.total_usd += r.cost_usd;
      if (r._tier === 'brain') {
        dObj.brain_usd += r.cost_usd;
      }

      let gKey;
      let gInit;
      if (byMode === 'session') {
        const sessId = typeof r.session === 'string' ? r.session : 'unknown';
        gKey = sessId;
        gInit = { session: sessId, modelSet: new Set(), sessionSet: new Set() };
      } else if (byMode === 'tier') {
        gKey = r._tier;
        gInit = { tier: r._tier, sessionSet: new Set() };
      } else {
        // 'day' (default) and 'model' both group by tier x model within the day.
        const model = r.model || 'unknown';
        gKey = `${r._tier}\0${model}`;
        gInit = { tier: r._tier, model, sessionSet: new Set() };
      }

      let gObj = dObj.groups.get(gKey);
      if (!gObj) {
        gObj = Object.assign(gInit, {
          turns: 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cost_usd: 0
        });
        dObj.groups.set(gKey, gObj);
      }

      if (r.session) {
        gObj.sessionSet.add(r.session);
      }
      if (byMode === 'session' && gObj.modelSet) {
        gObj.modelSet.add(r.model || 'unknown');
      }
      const turns = typeof r.turns === 'number' && !isNaN(r.turns) ? r.turns : 0;
      gObj.turns += turns;
      gObj.input_tokens += typeof r.input_tokens === 'number' ? r.input_tokens : 0;
      gObj.output_tokens += typeof r.output_tokens === 'number' ? r.output_tokens : 0;
      gObj.cache_read_tokens += typeof r.cache_read_tokens === 'number' ? r.cache_read_tokens : 0;
      gObj.cost_usd += r.cost_usd;
    }

    const sortedDays = Array.from(dayMap.keys()).sort();
    const daysResult = [];

    for (const dStr of sortedDays) {
      const dObj = dayMap.get(dStr);
      const brainShare = dObj.total_usd > 0 ? dObj.brain_usd / dObj.total_usd : 0;

      const groupRows = Array.from(dObj.groups.values()).map((g) => {
        const base = {
          sessions: g.sessionSet.size,
          turns: g.turns,
          input_tokens: g.input_tokens,
          output_tokens: g.output_tokens,
          cache_read_tokens: g.cache_read_tokens,
          cost_usd: Number(g.cost_usd.toFixed(4))
        };
        if (byMode === 'session') {
          return Object.assign({ session: g.session, models: Array.from(g.modelSet).sort() }, base);
        }
        if (byMode === 'tier') {
          return Object.assign({ tier: g.tier }, base);
        }
        return Object.assign({ tier: g.tier, model: g.model }, base);
      });

      // Sort rows by cost_usd descending
      groupRows.sort((a, b) => b.cost_usd - a.cost_usd);

      daysResult.push({
        day: dObj.day,
        total_usd: Number(dObj.total_usd.toFixed(4)),
        brain_usd: Number(dObj.brain_usd.toFixed(4)),
        brain_share: Number(brainShare.toFixed(4)),
        rows: groupRows
      });
    }

    const result = {
      schema_version: 1,
      file: resolvedPath,
      since: sinceDay,
      by: byMode,
      skipped_lines: skippedLines,
      days: daysResult
    };

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  // Text table output
  // Group by day first
  const dayBuckets = new Map();
  for (const r of filteredRows) {
    if (!dayBuckets.has(r._day)) {
      dayBuckets.set(r._day, []);
    }
    dayBuckets.get(r._day).push(r);
  }

  const sortedDays = Array.from(dayBuckets.keys()).sort();

  if (args.by === 'session') {
    process.stdout.write('day        session   cwd                  sessions turns input      output     cache_read cost_usd\n');

    for (const day of sortedDays) {
      const dayRows = dayBuckets.get(day);
      let dayTotalUsd = 0;
      let dayBrainUsd = 0;

      const groups = new Map();

      for (const r of dayRows) {
        dayTotalUsd += r.cost_usd;
        if (r._tier === 'brain') {
          dayBrainUsd += r.cost_usd;
        }

        const sessId = typeof r.session === 'string' ? r.session : 'unknown';
        const cwdBase = typeof r.cwd === 'string' ? path.basename(r.cwd) : '';
        const key = `${sessId}\0${cwdBase}`;

        let g = groups.get(key);
        if (!g) {
          g = {
            session: sessId,
            cwd: cwdBase,
            sessionSet: new Set(),
            turns: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0
          };
          groups.set(key, g);
        }

        if (r.session) {
          g.sessionSet.add(r.session);
        }
        const turns = typeof r.turns === 'number' && !isNaN(r.turns) ? r.turns : 0;
        g.turns += turns;
        g.input_tokens += typeof r.input_tokens === 'number' ? r.input_tokens : 0;
        g.output_tokens += typeof r.output_tokens === 'number' ? r.output_tokens : 0;
        g.cache_read_tokens += typeof r.cache_read_tokens === 'number' ? r.cache_read_tokens : 0;
        g.cost_usd += r.cost_usd;
      }

      const rowList = Array.from(groups.values()).sort((a, b) => b.cost_usd - a.cost_usd);

      let dayTurns = 0;
      let dayInput = 0;
      let dayOutput = 0;
      let dayCache = 0;
      const daySessionsSet = new Set();

      for (const r of rowList) {
        r.sessionSet.forEach((s) => daySessionsSet.add(s));
        dayTurns += r.turns;
        dayInput += r.input_tokens;
        dayOutput += r.output_tokens;
        dayCache += r.cache_read_tokens;

        const dayCol = day.padEnd(10);
        const sessCol = r.session.slice(0, 8).padEnd(9);
        const cwdCol = r.cwd.slice(0, 20).padEnd(20);
        const sCountCol = String(r.sessionSet.size).padStart(8);
        const turnsCol = String(r.turns).padStart(5);
        const inCol = String(r.input_tokens).padStart(10);
        const outCol = String(r.output_tokens).padStart(10);
        const cacheCol = String(r.cache_read_tokens).padStart(10);
        const costCol = r.cost_usd.toFixed(4).padStart(8);

        process.stdout.write(`${dayCol} ${sessCol} ${cwdCol} ${sCountCol} ${turnsCol} ${inCol} ${outCol} ${cacheCol} ${costCol}\n`);
      }

      // TOTAL row
      const totalDayCol = 'TOTAL'.padEnd(10);
      const totalSessCol = '-'.padEnd(9);
      const totalCwdCol = '-'.padEnd(20);
      const totalSCountCol = String(daySessionsSet.size).padStart(8);
      const totalTurnsCol = String(dayTurns).padStart(5);
      const totalInCol = String(dayInput).padStart(10);
      const totalOutCol = String(dayOutput).padStart(10);
      const totalCacheCol = String(dayCache).padStart(10);
      const totalCostCol = dayTotalUsd.toFixed(4).padStart(8);

      process.stdout.write(`${totalDayCol} ${totalSessCol} ${totalCwdCol} ${totalSCountCol} ${totalTurnsCol} ${totalInCol} ${totalOutCol} ${totalCacheCol} ${totalCostCol}\n`);

      const brainPct = dayTotalUsd > 0 ? (dayBrainUsd / dayTotalUsd) * 100 : 0;
      process.stdout.write(`brain_share: ${brainPct.toFixed(1)}%\n\n`);
    }
  } else if (args.by === 'tier') {
    process.stdout.write('day        tier        sessions turns input      output     cache_read cost_usd\n');

    for (const day of sortedDays) {
      const dayRows = dayBuckets.get(day);
      let dayTotalUsd = 0;
      let dayBrainUsd = 0;

      const groups = new Map();

      for (const r of dayRows) {
        dayTotalUsd += r.cost_usd;
        if (r._tier === 'brain') {
          dayBrainUsd += r.cost_usd;
        }

        const tier = r._tier;
        let g = groups.get(tier);
        if (!g) {
          g = {
            tier,
            sessionSet: new Set(),
            turns: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0
          };
          groups.set(tier, g);
        }

        if (r.session) {
          g.sessionSet.add(r.session);
        }
        const turns = typeof r.turns === 'number' && !isNaN(r.turns) ? r.turns : 0;
        g.turns += turns;
        g.input_tokens += typeof r.input_tokens === 'number' ? r.input_tokens : 0;
        g.output_tokens += typeof r.output_tokens === 'number' ? r.output_tokens : 0;
        g.cache_read_tokens += typeof r.cache_read_tokens === 'number' ? r.cache_read_tokens : 0;
        g.cost_usd += r.cost_usd;
      }

      const rowList = Array.from(groups.values()).sort((a, b) => b.cost_usd - a.cost_usd);

      let dayTurns = 0;
      let dayInput = 0;
      let dayOutput = 0;
      let dayCache = 0;
      const daySessionsSet = new Set();

      for (const r of rowList) {
        r.sessionSet.forEach((s) => daySessionsSet.add(s));
        dayTurns += r.turns;
        dayInput += r.input_tokens;
        dayOutput += r.output_tokens;
        dayCache += r.cache_read_tokens;

        const dayCol = day.padEnd(10);
        const tierCol = r.tier.padEnd(11);
        const sCountCol = String(r.sessionSet.size).padStart(8);
        const turnsCol = String(r.turns).padStart(5);
        const inCol = String(r.input_tokens).padStart(10);
        const outCol = String(r.output_tokens).padStart(10);
        const cacheCol = String(r.cache_read_tokens).padStart(10);
        const costCol = r.cost_usd.toFixed(4).padStart(8);

        process.stdout.write(`${dayCol} ${tierCol} ${sCountCol} ${turnsCol} ${inCol} ${outCol} ${cacheCol} ${costCol}\n`);
      }

      // TOTAL row
      const totalDayCol = 'TOTAL'.padEnd(10);
      const totalTierCol = '-'.padEnd(11);
      const totalSCountCol = String(daySessionsSet.size).padStart(8);
      const totalTurnsCol = String(dayTurns).padStart(5);
      const totalInCol = String(dayInput).padStart(10);
      const totalOutCol = String(dayOutput).padStart(10);
      const totalCacheCol = String(dayCache).padStart(10);
      const totalCostCol = dayTotalUsd.toFixed(4).padStart(8);

      process.stdout.write(`${totalDayCol} ${totalTierCol} ${totalSCountCol} ${totalTurnsCol} ${totalInCol} ${totalOutCol} ${totalCacheCol} ${totalCostCol}\n`);

      const brainPct = dayTotalUsd > 0 ? (dayBrainUsd / dayTotalUsd) * 100 : 0;
      process.stdout.write(`brain_share: ${brainPct.toFixed(1)}%\n\n`);
    }
  } else {
    // --by day or --by model
    process.stdout.write('day        tier        model                          sessions turns input      output     cache_read cost_usd\n');

    for (const day of sortedDays) {
      const dayRows = dayBuckets.get(day);
      let dayTotalUsd = 0;
      let dayBrainUsd = 0;

      const groups = new Map();

      for (const r of dayRows) {
        dayTotalUsd += r.cost_usd;
        if (r._tier === 'brain') {
          dayBrainUsd += r.cost_usd;
        }

        const tier = r._tier;
        const model = r.model || 'unknown';
        const key = `${tier}\0${model}`;

        let g = groups.get(key);
        if (!g) {
          g = {
            tier,
            model,
            sessionSet: new Set(),
            turns: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0
          };
          groups.set(key, g);
        }

        if (r.session) {
          g.sessionSet.add(r.session);
        }
        const turns = typeof r.turns === 'number' && !isNaN(r.turns) ? r.turns : 0;
        g.turns += turns;
        g.input_tokens += typeof r.input_tokens === 'number' ? r.input_tokens : 0;
        g.output_tokens += typeof r.output_tokens === 'number' ? r.output_tokens : 0;
        g.cache_read_tokens += typeof r.cache_read_tokens === 'number' ? r.cache_read_tokens : 0;
        g.cost_usd += r.cost_usd;
      }

      const rowList = Array.from(groups.values()).sort((a, b) => b.cost_usd - a.cost_usd);

      let dayTurns = 0;
      let dayInput = 0;
      let dayOutput = 0;
      let dayCache = 0;
      const daySessionsSet = new Set();

      for (const r of rowList) {
        r.sessionSet.forEach((s) => daySessionsSet.add(s));
        dayTurns += r.turns;
        dayInput += r.input_tokens;
        dayOutput += r.output_tokens;
        dayCache += r.cache_read_tokens;

        const dayCol = day.padEnd(10);
        const tierCol = r.tier.padEnd(11);
        const modelCol = r.model.slice(0, 30).padEnd(30);
        const sCountCol = String(r.sessionSet.size).padStart(8);
        const turnsCol = String(r.turns).padStart(5);
        const inCol = String(r.input_tokens).padStart(10);
        const outCol = String(r.output_tokens).padStart(10);
        const cacheCol = String(r.cache_read_tokens).padStart(10);
        const costCol = r.cost_usd.toFixed(4).padStart(8);

        process.stdout.write(`${dayCol} ${tierCol} ${modelCol} ${sCountCol} ${turnsCol} ${inCol} ${outCol} ${cacheCol} ${costCol}\n`);
      }

      // TOTAL row
      const totalDayCol = 'TOTAL'.padEnd(10);
      const totalTierCol = '-'.padEnd(11);
      const totalModelCol = '-'.padEnd(30);
      const totalSCountCol = String(daySessionsSet.size).padStart(8);
      const totalTurnsCol = String(dayTurns).padStart(5);
      const totalInCol = String(dayInput).padStart(10);
      const totalOutCol = String(dayOutput).padStart(10);
      const totalCacheCol = String(dayCache).padStart(10);
      const totalCostCol = dayTotalUsd.toFixed(4).padStart(8);

      process.stdout.write(`${totalDayCol} ${totalTierCol} ${totalModelCol} ${totalSCountCol} ${totalTurnsCol} ${totalInCol} ${totalOutCol} ${totalCacheCol} ${totalCostCol}\n`);

      const brainPct = dayTotalUsd > 0 ? (dayBrainUsd / dayTotalUsd) * 100 : 0;
      process.stdout.write(`brain_share: ${brainPct.toFixed(1)}%\n\n`);
    }
  }
}

module.exports = {
  tierOf
};

if (require.main === module) {
  run();
}
