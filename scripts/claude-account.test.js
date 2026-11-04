#!/usr/bin/env node
'use strict';
// G37 P3 tests: N1 N2b N5 N6 N7 N12 N14 N16 N17 N18 N19 N20 T-GIT (+ all_tight_refused mapping, no-echo).
// Tempdir only, FAKE- tokens, Node claude shim only. No real home, credential, or network.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { cli, createScrubber } = require('./claude-account.js');
const { makeFixture, R401, R429, R429_USAGE, ERR_EXIT0, OK } = require('./lib/account-fixtures/shim-install.js');
const quota = require('./lib/account-quota.js');

async function go(fx, args, extraEnv, now) {
  let out = '';
  let err = '';
  const code = await cli(args, {
    env: Object.assign({}, fx.env, extraEnv || {}), realHome: fx.realHome, warn: () => {}, now,
    write: (fd, d) => { if (fd === 1) out += d.toString(); else err += d.toString(); },
  });
  return { code, out, err };
}
const EMAIL = ['fixture', 'example.invalid'].join('@');
const RUN = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi'];
const auditLines = (fx) => (fs.existsSync(fx.auditFile) ? fs.readFileSync(fx.auditFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const outcomes = (fx) => auditLines(fx).map((r) => `${r.alias}:${r.attempt}:${r.outcome}`);
const snap = (alias, pct) => ({
  schema: quota.SCHEMA, alias, root: null, written_at_ms: Date.now(),
  five_hour: { pct, resets_at: Math.floor(Date.now() / 1000) + 3600 }, seven_day: null,
});
function findToken(dir, token, skip) {
  const hits = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && !skip.includes(p) && fs.readFileSync(p).includes(token)) hits.push(p);
    }
  })(dir);
  return hits;
}

test('N1: bad token -> 401 -> exit 6; ambient decoy never used; env points at alias dirs', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', token: 'FAKE-bad' }] });
  fx.shim.setControl({ tokens: { 'FAKE-bad': R401 } });
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 6);
  assert.match(r.err, /STOP_AUTH alias=a/);
  const calls = fx.shim.calls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].decoy_read, false);
  assert.notStrictEqual(calls[0].home, fx.realHome);
  assert.strictEqual(calls[0].home, path.join(fx.accountsDir, 'a', 'home'));
  assert.strictEqual(calls[0].config_dir, path.join(fx.accountsDir, 'a', 'claude'));
  fx.cleanup();
});

test('N1b: broken registry fails closed, shim never spawned, decoy never read', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  fs.chmodSync(path.join(fx.accountsDir, 'registry.json'), 0o644);
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(fx.shim.spawns(), 0);
  fx.cleanup();
});

test('N2b: preferred alias with 0644 token stops the whole run; healthy second is not used', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  fs.chmodSync(path.join(fx.accountsDir, 'a', 'token'), 0o644);
  let r = await go(fx, RUN);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(fx.shim.spawns(), 0);
  fs.chmodSync(path.join(fx.accountsDir, 'a', 'token'), 0o600);
  fs.writeFileSync(path.join(fx.accountsDir, 'a', 'claude', '.credentials.json'), '{}');
  r = await go(fx, RUN);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(fx.shim.spawns(), 0);
  fx.cleanup();
});

test('N5: a child that prints the token (plain and split) -> exit 7, token only in the token file', async () => {
  for (const leak of ['plain', 'split']) {
    const fx = makeFixture({ aliases: [{ alias: 'a', token: 'FAKE-leaktoken-0123456789' }] });
    fx.shim.setControl({ tokens: { 'FAKE-leaktoken-0123456789': { exit: 0, leak, stdout: OK.stdout } } });
    const so = path.join(fx.root, 'final.out');
    const se = path.join(fx.root, 'final.err');
    const r = await go(fx, ['run', '--purpose', 'tst', '--stdout', so, '--stderr', se, '--', 'claude', '-p', 'hi']);
    assert.strictEqual(r.code, 7, leak);
    assert.match(fs.readFileSync(so, 'utf8'), /\[token-scrubbed\]/);
    const tokenFile = path.join(fx.accountsDir, 'a', 'token');
    assert.deepStrictEqual(findToken(fx.root, 'FAKE-leaktoken-0123456789', [tokenFile, fx.shim.controlFile]), [], leak);
    assert.ok(!r.out.includes('FAKE-leaktoken') && !r.err.includes('FAKE-leaktoken'));
    assert.ok(outcomes(fx).includes('a:1:token_scrubbed'));
    fx.cleanup();
  }
});

