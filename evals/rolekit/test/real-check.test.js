'use strict';
// real-check.js, zero model calls: the rail runs a stub on its --bin seam (four shapes + one more for the mutation control),
// under a fixture account registry with FAKE- tokens. Negative controls: API-key refusal, weak2 refusal, account layer off,
// and mutated copies of the checker (card comparison skipped, nonce check skipped) that turn the matching case red.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { ROOT } = require('./helpers.js');
const { makeFixture } = require(path.join(ROOT, '..', '..', 'scripts', 'lib', 'account-fixtures', 'shim-install.js'));
const RC = path.join(ROOT, 'real-check.js');
const KIT = path.join(ROOT, 'kits', 'reviewer');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_BEARER_TOKEN_BEDROCK', 'KIMI_API_KEY', 'KIMI_MODEL_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY'];

function world() {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const base = { ...process.env }; for (const k of BILLING) delete base[k];
  delete base.AUTOPILOT_SESSION_ID;
  const env = { ...base, ...fx.env, DISPATCH_QUIET: '1', AUTOPILOT_SETTLE_MS: '0' };
  const out = path.join(fx.root, 'out');
  const run = (args, e, script) => {
    const r = cp.spawnSync('node', [script || RC, ...args], { encoding: 'utf8', env: { ...env, ...(e || {}) }, input: '' });
    return { rc: r.status, out: r.stdout, err: r.stderr, item: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').pop()) : null };
  };
  const std = (extra = []) => ['--seat', 'weak1', '--account', 'a', '--kit', KIT, '--out', out, ...extra];
  const evidence = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
  return { fx, env, out, run, std, evidence, done: () => fx.cleanup() };
}
const withWorld = (fn) => () => { const w = world(); try { return fn(w); } finally { w.done(); } };

test('dry-run ok: card recorded in argv, rail record sha, nonce in reply -> met true, rc 0, item id cannot satisfy a precondition', withWorld((w) => {
  const before = sha(fs.readFileSync(path.join(KIT, 'role.md')));
  const r = w.run(w.std(['--dry-run', 'ok']));
  assert.strictEqual(r.rc, 0, r.err);
  assert.deepStrictEqual(Object.keys(r.item).sort(), ['evidence', 'id', 'met']);
  assert.strictEqual(r.item.id, 'dry-run-real-check-weak1');
  assert.strictEqual(r.item.met, true);
  const ev = w.evidence('dry-run-real-check-weak1.json');
  assert.ok(Object.values(ev.checks).every(Boolean), JSON.stringify(ev.checks));
  assert.strictEqual(ev.dry_run, 'ok');
  assert.strictEqual(ev.tools_file_empty_rewritten_to_none, true, 'the reviewer kit has an empty tools file; only the copy becomes `none`');
  assert.strictEqual(ev.account, 'a');
  const copy = fs.readFileSync(ev.kit_copy_role_md);
  assert.strictEqual(ev.role_md_sha256, sha(copy));
  assert.notStrictEqual(ev.role_md_sha256, before, 'the copied card carries the nonce line');
  assert.match(copy.toString(), /RK-NONCE-[0-9a-f]{32}/);
  assert.strictEqual(sha(fs.readFileSync(path.join(KIT, 'role.md'))), before, 'the source kit is untouched');
  const nonce = /RK-NONCE-[0-9a-f]{32}/.exec(copy.toString())[0];
  assert.strictEqual(ev.nonce_sha256, sha(nonce));
  assert.ok(!JSON.stringify(ev).includes(nonce), 'the evidence JSON holds the nonce hash only');
  assert.ok(!fs.existsSync(path.join(w.out, 'preconditions-formal.json')));
  assert.deepStrictEqual(fs.readdirSync(os.tmpdir() === w.env.TMPDIR ? w.env.TMPDIR : w.fx.tmpDir).filter((n) => n.startsWith('rolekit-real-check-')), [], 'the throwaway work dir is removed');
}));

test('dry-run ok with a kit that has plugin/ and a tool list (planner): --tools equals the kit line', withWorld((w) => {
  const r = w.run(['--seat', 'weak1', '--account', 'a', '--kit', path.join(ROOT, 'kits', 'planner'), '--out', w.out, '--dry-run', 'ok']);
  assert.strictEqual(r.rc, 0, r.err);
  const ev = w.evidence('dry-run-real-check-weak1.json');
  assert.strictEqual(ev.tools_arg, 'Read,Grep,Glob');
  assert.strictEqual(ev.checks.tools_in_argv, true);
}));

test('dry-run dropcard: argv record lacks the card, reply has no nonce -> met false, rc 1', withWorld((w) => {
  const r = w.run(w.std(['--dry-run', 'dropcard']));
  assert.strictEqual(r.rc, 1, r.err);
  assert.strictEqual(r.item.met, false);
  const ev = w.evidence('dry-run-real-check-weak1.json');
  assert.strictEqual(ev.checks.card_in_argv, false);
  assert.strictEqual(ev.checks.nonce_in_reply, false);
}));

test('dry-run wrongnonce: card present, reply carries another nonce -> met false, rc 1', withWorld((w) => {
  const r = w.run(w.std(['--dry-run', 'wrongnonce']));
  assert.strictEqual(r.rc, 1, r.err);
  const ev = w.evidence('dry-run-real-check-weak1.json');
  assert.strictEqual(ev.checks.card_in_argv, true);
  assert.strictEqual(ev.checks.nonce_in_reply, false);
  assert.strictEqual(ev.met, false);
}));

test('dry-run authstop: non-zero exit, nothing printed, no evidence claims met', withWorld((w) => {
  const r = w.run(w.std(['--dry-run', 'authstop']));
  assert.strictEqual(r.rc, 3, r.err);
  assert.strictEqual(r.out.trim(), '');
  const f = path.join(w.out, 'dry-run-real-check-weak1.json');
  if (fs.existsSync(f)) { const ev = JSON.parse(fs.readFileSync(f, 'utf8')); assert.strictEqual(ev.met, false); assert.notStrictEqual(ev.verdict, 'met'); }
}));

test('dry-run dropcard-echo: nonce echoed but the card is not in the recorded argv -> met false (only the card comparison catches it)', withWorld((w) => {
  const r = w.run(w.std(['--dry-run', 'dropcard-echo']));
  assert.strictEqual(r.rc, 1, r.err);
  const ev = w.evidence('dry-run-real-check-weak1.json');
  assert.deepStrictEqual([ev.checks.card_in_argv, ev.checks.nonce_in_reply], [false, true]);
}));

test('a different alias than --account ran -> not met (account_is_requested)', withWorld((w) => {
  const { verify } = require(RC);
  const v = verify({ records: [{ argv: ['--system-prompt', 'c', '--tools', ''], account: 'b' }], roleSha: sha('c'), tools: '', account: 'a', railResult: { role_kit: { role_md_sha256: sha('c') } }, reply: 'N', nonce: 'N' });
  assert.strictEqual(v.met, false);
  assert.strictEqual(v.checks.account_is_requested, false);
}));

for (const k of BILLING) {
  test(`API-key / cloud billing env ${k} set -> refused (rc 2), nothing dispatched`, withWorld((w) => {
    const r = w.run(w.std(['--dry-run', 'ok']), { [k]: 'FAKE-not-a-key' });
    assert.strictEqual(r.rc, 2);
    assert.match(r.err, new RegExp(`${k}`));
    assert.ok(!fs.existsSync(w.out), 'no out dir, no dispatch');
  }));
}

test('weak2 (kimi) is refused while the rail has no kimi --role-kit: "rail not available", rc 2, nothing written', withWorld((w) => {
  const r = w.run(['--seat', 'weak2', '--account', 'a', '--kit', KIT, '--out', w.out, '--dry-run', 'ok']);
  assert.strictEqual(r.rc, 2);
  assert.match(r.err, /rail not available/);
  assert.ok(!fs.existsSync(w.out));
}));

test('account layer not active (no registry) -> rc 3 before any dispatch; unknown alias -> rc 3', withWorld((w) => {
  const off = w.run(w.std(['--dry-run', 'ok']), { AUTOPILOT_ACCOUNTS_DIR: path.join(w.fx.root, 'none') });
  assert.strictEqual(off.rc, 3); assert.match(off.err, /account layer not usable/); assert.ok(!fs.existsSync(path.join(w.out, 'dry-run-real-check-weak1.json')));
  const bad = w.run(['--seat', 'weak1', '--account', 'zz', '--kit', KIT, '--out', w.out, '--dry-run', 'ok']);
  assert.strictEqual(bad.rc, 3); assert.match(bad.err, /unknown_alias/);
}));

test('usage: missing --account, unknown dry-run shape, unknown flag -> rc 2', withWorld((w) => {
  assert.strictEqual(w.run(['--seat', 'weak1', '--kit', KIT, '--out', w.out]).rc, 2);
  assert.strictEqual(w.run(w.std(['--dry-run', 'nope'])).rc, 2);
  assert.strictEqual(w.run(w.std(['--bogus', 'x'])).rc, 2);
}));

test('real mode (no --dry-run) runs the given claude binary through the wrapper: a fake binary that obeys the card -> met true, id real-check-weak1', withWorld((w) => {
  const fake = path.join(w.fx.root, 'fake-claude');
  fs.writeFileSync(fake, `#!${process.execPath}\nconst fs=require('fs');const a=process.argv.slice(2);const c=a[a.indexOf('--system-prompt')+1];const p=fs.readFileSync(0,'utf8');\nconst b=/<<<AUTOPILOT-AUTHOR-[0-9a-f]+>>>/.exec(p)[0],e=/<<<AUTOPILOT-END-[0-9a-f]+>>>/.exec(p)[0];\nprocess.stdout.write(b+'\\n'+/RK-NONCE-[0-9a-f]{32}/.exec(c)[0]+'\\n'+e+'\\n');\n`, { mode: 0o755 });
  const r = w.run(w.std(['--claude-bin', fake]));
  assert.strictEqual(r.rc, 0, r.err);
  assert.strictEqual(r.item.id, 'real-check-weak1');
  assert.strictEqual(r.item.met, true);
  const ev = w.evidence('real-check-weak1.json');
  assert.strictEqual(ev.dry_run, null);
  assert.match(ev.session_record_note, /does not contain --system-prompt/);
}));

// ---- negative controls: a copy of the checker with one verification neutralised must turn the matching case red
function mutant(w, from, to) {
  const src = fs.readFileSync(RC, 'utf8');
  assert.strictEqual(src.split(from).length - 1, 1, `mutation text must match once: ${from}`);
  const f = path.join(w.fx.root, 'real-check.mutant.js');
  fs.writeFileSync(f, src.replace(from, () => to).replace("path.resolve(__dirname, '..', '..')", () => JSON.stringify(path.join(ROOT, '..', '..'))));
  return f;
}
test('mutation: a checker that skips the card comparison accepts dropcard-echo (the real one rejects it)', withWorld((w) => {
  const real = w.run(w.std(['--dry-run', 'dropcard-echo']));
  assert.strictEqual(real.rc, 1);
  const m = mutant(w, "return i >= 0 && typeof a[i + 1] === 'string' && sha256(Buffer.from(a[i + 1], 'utf8')) === roleSha;", 'return true;');
  const bad = w.run(w.std(['--dry-run', 'dropcard-echo']), {}, m);
  assert.strictEqual(bad.rc, 0, 'the mutant accepts a dropped card, so the case above is what guards it');
  assert.notStrictEqual(bad.rc, real.rc);
}));
test('mutation: a checker that skips the nonce check accepts wrongnonce (the real one rejects it)', withWorld((w) => {
  assert.strictEqual(w.run(w.std(['--dry-run', 'wrongnonce'])).rc, 1);
  const m = mutant(w, "reply.split('\\n').some((l) => l.trim() === nonce)", 'true');
  assert.strictEqual(w.run(w.std(['--dry-run', 'wrongnonce']), {}, m).rc, 0);
}));
test('mutation: a checker without the billing refusal runs under ANTHROPIC_API_KEY (the real one refuses)', withWorld((w) => {
  const m = mutant(w, 'if (set.length) throw', 'if (false) throw');
  assert.strictEqual(w.run(w.std(['--dry-run', 'ok']), { ANTHROPIC_API_KEY: 'FAKE-x' }).rc, 2);
  assert.strictEqual(w.run(w.std(['--dry-run', 'ok']), { ANTHROPIC_API_KEY: 'FAKE-x' }, m).rc, 0);
}));
