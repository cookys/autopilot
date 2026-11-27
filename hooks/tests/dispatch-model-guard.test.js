'use strict';
// M10: the guard honours `model:` in an agent file's frontmatter instead of rewriting to sonnet.
// GUARD_UNDER_TEST overrides the guard path (used to show red against the pre-M10 guard).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = process.env.GUARD_UNDER_TEST || path.resolve(__dirname, '..', 'dispatch-model-guard.js');

function run(cwd, toolInput) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-home-'));
  const env = { ...process.env, HOME: home, AUTOPILOT_DISPATCH_ROLE: 'probe-model-guard-test',
    AUTOPILOT_STATE_DIR: path.join(home, 'state') };
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) delete env[k];
  const input = { tool_name: 'Agent', tool_input: toolInput, hook_event_name: 'PreToolUse', cwd };
  const r = spawnSync('node', [GUARD], { input: JSON.stringify(input), env, encoding: 'utf8' });
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}

function sandbox(agentModel) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-cwd-'));
  fs.mkdirSync(path.join(d, 'agents'));
  fs.writeFileSync(path.join(d, 'agents', 'cheap.md'), `---\nname: cheap\n${agentModel ? `model: ${agentModel}\n` : ''}---\nbody\n`);
  return d;
}

const PROMPT = (engine) => `Engine: ${engine}\nFleet-Task: 01M8F0DMFESJZ0Y45VBR2ZSZ76\nDo work.`;

test('agent file with model: haiku is NOT rewritten to sonnet', () => {
  const d = sandbox('haiku');
  const r = run(d, { subagent_type: 'cheap', prompt: PROMPT('haiku') });
  fs.rmSync(d, { recursive: true, force: true });
  assert.strictEqual(r.status, 0);
  assert.ok(!/updatedInput/.test(r.stdout), `unexpected rewrite: ${r.stdout}`);
  assert.ok(!/"model":"sonnet"/.test(r.stdout), r.stdout);
});

test('agent file without model: still defaults to sonnet', () => {
  const d = sandbox('');
  const r = run(d, { subagent_type: 'cheap', prompt: PROMPT('sonnet') });
  fs.rmSync(d, { recursive: true, force: true });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /"model":"sonnet"/);
});

test('explicit model on the call beats the agent file', () => {
  const d = sandbox('haiku');
  const r = run(d, { subagent_type: 'cheap', model: 'sonnet', prompt: PROMPT('sonnet') });
  fs.rmSync(d, { recursive: true, force: true });
  assert.strictEqual(r.status, 0);
  assert.ok(!/updatedInput/.test(r.stdout), r.stdout);
});
