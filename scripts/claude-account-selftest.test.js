#!/usr/bin/env node
'use strict';
// G37 selftest --real-binary (O6) and --simulate-429 (O9) tests. Tempdir only, FAKE- tokens, Node shims
// as the `--binary`, a local HTTP server. Never the real claude, never the Anthropic API, never a real ~/.claude.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cli, judgeRealBinary, EXIT } = require('./claude-account.js');
const { makeFixture } = require('./lib/account-fixtures/shim-install.js');

const R401 = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.' });
const R429 = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: "API Error: Server is temporarily limiting requests (not your usage limit) · This request would exceed your account's rate limit. (local synthetic)" });
const ANSWER = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' });

function mkShim(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/usr/bin/env node\n'use strict';\n${body}\n`, { mode: 0o755 });
  fs.chmodSync(p, 0o755);
  return p;
}
async function go(fx, args) {
  let out = ''; let err = '';
  const code = await cli(args, {
    env: fx.env, realHome: fx.realHome, warn: () => {},
    write: (fd, d) => { if (fd === 1) out += d.toString(); else err += d.toString(); },
  });
  return { code, out, err };
}
const shimMode = (mode) => `
const o = ${JSON.stringify({ r401: R401, answer: ANSWER })};
if ('${mode}' === '401') { process.stdout.write(o.r401 + '\\n'); process.exitCode = 1; }
else { process.stdout.write(o.answer + '\\n'); }`;

test('real-binary: 401 shim passes, prints the line, exit 0', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const bin = mkShim(fx.root, 'bin401.js', shimMode('401'));
  const r = await go(fx, ['selftest', '--real-binary', '--binary', bin]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /selftest: fake token -> 401, ambient login not used/);
  fx.cleanup();
});

test('real-binary: shim answers normally (fell back to a login) -> exit 1', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const bin = mkShim(fx.root, 'binok.js', shimMode('answer'));
  const r = await go(fx, ['selftest', '--real-binary', '--binary', bin]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /exit_not_auth/);
  assert.doesNotMatch(r.out, /ambient login not used/);
  fx.cleanup();
});

test('real-binary: answer despite exit 6 is still caught by the no-normal-answer rule', () => {
  const tmpRoot = '/tmp/x/base';
  const good = { home: `${tmpRoot}/accounts/p/home`, config_dir: `${tmpRoot}/accounts/p/claude` };
  const base = { code: 6, stdout: ANSWER, observed: good, tmpRoot, realHome: '/tmp/x/realhome' };
  assert.ok(judgeRealBinary(base).some((b) => /normal_answer/.test(b)));
  assert.deepStrictEqual(judgeRealBinary(Object.assign({}, base, { stdout: R401 })), []);
});

test('real-binary: child HOME or CLAUDE_CONFIG_DIR at the real home -> fails', () => {
  const tmpRoot = '/tmp/x/base';
  const mk = (o) => ({ code: 6, stdout: R401, observed: o, tmpRoot, realHome: '/tmp/x/realhome' });
  assert.ok(judgeRealBinary(mk({ home: '/tmp/x/realhome', config_dir: `${tmpRoot}/c` })).some((b) => /HOME/.test(b)));
  assert.ok(judgeRealBinary(mk({ home: `${tmpRoot}/h`, config_dir: '/tmp/x/realhome/.claude' })).some((b) => /CONFIG_DIR/.test(b)));
  assert.ok(judgeRealBinary(mk(null)).some((b) => /not_observed/.test(b)));
});

test('real-binary: leaves the fixture world untouched and removes its own tempdir', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const bin = mkShim(fx.root, 'bin401.js', shimMode('401'));
  const before = fs.readdirSync(fx.tmpDir).length;
  await go(fx, ['selftest', '--real-binary', '--binary', bin]);
  assert.strictEqual(fs.readdirSync(fx.tmpDir).length, before);
  assert.ok(!fs.existsSync(fx.auditFile), 'selftest must not write the operator audit log');
  fx.cleanup();
});

// A: reaches the local server named by ANTHROPIC_BASE_URL and reports its 429. B: answers.
function simShim(logFile) {
  return `
const fs = require('fs'); const http = require('http');
const base = process.env.ANTHROPIC_BASE_URL;
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ account: process.env.AUTOPILOT_ACCOUNT, base: base || null,
  proxy: ['HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy'].filter((k) => process.env[k]) }) + '\\n');
if (!base) { process.stdout.write(${JSON.stringify(ANSWER)} + '\\n'); }
else {
  const rq = http.request(base + '/v1/messages', { method: 'POST' }, (res) => {
    res.resume(); res.on('end', () => { if (res.statusCode === 429) { process.stdout.write(${JSON.stringify(R429)} + '\\n'); process.exitCode = 1; } });
  });
  rq.setTimeout(1500, () => rq.destroy()); rq.on('error', () => { process.exitCode = 3; }); rq.end('{}');
}`;
}
const logOf = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('simulate-429: A hits only the local server, cooldown written, B answers, status shows A cooling', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  const log = path.join(fx.root, 'sim.log');
  const bin = mkShim(fx.root, 'binsim.js', simShim(log));
  const r = await go(fx, ['selftest', '--simulate-429', 'a', '--binary', bin]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /^a rate_limited -> b ok$/m);
  const calls = logOf(log);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].account, 'a');
  assert.match(calls[0].base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepStrictEqual(calls[0].proxy, []);
  assert.strictEqual(calls[1].account, 'b');
  assert.strictEqual(calls[1].base, null, 'B must run on its real route, no base URL seam');
  const st = await go(fx, ['status']);
  assert.match(st.out, /alias=a [^\n]*cooldown_until=(?!-)/);
  assert.match(st.out, /alias=b [^\n]*cooldown_until=-/);
  fx.cleanup();
});

test('simulate-429: the base URL seam is not reachable from the caller env or argv', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }] });
  const log = path.join(fx.root, 'sim.log');
  const bin = mkShim(fx.root, 'binsim.js', simShim(log));
  fx.env.ANTHROPIC_BASE_URL = 'http://203.0.113.9:1';
  const r = await go(fx, ['run', '--purpose', 'tst', '--alias', 'a', '--', bin, '-p', 'x']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(logOf(log)[0].base, null);
  const bad = await go(fx, ['run', '--purpose', 'tst', '--child-env', 'ANTHROPIC_BASE_URL=http://x', '--', bin]);
  assert.strictEqual(bad.code, 2);
  fx.cleanup();
});

test('simulate-429: unknown alias and bad flag combinations exit 2 without spawning', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const log = path.join(fx.root, 'sim.log');
  const bin = mkShim(fx.root, 'binsim.js', simShim(log));
  assert.strictEqual((await go(fx, ['selftest', '--simulate-429', 'zz', '--binary', bin])).code, 2);
  assert.strictEqual((await go(fx, ['selftest', '--simulate-429', 'a', '--real-binary'])).code, 2);
  assert.strictEqual((await go(fx, ['selftest', '--binary', bin])).code, 2);
  assert.ok(!fs.existsSync(log));
  fx.cleanup();
});

test('simulate-429: only one alias, so nobody can take over -> exit 1, not a pass', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const bin = mkShim(fx.root, 'binsim.js', simShim(path.join(fx.root, 'sim.log')));
  const r = await go(fx, ['selftest', '--simulate-429', 'a', '--binary', bin]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /next_alias_not_ok/);
  fx.cleanup();
});
