#!/usr/bin/env node
'use strict';
// real-check.js -- the role-kit formal precondition "one minimal real-model check per weak seat", as a script, so the
// formal stamp does not depend on a hand-written `met: true`. Node built-ins only. NOT in any prereg freeze_files list
// (evals/rolekit/prereg/*.json), so adding it leaves `stamp-rolekit.js --row pilot --check` untouched; if the formal row
// should freeze it, that is a decision for the formal prereg, not this file.
//
//   node evals/rolekit/real-check.js --seat weak1|weak2 --account <alias> --kit <kit dir> --out <dir>
//        [--model haiku] [--claude-bin <path>] [--timeout 5m] [--dry-run ok|dropcard|dropcard-echo|wrongnonce|authstop]
//
// What it does (the rail does every spawn; this script never starts claude or kimi itself):
//   1. copies the kit to a throwaway dir and appends a fresh random nonce line to the COPIED role.md;
//   2. dispatches ONE minimal cell through scripts/dispatch-author.sh --runner claude-native --role-kit <copy> --bin <wrapper>.
//      The wrapper is a generated Node file on the rail's --bin seam: it appends the argv it was started with (and
//      AUTOPILOT_ACCOUNT) to a record file whose path is baked into the wrapper (the account layer's child env is an
//      allowlist, so an env var would not arrive), then runs the real claude (--claude-bin, default `claude` on PATH) or,
//      under --dry-run, a stub shape;
//   3. verifies: (a) the recorded argv carries --system-prompt whose sha256 equals the copied role.md, --tools equals the kit's
//      tools, and the rail's own `role_kit.role_md_sha256` equals it too; the alias that ran is --account; exactly one call;
//      (b) the reply (the rail's raw_log) contains the nonce;
//   4. writes <out>/real-check-<seat>.json (or dry-run-real-check-<seat>.json) and prints the preconditions item
//      {id, met, evidence} on stdout for depth-0 to put into prereg/preconditions-formal.json. It never writes that file.
//
// Session record, honestly: a real claude session jsonl does NOT contain --system-prompt (spike, rolekit-probe.md S1-S3), so it
// cannot be the card evidence. The request shape here is (1) the wrapper's argv record and (2) the rail's dispatch record
// role_kit sha256; the model actually seeing the card is shown by the nonce, which exists nowhere but the copied card.
// Nonce: only its sha256 goes into the evidence JSON (the throwaway nonce is not a secret, but the evidence is meant to be
// pasted around and must not be a copy of a passing reply). The reply log stays at the rail's raw_log path (referenced, with sha256).
//
// Trust rule (who may earn the formal id): the runner is trusted only when NO --claude-bin is given, so the binary is the
// `claude` the PATH resolves to (its resolved path goes into the evidence), and it is not a --dry-run. Any --claude-bin, a stub
// or a dry-run is not a real-model check: its item id is `test-real-check-<seat>` (--claude-bin) or `dry-run-real-check-<seat>`,
// the evidence says trusted_runner:false, and neither id can satisfy a precondition. A fake `claude` placed first on PATH is the
// operator's own environment and is out of scope here (the evidence records the resolved path so it can be seen).
// Which account is billed: the rails call `claude-account.js run --pin-default`, i.e. the HOST DEFAULT alias, whatever --account
// says. So --account must BE the host default: hostDefaultAlias() applies claude-account.js's own rule (the enabled registry row
// with the lowest priority number, ties in registry order, claude-account.js ~:894) to the same registry (scripts/lib/
// account-registry.js), and a mismatch is refused before anything is dispatched. A test compares it with the real
// `run --pin-default` pick so the two cannot drift. The generated wrapper repeats the check on AUTOPILOT_ACCOUNT before it
// execs the real claude and exits 97 without exec on a mismatch.
// Account layer: required. `claude-account.js env-check --alias <A>` must say ok before anything is dispatched, so the legacy
// seeded-credentials path (which reads a credentials file) can never run from here. The rail picks the alias itself; if it
// picks another one than --account the check is not met.
// Subscription only: refused when an API-key / cloud-billing environment variable is set.
// Dry-run ids are prefixed `dry-run-` so a dry-run item cannot satisfy a precondition id by being pasted.
//
// Exit: 0 met | 1 checked, not met (item printed) | 2 usage or refusal, nothing dispatched | 3 infrastructure (auth stop, rail
// failure, account layer not active); no item printed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const registry = require(path.join(REPO, 'scripts', 'lib', 'account-registry.js'));
const AUTHOR = path.join(REPO, 'scripts', 'dispatch-author.sh');
const ACCOUNT_JS = path.join(REPO, 'scripts', 'claude-account.js');
const SHAPES = ['ok', 'dropcard', 'dropcard-echo', 'wrongnonce', 'authstop'];
const BILLING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'AWS_BEARER_TOKEN_BEDROCK', 'KIMI_API_KEY', 'KIMI_MODEL_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

