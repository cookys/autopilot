#!/usr/bin/env node
'use strict';

const { checkPool } = require('./lib/replay-pool.js');
const { createRealModelRunner } = require('./lib/replay-model-runner.js');

const fs = require('node:fs');
const path = require('node:path');
const { buildSandboxArgs } = require('./lib/replay-sandbox.js');

/**
 * Pure function: schedule events in ABBA interleaved order across [armA, armB].
 * Event 0 -> [A, B], Event 1 -> [B, A], Event 2 -> [A, B], ...
 * @param {Array<{id?: string}>} events
 * @param {[string, string]} arms
 * @returns {Array<{eventIndex: number, eventId: string, arm: string}>}
 */
function scheduleABBA(events, arms) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  if (!Array.isArray(arms) || arms.length !== 2) {
    throw new TypeError('arms must be a 2-element array [armA, armB]');
  }
  const [armA, armB] = arms;
  const schedule = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i] || {};
    const eventId = ev.id !== undefined ? String(ev.id) : `event-${i}`;
    const order = i % 2 === 0 ? [armA, armB] : [armB, armA];
    for (const arm of order) {
      schedule.push({ eventIndex: i, eventId, arm });
    }
  }
  return schedule;
}

/**
 * Pure function: plan per-event reset of context (deep copy of immutable prefill prefix)
 * and sandbox file state.
 * @param {object} params
 * @param {Array<object>} params.prefillPrefix - Immutable prefill messages
 * @param {string} params.workDir - Sandbox work directory to reset
 * @param {object} params.event - Current event
 * @returns {{ contextMessages: Array<object>, sandboxResetPlan: { workDir: string, cleanWorkDir: boolean, eventId: string } }}
 */
function planEventReset({ prefillPrefix = [], workDir = '/work', event = {} }) {
  const clonedPrefix = JSON.parse(JSON.stringify(prefillPrefix));
  return {
    contextMessages: clonedPrefix,
    sandboxResetPlan: {
      workDir,
      cleanWorkDir: true,
      eventId: event.id !== undefined ? String(event.id) : 'unknown',
    },
  };
}

/**
 * Built-in mock modelRunner for --selftest (never makes real network/model calls).
 */
function createMockModelRunner() {
  return {
    async run({ arm, event, contextMessages }) {
      return {
        arm,
        eventId: event.id || 'unknown',
        turns: 1,
        prefillCount: contextMessages.length,
        output: `mock-response:${arm}:${event.id || 'unknown'}`,
        usage: { input: 100, output: 20, cache_read: 50, cache_write: 0 },
      };
    },
  };
}

/**
 * Run replay according to manifest, arm(s), and injected modelRunner.
 * Rejects if neither --dry-run-model nor a valid pool is available.
 */
async function runReplay({ manifest, arm, dryRunModel, poolId, modelRunner }) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest is required');
  }
  // A small-model dry run needs no pool; anything else must name a whitelisted pool (fail closed).
  const poolCheck = dryRunModel ? { ok: true, poolId: `dry-run:${dryRunModel}`, dryRun: true } : { ...checkPool(manifest, poolId), poolId };
  if (!poolCheck.ok) {
    throw new Error(`Pool rejected: ${poolCheck.reason}`);
  }
  if (!modelRunner || typeof modelRunner.run !== 'function') {
    throw new Error('modelRunner with .run() is required');
  }

  const events = Array.isArray(manifest.events) ? manifest.events : [];
  const treatments = Array.isArray(manifest.treatments) ? manifest.treatments : ['baseline', arm || 'treatment'];
  const arms = treatments.length >= 2 ? [treatments[0], treatments[1]] : [treatments[0], treatments[0]];
  const schedule = scheduleABBA(events, arms);
  const prefillPrefix = Array.isArray(manifest.prefill_prefix) ? manifest.prefill_prefix : [];

  const results = [];
  for (const step of schedule) {
    if (arm && step.arm !== arm) continue;
    const event = events[step.eventIndex];
    const reset = planEventReset({ prefillPrefix, workDir: '/work', event });
    const sandboxArgs = buildSandboxArgs({ workDir: undefined });
    const res = await modelRunner.run({
      arm: step.arm,
      event,
      contextMessages: reset.contextMessages,
      sandboxResetPlan: reset.sandboxResetPlan,
      sandboxArgs,
      poolId: poolCheck.poolId,
    });
    results.push(res);
  }

  return {
    poolId: poolCheck.poolId,
    dryRun: Boolean(poolCheck.dryRun),
    totalCap: manifest.total_cap || 0,
    scheduledCount: schedule.length,
    executedCount: results.length,
    results,
  };
}

function parseArgs(argv) {
  const out = { selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') out.selftest = true;
    else if (a === '--real') out.real = true;
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--arm') out.arm = argv[++i];
    else if (a === '--dry-run-model') out.dryRunModel = argv[++i];
    else if (a === '--pool') out.poolId = argv[++i];
    else if (a === '--proxy-socket') out.proxySocket = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    const mockManifest = {
      pool_whitelist: [],
      total_cap: 5000000,
      treatments: ['baseline', 'S2'],
      prefill_prefix: [{ role: 'user', content: 'prefill-1' }],
      events: [{ id: 'ev-1' }, { id: 'ev-2' }],
    };
    const out = await runReplay({
      manifest: mockManifest,
      dryRunModel: 'mock-selftest-model',
      modelRunner: createMockModelRunner(),
    });
    console.log(JSON.stringify({ selftest: 'ok', executedCount: out.executedCount, poolId: out.poolId }));
    return;
  }

  if (args.real && !args.poolId) {
    console.error('refusing --real without --pool <id>');
    process.exit(2);
  }
  if (!args.manifest) {
    console.error('Usage: pm-replay-run.js --manifest <file> [--arm <name>] [--dry-run-model <id> | --real --pool <id> --proxy-socket <path>] | --selftest');
    process.exit(2);
  }

  const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifest), 'utf8'));
  const modelRunner = args.real
    ? createRealModelRunner({ manifest, proxySocket: args.proxySocket })
    : createMockModelRunner();
  const out = await runReplay({
    manifest,
    arm: args.arm,
    dryRunModel: args.dryRunModel,
    poolId: args.poolId,
    modelRunner,
  });
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  scheduleABBA,
  planEventReset,
  createMockModelRunner,
  runReplay,
  parseArgs,
};
