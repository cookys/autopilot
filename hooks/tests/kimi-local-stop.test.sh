#!/usr/bin/env bash
# Local Kimi must never start, including version/help probes. Fake binaries only.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_KIMI_LOCAL_ALLOW
export AUTOPILOT_TEST_CN_GATE_OFF=1
node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const [root, tmp] = process.argv.slice(2);
const bin = path.join(tmp, 'bin');
const home = path.join(tmp, 'home');
const repo = path.join(tmp, 'repo');
for (const d of [bin, home, repo]) fs.mkdirSync(d, { recursive: true });
const recorder = path.join(tmp, 'kimi-argv');
fs.writeFileSync(path.join(bin, 'kimi'), '#!/bin/sh\nprintf "%s\\n" "$@" >> ' + JSON.stringify(recorder) + '\nprintf "fake edit\\n" > kimi-edited.txt\nprintf "done\\n"\n', { mode: 0o755 });
const prompt = path.join(tmp, 'prompt');
fs.writeFileSync(prompt, 'update one file\n');
const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, KIMI_STOP_RECORDER: recorder,
  AUTOPILOT_KIMI_BROKER_SOCK: path.join(tmp, 'absent.sock'),
  AUTOPILOT_KIMI_LOCAL_ALLOW: '', AUTOPILOT_SESSION_MODE_DIR: path.join(tmp, 'session'),
  AUTOPILOT_DISPATCH_RUNS_DIR: path.join(tmp, 'runs'), AUTOPILOT_RUNNER_HOME_FALLBACK: 'off',
  ENGINE_CAPABILITY_DIR: path.join(tmp, 'capability'), ENGINE_SCORECARD_DIR: path.join(tmp, 'scorecard'),
  AUTOPILOT_WORKER_MOUNT_ISOLATION: 'off', DISPATCH_DETACH: '0', DISPATCH_QUIET: '1' };
