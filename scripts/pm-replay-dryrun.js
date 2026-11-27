#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scanAndSampleEvents, SCREENING_QUOTA, DEFAULT_LEVELS } = require('./pm-replay-slice.js');

function makeManifest(seed) {
  const candidates = Object.entries(SCREENING_QUOTA).flatMap(([type, count]) =>
    Array.from({ length: count * 3 }, (_, i) => ({
      id: `fake-${type}-${i}`, type, text: `Synthetic ${type} example ${i}`,
      valid_answers: [{ intents: [{ actionCategory: 'fake_action', target: `fake-${i}` }] }],
    })));
  return { seed, quota: SCREENING_QUOTA, levels: DEFAULT_LEVELS,
    events: scanAndSampleEvents(candidates, SCREENING_QUOTA, seed).selected,
    treatments: ['baseline', 'S2'], total_cap: 5000000, estimate: 5000000,
    pool_whitelist: [] };
}
function writeJson(file, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(file, content);
  return crypto.createHash('sha256').update(content).digest('hex');
}
module.exports = { makeManifest, writeJson };

const { runReplay, createMockModelRunner } = require('./pm-replay-run.js');
const { createStub } = require('./lib/replay-stub.js');
const { scoreArm, compareArms } = require('./lib/replay-score.js');
const { createBudget, weightedCost } = require('./lib/replay-budget.js');
const { runNegativeControls } = require('./lib/replay-sandbox.js');

async function replay(manifest, { divergences = 0, mismatches = 0 } = {}) {
  const budget = createBudget({ total_limit: manifest.total_cap, estimate: manifest.estimate });
  const mock = createMockModelRunner();
  const runner = { async run(args) {
    const index = manifest.events.findIndex(e => e.id === args.event.id);
    const params = { id: args.event.id };
    const stub = createStub([{ name: 'fake_tool', params, result: { fake: true } }]);
    stub.call('fake_tool', args.arm === 'S2' && index < divergences ? { id: 'unrecorded' } : params);
    const reservation = budget.reserve(1000);
    if (!reservation) throw new Error('Budget reservation refused');
    const result = await mock.run(args);
    budget.settle(reservation, weightedCost({ input: result.usage.input, output: result.usage.output, read: result.usage.cache_read }));
    return { ...result, divergent: stub.report().divergences > 0,
      intents: args.arm === 'S2' && index < mismatches ? [{ actionCategory: 'wrong', target: 'fake' }] : args.event.valid_answers[0].intents };
  } };
  const execution = await runReplay({ manifest, dryRunModel: 'mock-small', modelRunner: runner });
  const scored = {};
  for (const arm of manifest.treatments) {
    scored[arm] = scoreArm(manifest.events.map(event => {
      const result = execution.results.find(r => r.arm === arm && r.eventId === event.id);
      return { ...event, intents: result.intents, divergent: result.divergent };
    }));
  }
  return { execution, scored, comparison: compareArms(scored.baseline, scored.S2, { screening: true }), budget: budget.report() };
}
module.exports.replay = replay;

async function dryRun(out, seed = 20261125, options = {}) {
  fs.mkdirSync(out, { recursive: true });
  const manifest = makeManifest(seed);
  const manifest_sha256 = writeJson(path.join(out, 'manifest.json'), manifest);
  const result = await replay(manifest, options);
  let rejection;
  try {
    await runReplay({ manifest, poolId: 'fake-pool', modelRunner: createMockModelRunner() });
    rejection = { rejected: false };
  } catch (error) {
    rejection = { rejected: true, reason: error.message };
  }
  const controls = runNegativeControls();
  const names = ['a_fake_fleet_blocked', 'b_repo_write_blocked', 'c_config_read_blocked', 'd_network_egress_blocked', 'e_hook_subprocess_bypass_blocked', 'f_no_egress_except_proxy', 'g_proxy_refuses_non_model_paths'];
  const probes = controls.skipped ? names.map(name => ({ name, blocked: null, skipped: true, reason: controls.reason })) : controls.probes;
  const report = { manifest_sha256, negative_controls: { ...controls, probes }, budget: result.budget,
    arms: { baseline: { full: result.scored.baseline.agreement, paired: result.comparison.baseline_paired },
      S2: { full: result.scored.S2.agreement, paired: result.comparison.treatment_paired } },
    paired_n: result.comparison.paired_n, verdict: result.comparison.verdict, non_dry_run: rejection,
    injected: { divergences: options.divergences || 0, mismatches: options.mismatches || 0 },
    per_event: manifest.events.map(event => {
      const row = { id: event.id };
      for (const arm of manifest.treatments) {
        const r = result.execution.results.find(x => x.arm === arm && x.eventId === event.id);
        row[arm] = { divergent: !!r.divergent, correct: JSON.stringify(r.intents) === JSON.stringify(event.valid_answers[0].intents) };
      }
      return row;
    }) };
  const report_sha256 = writeJson(path.join(out, 'report.json'), report);
  return { manifest, report, report_sha256 };
}
module.exports.dryRun = dryRun;
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let out, seed = 20261125;
    const options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--out' && args[i + 1]) out = args[++i];
      else if (args[i] === '--seed' && args[i + 1]) seed = Number(args[++i]);
      else if (args[i] === '--divergences' && args[i + 1]) options.divergences = Number(args[++i]);
      else if (args[i] === '--mismatches' && args[i + 1]) options.mismatches = Number(args[++i]);
      else throw new Error('Usage: node scripts/pm-replay-dryrun.js --out <directory> [--seed N] [--divergences N] [--mismatches N]');
    }
    if (!out || !Number.isSafeInteger(seed)) throw new Error('Output directory and integer seed required');
    const result = await dryRun(out, seed, options);
    console.log(result.report_sha256);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
