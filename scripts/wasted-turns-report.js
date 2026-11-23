#!/usr/bin/env node
'use strict';

/**
 * wasted-turns-report.js — measure wasted turns (whiff) and context cost from
 * Claude Code session transcripts.
 *
 * Modes:
 *   --self (default)                 Analyze this seat's transcripts
 *   --usage-only --transcript <path> Other seat: usage fields + timestamp only
 *   --aggregate <dir>                Rank seat JSONs in <dir> (autopilot.wasted-turns.rank/1)
 *
 * Options:
 *   --window <days>                  Lookback window in days (default: 7)
 *   --out <path>                     Write JSON output to <path>
 *   --top <N>                        Top N seats in --aggregate (default: 10)
 *   --hit-factor <num>               Cache-hit cost multiplier (default: 0.10)
 *   --miss-factor <num>              Cache-miss cost multiplier (default: 2.0)
 *   --seat <label>                   Seat label in output JSON
 *   --now <ISO>                      Override current timestamp (for testing)
 *   --help                           Show this help
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveTranscriptPath } = require('../hooks/transcript-reader-lib.js');
const {
  DEFAULT_HIT_FACTOR,
  DEFAULT_MISS_FACTOR,
  toTaipeiIso,
  projectUsageOnlyStream,
  classifyTranscriptStream,
} = require('./lib/wasted-turns-classify.js');

function printHelp() {
  process.stdout.write(
    'Usage: wasted-turns-report.js [--self | --usage-only --transcript <path> | --aggregate <dir>]\n' +
    '  --window <days>       Lookback window in days (default: 7)\n' +
    '  --out <path>          Write JSON output to <path>\n' +
    '  --top <N>             Top N seats in --aggregate (default: 10)\n' +
    '  --hit-factor <num>    Cache-hit multiplier (default: 0.10)\n' +
    '  --miss-factor <num>   Cache-miss multiplier (default: 2.0)\n' +
    '  --seat <label>        Seat label\n' +
    '  --now <ISO>           Override current time\n'
  );
}

function parseArgs(argv) {
  const opts = {
    mode: 'self',
    transcript: null,
    aggregateDir: null,
    windowDays: 7,
    out: null,
    top: 10,
    hitFactor: DEFAULT_HIT_FACTOR,
    missFactor: DEFAULT_MISS_FACTOR,
    seat: process.env.FLEET_SEAT || os.hostname() || 'self',
    nowMs: Date.now(),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--self') {
      opts.mode = 'self';
    } else if (a === '--usage-only') {
      opts.mode = 'usage-only';
    } else if (a === '--transcript' && i + 1 < argv.length) {
      opts.transcript = argv[++i];
    } else if (a === '--aggregate' && i + 1 < argv.length) {
      opts.mode = 'aggregate';
      opts.aggregateDir = argv[++i];
    } else if (a === '--window' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid --window');
      opts.windowDays = n;
    } else if (a === '--out' && i + 1 < argv.length) {
      opts.out = argv[++i];
    } else if (a === '--top' && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid --top');
      opts.top = n;
    } else if (a === '--hit-factor' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error('Invalid --hit-factor');
      opts.hitFactor = n;
    } else if (a === '--miss-factor' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error('Invalid --miss-factor');
      opts.missFactor = n;
    } else if (a === '--seat' && i + 1 < argv.length) {
      opts.seat = argv[++i];
    } else if (a === '--now' && i + 1 < argv.length) {
      const ms = Date.parse(argv[++i]);
      if (!Number.isFinite(ms)) throw new Error('Invalid --now');
      opts.nowMs = ms;
    } else {
      throw new Error(`Unknown or incomplete argument: ${a}`);
    }
  }
  return opts;
}

function findSelfTranscripts(windowFromMs) {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (sessionId) {
    const p = resolveTranscriptPath({ sessionId });
    if (p) return [p];
  }
  const base = path.join(os.homedir(), '.claude', 'projects');
  const found = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return []; }
  for (const d of dirs) {
    const dirPath = path.join(base, d);
    let files = [];
    try { files = fs.readdirSync(dirPath); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dirPath, f);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs >= windowFromMs) {
          found.push(full);
        }
      } catch { /* skip */ }
    }
  }
  return found;
}