test('A: structured error is exit 5 whatever the child exit code (500 status, no status)', async () => {
  const mk = (o) => ({ exit: 1, stdout: JSON.stringify(Object.assign({ type: 'result', subtype: 'success', is_error: true, result: 'boom' }, o)) + '\n' });
  for (const resp of [mk({ api_error_status: 500 }), mk({}), Object.assign(mk({ api_error_status: 500 }), { exit: 0 })]) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 5);
    assert.ok(outcomes(fx).includes('a:1:child_error'));
    fx.cleanup();
  }
  // plain non-structured failure keeps the child's code
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: { exit: 3, stderr: 'plain failure\n' } } });
  assert.strictEqual((await go(fx, RUN)).code, 3);
  fx.cleanup();
});

test('B: output ending in a truncated token is scrubbed (unit and run level)', async () => {
  const s = createScrubber('SECRET-VALUE-XYZ');
  const out = Buffer.concat([s.push(Buffer.from('ok SECRET-VALUE-XY')), s.end()]).toString();
  assert.strictEqual(out, 'ok [token-scrubbed]');
  assert.strictEqual(s.hit, true);
  const s2 = createScrubber('SECRET-VALUE-XYZ');
  assert.strictEqual(Buffer.concat([s2.push(Buffer.from('plain tail SEC')), s2.end()]).toString(), 'plain tail SEC');
  assert.strictEqual(s2.hit, false);
  const fx = makeFixture({ aliases: [{ alias: 'a', token: 'FAKE-prefixtoken-0123456789' }] });
  fx.shim.setControl({ tokens: { 'FAKE-prefixtoken-0123456789': { exit: 0, leak: 'prefix' } } });
  const so = path.join(fx.root, 'f.out');
  const r = await go(fx, ['run', '--purpose', 'tst', '--stdout', so, '--', 'claude']);
  assert.strictEqual(r.code, 7);
  assert.ok(!fs.readFileSync(so, 'utf8').includes('FAKE-prefixtoken-012'));
  assert.ok(!r.err.includes('FAKE-prefixtoken-012') && !r.out.includes('FAKE-prefixtoken-012'));
  fx.cleanup();
});

test('C: symlinked .ssh or .ssh/config in the alias home is refused (exit 2) and the real config is untouched', async () => {
  for (const kind of ['dir', 'file']) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }] });
    const realSsh = path.join(fx.realHome, '.ssh');
    fs.mkdirSync(realSsh, { recursive: true });
    fs.writeFileSync(path.join(realSsh, 'config'), 'REAL-CONFIG\n');
    const home = path.join(fx.accountsDir, 'a', 'home');
    if (kind === 'dir') fs.symlinkSync(realSsh, path.join(home, '.ssh'));
    else { fs.mkdirSync(path.join(home, '.ssh')); fs.symlinkSync(path.join(realSsh, 'config'), path.join(home, '.ssh', 'config')); }
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 2, kind);
    assert.match(r.err, /ssh_path_is_link/);
    assert.strictEqual(fs.readFileSync(path.join(realSsh, 'config'), 'utf8'), 'REAL-CONFIG\n');
    assert.deepStrictEqual(fs.readdirSync(realSsh), ['config']);
    assert.strictEqual(fx.shim.spawns(), 0);
    fx.cleanup();
  }
});

test('C2: with no real ~/.ssh, a linked .ssh or .ssh/config in the alias home is still refused (exit 2, no spawn)', async () => {
  for (const kind of ['dir', 'file']) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }] });
    const victim = path.join(fx.root, 'victim');
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'config'), 'VICTIM\n');
    const home = path.join(fx.accountsDir, 'a', 'home');
    if (kind === 'dir') fs.symlinkSync(victim, path.join(home, '.ssh'));
    else { fs.mkdirSync(path.join(home, '.ssh')); fs.symlinkSync(path.join(victim, 'config'), path.join(home, '.ssh', 'config')); }
    assert.ok(!fs.existsSync(path.join(fx.realHome, '.ssh')));
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 2, kind);
    assert.match(r.err, /ssh_path_is_link/);
    assert.strictEqual(fs.readFileSync(path.join(victim, 'config'), 'utf8'), 'VICTIM\n');
    assert.strictEqual(fx.shim.spawns(), 0);
    fx.cleanup();
  }
});

