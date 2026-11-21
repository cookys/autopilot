#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'dispatch-model-guard.js');
const REPORT = path.resolve(__dirname, '../scripts/mechanical-reroute-report.js');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mech-reroute-test-'));
const fakeCwd = path.join(tmpRoot, 'cwd');
const fakeRuntime = path.join(tmpRoot, 'runtime');
fs.mkdirSync(fakeCwd, { recursive: true });
fs.mkdirSync(fakeRuntime, { recursive: true });
const logPath = path.join(fakeRuntime, 'autopilot', 'mechanical-reroute-shadow.jsonl');

function baseEnv(extra) {
  const env = { ...process.env, XDG_RUNTIME_DIR: fakeRuntime, AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: 'remind' };
  for (const k of ['AUTOPILOT_SEAT_ROLE', 'AUTOPILOT_MECHANICAL_REROUTE', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_SESSION_ID']) delete env[k];
  return { ...env, ...extra };
}
function runHook(payload, extraEnv = {}) {
  const res = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: baseEnv(extraEnv) });
  let out = null;
  try { out = JSON.parse(res.stdout.trim()); } catch { out = null; }
  return { status: res.status, out, stderr: res.stderr };
}
const decision = (r) => r.out?.hookSpecificOutput?.permissionDecision;
const call = (prompt, extra = {}, cwd = fakeCwd) => ({
  tool_name: 'Agent', cwd,
  tool_input: { subagent_type: 'general-purpose', model: 'sonnet', prompt, ...extra },
});
const logLines = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean) : []);
const LEAD = (mode) => ({ AUTOPILOT_SEAT_ROLE: 'lead', AUTOPILOT_MECHANICAL_REROUTE: mode });

// 1. lead + Role: stats: shadow allows and logs header values only; enforce denies with a real command
const sh = runHook(call('Engine: sonnet\nRole: stats\nLane: test-lane\nFleet-Task: 01M7ZDSR7X7C6GVSB6T3Q6YC3G\nSECRET BODY TEXT'), LEAD('shadow'));
assert.strictEqual(sh.status, 0);
assert.strictEqual(decision(sh), undefined, 'shadow must allow');
assert.strictEqual(logLines().length, 1, 'shadow writes one log line');
assert.ok(!logLines()[0].includes('SECRET BODY'), 'no brief body in log');
const row = JSON.parse(logLines()[0]);
assert.deepStrictEqual([row.seat, row.role, row.subagent_type, row.model, row.Lane, row['Fleet-Task']],
  ['lead', 'stats', 'general-purpose', 'sonnet', 'test-lane', '01M7ZDSR7X7C6GVSB6T3Q6YC3G']);
assert.ok(row.ts && !row.intentional);

// default mode (env unset) is shadow
const dflt = runHook(call('Engine: sonnet\nRole: LOGS\nDo it.'), { AUTOPILOT_SEAT_ROLE: 'pm' });
assert.strictEqual(decision(dflt), undefined);
assert.strictEqual(logLines().length, 2, 'default mode = shadow, case-insensitive Role');

const enf = runHook(call('Engine: sonnet\nRole: stats\nDo stats.'), LEAD('enforce'));
assert.strictEqual(decision(enf), 'deny');
const reason = enf.out.hookSpecificOutput.permissionDecisionReason;
assert.ok(reason.includes('scripts/dispatch-hetero.sh --runner local --branch <branch> --prompt-file <file>'));
assert.ok(reason.includes('--runner grok') && reason.includes('intentional') && /[一-鿿]/.test(reason));
assert.strictEqual(logLines().length, 2, 'enforce does not log');

// 2. other roles / role outside first 6 lines / missing role: untouched
for (const prompt of ['Engine: sonnet\nRole: reviewer\nx', 'Engine: sonnet\nDo stats.',
  'Engine: sonnet\nLane: a\nb\nc\nd\ne\nRole: stats\nx']) {
  for (const mode of ['shadow', 'enforce']) {
    const r = runHook(call(prompt), LEAD(mode));
    assert.strictEqual(decision(r), undefined, `untouched: ${prompt.slice(0, 30)}`);
  }
}
assert.strictEqual(logLines().length, 2, 'no log for non-matching roles');

