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

const PANEL_ELIGIBLE_RUNNERS = Object.freeze([
  'codex', 'agy', 'grok', 'cc-shim', 'anthropic-compatible', 'claude-native', 'qoderclicn', 'cursor',
]);

const PANEL_RUNNERS_SET = new Set(PANEL_ELIGIBLE_RUNNERS);

const VALID_ROLES = Object.freeze([
  'implementer', 'plan_reviewer', 'reviewer', 'consult', 'discuss',
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

function normalizeRunner(runner) {
  if (runner === 'codex-cli') return 'codex';
  return runner;
}

function familyOf(engine) {
  const e = (engine || '').toLowerCase();
  if (e.includes('gpt') || e.includes('codex') || e.includes('o1') || e.includes('o3') || e.includes('o4')) {
    return 'openai';
  }
  if (e.includes('claude') || e.includes('opus') || e.includes('sonnet') || e.includes('haiku')) {
    return 'anthropic';
  }
  if (e.includes('qwen') || e.includes('qwq')) {
    return 'alibaba';
  }
  if (e.includes('gemini') || e.includes('flash') || e.includes('bison')) {
    return 'google';
  }
  if (e.includes('grok') || e.includes('composer')) {
    return 'xai';
  }
  if (e.includes('minimax') || e.includes('abab')) {
    return 'minimax';
  }
  if (e.includes('glm') || e.includes('zhipu')) {
    return 'zhipu';
  }
  if (e.includes('kimi') || e.includes('moonshot')) {
    return 'moonshot';
  }
  return 'unknown';
}

function resolveEndpoint(engine, runner) {
  const normRunner = normalizeRunner(runner);
  // Match resolve-endpoint.sh style endpoint-name convention:
  // Check env vars like AUTOPILOT_ENDPOINT_<NAME>_URL
  const endpointVars = [];
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^AUTOPILOT_ENDPOINT_([A-Za-z0-9_]+)_URL$/);
    if (match && process.env[key]) {
      endpointVars.push(match[1]);
    }
  }

  // Check possible candidates based on engine / runner
  // e.g. exact match on lowercased endpoint name against engine or runner
  for (const ep of endpointVars) {
    const epLower = ep.toLowerCase();
    if (normRunner && normRunner.toLowerCase() === epLower) {
      return epLower;
    }
    if (engine && engine.toLowerCase().includes(epLower)) {
      return epLower;
    }
  }
  return '';
}