test('--stdin pointing at a missing file is a usage error (exit 2, no spawn)', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const r = await go(fx, ['run', '--purpose', 'tst', '--stdin', path.join(fx.root, 'nope'), '--', 'claude']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(fx.shim.spawns(), 0);
  fx.cleanup();
});

test('scrubber unit: match split across three chunks, held-back tail flushed on end', () => {
  const s = createScrubber('SECRET-VALUE');
  let out = Buffer.concat([s.push(Buffer.from('xx SECR')), s.push(Buffer.from('ET-VAL')), s.push(Buffer.from('UE yy SECRET')), s.end()]);
  assert.strictEqual(out.toString(), 'xx [token-scrubbed] yy SECRET');
  assert.strictEqual(s.hit, true);
});

test('N5 argv: the token never appears in shim argv', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  await go(fx, RUN);
  assert.ok(!JSON.stringify(fx.shim.calls()[0].argv).includes(fx.tokens.a));
  fx.cleanup();
});

test('N6: 429 on preferred alias falls to the next; audit shows rate_limited then ok', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'b', priority: 10 }, { alias: 'a', priority: 20 }], responses: { b: R429 } });
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(outcomes(fx), ['b:1:rate_limited', 'a:2:ok']);
  assert.strictEqual(fx.shim.spawns(), 2);
  fx.cleanup();
});

test('N6: 401 on preferred alias stops; the other alias is never spawned', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'b', priority: 10 }, { alias: 'a', priority: 20 }], responses: { b: R401 } });
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 6);
  assert.strictEqual(fx.shim.spawns(), 1);
  fx.cleanup();
});

test('N7: every alias 429 -> exit 4, cooldown written for both, following pick skips both', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: R429, b: R429_USAGE } });
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 4);
  assert.deepStrictEqual(fs.readdirSync(fx.cooldownDir).sort(), ['a.json', 'b.json']);
  const ca = JSON.parse(fs.readFileSync(path.join(fx.cooldownDir, 'a.json'), 'utf8')).cooldown_until_ms;
  const cb = JSON.parse(fs.readFileSync(path.join(fx.cooldownDir, 'b.json'), 'utf8')).cooldown_until_ms;
  assert.ok(ca - Date.now() <= 5 * 60 * 1000 + 1000, 'plain throttle gets the short cooldown');
  assert.strictEqual(cb, 1799999999 * 1000, 'usage limit text carries its reset epoch');
  assert.ok(outcomes(fx).includes('-:0:all_limited'));
  const p = await go(fx, ['pick']);
  assert.strictEqual(p.code, 3);
  const before = fx.shim.spawns();
  const r2 = await go(fx, RUN);
  assert.strictEqual(r2.code, 3);
  assert.strictEqual(fx.shim.spawns(), before);
  const st = await go(fx, ['status']);
  assert.match(st.out, /alias=a .*cooldown_until=\d{4}-/);
  const clr = await go(fx, ['cooldown', '--clear', 'a']);
  assert.match(clr.out, /cleared alias=a/);
  fx.cleanup();
});

test('N16: max_attempts bounds the spawns', async () => {
  const fx = makeFixture({
    aliases: [{ alias: 'a' }, { alias: 'b' }, { alias: 'c' }], config: { accounts: { max_attempts: 2 } },
    responses: { a: R429, b: R429, c: R429 },
  });
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 4);
  assert.strictEqual(fx.shim.spawns(), 2);
  const fx2 = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }, { alias: 'c' }], responses: { a: R429, b: R429, c: R429 } });
  assert.strictEqual((await go(fx2, ['run', '--purpose', 'tst', '--max-attempts', '1', '--', 'claude'])).code, 4);
  assert.strictEqual(fx2.shim.spawns(), 1);
  fx.cleanup(); fx2.cleanup();
});

test('N14: refuse_all_tight true -> exit 3, no spawn, audit all_limited with alias dash; false -> least tight, audit all_tight', async () => {
  const fx = makeFixture({
    aliases: [{ alias: 'a' }, { alias: 'b' }], config: { accounts: { refuse_all_tight: true } },
    snapshots: { a: snap('a', 0.97), b: snap('b', 0.95) },
  });
  let r = await go(fx, RUN);
  assert.strictEqual(r.code, 3);
  assert.strictEqual(fx.shim.spawns(), 0);
  assert.deepStrictEqual(outcomes(fx), ['-:0:all_limited']);
  r = await go(fx, ['pick']);
  assert.strictEqual(r.code, 3);
  fx.writeConfig({ accounts: { refuse_all_tight: false } });
  r = await go(fx, RUN);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(fx.shim.calls()[0].fp.length, 8);
  assert.ok(outcomes(fx).includes('b:1:all_tight'));
  assert.strictEqual(fx.shim.spawns(), 1);
  fx.cleanup();
});

