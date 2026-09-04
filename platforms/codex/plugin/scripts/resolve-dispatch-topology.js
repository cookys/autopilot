#!/usr/bin/env node
'use strict';

/**
 * resolve-dispatch-topology.js — derives the host's default implementer dispatch ladder
 * from installed runner binaries and qualified scorecard seats.
 *
 * Ordering:
 * Cheapest-first — there is no reliable price data; effort rank
 * low < medium < high < xhigh < max, then ascending latency.sample_wall_time_s,
 * then engine name (string compare) as final tiebreak.
 *
 * ADR-0001: topology facts are re-derived from installed binaries + scorecard,
 * never trusted from a feed or a prior receipt.
 *
 * Node >= 20, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const RUNNER_TOKENS = Object.freeze([
  'agy', 'codex', 'grok', 'cursor', 'kimi', 'opencode', 'qoderclicn', 'pi', 'cc-shim',
]);

const EFFORT_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
});

const CLAUDE_FALLBACK_LADDER = Object.freeze([
  'haiku/medium@claude-native',
  'sonnet/medium@claude-native',
]);

function usage(code = 2) {
  process.stderr.write(
    'Usage: node scripts/resolve-dispatch-topology.js [--json] [--check] [--out <path>]\n'
  );
  process.exit(code);
}

function resolveOutputPath(outArg) {
  if (outArg) return path.resolve(outArg);
  if (process.env.AUTOPILOT_TOPOLOGY_FILE) {
    return path.resolve(process.env.AUTOPILOT_TOPOLOGY_FILE);
  }
  return path.join(os.homedir(), '.autopilot', 'topology.json');
}

function getInstalledRunners(repoRoot) {
  const runnerBinaryScript = path.join(repoRoot, 'scripts', 'lib', 'runner-binary.js');
  const installed = {};

  for (const r of RUNNER_TOKENS) {
    const res = spawnSync(process.execPath, [runnerBinaryScript, 'binary', '--runner', r], {
      env: process.env,
      encoding: 'utf8',
    });
    if (res.status === 0) {
      const binaryName = (res.stdout || '').trim();
      const resolved = resolveBinaryPath(binaryName, r);
      installed[r] = resolved;
    } else {
      installed[r] = null;
    }
  }

  return installed;
}

function resolveBinaryPath(binaryName, runner) {
  if (!binaryName) return null;
  if (binaryName.includes(path.sep)) {
    try {
      fs.accessSync(binaryName, fs.constants.X_OK);
      return path.resolve(binaryName);
    } catch {
      return null;
    }
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, binaryName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      // next
    }
  }
  const home = process.env.HOME || '';
  const fallbackPaths = {
    kimi: ['.kimi-code/bin/kimi'],
  };
  for (const rel of (fallbackPaths[runner] || [])) {
    if (!home) break;
    const candidate = path.join(home, rel);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      // next
    }
  }
  return null;
}

function getCandidateSeats(repoRoot) {
  const scorecardScript = path.join(repoRoot, 'scripts', 'engine-scorecard.js');
  const res = spawnSync(process.execPath, [scorecardScript, 'current', '--role', 'implementer'], {
    env: process.env,
    encoding: 'utf8',
  });
  if (res.status !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function checkSeatStatus(repoRoot, engine, runner, effort) {
  const scorecardScript = path.join(repoRoot, 'scripts', 'engine-scorecard.js');
  const args = [
    scorecardScript,
    'seat-status',
    '--engine', engine,
    '--runner', runner,
    '--role', 'implementer',
  ];
  if (effort) {
    args.push('--effort', effort);
  }
  const res = spawnSync(process.execPath, args, {
    env: process.env,
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

function resolveJudgeField(repoRoot, field) {
  const scriptPath = path.join(repoRoot, 'scripts', 'resolve-review-loop.sh');
  try {
    const res = spawnSync('bash', [scriptPath, '--field', field], {
      env: process.env,
      encoding: 'utf8',
    });
    if (res.status !== 0) return null;
    const val = (res.stdout || '').trim();
    return val.length > 0 ? val : null;
  } catch {
    return null;
  }
}

function getJudge(repoRoot) {
  try {
    const engine = resolveJudgeField(repoRoot, 'reviewer_engine');
    const runner = resolveJudgeField(repoRoot, 'reviewer_runner');
    const effort = resolveJudgeField(repoRoot, 'reviewer_effort');
    if (engine === null || runner === null || effort === null) {
      return { reviewer_engine: null, reviewer_runner: null, reviewer_effort: null };
    }
    return { reviewer_engine: engine, reviewer_runner: runner, reviewer_effort: effort };
  } catch {
    return { reviewer_engine: null, reviewer_runner: null, reviewer_effort: null };
  }
}

function deriveTopology(repoRoot) {
  const runnersInstalled = getInstalledRunners(repoRoot);
  const candidates = getCandidateSeats(repoRoot);

  const qualifiedSeats = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const runner = c.runner;
    const engine = c.engine;
    const effort = c.effort || null;
    if (!runner || !engine) continue;

    // A seat is usable only if its runner is installed
    if (!runnersInstalled[runner]) continue;

    const status = checkSeatStatus(repoRoot, engine, runner, effort);
    if (!status || status.admission_status !== 'qualified') continue;

    const rowLatency = (c.latency && typeof c.latency.sample_wall_time_s === 'number')
      ? c.latency.sample_wall_time_s
      : Infinity;

    // baseline_event_id: pull from seat-status or scorecard row if present
    let baselineEventId = undefined;
    if (status.baseline_event_id !== undefined && status.baseline_event_id !== null) {
      baselineEventId = status.baseline_event_id;
    } else if (c.baseline_event_id !== undefined && c.baseline_event_id !== null) {
      baselineEventId = c.baseline_event_id;
    } else if (c.event_id !== undefined && c.event_id !== null) {
      baselineEventId = c.event_id;
    }

    const rungName = effort ? `${engine}/${effort}@${runner}` : `${engine}@${runner}`;
    const rungObj = {
      rung: rungName,
      engine,
      effort: effort || '',
      runner,
    };
    if (baselineEventId !== undefined) {
      rungObj.baseline_event_id = baselineEventId;
    }

    qualifiedSeats.push({
      rungObj,
      effort: effort || '',
      latency: rowLatency,
      engine,
      runner,
    });
  }

  // Ordering (cheapest-first):
  // effort rank low < medium < high < xhigh < max, then ascending latency.sample_wall_time_s,
  // then engine name (string compare) as final tiebreak.
  qualifiedSeats.sort((a, b) => {
    const rankA = EFFORT_RANK[a.effort] || 99;
    const rankB = EFFORT_RANK[b.effort] || 99;
    if (rankA !== rankB) return rankA - rankB;
    if (a.latency !== b.latency) return a.latency - b.latency;
    return a.engine.localeCompare(b.engine);
  });

  const implementerLadder = qualifiedSeats.map((s) => s.rungObj);

  // candidates_to_qualify: installed runners (non-null in runners_installed)
  // that have NO qualified implementer seat in the ladder. Dedup, stable order = RUNNER_TOKENS.
  const ladderRunners = new Set(implementerLadder.map((r) => r.runner));
  const candidatesToQualify = RUNNER_TOKENS.filter(
    (r) => runnersInstalled[r] !== null && !ladderRunners.has(r)
  );

  const judge = getJudge(repoRoot);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    runners_installed: runnersInstalled,
    implementer_ladder: implementerLadder,
    claude_fallback_ladder: [...CLAUDE_FALLBACK_LADDER],
    candidates_to_qualify: candidatesToQualify,
    judge,
  };
}

function jsonDiff(actualObj, expectedObj) {
  const aLines = JSON.stringify(actualObj, null, 2).split('\n');
  const bLines = JSON.stringify(expectedObj, null, 2).split('\n');
  const diff = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i += 1) {
    const a = aLines[i];
    const b = bLines[i];
    if (a !== b) {
      if (a !== undefined) diff.push(`- ${a}`);
      if (b !== undefined) diff.push(`+ ${b}`);
    } else {
      diff.push(`  ${a}`);
    }
  }
  return diff.join('\n');
}

function deepEqualIgnoringGeneratedAt(objA, objB) {
  const copyA = { ...objA };
  const copyB = { ...objB };
  delete copyA.generated_at;
  delete copyB.generated_at;
  return JSON.stringify(copyA) === JSON.stringify(copyB);
}

function main() {
  const argv = process.argv.slice(2);
  let asJson = false;
  let isCheck = false;
  let outArg = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      asJson = true;
    } else if (arg === '--check') {
      isCheck = true;
    } else if (arg === '--out') {
      if (i + 1 >= argv.length) usage(2);
      outArg = argv[i + 1];
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      usage(0);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      usage(2);
    }
  }

  const repoRoot = path.resolve(__dirname, '..');
  const outPath = resolveOutputPath(outArg);

  if (isCheck) {
    if (!fs.existsSync(outPath)) {
      process.stderr.write(`Topology file missing at ${outPath}\n`);
      process.exit(1);
    }
    let diskContent;
    try {
      diskContent = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (err) {
      process.stderr.write(`Topology file invalid JSON at ${outPath}: ${err.message}\n`);
      process.exit(1);
    }
    const derived = deriveTopology(repoRoot);
    if (!deepEqualIgnoringGeneratedAt(diskContent, derived)) {
      const copyDisk = { ...diskContent };
      const copyDerived = { ...derived };
      delete copyDisk.generated_at;
      delete copyDerived.generated_at;
      const diffStr = jsonDiff(copyDisk, copyDerived);
      process.stderr.write(`Topology check failure against ${outPath}:\n${diffStr}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  const topology = deriveTopology(repoRoot);
  const topologyJson = JSON.stringify(topology, null, 2) + '\n';

  // ALWAYS write to outPath
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, topologyJson, 'utf8');
  } catch (err) {
    process.stderr.write(`Failed to write topology file to ${outPath}: ${err.message}\n`);
    process.exit(1);
  }

  if (asJson) {
    process.stdout.write(topologyJson);
  }
}

main();
