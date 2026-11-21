const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'rc-alarm.js');
const LEAD = 'team/lead--claude';
const OWNER = 'team/owner--claude';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-alarm-test-'));
  const state = path.join(root, 'state');
  const calls = path.join(root, 'calls.jsonl');
  const fake = path.join(root, 'fake-fleet');
  fs.writeFileSync(fake, '#!/usr/bin/env node\nconst fs=require("fs"); fs.appendFileSync(process.env.FLEET_CALLS, JSON.stringify(process.argv.slice(2))+"\\n"); process.exit(Number(process.env.FLEET_RC||0));\n', { mode: 0o755 });
  const env = { ...process.env, FLEET_BIN: fake, FLEET_CALLS: calls, AUTOPILOT_CONFIG_FILE: path.join(root, 'config.json') };
  const run = (args, opts = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...env, ...opts.env }, input: opts.input, timeout: 35000 });
  const messages = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, state, calls, env, run, messages };
}

const wrap = (f, command, label = 'preflight', recipients = ['--owner', OWNER], opts = {}) => f.run(['--label', label, '--state-dir', f.state, ...recipients, '--', ...command], opts);
const assertPair = (messages, included) => {
  assert.deepEqual(messages.map(x => x.slice(0, 2)), [['send', LEAD], ['send', OWNER]]);
  assert.equal(messages[0][2], messages[1][2]);
  assert.ok(messages.every(x => x.length === 3 && x[2].includes(included) && x[2].includes('host=') && x[2].includes('time=')));
};

test('second failure notifies lead and owner; third warns future calls block', t => {
  const f = fixture(t);
  assert.equal(wrap(f, ['bash', '-c', 'echo bad >&2; exit 7']).status, 7);
  assert.deepEqual(f.messages(), []);
  assert.equal(wrap(f, ['bash', '-c', 'echo bad >&2; exit 7'], 'preflight', ['--lead', LEAD, '--owner', OWNER]).status, 7);
  assertPair(f.messages(), '連續 2 次 rc=7:bad');
  assert.equal(wrap(f, ['bash', '-c', 'echo bad >&2; exit 7'], 'preflight', ['--lead', LEAD, '--owner', OWNER]).status, 7);
  assertPair(f.messages().slice(2), '第 3 次失敗，之後的呼叫會被擋下');
});

test('blocked calls exit 75 once, reset reports old count and rearms', t => {
  const f = fixture(t), command = ['false'];
  for (let i = 0; i < 3; i++) wrap(f, command, 'preflight', ['--lead', LEAD, '--owner', OWNER]);
  const marker = path.join(f.root, 'ran');
  const blocked = wrap(f, ['touch', marker], 'preflight', ['--lead', LEAD, '--owner', OWNER]);
  assert.equal(blocked.status, 75); assert.equal(blocked.stdout, ''); assert.match(blocked.stderr, /停止重試/); assert.equal(fs.existsSync(marker), false);
  assert.equal(wrap(f, ['touch', marker], 'preflight', ['--lead', LEAD, '--owner', OWNER]).status, 75);
  assert.equal(f.messages().length, 6);
  assert.equal(f.run(['--reset', '--label', 'preflight', '--state-dir', f.state]).stdout, '3\n');
  assert.equal(wrap(f, ['touch', marker]).status, 0); assert.equal(fs.existsSync(marker), true);
});

test('reset prints counts zero through three, clears blocked markers, and does not notify', t => {
  for (let failures = 0; failures <= 3; failures++) {
    const f = fixture(t);
    for (let i = 0; i < failures; i++) wrap(f, ['false'], `reset-${failures}`, ['--lead', LEAD, '--owner', OWNER]);
    if (failures === 3) f.run(['check', '--label', `reset-${failures}`, '--state-dir', f.state, '--owner', OWNER]);
    const prior = f.messages();
    const reset = f.run(['--reset', '--label', `reset-${failures}`, '--state-dir', f.state]);
    assert.equal(reset.status, 0); assert.equal(reset.stdout, `${failures}\n`); assert.equal(reset.stderr, '');
    assert.equal(fs.readFileSync(path.join(f.state, `reset-${failures}.count`), 'utf8'), '0\n');
    assert.equal(fs.existsSync(path.join(f.state, `reset-${failures}.blocked`)), false);
    assert.deepEqual(f.messages(), prior);
  }
});