test('N17: alias home that is a link to the real home -> exit 2, no spawn', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const h = path.join(fx.accountsDir, 'a', 'home');
  fs.rmSync(h, { recursive: true });
  fs.symlinkSync(fx.realHome, h);
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /path_escapes_isolation/);
  assert.strictEqual(fx.shim.spawns(), 0);
  fx.cleanup();
});

test('N12: provider and auth variables from the caller never reach the child', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const bad = {
    ANTHROPIC_API_KEY: 'FAKE-k', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BASE_URL: 'http://x', ANTHROPIC_AUTH_TOKEN: 'FAKE-t',
    CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'FAKE-r', CLAUDE_CODE_NEWPROVIDER_X: '1', AWS_BEARER_TOKEN_BEDROCK: 'FAKE-b', RANDOM_OTHER: '1',
  };
  await go(fx, RUN, bad);
  const names = fx.shim.calls()[0].env_names;
  for (const k of Object.keys(bad)) assert.ok(!names.includes(k), k);
  assert.ok(names.includes('CLAUDE_CODE_OAUTH_TOKEN') && names.includes('CLAUDE_CONFIG_DIR') && names.includes('AUTOPILOT_ACCOUNT'));
  fx.cleanup();
});

test('N18: all five locators reach the child; a nested call resolves the same registry and live dir', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  const r = await go(fx, ['exec', '--alias', 'a', '--purpose', 'lane', '--', 'claude']);
  assert.strictEqual(r.code, 0);
  const loc = fx.shim.calls()[0].locators;
  assert.deepStrictEqual(loc, {
    accounts: fx.accountsDir, live: fx.liveDir, state: fx.stateDir, config: fx.configFile, runtime: fx.runtimeDir,
  });
  // nested: env as the child saw it, then a snapshot written under the child's live dir is found.
  const child = fx.shim.calls()[0];
  const nestedEnv = {
    PATH: fx.env.PATH, HOME: child.home, TMPDIR: fx.tmpDir, AUTOPILOT_ACCOUNTS_DIR: loc.accounts, AUTOPILOT_LIVE_DIR: loc.live,
    AUTOPILOT_STATE_DIR: loc.state, AUTOPILOT_CONFIG: loc.config, XDG_RUNTIME_DIR: loc.runtime,
  };
  const qdir = path.join(loc.live, 'codeforge', 'usage', 'quota');
  fs.mkdirSync(qdir, { recursive: true });
  fs.writeFileSync(path.join(qdir, 'b.json'), JSON.stringify(snap('b', 0.1)));
  let out = '';
  const code = await cli(['pick'], { env: nestedEnv, realHome: fx.realHome, warn: () => {}, write: (fd, d) => { if (fd === 1) out += d; } });
  assert.strictEqual(code, 0);
  assert.match(out, /^b class=ok/);
  fx.cleanup();
});

test('N19: structured error envelope with child exit 0 -> exit 5', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: ERR_EXIT0 } });
  const r = await go(fx, RUN);
  assert.strictEqual(r.code, 5);
  assert.ok(outcomes(fx).includes('a:1:child_error'));
  fx.cleanup();
});

test('N20: a 401 result keeps tripping auth-stop semantics (exit 6, final json trips auth-stop check)', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: R401 } });
  const so = path.join(fx.root, 'o.json');
  const r = await go(fx, ['run', '--purpose', 'tst', '--stdout', so, '--', 'claude', '-p', 'x']);
  assert.strictEqual(r.code, 6);
  const c = spawnSync(process.execPath, [path.join(__dirname, 'lib', 'auth-stop.js'), 'check', '--failed-from-json', so, '--log', so, '--id', 'x'], { encoding: 'utf8' });
  assert.strictEqual(c.status, 6);
  fx.cleanup();
});

test('timeout -> 124 and outcome timeout', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: { exit: 0, hangMs: 4000 } } });
  const r = await go(fx, ['run', '--purpose', 'tst', '--timeout', '1', '--', 'claude']);
  assert.strictEqual(r.code, 124);
  assert.ok(outcomes(fx).includes('a:1:timeout'));
  fx.cleanup();
});

