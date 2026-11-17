'use strict';

// Synthetic fixtures only. Run: node --test hooks/secret-output-redact.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const evidence = fs.mkdtempSync(path.join(__dirname, '..', '.secret-output-redact-test-'));
const config = path.join(evidence, 'config.json');
fs.writeFileSync(config, '{}');
test.after(() => {
  fs.unlinkSync(config);
  fs.rmdirSync(evidence);
});

function run(response, { mode, cfg = {}, tool = 'Bash', event = 'PostToolUse' } = {}) {
  fs.writeFileSync(config, JSON.stringify(cfg));
  const env = { ...process.env, AUTOPILOT_CONFIG_FILE: config };
  delete env.AUTOPILOT_BASH_GUARD_SECRET_MODE;
  if (mode !== undefined) env.AUTOPILOT_BASH_GUARD_SECRET_MODE = mode;
  const child = spawnSync(process.execPath, [path.join(__dirname, 'secret-output-redact.js')], {
    input: JSON.stringify({ hook_event_name: event, tool_name: tool, tool_response: response }),
    encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, timeout: 5000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  return child.stdout ? JSON.parse(child.stdout) : null;
}

function response(stdout, stderr = '') {
  return { stdout, stderr, interrupted: false, isImage: false, noOutputExpected: false };
}

function expectRedacted(input, expected) {
  const original = response(input, input);
  assert.deepEqual(run(original), {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: { ...original, stdout: expected, stderr: expected },
    },
  });
}

const defines = [
  ["define('AUTH_SALT', 'synthetic-salt-value-0001');", "define('AUTH_SALT', '[REDACTED]');"],
  ['define("DB_PASSWORD", "synthetic-password-0001")', 'define("DB_PASSWORD", "[REDACTED]")'],
  ["define(\t'API_TOKEN' ,\t 'synthetic-token-0001'\t);", "define(\t'API_TOKEN' ,\t '[REDACTED]'\t);"],
  ["define('API_KEY','synthetic-key-0001')", "define('API_KEY','[REDACTED]')"],
  ["define('auth_salt','synthetic-salt-value-0001');", "define('auth_salt','[REDACTED]');"],
  ["define('AUTH_SALT', 'synthetic-salt-value-0001'", "define('AUTH_SALT', '[REDACTED]'"],
  ['define("PASS",\'synthetic "other quote"\');', 'define("PASS",\'[REDACTED]\');'],
  ['define(\'SECRET\',"synthetic \'other quote\'");', 'define(\'SECRET\',"[REDACTED]");'],
  [String.raw`define('SECRET','synthetic\'quote\\tail');`, "define('SECRET','[REDACTED]');"],
  [String.raw`define("SECRET","synthetic\"quote\\tail");`, 'define("SECRET","[REDACTED]");'],
];
for (const [input, expected] of defines) {
  test(`PHP ${input}`, () => expectRedacted(input, expected));
}

const assignments = [
  ['Environment=AUTH_SALT=synthetic-salt-value-0001', 'Environment=AUTH_SALT=[REDACTED]'],
  ['Environment="API_TOKEN=synthetic token" "DB_PASSWORD=synthetic password" "MODE=debug"',
    'Environment="API_TOKEN=[REDACTED]" "DB_PASSWORD=[REDACTED]" "MODE=debug"'],
  ["Environment='SECRET=synthetic secret' API_KEY=synthetic-key-0001", "Environment='SECRET=[REDACTED]' API_KEY=[REDACTED]"],
  ['export API_KEY=synthetic-key-0001', 'export API_KEY=[REDACTED]'],
  ["  export DB_PASS='synthetic password'  # keep comment", "  export DB_PASS='[REDACTED]'  # keep comment"],
  ['auth_salt=synthetic-salt-value-0001', 'auth_salt=[REDACTED]'],
  ['SECRET=synthetic value with spaces', 'SECRET=[REDACTED]'],
  [String.raw`Environment="SECRET=synthetic\"quote" "TOKEN=synthetic-token-0001"`,
    'Environment="SECRET=[REDACTED]" "TOKEN=[REDACTED]"'],
];
for (const [input, expected] of assignments) {
  test(`env ${input}`, () => expectRedacted(input, expected));
}

test('service token: shared patterns redact every occurrence', () => {
  const token = 'ghp_' + 'A'.repeat(36);
  expectRedacted(`before ${token}\nafter ${token}`, 'before [REDACTED]\nafter [REDACTED]');
});

test('negative: unchanged lines produce no output', () => {
  assert.equal(run(response("define('WP_DEBUG', true);\r\nKEYBOARD text\nline without assignment\nMODE=debug\n")), null);
});
test('negative: preserve surrounding bytes and response metadata', () => {
  const original = { ...response("before\r\ndefine('SECRET','synthetic');\r\nafter\t\n", 'unchanged\r\n'), extra: 42 };
  assert.deepEqual(run(original).hookSpecificOutput.updatedToolOutput, {
    ...original, stdout: "before\r\ndefine('SECRET','[REDACTED]');\r\nafter\t\n",
  });
});
test('knob off: env and config emit nothing', () => {
  const original = response("define('SECRET','synthetic');");
  assert.equal(run(original, { mode: 'off' }), null);
  assert.equal(run(original, { cfg: { depth0_delegate_gate: { secret_print: 'off' } } }), null);
});
test('knob warn: env/config redact and env wins', () => {
  const original = response("define('SECRET','synthetic');");
  for (const opts of [
    { mode: 'warn' }, { cfg: { depth0_delegate_gate: { secret_print: 'warn' } } },
    { mode: 'block', cfg: { depth0_delegate_gate: { secret_print: 'off' } } },
    { mode: 'invalid', cfg: { depth0_delegate_gate: { secret_print: 'off' } } },
  ]) assert.equal(run(original, opts).hookSpecificOutput.updatedToolOutput.stdout, "define('SECRET','[REDACTED]');");
});
test('malformed: string or missing stdout produces null', () => {
  for (const original of ['SECRET=synthetic', {}, { stderr: 'SECRET=synthetic' }, { stdout: null }, null]) {
    assert.equal(run(original), null);
  }
});
test('wrong event/tool: no output', () => {
  assert.equal(run(response('SECRET=synthetic'), { tool: 'Read' }), null);
  assert.equal(run(response('SECRET=synthetic'), { event: 'PreToolUse' }), null);
});
test('large: several MB of matching and unterminated input completes within hook timeout', () => {
  const block = "x".repeat(1024) + "\n";
  const input = block.repeat(2048) + "define('SECRET','" + 'x'.repeat(1024 * 1024) + '\nSECRET=synthetic\n';
  const result = run(response(input));
  assert.equal(result.hookSpecificOutput.updatedToolOutput.stdout, input.replace('SECRET=synthetic', 'SECRET=[REDACTED]'));
});

test('wiring: default-on Bash hook is registered exactly once and retained in profiles', () => {
  const manifest = require('./hooks.json');
  const entries = Object.entries(manifest.hooks).flatMap(([event, groups]) =>
    groups.flatMap(group => group.hooks.filter(h => h.command.includes('/secret-output-redact.js'))
      .map(h => ({ event, matcher: group.matcher, ...h }))));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'PostToolUse');
  assert.equal(entries[0].matcher, 'Bash');
  assert.ok(!require('./opt-in-manifest.json').opt_in.includes('secret-output-redact'));
  assert.equal(require('../profiles/hook-classes.json').hooks.find(h => h.stem === 'secret-output-redact')?.class, 'invariant_effect');
});