for (const k of Object.keys(env)) if (k.startsWith('GIT_') || /^AUTOPILOT_(PARENT|ROOT|MISSION|LEVEL|DISPATCH_DEPTH)/u.test(k)) delete env[k];
const git = (...args) => cp.execFileSync('git', ['-C', repo, ...args], { env, stdio: 'pipe' });
git('init', '-q', '-b', 'develop');
git('-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
const heteroArgs = ['--runner', 'kimi', '--model', 'kimi-code/k3', '--effort', 'high', '--kimi-bin', path.join(bin, 'kimi'), '--prompt-file', prompt,
  '--context-window', 'off', '--branch', 'feat/kimi-stop', '--no-verify-tip'];
let heteroScript = path.join(root, 'scripts/dispatch-hetero.sh');
if (process.env.KIMI_LOCAL_STOP_MUTANT === '1') {
  const scratch = path.join(tmp, 'scratch');
  fs.mkdirSync(scratch);
  fs.cpSync(path.join(root, 'scripts'), path.join(scratch, 'scripts'), { recursive: true });
  for (const dir of ['src', 'hooks', 'references', '.claude', 'project-config-template']) fs.symlinkSync(path.join(root, dir), path.join(scratch, dir));
  heteroScript = path.join(scratch, 'scripts/dispatch-hetero.sh');
  const original = fs.readFileSync(heteroScript, 'utf8');
  const mutated = original.replace(/^  _kimi_stop=.*kimi-local-stop\.js.*$/mu, '  # negative control: local-stop call commented out');
  assert.notEqual(mutated, original, 'negative control removes exactly the hetero stop call');
  fs.writeFileSync(heteroScript, mutated);
}
function invoke(command, args, extraEnv = {}) {
  return cp.spawnSync(command, args, { cwd: repo, env: { ...env, ...extraEnv }, encoding: 'utf8', input: '', timeout: 60000 });
}
function refused(name, command, args, json = false) {
  const r = invoke(command, args);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (name === 'hetero' && process.env.KIMI_LOCAL_STOP_MUTANT === '1') {
    console.log(`NEGATIVE CONTROL RED: dispatch-hetero guard removed; recorder created=${fs.existsSync(recorder)}`);
    if (process.env.KIMI_STOP_EVIDENCE_RECORDER && fs.existsSync(recorder)) fs.copyFileSync(recorder, process.env.KIMI_STOP_EVIDENCE_RECORDER);
  }
  assert.notEqual(r.status, 0, `${name} refuses`);
  // dispatch-author's default Kimi seat is the broker (dispatch-author-kimi.test.sh forbids
  // the local-stop reason on that path). It must still refuse before any local spawn.
  if (name === 'author') {
    assert.doesNotMatch(out, /kimi_local_stopped/u, `author: ${out}`);
    assert.match(out, /kimi broker unavailable/u, `author: ${out}`);
  } else {
    assert.match(out, /kimi_local_stopped/u, `${name}: ${out}`);
  }
  if (json && name !== 'author') assert.match(JSON.parse(r.stdout.trim().split('\n').find((line) => line.startsWith('{'))).error, /kimi_local_stopped/u);
  assert.equal(fs.existsSync(recorder), false, `${name}: recorder absent`);
  console.log(`PASS ${name}: refusal exit=${r.status}, recorder absent`);
}
refused('hetero', 'bash', [heteroScript, ...heteroArgs], true);
refused('review', 'bash', [path.join(root, 'scripts/dispatch-review.sh'), '--runner', 'kimi', '--model', 'kimi-code/k3', '--diff-file', prompt, '--context-window', 'off'], true);
refused('author', 'bash', [path.join(root, 'scripts/dispatch-author.sh'), '--runner', 'kimi', '--model', 'kimi-code/k3', '--prompt-file', prompt, '--context-window', 'off'], true);
refused('foreman', 'bash', [path.join(root, 'scripts/dispatch-foreman.sh'), '--brief-file', prompt, '--plan-file', prompt], true);
refused('probe', 'bash', [path.join(root, 'scripts/probe-engine-capability.sh'), 'quota', '--runner', 'kimi', '--model', 'fixture', '--store', path.join(tmp, 'store')], true);
refused('cleanroom', 'bash', [path.join(root, 'scripts/lib/cleanroom-launch.sh'), '--profile', 'kimi', '--preflight'], true);
for (const [file, args] of [
  ['docs/plans/evidence/2026-09-13-non-claude-foreman/kimi-probes/p8-setsid-kill.sh', []],
  ['docs/plans/evidence/2026-10-14-reviewer-requalify-minimax-glm-qwen/kimi-auth-probe.sh', []],
  ['docs/plans/evidence/2026-10-14-reviewer-requalify-minimax-glm-qwen/kimi28-stage-probe.sh', []],
  ['docs/plans/evidence/2026-10-26-k31-beam-longcat-qualify/drivers/sit.sh', ['k31', 'reviewer']],
  ['docs/plans/evidence/2026-10-27-terra-qualify/drivers/sit.sh', ['k31', 'reviewer']],
]) refused(file, 'bash', [path.join(root, file), ...args]);
const q = invoke(process.execPath, [path.join(root, 'scripts/qualification-review-provider.js')], { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'kimi' });
assert.notEqual(q.status, 0); assert.match(q.stderr, /kimi_local_stopped/u); assert.equal(fs.existsSync(recorder), false);
console.log('PASS qualification provider: recorder absent');
const adapter = require(path.join(root, 'src/runners/kimi'));
let calls = 0;
assert.match(adapter.inspectKimiSurface({ env, spawnSync() { calls++; } }).reason, /kimi_local_stopped/u);
assert.match(adapter.runKimiAuthor({}, { env, spawnSync() { calls++; } }).error, /kimi_local_stopped/u);
assert.equal(calls, 0);
const version = require(path.join(root, 'scripts/lib/runner-binary')).resolveRunnerVersion('kimi');
assert.equal(version.reason, 'kimi_local_stopped');
const readiness = require(path.join(root, 'src/readiness/probe')).probeSafeSurface({ tuple: { runner: 'kimi' } });
assert.equal(readiness.reason, 'kimi_local_stopped');
console.log('PASS adapter/readiness/version probes: zero spawns');
const pace = require(path.join(root, 'scripts/pace-select'));
const roles = { ...pace.loadRoles(), _disabled: [] };
const pools = pace.loadPools();
const result = pace.selectEngine({ pace: { schema: 'capacity.pace/1', rows: [] }, pools, roles, role: 'implementer', env, checkEndpoint: () => true });
assert.notEqual(result.engine, 'kimi');
assert.equal(require(path.join(root, 'scripts/lib/cursor-broker-client')).brokerAvailable('kimi', { env }), false);
console.log('PASS pace: Kimi implementer excluded without a broker');
// Exercise jury availability with Kimi present on PATH and a dispatch stub that would record a call.
const dispatch = path.join(tmp, 'dispatch');
fs.writeFileSync(dispatch, '#!/bin/sh\nprintf called >> "$KIMI_STOP_RECORDER"\n', { mode: 0o755 });
const jury = invoke(process.execPath, [path.join(root, 'scripts/review-jury.js'), 'run', '--pack', prompt,
  '--seats', 'kimi', '--implementer-family', 'anthropic', '--dispatch-bin', dispatch, '--out', path.join(tmp, 'jury')]);
assert.equal(fs.existsSync(recorder), false, `jury must skip Kimi: ${jury.stderr}`);
const merged = JSON.parse(fs.readFileSync(path.join(tmp, 'jury/merged.json'), 'utf8'));
assert.equal(merged.seat_states.kimi.status, 'unavailable');
console.log('PASS jury: Kimi unavailable even on PATH');
const allowed = invoke('bash', [heteroScript, ...heteroArgs], { AUTOPILOT_KIMI_LOCAL_ALLOW: '1' });
assert.equal(fs.existsSync(recorder), true, `test seam restores Kimi spawn: ${allowed.stdout}${allowed.stderr}`);
assert.doesNotMatch(`${allowed.stdout}${allowed.stderr}`, /kimi_local_stopped/u);
console.log(`PASS test-only allow seam: fake Kimi spawned (rail exit=${allowed.status})`);
NODE
assert_exit_code "$?" "0" "local Kimi stop contract"
finalize_test