test('--alias pins: unknown/disabled/path/sk-ant shapes exit 2 without spawn; cooling pin exits 3; errors never echo the input', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'off', enabled: false }] });
  const secret = ['sk', 'ant', 'oat01', 'FAKEabcdefghijklmnop'].join('-');
  for (const bad of ['../x', 'off', 'nope', secret]) {
    const r = await go(fx, ['run', '--purpose', 'tst', '--alias', bad, '--', 'claude']);
    assert.strictEqual(r.code, 2, bad);
    for (let i = 0; i + 8 <= secret.length; i++) assert.ok(!r.err.includes(secret.slice(i, i + 8)), `echoed ${i}`);
  }
  const r2 = await go(fx, ['run', '--purpose', 'tst', '--alias', 'a', secret, '--', 'claude']);
  assert.strictEqual(r2.code, 0);
  const r3 = await go(fx, ['run', '--purpose', 'tst', `--${secret}`, 'x', '--', 'claude']);
  assert.strictEqual(r3.code, 2);
  for (let i = 0; i + 8 <= secret.length; i++) assert.ok(!r3.err.includes(secret.slice(i, i + 8)));
  assert.strictEqual((await go(fx, ['run', '--purpose', 'bad purpose', '--', 'claude'])).code, 2);
  assert.strictEqual(fx.shim.spawns(), 1);
  fx.shim.setControl({ default: R429 });
  await go(fx, ['run', '--purpose', 'tst', '--alias', 'a', '--', 'claude']);
  const r4 = await go(fx, ['run', '--purpose', 'tst', '--alias', 'a', '--', 'claude']);
  assert.strictEqual(r4.code, 3);
  fx.cleanup();
});

test('unconfigured registry: run exits 2, env-check says unconfigured; mode off is explicit and audited', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  let r = await go(fx, ['env-check', '--any']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^ok alias=a mode=0600 /);
  r = await go(fx, ['env-check', '--any'], { AUTOPILOT_ACCOUNT_MODE: 'off' });
  assert.match(r.out, /mode_off/);
  assert.ok(outcomes(fx).includes('-:0:mode_off'));
  r = await go(fx, RUN, { AUTOPILOT_ACCOUNT_MODE: 'off' });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(fx.shim.spawns(), 0);
  fs.rmSync(fx.regFile);
  r = await go(fx, ['env-check', '--any']);
  assert.match(r.out, /unconfigured/);
  assert.strictEqual((await go(fx, RUN)).code, 2);
  fx.cleanup();
});

test('N5c: status never prints token bytes', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  await go(fx, RUN);
  const r = await go(fx, ['status']);
  assert.strictEqual(r.code, 0);
  assert.ok(!r.out.includes(fx.tokens.a) && !r.err.includes(fx.tokens.a));
  assert.match(r.out, /alias=a purpose=tst attempt=1 outcome=ok/);
  fx.cleanup();
});

test('ORG: status shows org_label per alias and unverified until checked; no org part without metadata; no e-mail', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }, { alias: 'c' }] });
  const reg = require('./lib/account-registry.js');
  reg.writeTokenMeta(fx.accountsDir, 'a', { org_id: 'FAKE-ORG-1', org_label: 'Acme Team', org_check: 'verified' });
  reg.writeTokenMeta(fx.accountsDir, 'b', { org_id: null, org_label: 'Personal' });
  const r = await go(fx, ['status']);
  assert.strictEqual(r.code, 0);
  const line = (al) => r.out.split('\n').find((l) => l.startsWith(`alias=${al} `));
  assert.match(line('a'), / org="Acme Team"$/);
  assert.match(line('b'), / org="Personal" org_check=unverified$/);
  assert.doesNotMatch(line('c'), /org/);
  assert.ok(!r.out.includes('@') && !r.out.includes('FAKE-ORG-1'), 'no e-mail, no org id on status');
  // negative control: a label that is not printable-safe (hand-edited file) is dropped, never printed
  reg.writeTokenMeta(fx.accountsDir, 'c', { org_label: EMAIL });
  assert.doesNotMatch((await go(fx, ['status'])).out.split('\n').find((l) => l.startsWith('alias=c ')), /org/);
  fx.cleanup();
});

