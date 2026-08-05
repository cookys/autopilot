#!/usr/bin/env node
'use strict';

/**
 * D6 benchmark driver for the opt-in hook multiplexer.
 *
 * Every sample is run from a detached checkout of the requested Git commit.
 * The report therefore contains measurements of the frozen base and candidate,
 * rather than two labels applied to the current checkout.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function usage(code) {
  process.stderr.write(
    'usage: benchmark-hook-multiplexer.js --base <sha> --candidate <sha> '
    + '--fixtures <json> --warmups N --repetitions N --report <out>\n',
  );
  process.exit(code);
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1];
}

const baseRef = arg('--base');
const candidateRef = arg('--candidate');
const fixturesArg = arg('--fixtures');
const warmups = Number.parseInt(arg('--warmups', '2'), 10);
const repetitions = Number.parseInt(arg('--repetitions', '10'), 10);
const reportPath = arg('--report');
if (!baseRef || !candidateRef || !fixturesArg || !reportPath) usage(2);
if (!Number.isSafeInteger(warmups) || warmups < 0
  || !Number.isSafeInteger(repetitions) || repetitions < 1) {
  process.stderr.write('warmups must be >= 0 and repetitions must be >= 1\n');
  process.exit(2);
}

const repo = path.resolve(__dirname, '..');
const fixturesPath = path.resolve(fixturesArg);
let traceSequence = 0;

function runGit(args) {
  return spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

function resolveCommit(ref, label) {
  const result = runGit(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (result.status !== 0) {
    throw new Error(`${label} ref does not resolve: ${ref}`);
  }
  return String(result.stdout || '').trim();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function mad(values, median) {
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return percentile(deviations, 50);
}

function fixturePayload(fixture) {
  return JSON.stringify({
    hook_event_name: fixture.event,
    tool_name: fixture.event === 'Stop' ? '' : fixture.event === 'PostToolUse' ? 'Write' : 'Bash',
    tool_input: { command: 'true' },
  });
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function matcherHits(matcher, toolName) {
  if (!matcher || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName || '');
  } catch (_error) {
    return false;
  }
}

function registrations(checkout, fixture, payload) {
  const hooksPath = path.join(checkout, 'hooks', 'hooks.json');
  const hooksDoc = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const manifestPath = path.join(checkout, 'hooks', 'opt-in-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const optIn = new Set(manifest.opt_in || []);
  const toolName = JSON.parse(payload).tool_name || '';
  const groups = hooksDoc.hooks && hooksDoc.hooks[fixture.event];
  if (!Array.isArray(groups)) return [];
  const direct = [];
  for (const group of groups) {
    if (!matcherHits(group.matcher, toolName)) continue;
    for (const hook of group.hooks || []) {
      if (typeof hook.command !== 'string') continue;
      const match = hook.command.match(/hooks\/([^/]+\.js)(?:\s+(.*))?$/);
      if (!match) continue;
      const scriptName = match[1];
      const stem = scriptName.slice(0, -3);
      if (scriptName === 'opt-in-multiplexer.js') {
        direct.push({ scriptName, args: (match[2] || '').trim().split(/\s+/).filter(Boolean) });
      } else if (optIn.has(stem)) {
        if (!matcherHits(group.matcher, toolName)) continue;
        direct.push({ scriptName, args: (match[2] || '').trim().split(/\s+/).filter(Boolean) });
      }
    }
  }
  return direct;
}

function runFixture(fixture, checkout, home) {
  const payload = fixturePayload(fixture);
  const actualPayloadSha = payloadHash(payload);
  if (fixture.payload_sha256 !== actualPayloadSha) {
    throw new Error(`${fixture.id}: fixture payload_sha256 does not match generated payload`);
  }

  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: checkout,
    HOME: home,
  };
  // The isolated HOME has no user config. Explicitly zero every manifest stem
  // so enabled/disabled semantics cannot be inherited from the caller.
  const manifest = JSON.parse(fs.readFileSync(path.join(checkout, 'hooks', 'opt-in-manifest.json'), 'utf8'));
  for (const stem of (manifest.opt_in || [])) {
    const key = `AUTOPILOT_HOOK_${stem.replace(/-/g, '_').toUpperCase()}`;
    env[key] = '0';
  }
  for (const stem of (fixture.enabled_hook_ids || [])) {
    const key = `AUTOPILOT_HOOK_${stem.replace(/-/g, '_').toUpperCase()}`;
    env[key] = fixture.enabled === true ? '1' : '0';
  }
  const commands = registrations(checkout, fixture, payload);
  const traceFile = path.join(os.tmpdir(), `hook-mux-trace-${process.pid}-${traceSequence++}.json`);
  const traceModule = path.join(os.tmpdir(), `hook-mux-trace-${process.pid}-${traceSequence++}.cjs`);
  fs.writeFileSync(traceModule, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const childProcess = require('child_process');",
    "if (process.argv.some((arg) => /opt-in-multiplexer\\.js$/.test(String(arg)))) {",
    "  let count = 0;",
    "  const original = childProcess.spawnSync;",
    "  childProcess.spawnSync = function tracedSpawnSync(command, args, options) {",
    "    if (Array.isArray(args)) count += 1;",
    "    return original.call(this, command, args, options);",
    "  };",
    "  process.on('exit', () => { try { fs.writeFileSync(process.env.AUTOPILOT_HOOK_BENCHMARK_TRACE_FILE, JSON.stringify({ count })); } catch (_) {} });",
    "}",
  ].join('\n'));
  env.AUTOPILOT_HOOK_BENCHMARK_TRACE_FILE = traceFile;
  const priorNodeOptions = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : '';
  env.NODE_OPTIONS = `${priorNodeOptions}--require=${traceModule}`;
  const started = process.hrtime.bigint();
  const statuses = [];
  try {
    for (const command of commands) {
      const child = spawnSync(
        process.execPath,
        [path.join(checkout, 'hooks', command.scriptName), ...command.args],
        { input: payload, env, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
      );
      if (child.error) throw new Error(`${fixture.id}: hook failed: ${child.error.message}`);
      statuses.push(typeof child.status === 'number' ? child.status : 1);
    }
  } finally {
    // Direct registrations do not contain nested multiplexer children. The
    // candidate's trace is the authoritative count of children it spawned.
    const trace = fs.existsSync(traceFile)
      ? JSON.parse(fs.readFileSync(traceFile, 'utf8')) : { count: 0 };
    fs.rmSync(traceFile, { force: true });
    fs.rmSync(traceModule, { force: true });
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    runFixture.lastTrace = { elapsed, trace, statuses, commands };
  }
  const { elapsed, trace } = runFixture.lastTrace;
  delete runFixture.lastTrace;
  return {
    ms: elapsed,
    status: statuses.every((status) => status === 0) ? 0 : (statuses.find((status) => status !== 0) || 1),
    processes_started: commands.length,
    // Direct registrations have no nested multiplexer children; the candidate
    // trace records actual child hook spawns (including zero when disabled).
    children: commands.some((command) => command.scriptName === 'opt-in-multiplexer.js')
      ? trace.count : 0,
    payload_sha256: actualPayloadSha,
  };
}

function summarize(fixture, samples) {
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const median = percentile(times, 50);
  const p95 = percentile(times, 95);
  return {
    samples: times.length,
    median_ms: median,
    p95_ms: p95,
    mad_ms: mad(times, median),
    mad_median_ratio: median > 0 ? mad(times, median) / median : 0,
    observed_child_count: samples[0].children,
    expected_child_count: fixture.expected_child_count,
    payload_sha256: samples[0].payload_sha256,
    processes_started: samples[0].processes_started,
    process_count_consistent: samples.every((sample) => sample.processes_started === samples[0].processes_started),
    nonzero_statuses: samples.filter((sample) => sample.status !== 0).length,
  };
}

function benchmarkFixture(fixture, checkouts, homes) {
  // Warm both trees and then collect paired samples. Alternating which tree
  // runs first prevents a blocked base-then-candidate sequence from turning
  // host load, thermal state, or background work into a false ratio.
  const warmupOrders = [];
  for (let i = 0; i < warmups; i += 1) {
    const order = i % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    warmupOrders.push(order);
    runFixture(fixture, order[0] === 'baseline' ? checkouts.base : checkouts.candidate,
      order[0] === 'baseline' ? homes.base : homes.candidate);
    runFixture(fixture, order[1] === 'baseline' ? checkouts.base : checkouts.candidate,
      order[1] === 'baseline' ? homes.base : homes.candidate);
  }
  const baselineSamples = [];
  const candidateSamples = [];
  const repetitionOrders = [];
  for (let i = 0; i < repetitions; i += 1) {
    const order = i % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    repetitionOrders.push(order);
    const first = runFixture(fixture, order[0] === 'baseline' ? checkouts.base : checkouts.candidate,
      order[0] === 'baseline' ? homes.base : homes.candidate);
    const second = runFixture(fixture, order[1] === 'baseline' ? checkouts.base : checkouts.candidate,
      order[1] === 'baseline' ? homes.base : homes.candidate);
    if (order[0] === 'baseline') {
      baselineSamples.push(first);
      candidateSamples.push(second);
    } else {
      candidateSamples.push(first);
      baselineSamples.push(second);
    }
  }
  return {
    baseline: summarize(fixture, baselineSamples),
    candidate: summarize(fixture, candidateSamples),
    sampling: {
      strategy: 'alternating-paired',
      warmups: warmupOrders,
      repetitions: repetitionOrders,
    },
  };
}

const baseSha = resolveCommit(baseRef, 'base');
const candidateSha = resolveCommit(candidateRef, 'candidate');
if (baseSha === candidateSha) {
  process.stderr.write('base and candidate refs must resolve to distinct commits\n');
  process.exit(2);
}

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
if (!Array.isArray(fixtures.fixtures) || fixtures.fixtures.length === 0) {
  throw new Error('fixtures must contain a non-empty fixtures array');
}
const fixturesSha = crypto.createHash('sha256').update(fs.readFileSync(fixturesPath)).digest('hex');
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-multiplexer-benchmark-'));

function checkout(sha, label) {
  const directory = path.join(scratchRoot, label);
  const clone = spawnSync('git', ['clone', '--local', repo, directory], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (clone.status !== 0) throw new Error(`${label} checkout clone failed`);
  const detached = spawnSync('git', ['-C', directory, 'checkout', '--detach', '-q', sha], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (detached.status !== 0) throw new Error(`${label} checkout failed: ${sha}`);
  return directory;
}

let report;
try {
  const baseCheckout = checkout(baseSha, 'base');
  const candidateCheckout = checkout(candidateSha, 'candidate');
  const baseHome = fs.mkdtempSync(path.join(scratchRoot, 'home-base-'));
  const candidateHome = fs.mkdtempSync(path.join(scratchRoot, 'home-candidate-'));
  const results = fixtures.fixtures.map((fixture) => {
    const paired = benchmarkFixture(
      fixture,
      { base: baseCheckout, candidate: candidateCheckout },
      { base: baseHome, candidate: candidateHome },
    );
    const baseline = paired.baseline;
    const candidateResult = paired.candidate;
    return {
      id: fixture.id,
      event: fixture.event,
      mode: fixture.mode,
      enabled: fixture.enabled === true,
      expected_child_count: fixture.expected_child_count,
      baseline,
      candidate: candidateResult,
      sampling: paired.sampling,
      ratios: {
        median: baseline.median_ms > 0
          ? candidateResult.median_ms / baseline.median_ms : null,
        p95: baseline.p95_ms > 0
          ? candidateResult.p95_ms / baseline.p95_ms : null,
      },
    };
  });

  report = {
    schema_version: 1,
    runtime: process.version,
    base_ref: baseRef,
    candidate_ref: candidateRef,
    base_sha: baseSha,
    candidate_sha: candidateSha,
    fixtures_path: path.relative(repo, fixturesPath),
    fixtures_sha256: fixturesSha,
    warmups,
    repetitions,
    results,
    generated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `wrote ${reportPath} base=${baseSha} candidate=${candidateSha} `
    + `fixtures=${results.length}\n`,
  );
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}
