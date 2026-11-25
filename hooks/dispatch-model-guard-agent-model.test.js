'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK_PATH = path.resolve(__dirname, 'dispatch-model-guard.js');

function runGuard(payload, env = {}) {
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: '',
      AUTOPILOT_MECHANICAL_REROUTE: 'off',
      AUTOPILOT_FLEET_TASK: '01M7ZDSR7X7C6GVSB6T3Q6YC3G',
      ...env,
    },
  });
  let json = null;
  const stdout = (res.stdout || '').trim();
  if (stdout) {
    json = JSON.parse(stdout);
  }
  return { status: res.status, stdout, stderr: res.stderr || '', json };
}

function makeTempRepo(agentFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-agent-model-'));
  const agentsDir = path.join(dir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const [name, content] of Object.entries(agentFiles)) {
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), content, 'utf8');
  }
  return dir;
}

test('allows dispatch when model is omitted and agent frontmatter declares model: sonnet', () => {
  const cwd = makeTempRepo({
    'custom-worker': '---\nname: custom-worker\nmodel: sonnet\n---\nBody\n',
  });
  try {
    const res = runGuard({
      tool_name: 'Agent',
      cwd,
      tool_input: {
        subagent_type: 'custom-worker',
        prompt: 'Engine: sonnet\nDo the task.',
      },
    });
    assert.equal(res.status, 0);
    assert.equal(res.json, null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runs opus/fable cost and Model-Reason checks when model is omitted and agent frontmatter declares model: opus', () => {
  const cwd = makeTempRepo({
    'opus-reviewer': '---\nname: opus-reviewer\nmodel: opus\n---\nBody\n',
  });
  try {
    const denied = runGuard({
      tool_name: 'Agent',
      cwd,
      tool_input: {
        subagent_type: 'opus-reviewer',
        prompt: 'Engine: opus (intentional: test)\nReview this.',
      },
    });
    assert.equal(denied.status, 0);
    assert.equal(denied.json?.hookSpecificOutput?.permissionDecision, 'deny');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('falls back to worker-level default when agent frontmatter has no model and call omits model', () => {
  const cwd = makeTempRepo({
    'no-model-agent': '---\nname: no-model-agent\ndescription: no model\n---\nBody\n',
  });
  try {
    const res = runGuard({
      tool_name: 'Agent',
      cwd,
      tool_input: {
        subagent_type: 'no-model-agent',
        prompt: 'Do the task.',
      },
    });
    assert.equal(res.status, 0);
    assert.equal(res.json?.hookSpecificOutput?.permissionDecision, 'allow');
    assert.equal(res.json?.hookSpecificOutput?.updatedInput?.model, 'sonnet');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('explicit caller model overrides agent frontmatter model and runs normal checks', () => {
  const cwd = makeTempRepo({
    'sonnet-agent': '---\nname: sonnet-agent\nmodel: sonnet\n---\nBody\n',
  });
  try {
    const res = runGuard({
      tool_name: 'Agent',
      cwd,
      tool_input: {
        subagent_type: 'sonnet-agent',
        model: 'opus',
        prompt: 'Engine: sonnet\nDo the task.',
      },
    });
    assert.equal(res.status, 0);
    assert.equal(res.json?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(res.json?.hookSpecificOutput?.permissionDecisionReason || '', /model:\s*opus/i);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('M11: an allowed Agent dispatch leaves a ledger row with role, subagent_type, model, usd (usd unknown = null)', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-ledger-'));
  try {
    const res = runGuard({
      tool_name: 'Agent',
      tool_use_id: 'toolu_m11probe',
      tool_input: { subagent_type: 'general-purpose', model: 'haiku', description: 'x', prompt: 'Engine: haiku | Role: reviewer | Lane: x | Size: S | Used-by: n/a probe\nhi' },
    }, { AUTOPILOT_LIVE_DIR: live });
    assert.equal(res.status, 0);
    const file = fs.readdirSync(live).find((n) => /^dispatch-usage-\d{6}\.jsonl$/.test(n));
    assert.ok(file, 'ledger file written');
    const row = JSON.parse(fs.readFileSync(path.join(live, file), 'utf8').trim().split('\n').pop());
    assert.equal(row.run_id, 'toolu_m11probe');
    assert.equal(row.role, 'reviewer');
    assert.equal(row.subagent_type, 'general-purpose');
    assert.equal(row.model, 'haiku');
    assert.equal(row.usd, null);
  } finally {
    fs.rmSync(live, { recursive: true, force: true });
  }
});