test('T-GIT: child HOME carries the real git identity, ssh Include and links, push to file:// works; empty home fails (negative control)', async () => {
  const script = (fx) => {
    const f = path.join(fx.root, 'check.js');
    fs.writeFileSync(f, `
const cp=require('child_process'),fs=require('fs'),path=require('path'),os=require('os');
const sh=(c,o)=>cp.spawnSync('sh',['-c',c],Object.assign({encoding:'utf8',env:process.env},o||{}));
const root=process.argv[2];const res={};
res.email=sh('git config user.email').stdout.trim();
const bare=path.join(root,'remote.git');sh('git init -q --bare '+bare);
const w=path.join(root,'work');fs.mkdirSync(w,{recursive:true});
sh('git init -q . && git checkout -q -b main',{cwd:w});
fs.writeFileSync(path.join(w,'f'),'x');
res.commit=sh('git add f && git commit -q -m t',{cwd:w}).status;
res.push=sh('git push -q file://'+bare+' main',{cwd:w}).status;
const sshcfg=path.join(process.env.HOME,'.ssh','config');
res.include=fs.existsSync(sshcfg)?fs.readFileSync(sshcfg,'utf8'):'';
try{res.link=fs.readlinkSync(path.join(process.env.HOME,'.ssh','id_test'));}catch(e){res.link='';}
res.claude=sh('ls '+process.env.HOME+'/.claude').status;
fs.writeFileSync(path.join(root,'res.json'),JSON.stringify(res));
process.stdout.write('{}');`);
    return f;
  };
  const withHome = (fx, seed) => {
    if (seed) {
      const gc = `[user]\n\tname = Fixture\n\temail = ${EMAIL}\n`;
      if (seed === 'xdg') {
        fs.mkdirSync(path.join(fx.realHome, '.config', 'git'), { recursive: true });
        fs.writeFileSync(path.join(fx.realHome, '.config', 'git', 'config'), gc);
      } else {
        fs.writeFileSync(path.join(fx.realHome, '.gitconfig'), gc);
      }
      fs.mkdirSync(path.join(fx.realHome, '.ssh'), { recursive: true });
      fs.writeFileSync(path.join(fx.realHome, '.ssh', 'config'), 'Host x\n');
      fs.writeFileSync(path.join(fx.realHome, '.ssh', 'id_test'), 'FAKE-key');
      fs.writeFileSync(path.join(fx.realHome, '.ssh', 'known_hosts'), '');
    }
  };
  const runOne = async (seed) => {
    const fx = makeFixture({ aliases: [{ alias: 'a' }] });
    withHome(fx, seed);
    const r = await go(fx, ['run', '--purpose', 'git', '--', process.execPath, script(fx), fx.root], { GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    const res = JSON.parse(fs.readFileSync(path.join(fx.root, 'res.json'), 'utf8'));
    return { fx, r, res };
  };
  const good = await runOne(true);
  assert.strictEqual(good.r.code, 0);
  assert.strictEqual(good.res.email, EMAIL);
  assert.strictEqual(good.res.commit, 0);
  assert.strictEqual(good.res.push, 0);
  assert.ok(good.res.include.includes(`Include ${path.join(good.fx.realHome, '.ssh', 'config')}`));
  assert.strictEqual(good.res.link, path.join(good.fx.realHome, '.ssh', 'id_test'));
  assert.notStrictEqual(good.res.claude, 0);
  good.fx.cleanup();
  const xdg = await runOne('xdg');
  assert.strictEqual(xdg.r.code, 0);
  assert.strictEqual(xdg.res.email, EMAIL);
  assert.strictEqual(xdg.res.commit, 0);
  xdg.fx.cleanup();
  const empty = await runOne(false);
  assert.notStrictEqual(empty.res.email, EMAIL);
  empty.fx.cleanup();
});

test('selftest runs on the shim; mixed or dangling selftest flags are refused', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const r = await go(fx, ['selftest']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /selftest ok/);
  assert.strictEqual((await go(fx, ['selftest', '--real-binary', '--simulate-429', 'a'])).code, 2);
  assert.strictEqual((await go(fx, ['selftest', '--binary', '/nonexistent'])).code, 2);
  fx.cleanup();
});

test('CLI process: usage exit 2', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'claude-account.js'), 'nope'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});

test('ORG: status shows a mismatch instead of verified', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  require('./lib/account-registry.js').writeTokenMeta(fx.accountsDir, 'a', { org_id: 'x', org_label: 'Acme', org_check: 'mismatch' });
  assert.match((await go(fx, ['status'])).out, / org="Acme" org_check=mismatch/);
  fx.cleanup();
});