test('record and check update/read blocked state', t => {
  const f = fixture(t);
  for (let i = 1; i <= 3; i++) assert.equal(f.run(['record', '--label', 'recorded', '--lead', LEAD, '--owner', OWNER, '--rc', '9', '--last-line', 'error', '--state-dir', f.state]).status, 0);
  const blocked = f.run(['check', '--label', 'recorded', '--state-dir', f.state]);
  assert.equal(blocked.status, 75); assert.match(blocked.stderr, /已連續失敗 3 次/);
  assertPair(f.messages().slice(0, 2), '連續 2 次 rc=9:error');
  assertPair(f.messages().slice(2, 4), '第 3 次失敗');
});

test('recipients come only from flags or configured rc_alarm_lead', t => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) wrap(f, ['false'], 'unaddressed', []);
  assert.deepEqual(f.messages(), []);
  fs.writeFileSync(f.env.AUTOPILOT_CONFIG_FILE, JSON.stringify({ rc_alarm_lead: [LEAD] }));
  for (let i = 0; i < 2; i++) wrap(f, ['false'], 'configured', ['--owner', OWNER]);
  assertPair(f.messages(), '連續 2 次');
});

test('preserves output/status and uses last non-empty line of final 20 lines', t => {
  const f = fixture(t), output = Array.from({length: 40}, (_, i) => `line ${i}\n`).join('') + 'last error\n\n';
  for (let i = 0; i < 2; i++) {
    const result = wrap(f, ['node', '-e', 'process.stdout.write(process.argv[1]); process.exit(9)', output], 'tail', ['--lead', LEAD, '--owner', OWNER]);
    assert.equal(result.status, 9); assert.equal(result.stdout, output);
  }
  assertPair(f.messages(), 'rc=9:last error');
});

test('recovery notifies once and clears count; unrelated labels stay independent', t => {
  const f = fixture(t);
  wrap(f, ['false'], 'recover', ['--lead', LEAD, '--owner', OWNER]);
  wrap(f, ['false'], 'recover', ['--lead', LEAD, '--owner', OWNER]);
  assert.equal(wrap(f, ['true'], 'recover', ['--lead', LEAD, '--owner', OWNER]).status, 0);
  assertPair(f.messages().slice(2), 'recovered rc=0');
  assert.equal(fs.readFileSync(path.join(f.state, 'recover.count'), 'utf8').trim(), '0');
  wrap(f, ['false'], 'other', ['--lead', LEAD, '--owner', OWNER]);
  assert.equal(fs.readFileSync(path.join(f.state, 'other.count'), 'utf8').trim(), '1');
});

test('success after one failure rearms without a recovery notice', t => {
  const f = fixture(t);
  wrap(f, ['false'], 'one', ['--lead', LEAD, '--owner', OWNER]);
  assert.equal(wrap(f, ['true'], 'one', ['--lead', LEAD, '--owner', OWNER]).status, 0);
  assert.equal(fs.readFileSync(path.join(f.state, 'one.count'), 'utf8').trim(), '0');
  assert.deepEqual(f.messages(), []);
});

test('combined output and command status are preserved, including high exit codes', t => {
  const f = fixture(t);
  for (const rc of [0, 1, 7, 42, 127, 255]) {
    const result = wrap(f, ['bash', '-c', 'printf "stdout\\n"; printf "stderr\\n" >&2; exit "$1"', 'bash', String(rc)], `status-${rc}`);
    assert.equal(result.status, rc);
    assert.equal(result.stdout, 'stdout\nstderr\n');
    assert.equal(result.stderr, '');
  }
});