function runAggregate(dir, topN) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rows = [];
  let fleetTurns = 0;
  let fleetWhiffTurns = 0;
  let fleetCostHit = 0;
  let fleetCostMiss = 0;

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (!data || data.schema !== 'autopilot.wasted-turns/1') continue;
    if (data.mode !== 'self' || !data.whiff) continue;

    const cats = ['stop_block', 'hook_block', 'help_lookup', 'error_retry'];
    let seatCostHit = 0;
    let seatCostMiss = 0;
    for (const c of cats) {
      if (data.whiff[c]) {
        seatCostHit += Number(data.whiff[c].cost_hit || 0);
        seatCostMiss += Number(data.whiff[c].cost_miss || 0);
      }
    }

    fleetTurns += Number(data.turns_total || 0);
    fleetWhiffTurns += Number(data.whiff_turns || 0);
    fleetCostHit += seatCostHit;
    fleetCostMiss += seatCostMiss;

    rows.push({
      seat: data.seat || f,
      whiff_per_100: Number(data.whiff_per_100 || 0),
      whiff_cost_hit: seatCostHit,
      whiff_cost_miss: seatCostMiss,
    });
  }

  rows.sort((a, b) => b.whiff_per_100 - a.whiff_per_100 || a.seat.localeCompare(b.seat));

  return {
    schema: 'autopilot.wasted-turns.rank/1',
    top: rows.slice(0, topN),
    fleet: {
      seats_total: rows.length,
      turns_total: fleetTurns,
      whiff_turns: fleetWhiffTurns,
      whiff_per_100: fleetTurns > 0 ? Number(((fleetWhiffTurns / fleetTurns) * 100).toFixed(2)) : 0,
      whiff_cost_hit: fleetCostHit,
      whiff_cost_miss: fleetCostMiss,
    },
  };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(2);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const windowToMs = opts.nowMs;
  const windowFromMs = windowToMs - opts.windowDays * 24 * 3600 * 1000;

  let output;
  if (opts.mode === 'aggregate') {
    output = runAggregate(opts.aggregateDir, opts.top);
  } else if (opts.mode === 'usage-only') {
    if (!opts.transcript) {
      process.stderr.write('Error: --usage-only requires --transcript <path>\n');
      process.exit(2);
    }
    const proj = await projectUsageOnlyStream(opts.transcript, windowFromMs, windowToMs);
    output = {
      schema: 'autopilot.wasted-turns/1',
      seat: opts.seat,
      mode: 'usage-only',
      window: { from: toTaipeiIso(windowFromMs), to: toTaipeiIso(windowToMs) },
      turns_total: proj.turns_total,
      ctx_tokens: proj.ctx_tokens,
      whiff: {
        stop_block: null,
        hook_block: null,
        help_lookup: null,
        error_retry: null,
        repeat_chain: null,
      },
      whiff_turns: null,
      whiff_per_100: null,
      whiff_share: null,
    };
  } else {
    const paths = opts.transcript ? [opts.transcript] : findSelfTranscripts(windowFromMs);
    const res = await classifyTranscriptStream(paths, {
      hitFactor: opts.hitFactor,
      missFactor: opts.missFactor,
      windowFromMs,
      windowToMs,
    });
    output = {
      schema: 'autopilot.wasted-turns/1',
      seat: opts.seat,
      mode: 'self',
      window: { from: toTaipeiIso(windowFromMs), to: toTaipeiIso(windowToMs) },
      turns_total: res.turns_total,
      whiff: res.whiff,
      whiff_turns: res.whiff_turns,
      whiff_per_100: res.whiff_per_100,
      whiff_share: res.whiff_share,
    };
  }

  const json = JSON.stringify(output, null, 2) + '\n';
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, runAggregate };
