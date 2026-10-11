#!/usr/bin/env node
'use strict';

/**
 * scripts/cost-digest.js
 *
 * Reads a cost ledger JSONL file and prints a per-day x tier x model x session spend table.
 *
 * CLI:
 *   node scripts/cost-digest.js [--file <path>] [--since <N days, default 7>] [--today] [--by day|model|session|tier|agent] [--json]
 *   node scripts/cost-digest.js --help
 *
 * Columns: turns, input, output, cache_read, cache_write (cache_creation), ctx/turn, cost_usd.
 *   ctx/turn = (input + cache_read + cache_write) / turns, computed from the SUMMED ledger rows of each
 *   group. It is a mean derived from sums, not a per-turn measurement (the ledger holds no per-turn values).
 *   JSON: cache_write_tokens and avg_context_per_turn on every row.
 * Subagents: hooks/cost-tracker.js logs subagent turns (read from <session>/subagents/*.jsonl, which the
 *   main transcript does not contain) as separate rows carrying `sidechain:true` + `agent_id`. `--by agent`
 *   groups main vs subagent; every day also reports subagent_share (cost) and subagent_cache_write_share.
 *   Old rows without these fields (or without cache_write_tokens) count as main / 0 and never break the report.
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
  --by <day|model|session|tier|agent>
                             Grouping mode (default: day); agent = main vs subagent
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
      if (!['day', 'model', 'session', 'tier', 'agent'].includes(mode)) {
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

function isSubagentRow(r) {
  return r.sidechain === true || (typeof r.agent_id === 'string' && r.agent_id.length > 0);
}

function num(v) {
  return typeof v === 'number' && !isNaN(v) ? v : 0;
}

// Group definition per --by mode: key, identity fields, extra cells.
function groupSpec(mode, r) {
  if (mode === 'session') {
    const sess = typeof r.session === 'string' ? r.session : 'unknown';
    const cwd = typeof r.cwd === 'string' ? path.basename(r.cwd) : '';
    return { key: sess + '\0' + cwd, ident: { session: sess }, cwd };
  }
  if (mode === 'tier') {
    return { key: r._tier, ident: { tier: r._tier } };
  }
  if (mode === 'agent') {
    const agent = isSubagentRow(r) ? 'subagent' : 'main';
    return { key: agent, ident: { agent } };
  }
  const model = r.model || 'unknown';
  return { key: r._tier + '\0' + model, ident: { tier: r._tier, model } };
}

const NUM_HEAD = 'sessions turns input      output     cache_read cache_write ctx/turn   cost_usd';

function textHeader(mode) {
  if (mode === 'session') return 'day        session   cwd                  ' + NUM_HEAD + '\n';
  if (mode === 'tier') return 'day        tier        ' + NUM_HEAD + '\n';
  if (mode === 'agent') return 'day        agent       ' + NUM_HEAD + '\n';
  return 'day        tier        model                          ' + NUM_HEAD + '\n';
}

function identCols(mode, g) {
  if (mode === 'session') return g.ident.session.slice(0, 8).padEnd(9) + ' ' + (g.cwd || '').slice(0, 20).padEnd(20);
  if (mode === 'tier') return g.ident.tier.padEnd(11);
  if (mode === 'agent') return g.ident.agent.padEnd(11);
  return g.ident.tier.padEnd(11) + ' ' + g.ident.model.slice(0, 30).padEnd(30);
}

function identPlaceholder(mode) {
  if (mode === 'session') return '-'.padEnd(9) + ' ' + '-'.padEnd(20);
  if (mode === 'tier' || mode === 'agent') return '-'.padEnd(11);
  return '-'.padEnd(11) + ' ' + '-'.padEnd(30);
}

function ctxPerTurn(input, cacheRead, cacheWrite, turns) {
  return turns > 0 ? Math.round((input + cacheRead + cacheWrite) / turns) : 0;
}

function numCols(g) {
  return String(g.sessionSet.size).padStart(8) + ' ' +
    String(g.turns).padStart(5) + ' ' +
    String(g.input_tokens).padStart(10) + ' ' +
    String(g.output_tokens).padStart(10) + ' ' +
    String(g.cache_read_tokens).padStart(10) + ' ' +
    String(g.cache_write_tokens).padStart(11) + ' ' +
    String(ctxPerTurn(g.input_tokens, g.cache_read_tokens, g.cache_write_tokens, g.turns)).padStart(9) + ' ' +
    g.cost_usd.toFixed(4).padStart(8);
}

function pct(part, whole) {
  return whole > 0 ? part / whole : 0;
}

function run() {
  const args = parseArgs(process.argv);

  const defaultFilePath = process.env.AUTOPILOT_COSTS_FILE || '~/.claude/metrics/costs.jsonl';
  const rawFilePath = args.file || defaultFilePath;
  const resolvedPath = resolveTilde(rawFilePath);

  const now = new Date();
  const todayDay = getUtcIsoDay(now);
  const sinceDay = args.today ? todayDay : computeSinceDay(args.since, now);

  if (!fs.existsSync(resolvedPath)) {
    process.stderr.write(`Warning: cost ledger file not found: ${resolvedPath}\n`);
    if (args.json) {
      process.stdout.write(JSON.stringify({
        schema_version: 1, file: resolvedPath, since: sinceDay, skipped_lines: 0, days: []
      }, null, 2) + '\n');
    } else {
      process.stdout.write(textHeader(args.by));
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

  let skippedLines = 0;
  const validRows = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { skippedLines++; continue; }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { skippedLines++; continue; }
    if (!parsed.ts || typeof parsed.ts !== 'string') { skippedLines++; continue; }
    if (typeof parsed.cost_usd !== 'number' || isNaN(parsed.cost_usd)) { skippedLines++; continue; }
    const d = new Date(parsed.ts);
    if (isNaN(d.getTime())) { skippedLines++; continue; }
    parsed._day = getUtcIsoDay(d);
    parsed._tier = tierOf(parsed.model);
    validRows.push(parsed);
  }

  const filteredRows = validRows.filter((r) => (
    args.today ? r._day === todayDay : (r._day >= sinceDay && r._day <= todayDay)
  ));

  // Aggregate: day -> { totals, groups }
  const dayMap = new Map();
  for (const r of filteredRows) {
    let dObj = dayMap.get(r._day);
    if (!dObj) {
      dObj = { day: r._day, total_usd: 0, brain_usd: 0, sub_usd: 0, cw_total: 0, cw_sub: 0, groups: new Map() };
      dayMap.set(r._day, dObj);
    }
    const sub = isSubagentRow(r);
    const cw = num(r.cache_write_tokens);
    dObj.total_usd += r.cost_usd;
    dObj.cw_total += cw;
    if (r._tier === 'brain') dObj.brain_usd += r.cost_usd;
    if (sub) { dObj.sub_usd += r.cost_usd; dObj.cw_sub += cw; }

    const spec = groupSpec(args.by, r);
    let g = dObj.groups.get(spec.key);
    if (!g) {
      g = { ident: spec.ident, cwd: spec.cwd, sessionSet: new Set(), modelSet: new Set(),
        turns: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };
      dObj.groups.set(spec.key, g);
    }
    if (r.session) g.sessionSet.add(r.session);
    g.modelSet.add(r.model || 'unknown');
    g.turns += num(r.turns);
    g.input_tokens += num(r.input_tokens);
    g.output_tokens += num(r.output_tokens);
    g.cache_read_tokens += num(r.cache_read_tokens);
    g.cache_write_tokens += cw;
    g.cost_usd += r.cost_usd;
  }
  const sortedDays = Array.from(dayMap.keys()).sort();

  if (args.json) {
    const daysResult = sortedDays.map((dStr) => {
      const dObj = dayMap.get(dStr);
      const rows = Array.from(dObj.groups.values()).map((g) => {
        const base = {
          sessions: g.sessionSet.size,
          turns: g.turns,
          input_tokens: g.input_tokens,
          output_tokens: g.output_tokens,
          cache_read_tokens: g.cache_read_tokens,
          cache_write_tokens: g.cache_write_tokens,
          avg_context_per_turn: ctxPerTurn(g.input_tokens, g.cache_read_tokens, g.cache_write_tokens, g.turns),
          cost_usd: Number(g.cost_usd.toFixed(4))
        };
        const ident = args.by === 'session'
          ? Object.assign({}, g.ident, { models: Array.from(g.modelSet).sort() })
          : g.ident;
        return Object.assign({}, ident, base);
      });
      rows.sort((a, b) => b.cost_usd - a.cost_usd);
      return {
        day: dObj.day,
        total_usd: Number(dObj.total_usd.toFixed(4)),
        brain_usd: Number(dObj.brain_usd.toFixed(4)),
        brain_share: Number(pct(dObj.brain_usd, dObj.total_usd).toFixed(4)),
        subagent_usd: Number(dObj.sub_usd.toFixed(4)),
        subagent_share: Number(pct(dObj.sub_usd, dObj.total_usd).toFixed(4)),
        subagent_cache_write_tokens: dObj.cw_sub,
        subagent_cache_write_share: Number(pct(dObj.cw_sub, dObj.cw_total).toFixed(4)),
        rows
      };
    });
    process.stdout.write(JSON.stringify({
      schema_version: 1,
      file: resolvedPath,
      since: sinceDay,
      by: args.by,
      skipped_lines: skippedLines,
      avg_context_per_turn_note: 'derived: (input + cache_read + cache_write) / turns over summed ledger rows; not a per-turn measurement',
      days: daysResult
    }, null, 2) + '\n');
    process.exit(0);
  }

  process.stdout.write(textHeader(args.by));
  for (const day of sortedDays) {
    const dObj = dayMap.get(day);
    const rowList = Array.from(dObj.groups.values()).sort((a, b) => b.cost_usd - a.cost_usd);
    const tot = { sessionSet: new Set(), turns: 0, input_tokens: 0, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: dObj.total_usd };
    for (const g of rowList) {
      g.sessionSet.forEach((s) => tot.sessionSet.add(s));
      tot.turns += g.turns;
      tot.input_tokens += g.input_tokens;
      tot.output_tokens += g.output_tokens;
      tot.cache_read_tokens += g.cache_read_tokens;
      tot.cache_write_tokens += g.cache_write_tokens;
      process.stdout.write(`${day.padEnd(10)} ${identCols(args.by, g)} ${numCols(g)}\n`);
    }
    process.stdout.write(`${'TOTAL'.padEnd(10)} ${identPlaceholder(args.by)} ${numCols(tot)}\n`);
    process.stdout.write(`brain_share: ${(pct(dObj.brain_usd, dObj.total_usd) * 100).toFixed(1)}%\n`);
    process.stdout.write(`subagent_share: ${(pct(dObj.sub_usd, dObj.total_usd) * 100).toFixed(1)}% of cost, ` +
      `${(pct(dObj.cw_sub, dObj.cw_total) * 100).toFixed(1)}% of cache_write\n\n`);
  }
  process.stdout.write('ctx/turn = (input + cache_read + cache_write) / turns, derived from summed ledger rows (a mean, not per-turn values)\n');
}

module.exports = {
  tierOf
};

if (require.main === module) {
  run();
}