test('alert ignores lines older than the final twenty output lines', t => {
  const f = fixture(t), output = `old error\n${'\n'.repeat(20)}`;
  for (let i = 0; i < 2; i++) wrap(f, ['node', '-e', 'process.stdout.write(process.argv[1]); process.exit(9)', output], 'old-tail', ['--lead', LEAD, '--owner', OWNER]);
  assertPair(f.messages(), 'rc=9: host=');
  assert.ok(!f.messages()[0][2].includes('old error'));
});

test('fleet send failures warn for every recipient and preserve command status', t => {
  const f = fixture(t), command = ['bash', '-c', 'echo failed; exit 37'];
  wrap(f, command, 'fleet-error', ['--lead', LEAD, '--owner', OWNER]);
  const failed = wrap(f, command, 'fleet-error', ['--lead', LEAD, '--owner', OWNER], { env: { FLEET_RC: '23' } });
  assert.equal(failed.status, 37);
  for (const address of [LEAD, OWNER]) assert.match(failed.stderr, new RegExp(`warning: fleet send to ${address} failed rc=23`));
  const recovered = wrap(f, ['true'], 'fleet-error', ['--lead', LEAD, '--owner', OWNER], { env: { FLEET_RC: '23' } });
  assert.equal(recovered.status, 0); assert.equal((recovered.stderr.match(/warning:/g) || []).length, 2);
});

test('reset rejects a supplied command with usage exit 2', t => {
  const f = fixture(t), marker = path.join(f.root, 'must-not-run');
  const result = f.run(['--reset', '--label', 'reset-command', '--state-dir', f.state, '--', 'touch', marker]);
  assert.equal(result.status, 2); assert.match(result.stderr, /usage:/); assert.equal(fs.existsSync(marker), false);
});

test('a stored count above three blocks before executing the command', t => {
  const f = fixture(t), marker = path.join(f.root, 'must-not-run');
  fs.mkdirSync(f.state, { recursive: true }); fs.writeFileSync(path.join(f.state, 'large.count'), '12\n');
  const result = wrap(f, ['touch', marker], 'large', ['--lead', LEAD, '--owner', OWNER]);
  assert.equal(result.status, 75); assert.equal(fs.existsSync(marker), false);
  assert.match(result.stderr, /已連續失敗 12 次/); assert.equal(fs.readFileSync(path.join(f.state, 'large.count'), 'utf8'), '12\n');
});

test('invalid usage exits 2 and lock contention serializes same-label updates', async t => {
  const f = fixture(t);
  assert.equal(f.run(['--label', '../bad', '--owner', OWNER, '--', 'true']).status, 2);
  const args = ['--label', 'locked', '--state-dir', f.state, '--owner', OWNER, '--', 'bash', '-c', 'sleep .2; exit 1'];
  const start = () => spawn(process.execPath, [SCRIPT, ...args], { env: f.env, stdio: 'ignore' });
  const a = start(), pa = new Promise(resolve => a.on('exit', resolve));
  const b = start(), pb = new Promise(resolve => b.on('exit', resolve));
  assert.equal(await pa, 1); assert.equal(await pb, 1);
  assert.equal(fs.readFileSync(path.join(f.state, 'locked.count'), 'utf8').trim(), '2');
});

test('XDG runtime directory selects the documented default state path', t => {
  const f = fixture(t), runtime = path.join(f.root, 'runtime');
  fs.mkdirSync(runtime);
  const result = f.run(['--label', 'default-dir', '--owner', OWNER, '--', 'false'], { env: { XDG_RUNTIME_DIR: runtime } });
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(path.join(runtime, 'autopilot', 'rc-alarm', 'default-dir.count'), 'utf8'), '1\n');
});
