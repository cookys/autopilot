'use strict';
/**
 * Tests for scripts/lib/ar-redact-rules.js and scripts/ar-redact.js (AR layer 2, block 1).
 * Run: env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node scripts/lib/ar-redact-rules.test.js < /dev/null
 * Fake values come from ar-redact-fixtures.js (built at run time). Temp dirs only.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { redactText } = require('./ar-redact-rules');
const { planted, plantedLines, needles } = require('./ar-redact-fixtures');
const ar = require('../ar-redact');

const CLI = path.join(__dirname, '..', 'ar-redact.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-redact-test-'));
let fail = 0;
let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`PASS ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); }
}
const leaked = (out, p) => needles(p).filter((n) => out.includes(n));
const quiet = { write() {} };
function jsonl(name, objs) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, objs.map((o) => JSON.stringify(o) + '\n').join(''));
  return f;
}
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

const P = planted();
const LINES = plantedLines(P);

t('rules: every planted value masked, none of it or its 12-char fragments survives, count == planted', () => {
  const r = redactText(LINES.join('\n'));
  assert.deepStrictEqual(leaked(r.text, P), []);
  assert.strictEqual(r.total, LINES.length, JSON.stringify(r.counts));
  for (const k of ['anthropic', 'github-pat', 'aws-access-key', 'jwt', 'pem_private_key', 'ipv4', 'env_secret', 'account', 'phone']) {
    assert.strictEqual(r.counts[k], 1, `class ${k}: ${JSON.stringify(r.counts)}`);
  }
  assert.ok(r.text.includes('[REDACTED:ipv4]'));
});

t('rules: public IPv6, xAI/HF/GitLab, conn string, SSH pubkey, national id', () => {
  const v6 = ['2001:', 'db8::', '7a'].join('');
  const xai = ['xai', '-', 'Ab3dE5gH7jK9mN1pQ3sT5vW7'].join('');
  const hf = ['hf', '_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC2'].join('');
  const gl = ['glpat', '-', 'aB3dE5gH7jK9mN1pQ3sT'].join('');
  const conn = ['postgres', '://', 'dbuser', ':', 's3cretpw', '@', 'db.internal.example'].join('');
  const pub = ['ssh-', 'ed25519 ', 'AAAAC3NzaC1lZDI1NTE5AAAAIHk', ' me'].join('');
  const nid = ['A', '123456789'].join('');
  const text = [v6, xai, hf, gl, conn, pub, nid].join('\n');
  const r = redactText(text);
  for (const s of [v6, xai, hf, gl, 's3cretpw', 'dbuser', 'AAAAC3NzaC1lZDI1NTE5', nid]) assert.ok(!r.text.includes(s), `leaked ${s.slice(0, 4)}`);
  assert.strictEqual(r.total, 7, JSON.stringify(r.counts));
});

t('rules: account forms user= / --account / login: and 40-hex, base64', () => {
  const hex = 'a1b2c3d4e5'.repeat(4);
  const b64 = ['QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo', 'abcdefghijklmnopqrstuvwxyz0123'].join('');
  const text = `user=bob99 --account carol77 login: dave55 ${hex} ${b64}`;
  const r = redactText(text);
  for (const s of ['bob99', 'carol77', 'dave55', hex, b64]) assert.ok(!r.text.includes(s));
  assert.strictEqual(r.total, 5, JSON.stringify(r.counts));
});

t('variants: \\n-escaped, URL-encoded, split across blocks, decoded back to masked', () => {
  const esc = redactText(`line one\\nexport API_TOKEN=${P.anthropic}\\nnext`);
  assert.ok(!esc.text.includes(P.anthropic));
  const url = redactText(`q=${encodeURIComponent(P.password)}&x=1`);
  assert.ok(!url.text.includes('hunter2xyzzy9') && url.total >= 1, url.text);
  const f = jsonl('split.jsonl', [{ message: { content: [{ type: 'text', text: P.github.slice(0, 20) }, { type: 'text', text: P.github.slice(20) }] } }]);
  const out = path.join(tmp, 'split.out.jsonl');
  const rc = ar.run({ in: f, out, err: quiet });
  assert.strictEqual(rc, 0);
  const body = fs.readFileSync(out, 'utf8');
  assert.deepStrictEqual(leaked(body, P), []);
  assert.ok(body.includes('[REDACTED:split]'));
});

t('cli: transcript with tool_use input, tool_result cut to 200 chars + len, report has counts only', () => {
  const big = 'x '.repeat(300) + P.github;
  const f = jsonl('full.jsonl', [
    { type: 'assistant', message: { content: [{ type: 'text', text: LINES[0] }, { type: 'tool_use', input: { command: LINES[7] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: big }] }, toolUseResult: { stdout: LINES[6] } },
  ]);
  const out = path.join(tmp, 'full.out.jsonl');
  const rep = path.join(tmp, 'full.report.json');
  const res = spawnSync('node', [CLI, '--in', f, '--out', out, '--report', rep], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(res.status, 0, res.stderr);
  const body = fs.readFileSync(out, 'utf8');
  assert.deepStrictEqual(leaked(body, P), []);
  assert.ok(body.includes('…[len='), 'tool_result not cut');
  const r = JSON.parse(fs.readFileSync(rep, 'utf8'));
  assert.strictEqual(r.schema, 'ar-redact/1');
  assert.strictEqual(r.dropped, false);
  assert.strictEqual(r.in_lines, 2);
  assert.strictEqual(r.out_lines, 2);
  assert.ok(total(r.counts) >= 3);
  assert.deepStrictEqual(leaked(JSON.stringify(r) + res.stdout + res.stderr, P), []);
});

t('negative control: injected EMPTY rule set lets the planted values through (assertion goes red)', () => {
  const f = jsonl('neg.jsonl', [{ message: { content: [{ type: 'text', text: LINES.join('\n') }] } }]);
  const out = path.join(tmp, 'neg.out.jsonl');
  const rc = ar.run({ in: f, out, rules: [], rescanRules: [], err: quiet });
  assert.strictEqual(rc, 0);
  const survivors = leaked(fs.readFileSync(out, 'utf8'), P);
  assert.ok(survivors.length > 0, 'empty rules should leak');
  // the same assertion the positive test makes must now fail:
  assert.throws(() => assert.deepStrictEqual(survivors, []));
});

t('fail-closed: malformed line, injected throw, and a rule gap the re-scan catches all exit 4 with no out file', () => {
  const good = jsonl('g.jsonl', [{ message: { content: [{ type: 'text', text: LINES[0] }] } }]);
  const bad = path.join(tmp, 'bad.jsonl');
  fs.writeFileSync(bad, `{"a":"${P.github}"\n`);
  let out = path.join(tmp, 'bad.out.jsonl');
  assert.strictEqual(ar.run({ in: bad, out, err: quiet }), 4);
  assert.ok(!fs.existsSync(out));
  const boom = [{ cls: 'boom', apply() { throw new Error('rule failure'); } }];
  out = path.join(tmp, 'throw.out.jsonl');
  assert.strictEqual(ar.run({ in: good, out, rules: boom, err: quiet }), 4);
  assert.ok(!fs.existsSync(out));
  out = path.join(tmp, 'gap.out.jsonl');
  const rep = path.join(tmp, 'gap.report.json');
  assert.strictEqual(ar.run({ in: good, out, report: rep, rules: [], err: quiet }), 4);
  assert.ok(!fs.existsSync(out));
  assert.strictEqual(JSON.parse(fs.readFileSync(rep, 'utf8')).dropped, true);
  const cli = spawnSync('node', [CLI, '--in', bad, '--out', path.join(tmp, 'cli.out'), '--report', path.join(tmp, 'cli.rep')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(cli.status, 4);
  assert.ok(!fs.existsSync(path.join(tmp, 'cli.out')));
  assert.deepStrictEqual(leaked(cli.stdout + cli.stderr, P), []);
});

t('benign control: shas of 7-12 hex, repo-relative paths, prose, the word token stay as they are', () => {
  const benign = [
    'commit f4e0bccf3 and 9962787d0abc merged',
    'edit scripts/lib/ar-redact-rules.js and hooks/tests/lib.sh',
    'the token budget is large; the word token alone is fine',
    'version 3.0.0-alpha.7 at 12:34:56 on 2026-11-15',
    'loopback 127.0.0.1 and 0.0.0.0',
    'see docs/dev/adr/0001-verification-over-attestation.md',
  ].join('\n');
  const r = redactText(benign);
  assert.strictEqual(r.text, benign, r.text);
  assert.strictEqual(r.total, 0);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