// 3. no seat role (and not a PM console): untouched even in enforce
assert.strictEqual(decision(runHook(call('Engine: sonnet\nRole: stats\nx'), { AUTOPILOT_MECHANICAL_REROUTE: 'enforce' })), undefined);
assert.strictEqual(decision(runHook(call('Engine: sonnet\nRole: stats\nx'), { AUTOPILOT_SEAT_ROLE: 'worker', AUTOPILOT_MECHANICAL_REROUTE: 'enforce' })), undefined);
assert.strictEqual(logLines().length, 2);

// 3b. PM console cwd counts as a PM seat without the env role
const pmCwd = path.join(tmpRoot, 'pmrepo');
fs.mkdirSync(path.join(pmCwd, '.git'), { recursive: true });
fs.writeFileSync(path.join(pmCwd, '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.mkdirSync(path.join(pmCwd, '.claude'));
fs.writeFileSync(path.join(pmCwd, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }));
const pm = runHook(call('Engine: sonnet\nRole: docs\nx', {}, pmCwd), { AUTOPILOT_MECHANICAL_REROUTE: 'enforce' });
assert.strictEqual(decision(pm), 'deny');

// 4. intentional: enforce allows; shadow logs intentional:true
const inten = 'Engine: sonnet (intentional: need claude context)\nRole: stats\nx';
assert.strictEqual(decision(runHook(call(inten), LEAD('enforce'))), undefined);
assert.strictEqual(decision(runHook(call(inten), LEAD('shadow'))), undefined);
assert.strictEqual(JSON.parse(logLines().pop()).intentional, true);

// 5. mode off: untouched, no log
const n = logLines().length;
assert.strictEqual(decision(runHook(call('Engine: sonnet\nRole: stats\nx'), LEAD('off'))), undefined);
assert.strictEqual(logLines().length, n);

// 6. matching by model / subagent_type: Explore with no model-class, haiku with custom type
assert.strictEqual(decision(runHook(call('Engine: haiku\nRole: lint\nx', { subagent_type: 'Explore', model: 'haiku' }), LEAD('enforce'))), 'deny');
assert.strictEqual(decision(runHook(call('Engine: haiku\nRole: lint\nx', { subagent_type: 'autopilot:reviewer', model: 'haiku' }), LEAD('enforce'))), 'deny');
assert.strictEqual(decision(runHook(call('Engine: qwen\nRole: lint\nx', { subagent_type: 'autopilot:reviewer', model: 'qwen' }), LEAD('enforce'))), undefined);

// 7. fail-open: runtime dir unusable (autopilot is a regular file) still allows, exit 0
const badRuntime = path.join(tmpRoot, 'bad');
fs.mkdirSync(badRuntime);
fs.writeFileSync(path.join(badRuntime, 'autopilot'), 'x');
const bad = runHook(call('Engine: sonnet\nRole: stats\nx'), { ...LEAD('shadow'), XDG_RUNTIME_DIR: badRuntime });
assert.strictEqual(bad.status, 0);
assert.strictEqual(decision(bad), undefined);

// 8. report script
const rep = spawnSync(process.execPath, [REPORT, '--json', '--since', '1h'], { encoding: 'utf8', env: baseEnv({}) });
const rj = JSON.parse(rep.stdout);
assert.ok(rj.total >= 3 && rj.by_seat.lead >= 1 && rj.by_role.stats >= 1 && rj.by_subagent_type['general-purpose'] >= 1);
const old = JSON.stringify({ ts: '2000-01-01T00:00:00Z', seat: 'pm', role: 'docs', subagent_type: 'x' });
fs.appendFileSync(logPath, old + '\n');
const rj2 = JSON.parse(spawnSync(process.execPath, [REPORT, '--json'], { encoding: 'utf8', env: baseEnv({}) }).stdout);
assert.strictEqual(rj2.total, rj.total, '--since window excludes old rows');
assert.ok(/total=/.test(spawnSync(process.execPath, [REPORT], { encoding: 'utf8', env: baseEnv({}) }).stdout));

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log('PASS: dispatch-model-guard-mechanical-reroute.test.js');
