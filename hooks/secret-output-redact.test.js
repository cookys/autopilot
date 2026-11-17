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

function run(response, { mode, cfg = {}, tool = 'Bash', event = 'PostToolUse', timeout = 5000 } = {}) {
  fs.writeFileSync(config, JSON.stringify(cfg));
  const env = { ...process.env, AUTOPILOT_CONFIG_FILE: config };
  delete env.AUTOPILOT_BASH_GUARD_SECRET_MODE;
  if (mode !== undefined) env.AUTOPILOT_BASH_GUARD_SECRET_MODE = mode;
  const child = spawnSync(process.execPath, [path.join(__dirname, 'secret-output-redact.js')], {
    input: JSON.stringify({ hook_event_name: event, tool_name: tool, tool_response: response }),
    encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, timeout,
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

const grepYaml = [
  ['grep -n YAML list assignment', '7:      - MYSQL_ROOT_PASSWORD=S3cr3t-synthetic-001 with spaces',
    '7:      - MYSQL_ROOT_PASSWORD=[REDACTED]'],
  ['grep -Hn YAML list assignment', 'docker-compose.yml:7:      - DB_PASSWORD=S3cr3t-synthetic-001 with spaces',
    'docker-compose.yml:7:      - DB_PASSWORD=[REDACTED]'],
  ['rg YAML list assignment', 'config/docker-compose.yml:7:  - API_KEY=S3cr3t-synthetic-001 with spaces',
    'config/docker-compose.yml:7:  - API_KEY=[REDACTED]'],
  ['YAML list mapping', '7:      - MYSQL_ROOT_PASSWORD: S3cr3t-synthetic-001',
    '7:      - MYSQL_ROOT_PASSWORD: [REDACTED]'],
  ['grep -Hn YAML list mapping', 'docker-compose.yml:7:  - PRIVATE_KEY: S3cr3t-synthetic-001',
    'docker-compose.yml:7:  - PRIVATE_KEY: [REDACTED]'],
  ['quoted YAML list assignment', '7:  - "API_KEY=S3cr3t-synthetic-001"',
    '7:  - "API_KEY=[REDACTED]"'],
  ['single-quoted YAML list assignment', "- 'TOKEN=S3cr3t-synthetic-001 with spaces' # comment",
    "- 'TOKEN=[REDACTED]' # comment"],
  ['credential YAML list mapping', '- CREDENTIALS: S3cr3t-synthetic-001',
    '- CREDENTIALS: [REDACTED]'],
  ['passwd YAML list mapping', '- db_passwd: S3cr3t-synthetic-001',
    '- db_passwd: [REDACTED]'],
];
for (const [name, input, expected] of grepYaml) {
  test(`grep/YAML ${name}`, () => expectRedacted(input, expected));
}
test('grep/YAML exact incident and negative controls retain existing behavior', () => {
  expectRedacted('7:      - MYSQL_ROOT_PASSWORD=S3cr3t-synthetic-001',
    '7:      - MYSQL_ROOT_PASSWORD=[REDACTED]');
  assert.equal(run(response('7:  - IMAGE=percona:8.0\r\n- MODE: debug\n- "IMAGE=percona:8.0"')), null);
  // The existing secretName rule treats KEY_COUNT as secret; preserve that contract.
  expectRedacted('- KEY_COUNT=3', '- KEY_COUNT=[REDACTED]');
});

const spacedAssignments = [
  ['DB_PASSWORD = "synthetic"', 'DB_PASSWORD = "[REDACTED]"'],
  ['api_key = synthetic', 'api_key = [REDACTED]'],
  ['export DB_PASS=synthetic', 'export DB_PASS=[REDACTED]'],
  ['DB_PASS= "synthetic" # comment', 'DB_PASS= "[REDACTED]" # comment'],
  ['api_key = synthetic  # comment', 'api_key = [REDACTED]  # comment'],
  ['DB_PASS = synthetic#inline\t # comment', 'DB_PASS = [REDACTED]\t # comment'],
  ['Environment="API_TOKEN = synthetic"', 'Environment="API_TOKEN = [REDACTED]"'],
  ['Environment="API_TOKEN = synthetic # secret tail" # comment',
    'Environment="API_TOKEN = [REDACTED]" # comment'],
  [" \texport DB_PASS\t =\t 'synthetic'  # comment", " \texport DB_PASS\t =\t '[REDACTED]'  # comment"],
  ['Environment="API_TOKEN\t=\tsynthetic" "MODE=ok"', 'Environment="API_TOKEN\t=\t[REDACTED]" "MODE=ok"'],
  ['MODE = synthetic\r\nDB_PASS = "synthetic" # comment\r\nnext',
    'MODE = synthetic\r\nDB_PASS = "[REDACTED]" # comment\r\nnext'],
];
for (const [input, expected] of spacedAssignments) {
  test(`spaced assignment ${input}`, () => expectRedacted(input, expected));
}

const properties = [
  ['"password": "synthetic"', '"password": "[REDACTED]"'],
  ['{"api_key":"x","name":"ok"}', '{"api_key":"[REDACTED]","name":"ok"}'],
  ['{"SaLt":"synthetic","PASS":"synthetic","SECRET":"synthetic","TOKEN":"synthetic","KEY":"synthetic"}',
    '{"SaLt":"[REDACTED]","PASS":"[REDACTED]","SECRET":"[REDACTED]","TOKEN":"[REDACTED]","KEY":"[REDACTED]"}'],
  ["'db_pass'\t:\t'synthetic' # comment", "'db_pass'\t:\t'[REDACTED]' # comment"],
  ['api_key: "synthetic" # comment', 'api_key: "[REDACTED]" # comment'],
  [String.raw`{"password":"synthetic\"quote\\tail","name":"ok"}`, '{"password":"[REDACTED]","name":"ok"}'],
  ['"password": "synthetic"\r\n"name": "ok"', '"password": "[REDACTED]"\r\n"name": "ok"'],
];
for (const [input, expected] of properties) {
  test(`secret property ${input}`, () => expectRedacted(input, expected));
}
const statelessProperties = [
  ['client-secret-id: "synthetic"', 'client-secret-id: "[REDACTED]"'],
  ['secret-1: "synthetic"', 'secret-1: "[REDACTED]"'],
  ['api.key: "synthetic"', 'api.key: "[REDACTED]"'],
  [String.raw`password: 'secret\'`, "password: '[REDACTED]'"],
  ["password: 'it''s_secret'", "password: '[REDACTED]'"],
  ['Can\'t parse {"password": "synthetic"}', 'Can\'t parse {"password": "[REDACTED]"}'],
  ['INFO: "password": "synthetic"', 'INFO: "password": "[REDACTED]"'],
  ['config.yaml:api_key: "synthetic"', 'config.yaml:api_key: "[REDACTED]"'],
  ['config.secret: "name": "ok"', 'config.secret: "name": "ok"'],
  ['{"api_key":"x","name":"ok"}', '{"api_key":"[REDACTED]","name":"ok"}'],
  ['{"name":"password","value":"ok"}', '{"name":"password","value":"ok"}'],
  ['password: string', 'password: string'],
];
for (const [input, expected] of statelessProperties) {
  test(`stateless property ${input}`, () => {
    if (input === expected) assert.equal(run(response(input, input)), null);
    else expectRedacted(input, expected);
  });
}
test('negative properties: benign keys, quoted content and line boundaries stay intact', () => {
  const input = String.raw`{"name":"ok","message":"\"password\": \"synthetic\""}` +
    '\n"password":\n"synthetic"\n"password": "unterminated\nnext line\n';
  assert.equal(run(response(input)), null);
});

for (const fragment of ['a=', '"k":', String.raw`\"`, "'", '"password": "\n', '"password": "']) {
  test(`linear time: 1 MiB of ${fragment} finishes under 1 s`, () => {
    const input = fragment.repeat(Math.ceil(1024 * 1024 / fragment.length)).slice(0, 1024 * 1024);
    const start = performance.now();
    const result = run(response(input), { timeout: 1000 });
    // Repetition on one line closes alternating values; line-separated values
    // remain unterminated. Both must finish within the same bound.
    if (fragment === '"password": "') assert.ok(result.hookSpecificOutput.updatedToolOutput.stdout.includes('[REDACTED]'));
    else assert.equal(result, null);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1000, `redaction took ${elapsed.toFixed(1)} ms`);
  });
}
test('linear time: 1 MiB unterminated property value finishes under 1 s', () => {
  const input = '"password": "' + 'x'.repeat(1024 * 1024);
  const start = performance.now();
  assert.equal(run(response(input), { timeout: 1000 }), null);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `redaction took ${elapsed.toFixed(1)} ms`);
});

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
