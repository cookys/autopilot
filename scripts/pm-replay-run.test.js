'use strict';

const assert = require('node:assert/strict');
const {
  scheduleABBA,
  planEventReset,
  createMockModelRunner,
  runReplay,
} = require('./pm-replay-run.js');

let passedCount = 0;
async function test(name, fn) {
  await fn();
  passedCount++;
  console.log(`PASS: ${name}`);
}

async function run() {
  await test('scheduleABBA interleaves [A,B] then [B,A] per event', () => {
    const events = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
    const sched = scheduleABBA(events, ['OFF', 'ON']);
    assert.deepEqual(
      sched.map((s) => `${s.eventId}:${s.arm}`),
      ['e1:OFF', 'e1:ON', 'e2:ON', 'e2:OFF', 'e3:OFF', 'e3:ON']
    );
  });

  await test('planEventReset deep-clones immutable prefillPrefix and plans clean workDir', () => {
    const prefix = [{ role: 'user', content: 'hello' }];
    const plan = planEventReset({ prefillPrefix: prefix, workDir: '/work', event: { id: 'e1' } });
    plan.contextMessages[0].content = 'mutated';
    assert.equal(prefix[0].content, 'hello', 'original prefillPrefix must remain immutable');
    assert.equal(plan.sandboxResetPlan.cleanWorkDir, true);
    assert.equal(plan.sandboxResetPlan.eventId, 'e1');
  });

  await test('runReplay rejects when neither --dry-run-model nor pool_whitelist is provided', async () => {
    await assert.rejects(
      () =>
        runReplay({
          manifest: { pool_whitelist: [], total_cap: 1000, events: [{ id: 'e1' }], treatments: ['OFF', 'ON'] },
          modelRunner: createMockModelRunner(),
        }),
      /Pool rejected/
    );
  });

  await test('runReplay needs a pool that is on the whitelist, and only a whitelisted one runs', async () => {
    const m = { pool_whitelist: ['pool-a'], total_cap: 1000, events: [{ id: 'e1' }], treatments: ['OFF', 'ON'] };
    await assert.rejects(() => runReplay({ manifest: m, modelRunner: createMockModelRunner() }), /Pool rejected/);
    await assert.rejects(() => runReplay({ manifest: m, poolId: 'pool-z', modelRunner: createMockModelRunner() }), /Pool rejected/);
    const ok = await runReplay({ manifest: m, poolId: 'pool-a', modelRunner: createMockModelRunner() });
    assert.equal(ok.poolId, 'pool-a');
    assert.equal(ok.dryRun, false);
  });

  await test('runReplay executes ABBA schedule with mock modelRunner when dryRunModel is set', async () => {
    const res = await runReplay({
      manifest: {
        pool_whitelist: [],
        total_cap: 5000000,
        treatments: ['OFF', 'ON'],
        prefill_prefix: [{ role: 'user', content: 'p1' }],
        events: [{ id: 'e1' }, { id: 'e2' }],
      },
      dryRunModel: 'mock-haiku',
      modelRunner: createMockModelRunner(),
    });
    assert.equal(res.dryRun, true);
    assert.equal(res.executedCount, 4);
  });

  console.log(`\n${passedCount} tests passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
