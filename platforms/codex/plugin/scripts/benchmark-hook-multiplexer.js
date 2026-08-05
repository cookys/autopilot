#!/usr/bin/env node
'use strict';

/**
 * D6 benchmark driver for the opt-in hook multiplexer.
 * Compares base vs candidate latency using committed fixtures.
 * Default mode is synthetic (no live Claude Code): measures multiplexer
 * child-spawn counts and wall times against fixtures.
 */

const fs = require('fs');
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

const base = arg('--base', 'unknown');
const candidate = arg('--candidate', 'unknown');
const fixturesPath = arg('--fixtures');
const warmups = parseInt(arg('--warmups', '2'), 10);
const reps = parseInt(arg('--repetitions', '10'), 10);
const reportPath = arg('--report');
if (!fixturesPath || !reportPath) usage(2);

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const repo = path.resolve(__dirname, '..');
const mux = path.join(repo, 'hooks', 'opt-in-multiplexer.js');

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function mad(values, median) {
  const devs = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return percentile(devs, 50);
}

function runFixture(fx, enabled) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: repo, HOME: process.env.HOME };
  // Force enable/disable via env for the stems under test.
  for (const stem of (fx.enabled_hook_ids || [])) {
    const key = `AUTOPILOT_HOOK_${stem.replace(/-/g, '_').toUpperCase()}`;
    env[key] = enabled ? '1' : '0';
  }
  const payload = JSON.stringify({
    hook_event_name: fx.event,
    tool_name: fx.event === 'Stop' ? '' : 'Bash',
    tool_input: { command: 'true' },
  });
  const payloadSha = crypto.createHash('sha256').update(payload).digest('hex');
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [mux, fx.event], {
    input: payload,
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  return {
    ms,
    status: r.status,
    payload_sha256: payloadSha,
    // Multiplexer does not spawn children when disabled; enabled count is best-effort.
    children: enabled ? (fx.enabled_hook_ids || []).length : 0,
  };
}

const results = [];
for (const fx of fixtures.fixtures) {
  const enabled = fx.enabled === true;
  for (let i = 0; i < warmups; i += 1) runFixture(fx, enabled);
  const samples = [];
  for (let i = 0; i < reps; i += 1) {
    samples.push(runFixture(fx, enabled));
  }
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const median = percentile(times, 50);
  const p95 = percentile(times, 95);
  results.push({
    id: fx.id,
    event: fx.event,
    mode: fx.mode,
    enabled,
    expected_child_count: fx.expected_child_count,
    observed_child_count: samples[0].children,
    median_ms: median,
    p95_ms: p95,
    mad_ms: mad(times, median),
    mad_median_ratio: median > 0 ? mad(times, median) / median : 0,
    samples: times.length,
  });
}

const report = {
  schema_version: 1,
  runtime: process.version,
  base_sha: base,
  candidate_sha: candidate,
  fixtures_path: fixturesPath,
  warmups,
  repetitions: reps,
  results,
  generated_at: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`wrote ${reportPath}\n`);