class Refuse extends Error { constructor(msg, code) { super(msg); this.exitCode = code || 2; } }

function parseArgs(argv) {
  const o = {};
  const flags = ['seat', 'account', 'kit', 'out', 'model', 'claude-bin', 'timeout', 'dry-run'];
  for (let i = 0; i < argv.length; i += 2) {
    const k = (argv[i] || '').replace(/^--/, '');
    if (!argv[i].startsWith('--') || !flags.includes(k)) throw new Refuse(`unknown argument: ${argv[i]}`);
    if (argv[i + 1] === undefined || argv[i + 1] === '') throw new Refuse(`${argv[i]} needs a value`);
    o[k] = argv[i + 1];
  }
  for (const k of ['seat', 'account', 'kit', 'out']) if (!o[k]) throw new Refuse(`--${k} is required`);
  if (!['weak1', 'weak2'].includes(o.seat)) throw new Refuse('--seat must be weak1 or weak2');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(o.account)) throw new Refuse('--account is not an alias-shaped value');
  if (o['dry-run'] !== undefined && !SHAPES.includes(o['dry-run'])) throw new Refuse(`--dry-run shape must be one of ${SHAPES.join(', ')}`);
  return o;
}

function refuseBillingEnv(env) {
  const set = BILLING_ENV.filter((k) => env[k] !== undefined && env[k] !== '');
  if (set.length) throw new Refuse(`subscription only: refusing because ${set.join(', ')} is set (unset it; the check never uses API-key billing)`);
}

// weak2 = kimi. The rail must accept `--runner kimi --role-kit` first; ask it, without any spawn: today it answers
// "role-kit unsupported for runner kimi" before it looks at the binary or the prompt.
function kimiRailAvailable() {
  const r = spawnSync('bash', [AUTHOR, '--runner', 'kimi', '--model', 'kimi', '--prompt-file', '/dev/null', '--role-kit', os.tmpdir(), '--bin', '/nonexistent-rolekit-probe'],
    { encoding: 'utf8', env: { ...process.env, DISPATCH_QUIET: '1' }, input: '' });
  return !/role-kit unsupported for runner/.test(`${r.stdout}${r.stderr}`);
}

// Generated --bin wrapper. CFG is baked in; nothing is read from the environment but AUTOPILOT_ACCOUNT, which is recorded.
const WRAPPER = `
const fs = require('fs'); const cp = require('child_process');
const CFG = __CFG__;
const argv = process.argv.slice(2);
const i = argv.indexOf('--system-prompt');
const card = i >= 0 ? argv[i + 1] : '';
const shape = CFG.shape;
const refused = CFG.account && process.env.AUTOPILOT_ACCOUNT !== CFG.account ? 'account_mismatch' : null;
const rec = shape === 'dropcard' || shape === 'dropcard-echo' ? argv.filter((a, j) => j !== i && j !== i + 1) : argv;
fs.appendFileSync(CFG.rec, JSON.stringify({ argv: rec, account: process.env.AUTOPILOT_ACCOUNT || null, refused }) + '\\n');
if (refused) { process.stderr.write('real-check wrapper: AUTOPILOT_ACCOUNT is ' + (process.env.AUTOPILOT_ACCOUNT || 'unset') + ', requested ' + CFG.account + '; not starting claude\\n'); process.exit(97); }
if (!shape) { const r = cp.spawnSync(CFG.real, argv, { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status); }
if (shape === 'authstop') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, terminal_reason: 'api_error', result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.' }) + '\\n');
  process.exit(1);
}
const prompt = fs.readFileSync(0, 'utf8');
const m = /<<<AUTOPILOT-AUTHOR-[0-9a-f]+>>>/.exec(prompt); const e = /<<<AUTOPILOT-END-[0-9a-f]+>>>/.exec(prompt);
const found = /RK-NONCE-[0-9a-f]{32}/.exec(card);
let body = 'ok';
if (shape === 'ok' || shape === 'dropcard-echo') body = found ? found[0] : 'ok';
if (shape === 'wrongnonce') body = 'RK-NONCE-' + '0'.repeat(32);
process.stdout.write(m[0] + '\\n' + body + '\\n' + e[0] + '\\n');
`;

