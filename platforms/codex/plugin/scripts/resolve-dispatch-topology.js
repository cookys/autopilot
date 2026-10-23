#!/usr/bin/env node
'use strict';

/**
 * resolve-dispatch-topology.js — derives the host's default implementer dispatch ladder
 * from installed runner binaries and qualified scorecard seats.
 *
 * Ordering:
 * Cheapest-first. Effort rank low < medium < high < xhigh < max < default; within one rank,
 * ascending unit price (input+output micro-USD per Mtok) from the LOCAL price cache
 * (scripts/qualification-prices.js, lib/qualification-prices.js): exact (engine, runner, model)
 * match, unknown (no row, or input/output null) / no cache sorts last (never 0). Then explicit effort before legacy,
 * ascending latency.sample_wall_time_s, then engine name (string compare) as final tiebreak.
 * The cache is read here, never fetched (no network on the dispatch path); with no cache every
 * seat is unknown, so the order is identical to the pre-price ordering. Stale prices only warn
 * (qualification-prices.js status) and are still used.
 *
 * ADR-0001: topology facts are re-derived from installed binaries + scorecard,
 * never trusted from a feed or a prior receipt.
 *
 * Persistent exclusions (topology.exclude_seats in the operator config) filter the ladders and panel only;
 * judge, claude_fallback_ladder and operator pins are not filtered. HTTP seats (anthropic-compatible)
 * depend on AUTOPILOT_ENDPOINT_*_URL in the calling environment, so --check can differ per shell.
 *
 * claude-native (the local `claude` CLI) counts as available for reviewer/consult/discuss and the panel
 * when `claude` is installed, never for the implementer ladder (dispatch-hetero has no such runner).
 * The reviewer ladder lists anthropic-family seats after every other family (depth-0 is usually Claude),
 * and an anthropic seat only chairs the plan-review panel when no other family ties it on effort;
 * consult/discuss keep their --asking-family demotion.
 *
 * Node >= 20, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { configPath } = require('./lib/config-path.js');
const { normalizeEffort } = require('./lib/effort-scale.js');
const { spawnSync } = require('child_process');

const RUNNER_TOKENS = Object.freeze([
  'agy', 'codex', 'grok', 'cursor', 'kimi', 'opencode', 'qoderclicn', 'pi', 'cc-shim',
]);

// Runners that count as available for the reviewer/consult/discuss ladders and the plan-review panel
// but are NOT auto-selected implementer seats: dispatch-hetero.sh --runner claude-native exists, but only as an
// EXPLICIT implementer runner behind a one-time owner confirmation (scripts/run-approval.js
// confirm-claude-native), so the topology never routes to it. Availability
// reuses the `claude` binary cc-shim resolves to (runner-binary.js). RUNNER_TOKENS stays implementer-only,
// so candidates_to_qualify is unchanged and the implementer ladder skips these seats explicitly.
const NON_IMPLEMENTER_RUNNERS = Object.freeze(['claude-native']);

const PANEL_ELIGIBLE_RUNNERS = Object.freeze([
  'codex', 'agy', 'grok', 'cc-shim', 'anthropic-compatible', 'claude-native', 'qoderclicn', 'cursor',
]);

const PANEL_RUNNERS_SET = new Set(PANEL_ELIGIBLE_RUNNERS);

// Runners with no local binary; availability is a configured endpoint, not an installed CLI.
const HTTP_RUNNERS = new Set(['anthropic-compatible']);

const VALID_ROLES = Object.freeze([
  'implementer', 'plan_reviewer', 'reviewer', 'consult', 'discuss',
]);

// Roles --resolve-live can resolve: the topology roles plus verification_author, whose
// standing pin must reach dispatch-author's strict-contract check. Kept apart from
// VALID_ROLES, which also seeds the default topology derivation (no new ladder there).
const LIVE_ROLES = Object.freeze([...VALID_ROLES, 'verification_author']);

const EFFORT_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
  // `default` = no effort sent, the endpoint's own default ran. Its real cost is unknown, so it
  // sorts AFTER every explicit effort (a cheapest-first ladder must not put an unknown cost
  // ahead of a known-cheap one). Must stay in step with scripts/lib/effort-scale.js.
  default: 6,
});

const CLAUDE_FALLBACK_LADDER = Object.freeze([
  'haiku/medium@claude-native',
  'sonnet/medium@claude-native',
]);

// A climb after a red result is a DECORRELATION problem, not a horsepower problem: the rung above
// a failed one shares the model, the tokenizer and most of the failure mode when it is the same
// family at the same cost tier, so re-dispatching there burns a repair round to learn nothing new.
//
// THE RULE (KR1): consecutive rungs may share a family ONLY when the effort strictly increases —
// a real within-vendor climb, where the label IS comparable. Same family at the same or lower rank
// is a no-op climb.
//
// WHY THIS IS A CONSTRUCTION AND NOT A POST-PASS. The plan (2026-09-08-family-aware-ladder-ordering
// §4 P2) specified tie-group family rotation plus a repair sweep. Implementing it showed the sweep
// spends decorrelation too early: it pulls the nearest different-family rung forward at the FIRST
// opportunity, even when the adjacency there was already legal, and then has nothing left for a
// later pair that genuinely needs it. On a real fixture (openai low, openai high x2, google high)
// the sweep produced one illegal adjacency where a legal ordering existed.
//
// So the ladder is built instead of repaired, one rung at a time, and the preference is the
// counter-intuitive one: when the next cheapest tier already outranks the last rung, take a
// SAME-family rung first. That adjacency is legal for free, and it saves the scarce
// different-family rungs for the ties where they are the only thing that can satisfy KR1.
//
// Cheapest-first is preserved exactly: every pick comes from the cheapest remaining rank tier, so
// the ordering only ever reshuffles within a tier. On a single-family host every pick is the
// same-family one and the ladder is byte-identical to the plain effort ordering.
function decorrelateAdjacent(ladder) {
  if (ladder.length < 2) return ladder.slice();
  const pool = ladder.slice();
  const rankOf = (r) => normalizeEffort(r.family, r.effort);
  const out = [pool.shift()];
  while (pool.length > 0) {
    const last = out[out.length - 1];
    const lastRank = rankOf(last);
    const tierRank = Math.min(...pool.map(rankOf));
    const inTier = (r) => rankOf(r) === tierRank;
    let pick;
    if (tierRank > lastRank) {
      // A same-family rung here is already a legal climb — spend it, keep the others.
      pick = pool.find((r) => inTier(r) && r.family === last.family);
    }
    if (!pick) pick = pool.find((r) => inTier(r) && r.family !== last.family);
    // Nothing decorrelated left in this tier: emit the cheapest and accept the repeat.
    if (!pick) pick = pool.find(inTier);
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}

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
  if (e.includes('grok') || e.includes('composer')) {
    return 'xai';
  }
  // Vendor names are checked before the generic model-line words: `MiniMax-M3.1-Flash-Preview`
  // contains `flash`, and `flash` alone is only a Gemini hint when no vendor name matched.
  if (e.includes('minimax') || e.includes('abab')) {
    return 'minimax';
  }
  if (e.includes('deepseek')) return 'deepseek';
  if (e.includes('longcat')) return 'meituan';
  if (e.includes('beam')) return 'reflection';
  if (e.includes('gemini') || e.includes('flash') || e.includes('bison')) {
    return 'google';
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
    '  --resolve-live           Resolve one role in memory; print preferred/effective tuple JSON; never writes\n' +
    '  --out <path>             Custom output file path (default: $AUTOPILOT_TOPOLOGY_FILE or ~/.autopilot/topology.json)\n' +
    '  --role <roles>           Comma-separated or repeatable role filter (implementer, plan_reviewer, reviewer, consult, discuss; default: all five). Required (exactly one) with --resolve-live\n' +
    '  --store <dir>            Capability store directory for pins.jsonl lookup (--resolve-live only; default: $ENGINE_CAPABILITY_DIR or ~/.autopilot/engine-capability)\n' +
    '  --exclude-seats <seats>  Comma-separated seats to exclude (engine/effort@runner, or a bare engine for every effort and runner);\n' +
    '                           unioned with topology.exclude_seats in the operator config (see below)\n' +
    '  --asking-family <family> Family name for consult/discuss ladder sorting (default: anthropic)\n' +
    '  -h, --help               Print this help message\n\n' +
    'Operator config (persistent exclusions, always applied, also by --check and --resolve-live):\n' +
    '  file: $AUTOPILOT_CONFIG_FILE or ~/.autopilot/config.json\n' +
    '  key:  { "topology": { "exclude_seats": ["gpt-5.6-sol/max@codex", "gpt-5.5-sol"] } }\n' +
    '  A missing file or key is no exclusions; unparseable JSON or a wrong shape exits 1.\n' +
    '  Exclusions apply to the ladders and the panel only; judge, claude_fallback_ladder and operator pins are not filtered (a pin wins in --resolve-live).\n' +
    '  claude-native seats (local claude CLI) are available for reviewer/consult/discuss/panel when `claude` is on PATH, never for the implementer ladder;\n' +
    '  the reviewer ladder lists anthropic-family seats after every other family.\n' +
    '  HTTP seats (anthropic-compatible) appear only when an AUTOPILOT_ENDPOINT_*_URL is in the environment at call time, so --check can differ between shells that did and did not load endpoints.env.\n'
  );
  process.exit(code);
}

function ladderKeyForRole(role) {
  if (role === 'plan_reviewer') return 'plan_review_panel';
  return `${role}_ladder`;
}

function tupleFromLadderRung(rung) {
  if (!rung || typeof rung !== 'object') {
    return { engine: null, runner: null, effort: null, endpoint: null };
  }
  const endpointRaw = rung.endpoint;
  // '' is the canonical "no named endpoint" partition ("@none" on the
  // capability-state side) and resolveEndpoint() already returns it, so the
  // topology seats carry ''. Coercing it to null here was drift: the contract's
  // --resolved-live validator requires a string, so an endpoint-less seat could
  // never complete the resolve-live -> check --resolved-live flow at all.
  const endpoint = (typeof endpointRaw === 'string' && endpointRaw.length > 0)
    ? endpointRaw
    : '';
  return {
    engine: rung.engine == null ? null : rung.engine,
    runner: rung.runner == null ? null : rung.runner,
    effort: rung.effort == null ? null : rung.effort,
    endpoint,
  };
}

function loadTopologyNoWrite(repoRoot, outPath, deriveOptions) {
  if (fs.existsSync(outPath)) {
    try {
      return JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (err) {
      process.stderr.write(`Topology file invalid JSON at ${outPath}: ${err.message}\n`);
      process.exit(1);
    }
  }
  return deriveTopology(repoRoot, deriveOptions);
}

// Read the active pin for a role via the existing pins verb — do not re-validate
// pin rows here (KR6 owns that in engine-capability-state.js).
function readPinForRole(repoRoot, role, storeArg) {
  const capScript = path.join(repoRoot, 'scripts', 'engine-capability-state.js');
  const args = [capScript, 'pins', '--role', role];
  if (storeArg) {
    args.push('--store', storeArg);
  }
  const res = spawnSync(process.execPath, args, {
    env: process.env,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    process.stderr.write(
      detail.length > 0
        ? `${detail}\n`
        : `pins lookup failed for role ${role} (exit ${res.status})\n`
    );
    process.exit(res.status || 1);
  }
  let rows;
  try {
    rows = JSON.parse((res.stdout || '').trim() || '[]');
  } catch (err) {
    process.stderr.write(`pins output invalid JSON: ${err.message}\n`);
    process.exit(1);
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

function resolveCapabilityStoreDir(storeArg) {
  if (storeArg) return path.resolve(storeArg);
  if (process.env.ENGINE_CAPABILITY_DIR) {
    return path.resolve(process.env.ENGINE_CAPABILITY_DIR);
  }
  return path.join(os.homedir(), '.autopilot', 'engine-capability');
}

function resolveLiveTuple(repoRoot, role, outPath, storeArg, deriveOptions) {
  const topology = loadTopologyNoWrite(repoRoot, outPath, deriveOptions);
  const ladderKey = ladderKeyForRole(role);
  const excludeSet = (deriveOptions && deriveOptions.excludeSet) || new Set();
  const ladder = (Array.isArray(topology[ladderKey]) ? topology[ladderKey] : [])
    .filter((r) => !(r && excludeSet.size > 0 && seatMatchesExcluded(r.engine, r.effort, r.runner, excludeSet)));
  const ladderTuple = tupleFromLadderRung(ladder[0]);

  const pin = readPinForRole(repoRoot, role, storeArg);
  let preferred_tuple;
  let effective_tuple;
  // Substitution when a pinned seat is unusable is a later deliverable (P4).
  // P3 only names the reason; effective_tuple may still equal preferred_tuple.
  let substitution_reason = null;

  if (pin) {
    // A pin recorded without --endpoint stores `endpoint: null`. The tuple convention (and
    // dispatch-contract.js's --resolved-live validator) is '' for "no named endpoint" — null
    // was refused as `endpoint must be a string when present`, so a pinned seat with no
    // endpoint could never be admitted through this document (2026-09-13, sixth vacuity in
    // the operator-pin family: the shipped pin row could not pass the shipped checker).
    preferred_tuple = {
      engine: pin.engine,
      runner: pin.runner,
      effort: typeof pin.effort === 'string' ? pin.effort : undefined,
      endpoint: typeof pin.endpoint === 'string' ? pin.endpoint : '',
    };
    effective_tuple = {
      engine: preferred_tuple.engine,
      runner: preferred_tuple.runner,
      effort: preferred_tuple.effort,
      endpoint: preferred_tuple.endpoint,
    };
  } else {
    preferred_tuple = ladderTuple;
    effective_tuple = {
      engine: ladderTuple.engine,
      runner: ladderTuple.runner,
      effort: ladderTuple.effort,
      endpoint: ladderTuple.endpoint,
    };
  }

  // KR7: pending_revocation is a projection of the SAME fold admission uses.
  // Never open the strike store here — call into engine-scorecard.js.
  const scorecard = require(path.join(repoRoot, 'scripts', 'engine-scorecard.js'));
  const storeDir = resolveCapabilityStoreDir(storeArg);
  const effort = preferred_tuple && typeof preferred_tuple.effort === 'string'
    ? preferred_tuple.effort
    : undefined;
  const seatFold = scorecard.computeSeatProjection(
    preferred_tuple.engine,
    preferred_tuple.runner,
    role,
    Date.now(),
    effort,
    storeDir,
  );
  const pending_revocation = Array.isArray(seatFold.active_strike_rows)
    ? seatFold.active_strike_rows
    : [];

  if (pin && seatFold.projection && seatFold.projection.critical_trigger) {
    substitution_reason = 'critical_strike';
  }

  return {
    role,
    // The pin ROW as read, or null. The contract may not infer "a pin exists"
    // from preferred_tuple: the resolver emits a preferred_tuple either way
    // (unpinned, it is the ladder's own choice), so tuple equality is not pin
    // evidence. Emitting the row makes pin presence an explicit fact the
    // consumer can require, and lets it verify preferred_tuple was DERIVED
    // from the pin rather than merely equal to it.
    operator_pin: pin ? { ...pin } : null,
    preferred_tuple,
    effective_tuple,
    substitution_reason,
    pending_revocation,
  };
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

  // `runner-binary.js binary --runner <r>` is a pure map lookup (versionBinaryFor); call it
  // in-process instead of one node start per runner token. The CLI stays the fallback if the
  // module cannot be loaded here.
  let versionBinaryFor = null;
  try {
    ({ versionBinaryFor } = require(runnerBinaryScript));
  } catch {
    versionBinaryFor = null;
  }
  for (const r of [...RUNNER_TOKENS, ...NON_IMPLEMENTER_RUNNERS]) {
    let binaryName = null;
    if (typeof versionBinaryFor === 'function') {
      const binary = versionBinaryFor(r);
      binaryName = binary === null ? null : String(binary).trim();
    } else {
      const res = spawnSync(process.execPath, [runnerBinaryScript, 'binary', '--runner', r], {
        env: process.env,
        encoding: 'utf8',
      });
      binaryName = res.status === 0 ? (res.stdout || '').trim() : null;
    }
    installed[r] = binaryName === null ? null : resolveBinaryPath(binaryName, r);
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

// One resolve-review-loop.sh run for all three judge fields (was one full run — ~0.7s — per
// field). Up to its `--field` block the script takes the same path with or without --field
// and exits with the same code, so a failing status means every field would have been null.
// If the JSON is unreadable or lacks a field, fall back to the per-field calls.
function resolveJudgeFields(repoRoot) {
  const scriptPath = path.join(repoRoot, 'scripts', 'resolve-review-loop.sh');
  const res = spawnSync('bash', [scriptPath], { env: process.env, encoding: 'utf8' });
  if (res.error) return null;
  if (res.status !== 0) {
    return { reviewer_engine: null, reviewer_runner: null, reviewer_effort: null };
  }
  let doc;
  try { doc = JSON.parse(res.stdout); } catch { return null; }
  const out = {};
  for (const key of ['reviewer_engine', 'reviewer_runner', 'reviewer_effort']) {
    if (!doc || typeof doc[key] !== 'string') return null;
    const val = doc[key].trim();
    out[key] = val.length > 0 ? val : null;
  }
  return out;
}

function getJudge(repoRoot) {
  try {
    const all = resolveJudgeFields(repoRoot);
    const engine = all ? all.reviewer_engine : resolveJudgeField(repoRoot, 'reviewer_engine');
    const runner = all ? all.reviewer_runner : resolveJudgeField(repoRoot, 'reviewer_runner');
    const effort = all ? all.reviewer_effort : resolveJudgeField(repoRoot, 'reviewer_effort');
    if (engine === null || runner === null || effort === null) {
      return { reviewer_engine: null, reviewer_runner: null, reviewer_effort: null };
    }
    return { reviewer_engine: engine, reviewer_runner: runner, reviewer_effort: effort };
  } catch {
    return { reviewer_engine: null, reviewer_runner: null, reviewer_effort: null };
  }
}

// BL-0229: a recorded qoderclicn model can be retired by the vendor while the scorecard still
// holds it as qualified; a dispatch then dies with exit 3 and no output. Validate the engine against
// the runner's own `--list-models` at derivation time and drop a seat the runner no longer offers.
// FAIL-OPEN: a missing binary, timeout, non-zero exit or an empty/unparseable listing keeps the
// seat (offline hosts must not lose their topology); only a successfully parsed listing that
// lacks the engine removes it, with a stderr warning. Case-insensitive full-token equality.
const MODEL_LIST_RUNNERS = new Set(['qoderclicn']);
const modelInventoryCache = new Map();

function runnerModelInventory(binPath) {
  if (modelInventoryCache.has(binPath)) return modelInventoryCache.get(binPath);
  let inventory = null;
  try {
    const res = spawnSync(binPath, ['--list-models'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (!res.error && res.status === 0) {
      const ids = new Set();
      for (const line of String(res.stdout || '').split('\n')) {
        const tok = line.trim().split(/\s+/)[0];
        if (tok) ids.add(tok.toLowerCase());
      }
      ids.delete('model');
      if (ids.size > 0) inventory = ids;
    }
  } catch {
    inventory = null;
  }
  modelInventoryCache.set(binPath, inventory);
  return inventory;
}

function seatModelRetired(runner, engine, binPath) {
  if (!MODEL_LIST_RUNNERS.has(runner) || !binPath) return false;
  const inventory = runnerModelInventory(binPath);
  if (!inventory) return false;
  if (inventory.has(String(engine).toLowerCase())) return false;
  process.stderr.write(`resolve-dispatch-topology: dropping ${engine}@${runner}: model not in \`${path.basename(binPath)} --list-models\` (retired?)\n`);
  return true;
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

    // A seat is usable only if its runner is installed. HTTP runners have no binary to find
    // (`anthropic-compatible` drives dispatch-anthropic-review.js over HTTP), so they are usable
    // when an endpoint for the engine is configured in the environment.
    if (HTTP_RUNNERS.has(runner)) {
      if (!resolveEndpoint(engine, runner)) continue;
    } else if (!runnersInstalled[runner]) continue;
    if (seatModelRetired(runner, engine, runnersInstalled[runner])) continue;

    // Query scorecard status with the row's runner token (or normalized).
    // When effort is empty/null, omit --effort to query the legacy partition.
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
    const emittedEffort = effort || 'high';

    const seatObj = {
      engine,
      effort: emittedEffort,
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
      effort: emittedEffort,
      runner,
    };
    if (baselineEventId !== undefined) {
      legacyRungObj.baseline_event_id = baselineEventId;
    }

    qualified.push({
      engine,
      effort: effort || '',
      emittedEffort,
      runner,
      family,
      latency: rowLatency,
      costRank,
      eventId: c.event_id,
      seatObj,
      legacyRungObj,
    });
  }

  return dedupeSeats(qualified);
}

// `scorecard current` returns one row per qualification event, so a seat qualified under two
// corpus versions (v4 and v6) arrives twice and both pass seat-status. One dispatch identity
// (engine + effort + normalized runner) is one rung. Keep the row with the latest baseline
// event, then the latest row event, so the surviving baseline_event_id is the newest qualified one.
function dedupeSeats(seats) {
  const evOf = (s) => (typeof s.seatObj.baseline_event_id === 'number' ? s.seatObj.baseline_event_id : -1);
  const rank = (s) => [evOf(s), typeof s.eventId === 'number' ? s.eventId : -1];
  const best = new Map();
  const order = [];
  for (const s of seats) {
    const key = `${s.engine}\u0000${s.emittedEffort}\u0000${s.runner}`;
    const cur = best.get(key);
    if (!cur) { best.set(key, s); order.push(key); continue; }
    const [a1, a2] = rank(s);
    const [b1, b2] = rank(cur);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best.set(key, s);
  }
  return order.map((k) => best.get(k));
}

// Operator-owned persistent exclusions: `topology.exclude_seats` in the operator config.
// A missing file or missing key means no exclusions. A file that exists but cannot be parsed,
// or a key of the wrong shape, is a hard error: silently ignoring it would revive retired
// seats on the next regeneration, which is the failure this list exists to prevent.
function loadOperatorExcludeSeats() {
  const file = configPath();
  if (!fs.existsSync(file)) return [];
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`Operator config unreadable at ${file}: ${err.message}\n`);
    process.exit(1);
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    process.stderr.write(`Operator config at ${file} must be a JSON object\n`);
    process.exit(1);
  }
  if (cfg.topology === undefined) return [];
  if (!cfg.topology || typeof cfg.topology !== 'object' || Array.isArray(cfg.topology)) {
    process.stderr.write(`Operator config ${file}: "topology" must be an object\n`);
    process.exit(1);
  }
  const list = cfg.topology.exclude_seats;
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.some((x) => typeof x !== 'string' || x.trim() === '')) {
    process.stderr.write(`Operator config ${file}: "topology.exclude_seats" must be an array of non-empty strings\n`);
    process.exit(1);
  }
  return list.map((x) => x.trim());
}

function addExcludeEntry(excludeSet, entry) {
  excludeSet.add(entry);
  const atIdx = entry.indexOf('@');
  if (atIdx !== -1) {
    const prefix = entry.slice(0, atIdx);
    const normR = normalizeRunner(entry.slice(atIdx + 1));
    excludeSet.add(`${prefix}@${normR}`);
  }
}

function seatMatchesExcluded(engine, effort, runner, excludeSet) {
  // A bare engine entry (no `/effort`, no `@runner`) retires the model at every effort and runner.
  if (excludeSet.has(engine)) return true;
  const normRunner = normalizeRunner(runner);
  const defaultedEffort = effort || 'high';
  const emittedTuple = `${engine}/${defaultedEffort}@${normRunner}`;
  const rawTuple = `${engine}/${defaultedEffort}@${runner}`;
  const legacyNormTuple = `${engine}@${normRunner}`;
  const legacyRawTuple = `${engine}@${runner}`;
  return (
    excludeSet.has(emittedTuple) ||
    excludeSet.has(rawTuple) ||
    excludeSet.has(legacyNormTuple) ||
    excludeSet.has(legacyRawTuple)
  );
}

// Local price cache, read once per process; null when absent/invalid (ordering then unchanged).
let priceIndexMemo;
function priceIndex() {
  if (priceIndexMemo === undefined) {
    try {
      const cache = require('./lib/qualification-prices.js').readCache();
      priceIndexMemo = cache ? cache.index : null;
    } catch {
      priceIndexMemo = null;
    }
  }
  return priceIndexMemo;
}

// Seat price for the ladder sort: micro-USD per Mtok, Infinity when unknown. The seat's model id
// is the scorecard row's `model` when present, else its `engine`.
function priceValueOf(candidate, engine, origRunner, runner) {
  const index = priceIndex();
  if (!index) return Infinity;
  const prices = require('./lib/qualification-prices.js');
  const model = typeof candidate.model === 'string' && candidate.model ? candidate.model : engine;
  for (const r of [origRunner, runner]) {
    const v = prices.sortValue(index, { engine, runner: r, model });
    if (v !== Infinity) return v;
  }
  return Infinity;
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
      if (seatModelRetired(runner, engine, runnersInstalled[runner])) continue;
      // claude-native is an implementer runner (dispatch-hetero --runner claude-native) only behind the one-time
      // owner confirmation, so the implementer ladder never auto-selects it; review/consult/discuss still use it.
      if (NON_IMPLEMENTER_RUNNERS.includes(runner)) continue;

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

      // Legacy (pre-effort-partition) scorecard rows carry no effort. The emitted
      // rung keeps the `engine@runner` name so the seat stays traceable to its
      // legacy partition, but `effort` is defaulted to 'high' — the same rule the
      // reviewer/consult/discuss path applies (see emittedEffort above). An empty
      // effort is not in the review-loop contract's implementer_effort enum, so
      // '' here made resolve-review-loop.sh's `implementer_ladder: auto` output fail
      // validation on every host with a legacy seat (2026-09-07).
      const emittedEffort = effort || 'high';
      const rungName = effort ? `${engine}/${effort}@${runner}` : `${engine}@${runner}`;
      // family is attached here (producer-side only) via the SAME familyOf() helper
      // and value the reviewer/consult/discuss path uses for this engine. Effort is
      // not comparable cross-family — vendors document "low"/"medium"/etc.
      // differently and prompt style varies by family — so anything that wants to
      // reason per-family (rather than by the single cross-family EFFORT_RANK this
      // file sorts on today) needs the field to exist on the rung first. This does
      // NOT change ordering, and the review-loop contract / `implementer_ladder:
      // auto` reader intentionally still projects rungs down to
      // {engine, effort, runner} and must keep doing so — plumbing family through
      // that path is a separate, later change.
      const rungObj = {
        rung: rungName,
        engine,
        effort: emittedEffort,
        runner,
        family: familyOf(engine),
      };
      if (baselineEventId !== undefined) {
        rungObj.baseline_event_id = baselineEventId;
      }

      const seatKey = `${engine}\u0000${emittedEffort}\u0000${runner}`;

      qualifiedSeats.push({
        rungObj,
        seatKey,
        effort: effort || '',
        latency: rowLatency,
        engine,
        runner,
        priceValue: priceValueOf(c, engine, origRunner, runner),
      });
    }

    // Rank by the EMITTED effort so a legacy seat (emitted 'high') sits among the
    // other 'high' rungs, never above 'xhigh'/'max' — the ladder is climbed
    // top-down on red repairs and a legacy rung that sorted last would turn an
    // escalation into a de-escalation. Legacy sorts after explicit at the same
    // effort so the exact-tuple seat wins the dedupe below.
    qualifiedSeats.sort((a, b) => {
      const rankA = normalizeEffort(a.rungObj.family, a.rungObj.effort);
      const rankB = normalizeEffort(b.rungObj.family, b.rungObj.effort);
      if (rankA !== rankB) return rankA - rankB;
      if (a.priceValue !== b.priceValue) return a.priceValue - b.priceValue; // Infinity (unknown) last
      const legacyA = a.effort ? 0 : 1;
      const legacyB = b.effort ? 0 : 1;
      if (legacyA !== legacyB) return legacyA - legacyB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.engine.localeCompare(b.engine);
    });

    // Two scorecard rows can resolve to the same dispatch identity: a superseded
    // legacy row and its successor both still `current`, or a legacy no-effort
    // seat (emitted as 'high') next to an explicit `/high` seat. One identity is
    // one rung — a duplicate would just re-dispatch the same implementer on climb.
    // Dedupe AFTER the sort so the explicit-effort (exact-tuple) seat wins over
    // the legacy one, which sorts last.
    const seenSeats = new Set();
    let implementerLadder = qualifiedSeats
      .filter((s) => (seenSeats.has(s.seatKey) ? false : (seenSeats.add(s.seatKey), true)))
      .map((s) => s.rungObj);
    if (excludeSet.size > 0) {
      implementerLadder = implementerLadder.filter(
        (r) => !seatMatchesExcluded(r.engine, r.effort, r.runner, excludeSet)
      );
    }
    implementerLadder = decorrelateAdjacent(implementerLadder);

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
      // depth-0 is usually Claude, so an anthropic reviewer is the least decorrelated one: all other
      // families first, anthropic seats after them (stable; effort/latency order holds inside each group).
      const famA = a.family === 'anthropic' ? 1 : 0;
      const famB = b.family === 'anthropic' ? 1 : 0;
      if (famA !== famB) return famA - famB;
      // In ordering: empty effort ranks below every explicit effort (sorts last)
      const rankA = a.effort ? (EFFORT_RANK[a.effort] ?? 99) : 999;
      const rankB = b.effort ? (EFFORT_RANK[b.effort] ?? 99) : 999;
      if (rankA !== rankB) return rankA - rankB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.engine.localeCompare(b.engine);
    });
    let ladder = seats.map((s) => ({ ...s.seatObj, effort: s.emittedEffort }));
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
      // An originally-empty effort ranks below every explicit effort
      // `default` (no effort sent, endpoint default ran, cost unknown) is not a measured explicit effort,
      // so it ties with the empty/legacy effort at rank 1 and sorts after every explicit one.
      const explicitEffort = (s) => (s.effort && s.effort !== 'default' ? 0 : 1);
      const rankA = explicitEffort(a);
      const rankB = explicitEffort(b);
      if (rankA !== rankB) return rankA - rankB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      if (a.costRank !== b.costRank) return a.costRank - b.costRank;
      return a.engine.localeCompare(b.engine);
    });
    return seats;
  }

  if (roles.has('consult')) {
    const seats = [...getConsultQualified()];
    sortConsultDiscuss(seats);
    let ladder = seats.map((s) => ({ ...s.seatObj, effort: s.emittedEffort }));
    if (excludeSet.size > 0) {
      ladder = ladder.filter((s) => !seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet));
    }
    out.consult_ladder = ladder;
  }

  if (roles.has('discuss')) {
    const seats = [...getQualifiedSeatsForRole(repoRoot, 'discuss', runnersInstalled)];
    sortConsultDiscuss(seats);
    let ladder = seats.map((s) => ({ ...s.seatObj, effort: s.emittedEffort }));
    if (excludeSet.size > 0) {
      ladder = ladder.filter((s) => !seatMatchesExcluded(s.engine, s.effort, s.runner, excludeSet));
    }
    out.discuss_ladder = ladder;
  }

  if (roles.has('plan_reviewer')) {
    // Chair candidates: qualified reviewer-role rows only, eligible runners only, not excluded
    const chairCandidates = getReviewerQualified().filter((s) => {
      if (!PANEL_RUNNERS_SET.has(s.runner)) return false;
      if (seatMatchesExcluded(s.engine, s.emittedEffort, s.runner, excludeSet)) return false;
      return true;
    });

    function comparePanelCandidates(a, b) {
      // In panel ordering: highest effort rank first.
      // An originally-empty effort ranks below every explicit effort, so rank 0 ensures it sorts last
      // and never becomes chair over any explicit effort.
      // EFFORT_RANK is ASCENDING (default = 6, last); this comparator is DESCENDING, so `default`
      // (unknown cost) must be pinned below every explicit effort here or it would chair the panel.
      const chairRank = (s) => (s.effort === 'default' ? 0 : s.effort ? (EFFORT_RANK[s.effort] || 0) : -1);
      const rankA = chairRank(a);
      const rankB = chairRank(b);
      if (rankA !== rankB) return rankB - rankA; // highest effort rank first
      // At equal effort an anthropic seat (the depth-0 family) never chairs ahead of another family.
      const famA = a.family === 'anthropic' ? 1 : 0;
      const famB = b.family === 'anthropic' ? 1 : 0;
      if (famA !== famB) return famA - famB;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.engine.localeCompare(b.engine);
    }

    chairCandidates.sort(comparePanelCandidates);

    const panel = [];
    const usedFamilies = new Set();

    if (chairCandidates.length > 0) {
      const chair = chairCandidates[0];
      panel.push({ ...chair.seatObj, effort: chair.emittedEffort, role_source: 'reviewer' });
      usedFamilies.add(chair.family);
    }

    // Non-chair candidate pool: union of reviewer-role and consult-role rows
    const nonChairCandidates = [...getReviewerQualified(), ...getConsultQualified()].filter((s) => {
      if (!PANEL_RUNNERS_SET.has(s.runner)) return false;
      if (seatMatchesExcluded(s.engine, s.emittedEffort, s.runner, excludeSet)) return false;
      return true;
    });

    nonChairCandidates.sort(comparePanelCandidates);

    for (const cand of nonChairCandidates) {
      if (panel.length >= 3) break;
      if (usedFamilies.has(cand.family)) continue;
      panel.push({ ...cand.seatObj, effort: cand.emittedEffort });
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
  let isResolveLive = false;
  let outArg = null;
  let storeArg = null;
  let roleArgs = [];
  let excludeSeatsArg = null;
  let askingFamily = 'anthropic';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      asJson = true;
    } else if (arg === '--check') {
      isCheck = true;
    } else if (arg === '--resolve-live') {
      isResolveLive = true;
    } else if (arg === '--out') {
      if (i + 1 >= argv.length) usage(2);
      outArg = argv[i + 1];
      i += 1;
    } else if (arg === '--store') {
      if (i + 1 >= argv.length) usage(2);
      storeArg = argv[i + 1];
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

  // Defect 1: --store only means anything with --resolve-live. Reject it BEFORE
  // entering any legacy branch (isCheck, or the unconditional-write path) so no
  // file is written on the way to the error.
  if (storeArg && !isResolveLive) {
    process.stderr.write('--store is only valid with --resolve-live\n');
    process.exit(2);
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
    for (const p of excludeSeatsArg.split(',').map((x) => x.trim()).filter(Boolean)) {
      addExcludeEntry(excludeSet, p);
    }
  }
  for (const p of loadOperatorExcludeSeats()) addExcludeEntry(excludeSet, p);

  const repoRoot = path.resolve(__dirname, '..');
  const outPath = resolveOutputPath(outArg);
  const deriveOptions = {
    roles: selectedRoles,
    excludeSet,
    askingFamily,
  };

  // KR10 no-write live resolution: must return BEFORE the unconditional write below.
  if (isResolveLive) {
    if (roleArgs.length === 0) {
      process.stderr.write('--resolve-live requires --role\n');
      process.exit(2);
    }
    const liveRoles = [];
    for (const rArg of roleArgs) {
      const parts = rArg.split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of parts) liveRoles.push(p);
    }
    if (liveRoles.length !== 1) {
      process.stderr.write('--resolve-live requires exactly one --role\n');
      process.exit(2);
    }
    const liveRole = liveRoles[0];
    if (!LIVE_ROLES.includes(liveRole)) {
      process.stderr.write(
        `Invalid --role for --resolve-live: ${liveRole} (expected one of ${LIVE_ROLES.join(', ')})\n`
      );
      process.exit(2);
    }
    const liveDeriveOptions = {
      roles: new Set([liveRole]),
      excludeSet,
      askingFamily,
    };
    const result = resolveLiveTuple(repoRoot, liveRole, outPath, storeArg, liveDeriveOptions);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    // Defect 3: no process.exit(0) here — let main() return so Node drains the
    // stdout write before the process exits. On a pipe, an immediate exit()
    // can discard a still-pending write; returning normally lets libuv flush.
    return;
  }

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
