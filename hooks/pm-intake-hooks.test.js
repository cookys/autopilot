'use strict';
/**
 * PM-seat intake hooks A/B/C.
 * Run: node --test hooks/pm-intake-hooks.test.js
 *
 * MUTATION (core action removed → this case goes red):
 * - Hook A: deleting the additionalContext write → "stub output reaches additionalContext".
 * - Hook B: deleting the missing-verdict block → "missing verdict blocks".
 * - Hook C: deleting the forbid-regex deny → "F2 vzdump whole-VM migration denies".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures/pm-intake/constraints.md');
const HOOK_A = path.join(__dirname, 'pm-intake-a.js');
const HOOK_B = path.join(__dirname, 'pm-intake-b.js');
const HOOK_C = path.join(__dirname, 'pm-intake-c.js');
const PM = 'cookys/aimax395/pm--claude';
const OTHER = 'cookys/aimax395/fleet--claude';
const TASK = '01M7XFGT2GCRD8WFJVCANF4HCK';
const CONFIRM = '01M7XFGT2GCRD8WFJVCANF4HCM';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-intake-'));
}

function run(hook, payload, env) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      HOME: env.HOME,
      FLEET_ADDRESS: env.FLEET_ADDRESS || '',
      AUTOPILOT_FLEET_ADDRESS: env.FLEET_ADDRESS || '',
      PM_INTAKE_BIN: env.PM_INTAKE_BIN || '',
      PM_CONSTRAINTS_FILE: env.PM_CONSTRAINTS_FILE || '',
      PM_INTAKE_LOG: env.PM_INTAKE_LOG || '',
      PM_HOST_DENY_FILE: env.PM_HOST_DENY_FILE || path.join(env.HOME, 'no-deny.txt'),
      PM_PLAN_REPO: env.PM_PLAN_REPO || '',
      PM_ANSWER_LOOKUP_BIN: env.PM_ANSWER_LOOKUP_BIN || '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

function writeExe(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function gitRepo(dir) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com',
  };
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  };
  g(['init', '-q']);
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'plan.md'), '搬遷計畫：目錄打包，不用 vzdump。\n');
  g(['add', 'plan.md']);
  g(['commit', '-q', '-m', 'plan']);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).stdout.trim();
  return sha;
}

function transcript(dir, text) {
  const p = path.join(dir, 't.jsonl');
  fs.writeFileSync(p, `${JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  })}\n`);
  return p;
}

test('stub output reaches additionalContext', () => {
  const home = tmp();
  const bin = path.join(home, 'pm-intake');
  writeExe(bin, '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "## constraints" "- all of them" "- second" "## hits"\n');
  for (let i = 1; i <= 12; i += 1) fs.appendFileSync(bin, `echo hit-${i}\n`);
  const r = run(HOOK_A, { hook_event_name: 'UserPromptSubmit', prompt: 'Flash-Next 在哪' }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_BIN: bin,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /all of them/);
  assert.match(ctx, /second/);
  assert.match(ctx, /hit-10/);
  assert.doesNotMatch(ctx, /hit-11/);
  assert.doesNotMatch(ctx, /hit-12/);
});

test('non-PM seat is silent exit 0', () => {
  const home = tmp();
  const bin = path.join(home, 'pm-intake');
  writeExe(bin, '#!/bin/sh\necho SHOULD_NOT_RUN; exit 99\n');
  const r = run(HOOK_A, { hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, {
    HOME: home, FLEET_ADDRESS: OTHER, PM_INTAKE_BIN: bin,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('missing verdict blocks', () => {
  const home = tmp();
  const log = path.join(home, 'intake.jsonl');
  const tp = transcript(home, '建議改用目錄打包，我會派給 fleet。');
  const r = run(HOOK_B, { hook_event_name: 'Stop', transcript_path: tp }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_LOG: log,
  });
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /判定/);
  assert.strictEqual(fs.existsSync(log), false);
});

test('verdict plus evidence passes and logs', () => {
  const home = tmp();
  const log = path.join(home, 'intake.jsonl');
  const tp = transcript(home, `建議先查。\n判定：沒有 docs/plans/x.md@abc1234 擁有 lane：fleet`);
  const r = run(HOOK_B, { hook_event_name: 'Stop', transcript_path: tp }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_LOG: log,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  const line = fs.readFileSync(log, 'utf8').trim();
  const rec = JSON.parse(line);
  assert.strictEqual(rec.verdict, '沒有');
});

test('已經有 without a confirm id blocks', () => {
  const home = tmp();
  const log = path.join(home, 'intake.jsonl');
  const tp = transcript(home, `建議沿用。\n判定：已經有 docs/plans/x.md@abc1234`);
  const r = run(HOOK_B, { hook_event_name: 'Stop', transcript_path: tp }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_LOG: log,
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /待確認|確認/);
});

test('已經有 with 待確認 passes', () => {
  const home = tmp();
  const log = path.join(home, 'intake.jsonl');
  const tp = transcript(home, `推薦沿用。\n判定：已經有 docs/plans/x.md@abc1234\n待確認 ${CONFIRM}`);
  const r = run(HOOK_B, { hook_event_name: 'Stop', transcript_path: tp }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_LOG: log,
  });
  assert.strictEqual(r.stdout, '', r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(log, 'utf8')).verdict, '已經有');
});

test('stop_hook_active passes', () => {
  const home = tmp();
  const tp = transcript(home, '建議改一下。');
  const r = run(HOOK_B, { hook_event_name: 'Stop', transcript_path: tp, stop_hook_active: true }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_LOG: path.join(home, 'intake.jsonl'),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('host deny refuses the log line and blocks', () => {
  const home = tmp();
  const log = path.join(home, 'intake.jsonl');
  const deny = path.join(home, 'deny.txt');
  fs.writeFileSync(deny, 'secretbox\n');
  const tp = transcript(home, '建議不要。\n判定：沒有 docs/a.md@abc1234 擁有 lane：fleet secretbox');
  const r = run(HOOK_B, { hook_event_name: 'Stop', transcript_path: tp }, {
    HOME: home, FLEET_ADDRESS: PM, PM_INTAKE_LOG: log, PM_HOST_DENY_FILE: deny,
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /secretbox/);
  assert.strictEqual(fs.existsSync(log), false);
});

function go(text) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__fleet__dispatch',
    tool_input: { task: text },
  };
}

function lookupStub(home, mode) {
  const bin = path.join(home, 'lookup');
  const body = `#!/bin/sh
id="$1"
if [ "$id" = "OPGOOD" ]; then echo '{"exists":true,"from_operator":true,"question":"please release 16c69c54"}'; exit 0; fi
if [ "$id" = "PMSELF" ]; then echo '{"exists":true,"from_operator":false,"question":"please release 16c69c54"}'; exit 0; fi
if [ "$id" = "NOSHA" ]; then echo '{"exists":true,"from_operator":true,"question":"unrelated card"}'; exit 0; fi
echo '{"exists":false,"from_operator":false,"question":""}'
`;
  writeExe(bin, body);
  return bin;
}

test('F2 vzdump whole-VM migration denies', () => {
  const home = tmp();
  const r = run(HOOK_C, go('核准整機搬遷，用 vzdump 做 whole-VM'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /C-16c69c54-f2/);
  assert.match(reason, /vzdump/);
  assert.match(reason, /override:16c69c54:/);
});

test('F2 目錄打包 v3 allows', () => {
  const home = tmp();
  const r = run(HOOK_C, go('核准搬遷。用目錄打包，不整機複製。\nC-16c69c54-f2: 符合'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
});

test('valid operator override allows a forbid hit', () => {
  const home = tmp();
  const r = run(HOOK_C, go('go 整機 vzdump 搬遷 override:16c69c54:OPGOOD'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  assert.strictEqual(r.stdout, '', r.stdout + r.stderr);
});

test('forbid hit still denies when PM_ANSWER_LOOKUP_BIN is unset (no fail-open)', () => {
  const home = tmp();
  const r = run(HOOK_C, go('核准整機搬遷，用 vzdump 做 whole-VM'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE,
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('PM seat with PM_CONSTRAINTS_FILE unset or unreadable denies (no silent fail-open)', () => {
  const home = tmp();
  const r = run(HOOK_C, go('ruling go: 任何內容'), { HOME: home, FLEET_ADDRESS: PM });
  assert.strictEqual(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /PM_CONSTRAINTS_FILE 沒設/);
  const r2 = run(HOOK_C, go('ruling go: 任何內容'), { HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: home + '/nope.md' });
  assert.strictEqual(JSON.parse(r2.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const r3 = run(HOOK_C, go('ruling go: 任何內容'), { HOME: home, FLEET_ADDRESS: 'cookys/aimax395-team/autopilot--claude' });
  assert.strictEqual(r3.stdout, '');
});

test('PM-origin answer id denies', () => {
  const home = tmp();
  const r = run(HOOK_C, go('核准 vzdump 搬遷 override:16c69c54:PMSELF'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /C-16c69c54-f2/);
});

test('answer whose question lacks the sha denies', () => {
  const home = tmp();
  const r = run(HOOK_C, go('核准 vzdump 搬遷 override:16c69c54:NOSHA'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('unreadable path@sha blocks', () => {
  const home = tmp();
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  gitRepo(repo);
  const r = run(HOOK_C, go('核准。docs/missing.md@abc1234 C-16c69c54-f2: 不適用：沒有搬遷'), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_PLAN_REPO: repo, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /docs\/missing\.md@abc1234/);
});

test('readable path@sha is part of the plan text', () => {
  const home = tmp();
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  const sha = gitRepo(repo);
  const short = sha.slice(0, 7);
  const r = run(HOOK_C, go(`核准。plan.md@${short}\nC-16c69c54-f2: 符合`), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_PLAN_REPO: repo, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  // fetched body contains vzdump, so the forbid hits even though the go says 符合
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /vzdump/);
});

test('open-decision close is a trigger', () => {
  const home = tmp();
  const r = run(HOOK_C, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'node scripts/open-decision.js close --id d-abc 整機 vzdump 搬遷' },
  }, {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('non-PM PreToolUse is silent', () => {
  const home = tmp();
  const r = run(HOOK_C, go('核准 vzdump 搬遷'), {
    HOME: home, FLEET_ADDRESS: OTHER, PM_CONSTRAINTS_FILE: FIXTURE,
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('receipt id alone does not pass a matching scope', () => {
  const home = tmp();
  const r = run(HOOK_C, go(`核准搬遷用目錄打包。收據 ${TASK}`), {
    HOME: home, FLEET_ADDRESS: PM, PM_CONSTRAINTS_FILE: FIXTURE, PM_ANSWER_LOOKUP_BIN: lookupStub(home),
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /C-16c69c54-f2: 符合/);
});