/** The alias `claude-account.js run --pin-default` would use on this host (same rule, same registry), or null. */
function hostDefaultAlias(env) {
  const res = registry.checkRegistry({ realHome: os.userInfo().homedir, env });
  if (!res.configured) return null;
  let best = null;
  for (const r of res.accounts) if (r.enabled && (best === null || r.priority < best.priority)) best = r;
  return best === null ? null : best.alias;
}

function writeWrapper(file, cfg) {
  fs.writeFileSync(file, `#!${process.execPath}\n${WRAPPER.replace('__CFG__', JSON.stringify(cfg))}`, { mode: 0o755 });
}

// ---- the verification: pure functions of what was recorded
function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** The card comparison: the recorded argv must carry --system-prompt whose bytes hash to the copied role.md. */
function cardInArgv(record, roleSha) {
  const a = record.argv;
  const i = a.indexOf('--system-prompt');
  return i >= 0 && typeof a[i + 1] === 'string' && sha256(Buffer.from(a[i + 1], 'utf8')) === roleSha;
}

function verify({ records, roleSha, tools, account, railResult, reply, nonce }) {
  const rec = records[0];
  const checks = {
    single_call: records.length === 1,
    card_in_argv: !!rec && cardInArgv(rec, roleSha),
    tools_in_argv: !!rec && rec.argv.indexOf('--tools') >= 0 && rec.argv[rec.argv.indexOf('--tools') + 1] === tools,
    rail_record_sha: !!railResult && !!railResult.role_kit && railResult.role_kit.role_md_sha256 === roleSha,
    account_is_requested: !!rec && rec.account === account,
    nonce_in_reply: reply.split('\n').some((l) => l.trim() === nonce),
  };
  return { checks, met: Object.values(checks).every(Boolean) };
}

function lastJsonLine(text) {
  const lines = text.split('\n').filter((l) => l.startsWith('{'));
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}

