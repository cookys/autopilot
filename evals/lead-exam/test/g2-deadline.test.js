'use strict';
// g2 item 3: each round's call gets min(round timeout, remaining overall budget), and on timeout the provider's
// whole process group is killed (SIGTERM, then SIGKILL after a short grace), not merely raced.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const fx = require('../fixtures');
const { runExam } = require('../run');
const { callProvider } = require('../transport');

const items = lib.loadItems();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-g2dl-'));
const pidsSeen = [];

test('each round call gets min(round timeout, remaining overall budget); no budget left blanks the round', async () => {
  const gold = fx.goldOutputs('dl', items);
  let t = 0;
  const given = [];
  const rec = await runExam({
    items, seed: 'dl', name: 'n', model: 'stub', roundTimeoutMs: 600, hardStopMs: 1000, now: () => t,
    call: async (_p, r, ctl) => { given.push(ctl && ctl.timeoutMs); t += 700; return { text: gold[r - 1], ms: 1 }; },
  });
  assert.deepStrictEqual(given, [600, 300], 'round 1 gets the round timeout, round 2 only what is left');
  assert.strictEqual(rec.rounds[2].timed_out, true);
  assert.strictEqual(rec.outputs[2], '');
});

test('a provider that sleeps is killed at the deadline: run ends inside the hard stop and no stub process is left', async () => {
  const stub = path.join(tmp, 'sleepy-provider.js');
  fs.writeFileSync(stub, `'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
process.on('SIGTERM', () => {});
const kid = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>{},120000)"], { stdio: 'ignore' });
fs.appendFileSync(process.env.STUB_PIDS, process.pid + '\\n' + kid.pid + '\\n');
setTimeout(() => {}, 120000);
`);
  const pidFile = path.join(tmp, 'pids.txt');
  fs.writeFileSync(pidFile, '');
  const started = Date.now();
  const rec = await runExam({
    items, seed: 'dl', name: 'sleepy', model: 'stub', roundTimeoutMs: 500, hardStopMs: 1100,
    call: (prompt, _r, ctl) => callProvider(prompt, {
      kind: 'claude', model: 'm', timeoutMs: ctl.timeoutMs, signal: ctl.signal, graceMs: 300, providerBin: stub,
      passEnv: { STUB_PIDS: pidFile },
    }),
  });
  const wall = Date.now() - started;
  fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).forEach((p) => pidsSeen.push(Number(p)));
  assert.ok(wall < 1100 + 1200, `run took ${wall} ms`);
  assert.ok(rec.rounds.slice(0, 3).every((r) => r.timed_out), JSON.stringify(rec.rounds));
  assert.ok(rec.rounds.slice(2).every((r) => r.timed_out), 'budget ran out: later rounds blank');
  assert.ok(pidsSeen.length >= 4, `stub pids recorded: ${pidsSeen.length}`);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const until = Date.now() + 3000;
  while (pidsSeen.some(alive) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(pidsSeen.filter(alive), [], 'every stub process (provider and its child) is dead');
});

test.after(() => {
  pidsSeen.forEach((p) => { try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ } });
  fs.rmSync(tmp, { recursive: true, force: true });
});