function usage(code = 2) {
  process.stderr.write(
    'Usage: node scripts/resolve-dispatch-topology.js [options]\n' +
    'Derives the host dispatch topology from installed runner binaries and scorecard.\n\n' +
    'Options:\n' +
    '  --json                   Emit topology JSON to stdout (default: write to file only)\n' +
    '  --check                  Diff recomputed topology against on-disk file, exit non-zero on mismatch\n' +
    '  --out <path>             Custom output file path (default: $AUTOPILOT_TOPOLOGY_FILE or ~/.autopilot/topology.json)\n' +
    '  --role <roles>           Comma-separated or repeatable role filter (implementer, plan_reviewer, reviewer, consult, discuss; default: all five)\n' +
    '  --exclude-seats <seats>  Comma-separated list of engine/effort@runner seats to exclude\n' +
    '  --asking-family <family> Family name for consult/discuss ladder sorting (default: anthropic)\n' +
    '  -h, --help               Print this help message\n'
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

function getCandidateSeats(repoRoot, role = 'implementer') {
  const scorecardScript = path.join(repoRoot, 'scripts', 'engine-scorecard.js');
  const res = spawnSync(process.execPath, [scorecardScript, 'current', '--role', role], {
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

function checkSeatStatus(repoRoot, engine, runner, effort, role = 'implementer') {
  const scorecardScript = path.join(repoRoot, 'scripts', 'engine-scorecard.js');
  const args = [
    scorecardScript,
    'seat-status',
    '--engine', engine,
    '--runner', runner,
    '--role', role,
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

function getQualifiedSeatsForRole(repoRoot, role, runnersInstalled) {
  const candidates = getCandidateSeats(repoRoot, role);
  const qualified = [];

  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const origRunner = c.runner;
    const runner = normalizeRunner(origRunner);
    const engine = c.engine;
    const effort = c.effort || null;
    if (!runner || !engine) continue;

    // A seat is usable only if its runner is installed
    if (!runnersInstalled[runner]) continue;

    // Query scorecard status with the row's runner token (or normalized)
    const status = checkSeatStatus(repoRoot, engine, origRunner, effort, role)
      || checkSeatStatus(repoRoot, engine, runner, effort, role);
    if (!status || status.admission_status !== 'qualified') continue;

    const rowLatency = (c.latency && typeof c.latency.sample_wall_time_s === 'number')
      ? c.latency.sample_wall_time_s
      : Infinity;

    let baselineEventId = undefined;
    if (status.baseline_event_id !== undefined && status.baseline_event_id !== null) {
      baselineEventId = status.baseline_event_id;
    } else if (c.baseline_event_id !== undefined && c.baseline_event_id !== null) {
      baselineEventId = c.baseline_event_id;
    } else if (c.event_id !== undefined && c.event_id !== null) {
      baselineEventId = c.event_id;
    }

    let costRank = Infinity;
    if (c.cost !== undefined && c.cost !== null) {
      if (typeof c.cost === 'number') {
        costRank = c.cost;
      } else if (typeof c.cost.rank === 'number') {
        costRank = c.cost.rank;
      } else if (typeof c.cost.cost_rank === 'number') {
        costRank = c.cost.cost_rank;
      } else if (typeof c.cost.sample_cost_usd === 'number') {
        costRank = c.cost.sample_cost_usd;
      }
    }

    const family = familyOf(engine);
    const endpoint = resolveEndpoint(engine, runner);

    const seatObj = {
      engine,
      effort: effort || '',
      runner,
      family,
      endpoint,
      role_source: role,
    };
    if (baselineEventId !== undefined) {
      seatObj.baseline_event_id = baselineEventId;
    }

    const rungName = effort ? `${engine}/${effort}@${runner}` : `${engine}@${runner}`;
    const legacyRungObj = {
      rung: rungName,
      engine,
      effort: effort || '',
      runner,
    };
    if (baselineEventId !== undefined) {
      legacyRungObj.baseline_event_id = baselineEventId;
    }

    qualified.push({
      engine,
      effort: effort || '',
      runner,
      family,
      latency: rowLatency,
      costRank,
      seatObj,
      legacyRungObj,
    });
  }

  return qualified;
}

function seatMatchesExcluded(engine, effort, runner, excludeSet) {
  const normRunner = normalizeRunner(runner);
  const eff = effort || '';
  const tuple = eff ? `${engine}/${eff}@${normRunner}` : `${engine}@${normRunner}`;
  return excludeSet.has(tuple);
}

function deriveTopology(repoRoot, options = {}) {
  const roles = options.roles || new Set(VALID_ROLES);
  const excludeSet = options.excludeSet || new Set();
  const askingFamily = options.askingFamily || 'anthropic';

  const runnersInstalled = getInstalledRunners(repoRoot);

  const out = {};

  if (roles.has('implementer')) {
    const candidates = getCandidateSeats(repoRoot, 'implementer');
    const qualifiedSeats = [];
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      const origRunner = c.runner;
      const runner = normalizeRunner(origRunner);
      const engine = c.engine;
      const effort = c.effort || null;
      if (!runner || !engine) continue;

      if (!runnersInstalled[runner]) continue;

      const status = checkSeatStatus(repoRoot, engine, origRunner, effort, 'implementer')
        || checkSeatStatus(repoRoot, engine, runner, effort, 'implementer');
      if (!status || status.admission_status !== 'qualified') continue;

      const rowLatency = (c.latency && typeof c.latency.sample_wall_time_s === 'number')
        ? c.latency.sample_wall_time_s
        : Infinity;

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

    qualifiedSeats.sort((a, b) => {
      const rankA = EFFORT_RANK[a.effort] || 99;
      const rankB = EFFORT_RANK[b.effort] || 99;
      if (rankA !== rankB) return rankA - rankB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.engine.localeCompare(b.engine);
    });

    let implementerLadder = qualifiedSeats.map((s) => s.rungObj);
    if (excludeSet.size > 0) {
      implementerLadder = implementerLadder.filter(
        (r) => !seatMatchesExcluded(r.engine, r.effort, r.runner, excludeSet)
      );
    }

    const ladderRunners = new Set(implementerLadder.map((r) => r.runner));
    const candidatesToQualify = RUNNER_TOKENS.filter(
      (r) => runnersInstalled[r] !== null && !ladderRunners.has(r)
    );

    const judge = getJudge(repoRoot);

    out.schema_version = 1;
    out.generated_at = new Date().toISOString();
    out.host = os.hostname();
    out.runners_installed = runnersInstalled;
    out.implementer_ladder = implementerLadder;
    out.claude_fallback_ladder = [...CLAUDE_FALLBACK_LADDER];
    out.candidates_to_qualify = candidatesToQualify;
    out.judge = judge;
  } else {
    out.schema_version = 1;
    out.generated_at = new Date().toISOString();
    out.host = os.hostname();
    out.runners_installed = runnersInstalled;
  }

  // Reviewer qualified seats (needed for reviewer_ladder and plan_review_panel)
  let reviewerQualified = null;
  function getReviewerQualified() {
    if (!reviewerQualified) {
      reviewerQualified = getQualifiedSeatsForRole(repoRoot, 'reviewer', runnersInstalled);
    }
    return reviewerQualified;
  }

  // Consult qualified seats (needed for consult_ladder and plan_review_panel)
  let consultQualified = null;
  function getConsultQualified() {
    if (!consultQualified) {
      consultQualified = getQualifiedSeatsForRole(repoRoot, 'consult', runnersInstalled);
    }
    return consultQualified;
  }

  if (roles.has('reviewer')) {
    const seats = [...getReviewerQualified()];
    seats.sort((a, b) => {
      const rankA = EFFORT_RANK[a.effort] || 99;
      const rankB = EFFORT_RANK[b.effort] || 99;
      if (rankA !== rankB) return rankA - rankB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.engine.localeCompare(b.engine);
    });
    let ladder = seats.map((s) => ({ ...s.seatObj }));
    if (excludeSet.size > 0) {
      ladder = ladder.filter((s) => !seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet));
    }
    out.reviewer_ladder = ladder;
  }

  function sortConsultDiscuss(seats) {
    seats.sort((a, b) => {
      const diffA = a.family !== askingFamily ? 0 : 1;
      const diffB = b.family !== askingFamily ? 0 : 1;
      if (diffA !== diffB) return diffA - diffB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      if (a.costRank !== b.costRank) return a.costRank - b.costRank;
      return a.engine.localeCompare(b.engine);
    });
    return seats;
  }

  if (roles.has('consult')) {
    const seats = [...getConsultQualified()];
    sortConsultDiscuss(seats);
    let ladder = seats.map((s) => ({ ...s.seatObj }));
    if (excludeSet.size > 0) {
      ladder = ladder.filter((s) => !seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet));
    }
    out.consult_ladder = ladder;
  }

  if (roles.has('discuss')) {
    const seats = [...getQualifiedSeatsForRole(repoRoot, 'discuss', runnersInstalled)];
    sortConsultDiscuss(seats);
    let ladder = seats.map((s) => ({ ...s.seatObj }));
    if (excludeSet.size > 0) {
      ladder = ladder.filter((s) => !seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet));
    }
    out.discuss_ladder = ladder;
  }

  if (roles.has('plan_reviewer')) {
    // Chair candidates: qualified reviewer-role rows only, eligible runners only, not excluded
    const chairCandidates = getReviewerQualified().filter((s) => {
      if (!PANEL_RUNNERS_SET.has(s.runner)) return false;
      if (seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet)) return false;
      return true;
    });

    function comparePanelCandidates(a, b) {
      const rankA = EFFORT_RANK[a.effort] || 99;
      const rankB = EFFORT_RANK[b.effort] || 99;
      if (rankA !== rankB) return rankB - rankA; // highest effort rank first
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.engine.localeCompare(b.engine);
    }

    chairCandidates.sort(comparePanelCandidates);

    const panel = [];
    const usedFamilies = new Set();

    if (chairCandidates.length > 0) {
      const chair = chairCandidates[0];
      panel.push({ ...chair.seatObj, role_source: 'reviewer' });
      usedFamilies.add(chair.family);
    }

    // Non-chair candidate pool: union of reviewer-role and consult-role rows
    const nonChairCandidates = [...getReviewerQualified(), ...getConsultQualified()].filter((s) => {
      if (!PANEL_RUNNERS_SET.has(s.runner)) return false;
      if (seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet)) return false;
      return true;
    });

    nonChairCandidates.sort(comparePanelCandidates);

    for (const cand of nonChairCandidates) {
      if (panel.length >= 3) break;
      if (usedFamilies.has(cand.family)) continue;
      panel.push({ ...cand.seatObj });
      usedFamilies.add(cand.family);
    }

    out.plan_review_panel = panel;
  }

  return out;
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
  let roleArgs = [];
  let excludeSeatsArg = null;
  let askingFamily = 'anthropic';

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
    } else if (arg === '--role') {
      if (i + 1 >= argv.length) usage(2);
      roleArgs.push(argv[i + 1]);
      i += 1;
    } else if (arg === '--exclude-seats') {
      if (i + 1 >= argv.length) usage(2);
      excludeSeatsArg = argv[i + 1];
      i += 1;
    } else if (arg === '--asking-family') {
      if (i + 1 >= argv.length) usage(2);
      askingFamily = argv[i + 1];
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      usage(0);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      usage(2);
    }
  }

  let selectedRoles;
  if (roleArgs.length === 0) {
    selectedRoles = new Set(VALID_ROLES);
  } else {
    selectedRoles = new Set();
    for (const rArg of roleArgs) {
      const parts = rArg.split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        selectedRoles.add(p);
      }
    }
  }

  const excludeSet = new Set();
  if (excludeSeatsArg) {
    const parts = excludeSeatsArg.split(',').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      excludeSet.add(p);
    }
  }

  const repoRoot = path.resolve(__dirname, '..');
  const outPath = resolveOutputPath(outArg);
  const deriveOptions = {
    roles: selectedRoles,
    excludeSet,
    askingFamily,
  };

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
    const derived = deriveTopology(repoRoot, deriveOptions);
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

  const topology = deriveTopology(repoRoot, deriveOptions);
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