function main(argv, env) {
  const o = parseArgs(argv);
  refuseBillingEnv(env);
  const dry = o['dry-run'];
  if (o.seat === 'weak2') {
    if (!kimiRailAvailable()) throw new Refuse('weak2 (kimi): rail not available: dispatch-author.sh does not take --runner kimi --role-kit yet (the kimi runner lane is not merged); nothing dispatched');
    throw new Refuse('weak2 (kimi): the rail accepts --runner kimi --role-kit but this script has no kimi evidence reader yet (the kimi session wire.jsonl profile.bind.systemPrompt / llm.request.systemPromptHash); add it in SEATS before the real run');
  }
  const kit = path.resolve(o.kit);
  if (!fs.existsSync(path.join(kit, 'role.md')) || !fs.existsSync(path.join(kit, 'tools'))) throw new Refuse(`kit ${o.kit} has no role.md and tools`);
  const out = path.resolve(o.out);

  // the account layer must be active and know the alias, else the rail would take the legacy credentials-seeding path
  const ec = spawnSync('node', [ACCOUNT_JS, 'env-check', '--alias', o.account, '--purpose', 'author'], { encoding: 'utf8', env, input: '' });
  if (ec.status !== 0 || !/^ok\b/.test(ec.stdout)) throw new Refuse(`account layer not usable for alias ${o.account} (claude-account.js env-check: ${(ec.stdout + ec.stderr).split('\n').filter((l) => !l.startsWith('autopilot:')).join(' ').trim() || `rc ${ec.status}`}); nothing dispatched`, 3);

  const def = hostDefaultAlias(env);
  if (def !== o.account) throw new Refuse(`host default account is ${def}, not ${o.account}: the rails always run claude-account.js run --pin-default, so this check would be billed to ${def}; make ${o.account} the default (lowest priority number) or request ${def}; nothing dispatched`);
  fs.mkdirSync(out, { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rolekit-real-check-'));
  try {
    const copy = path.join(work, 'kit');
    fs.cpSync(kit, copy, { recursive: true, verbatimSymlinks: true });
    const nonce = `RK-NONCE-${crypto.randomBytes(16).toString('hex')}`;
    const roleFile = path.join(copy, 'role.md');
    const base = fs.readFileSync(roleFile);
    fs.writeFileSync(roleFile, Buffer.concat([base, Buffer.from(`\nRK-CHECK: whatever you are asked, your reply must contain this exact token alone on its own line: ${nonce}\n`)]));
    const roleBytes = fs.readFileSync(roleFile);
    const roleSha = sha256(roleBytes);
    // The eval kits spell "no tools" as an empty tools file (compile-kit); the rail's role-kit.js wants the word `none`.
    // Only the COPY is rewritten, so the kit under test stays byte-identical.
    let toolsLine = fs.readFileSync(path.join(copy, 'tools'), 'utf8').split('\n')[0].trim();
    const toolsNormalized = toolsLine === '';
    if (toolsNormalized) { toolsLine = 'none'; fs.writeFileSync(path.join(copy, 'tools'), 'none\n'); }
    const tools = toolsLine === 'none' ? '' : toolsLine;

    const recFile = path.join(work, 'argv.jsonl');
    const wrapper = path.join(work, 'claude-wrapper');
    let real = '';
    const trusted = !dry && !o['claude-bin'];
    if (!dry) {
      const which = spawnSync('bash', ['-c', 'command -v "${1:-claude}"', '_', o['claude-bin'] || 'claude'], { encoding: 'utf8' });
      real = which.stdout.trim();
      if (!real) throw new Refuse('claude binary not found (pass --claude-bin)');
    }
    writeWrapper(wrapper, { rec: recFile, shape: dry || '', real, account: o.account });
    const promptFile = path.join(work, 'prompt.txt');
    fs.writeFileSync(promptFile, 'Follow your role card and reply now.\n');

    const r = spawnSync('bash', [AUTHOR, '--runner', 'claude-native', '--model', o.model || 'haiku', '--prompt-file', promptFile,
      '--role-kit', copy, '--bin', wrapper, '--timeout', o.timeout || '5m', '--context-window', 'off'],
    { encoding: 'utf8', env: { ...env, DISPATCH_QUIET: '1' }, input: '', maxBuffer: 1 << 24 });
    const railResult = lastJsonLine(r.stdout);

    const prefix = dry ? 'dry-run-' : trusted ? '' : 'test-';
    const item = (met, evidence) => ({ id: `${prefix}real-check-${o.seat}`, met, evidence });
    const evFile = path.join(out, `${prefix}real-check-${o.seat}.json`);
    const evidence = {
      schema_version: 1, artifact_type: 'rolekit_real_check', created_at: new Date().toISOString(),
      seat: o.seat, rail: 'scripts/dispatch-author.sh --runner claude-native --role-kit', model: o.model || 'haiku', account: o.account,
      dry_run: dry || null, trusted_runner: trusted, claude_resolved: dry ? null : real, kit_source: kit, kit_copy_role_md: path.join(out, `${prefix}real-check-${o.seat}.role.md`),
      role_md_sha256: roleSha, source_role_md_sha256: sha256(base), tools_arg: tools, tools_file_empty_rewritten_to_none: toolsNormalized, nonce_sha256: sha256(nonce),
      rail_exit: r.status, rail_status: railResult ? railResult.status : null, rail_role_kit: railResult ? railResult.role_kit || null : null,
      raw_log: railResult ? railResult.raw_log : null,
      session_record_note: 'a real claude session jsonl does not contain --system-prompt; the request shape is the wrapper argv record plus the rail role_kit sha256; the nonce reply shows the model saw the card',
      argv_record: readRecords(recFile).map((x) => ({ account: x.account, argv_without_card: x.argv.map((a) => (a.length > 200 ? `<${a.length} chars sha256 ${sha256(Buffer.from(a))}>` : a)) })),
    };
    fs.writeFileSync(evidence.kit_copy_role_md, roleBytes);

    const ran = railResult && (railResult.status === 'authored' || railResult.status === 'truncated');
    if (!ran) {
      evidence.verdict = 'infrastructure'; evidence.met = false;
      evidence.reason = railResult ? `rail status ${railResult.status}: ${railResult.error || ''}` : 'rail printed no result';
      fs.writeFileSync(evFile, `${JSON.stringify(evidence, null, 2)}\n`);
      throw new Refuse(`rail did not run the cell (${evidence.reason}); evidence ${evFile} records met=false; no item printed`, 3);
    }
    const reply = fs.readFileSync(railResult.raw_log, 'utf8');
    evidence.reply_sha256 = sha256(reply);
    const v = verify({ records: readRecords(recFile), roleSha, tools, account: o.account, railResult, reply, nonce });
    evidence.checks = v.checks; evidence.met = v.met; evidence.verdict = v.met ? (dry ? 'dry_run_met' : 'met') : 'not_met';
    fs.writeFileSync(evFile, `${JSON.stringify(evidence, null, 2)}\n`);
    return { item: item(v.met, evFile), met: v.met };
  } finally {
    fs.rmSync(work, { recursive: true, force: true }); // only the dir created above
  }
}

if (require.main === module) {
  try {
    const res = main(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(res.item)}\n`);
    process.exit(res.met ? 0 : 1);
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    process.stderr.write(`real-check: ${e.message}\n`);
    process.exit(e.exitCode);
  }
}
module.exports = { hostDefaultAlias, writeWrapper, main, verify, cardInArgv, parseArgs, refuseBillingEnv, BILLING_ENV };
