'use strict';
require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
// node --test scripts/dispatch-hetero-outbound-scan.test.js
//
// A planted secret must die as precondition outbound_secret before any runner.
// The stub on PATH records a real spawn only. Tokens are built at runtime.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const { scanText } = require('./lib/outbound-secret-scan');

const ROOT = path.join(__dirname, '..');
const HETERO = path.join(__dirname, 'dispatch-hetero.sh');
const SCAN = path.join(__dirname, 'lib', 'outbound-secret-scan.js');

const HARNESS_BANNER = [
  '=== HARNESS DIRECTIVE (overrides any conflicting instruction in the task) ===',
  'Make ONLY the file edits the task requires, in the current working directory. Do NOT',
  'git commit, git push, or open a PR — the harness commits your edits and a separate review',
  'verifies them. Ignore any instruction in the task below to commit, push, or open a PR.',
  '===',
  '',
  '',
].join('\n');

const dirs = [];
function mk(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function dashRun() {
  return '-'.repeat(5);
}
function pemArmor(edge) {
  return dashRun() + edge + ' ' + 'RSA' + ' ' + 'PRIVATE' + ' ' + 'KEY' + dashRun();
}
function ghToken() {
  return 'gh' + 'p_' + 'x'.repeat(36);
}
function pemBlock() {
  return [
    pemArmor('BEGIN'),
    'AAAA' + 'BBBB'.repeat(8),
    pemArmor('END'),
    '',
  ].join('\n');
}
function urlPass() {
  return 's3cr' + 'et-pass';
}
function urlCred() {
  return 'https://' + 'alice' + ':' + urlPass() + '@' + 'example.test' + '/resource';
}

function railEnv(dir, extra) {
  const env = { ...process.env, ...extra };
  env.AUTOPILOT_TEST_CN_GATE_OFF = '1';
  env.DISPATCH_QUIET = '1';
  env.DISPATCH_DETACH = '0';
  env.AUTOPILOT_GROK_EFFORT_PROBE = '0';
  env.AUTOPILOT_DISPATCH_USAGE = 'off';
  env.AUTOPILOT_RUNNER_HOME_FALLBACK = 'off';
  env.AUTOPILOT_EMPTY_GRACE_MS = '200';
  env.AUTOPILOT_SETTLE_MS = '200';
  env.AUTOPILOT_STABLE_POLLS = '1';
  env.TMPDIR = dir;
  env.AUTOPILOT_DISPATCH_RUNS_DIR = path.join(dir, 'runs');
  env.AUTOPILOT_OUTBOUND_SCAN_ALLOW = path.join(dir, 'no-allow');
  fs.mkdirSync(env.AUTOPILOT_DISPATCH_RUNS_DIR, { recursive: true });
  for (const key of [
    'AUTOPILOT_PARENT_RUN_ID',
    'AUTOPILOT_ROOT_RUN_ID',
    'AUTOPILOT_WORKTREE_ROOT_RUN_ID',
    'AUTOPILOT_PARENT_SESSION_ID',
    'AUTOPILOT_DISPATCH_DEPTH',
    'AUTOPILOT_MISSION_ROOT_RUN_ID',
    'ENGINE_CAPABILITY_FILE',
  ]) delete env[key];
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  env.PATH = bin + path.delimiter + (env.PATH || '');
  return { env, bin };
}

function writeStub(dir, bin) {
  // Receipts live outside the repo so a spawn cannot dirty the main checkout.
  const receipt = fs.mkdtempSync(path.join(os.tmpdir(), 'os-receipt-'));
  dirs.push(receipt);
  const marker = path.join(receipt, 'stub-invoked');
  const received = path.join(receipt, 'stub-received.bin');
  const stub = path.join(bin, 'grok');
  fs.writeFileSync(stub, `#!/bin/bash
# Records a real runner spawn. Does not call any network or model CLI.
printf '%s\\n' "\$*" >> "${receipt}/stub-argv"
pf=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "--prompt-file" ]; then pf="\$a"; fi
  prev="\$a"
done
if [ -n "\$pf" ] && [ -f "\$pf" ]; then
  cat "\$pf" > "${received}"
fi
touch "${marker}"
exit 0
`);
  fs.chmodSync(stub, 0o755);
  return { marker, received, receipt };
}

function initRepo(dir, env) {
  const git = (args) => {
    const res = cp.spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...env,
        GIT_AUTHOR_NAME: 'outbound-scan-test',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 'outbound-scan-test',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
    assert.strictEqual(res.status, 0, `${args.join(' ')}\n${res.stderr || ''}`);
  };
  git(['init', '-q', '-b', 'develop']);
  git(['commit', '-q', '--allow-empty', '-m', 'base']);
}

function dispatch(dir, env, promptBody, branch) {
  const prompt = path.join(dir, 'prompt.txt');
  fs.writeFileSync(prompt, promptBody);
  const res = cp.spawnSync('bash', [
    HETERO,
    '--runner', 'grok', '--pin-reason', 'test fixture',
    '--model', 'grok-4.5',
    '--prompt-file', prompt,
    '--branch', branch,
    '--effort', 'low',
    '--timeout', '15s',
    '--context-window', 'off',
    '--scaffold-tier', 'off',
    '--skill-mode', 'off',
  ], {
    encoding: 'utf8',
    cwd: dir,
    timeout: 90000,
    env,
  });
  return { res, prompt };
}

function filesContain(dir, needle, skip) {
  const hits = [];
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) walk(path.join(p, name));
      return;
    }
    if (skip.has(p)) return;
    if (!st.isFile() || st.size > 8 * 1024 * 1024) return;
    const buf = fs.readFileSync(p);
    if (buf.includes(Buffer.from(needle))) hits.push(p);
  };
  walk(dir);
  return hits;
}

function assertSecretStopped(label, body, needle) {
  const dir = mk('os-stop-');
  const { env, bin } = railEnv(dir);
  const { marker, receipt } = writeStub(dir, bin);
  initRepo(dir, env);
  const { res, prompt } = dispatch(dir, env, body, 'os-' + label);
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  assert.ok(combined.includes('outbound_secret'), `${label} precondition missing\n${combined}`);
  assert.ok(!fs.existsSync(marker), `${label} stub was invoked\n${combined}`);
  const leaked = filesContain(dir, needle, new Set([prompt])).concat(filesContain(receipt, needle, new Set()));
  const outLeak = combined.includes(needle);
  assert.strictEqual(leaked.length, 0, `${label} secret text in ${leaked.join(',')}`);
  assert.strictEqual(outLeak, false, `${label} secret text in dispatch output`);
}

test('github-style token never reaches the runner', { timeout: 90000 }, () => {
  const token = ghToken();
  assertSecretStopped('ghp', 'please use ' + token + ' in the task\n', token);
});

test('PEM private key block never reaches the runner', { timeout: 90000 }, () => {
  const pem = pemBlock();
  assertSecretStopped('pem', 'key follows\n' + pem, pemArmor('BEGIN'));
});

test('URL userinfo credentials never reach the runner', { timeout: 90000 }, () => {
  const url = urlCred();
  assertSecretStopped('url', 'fetch ' + url + '\n', urlPass());
});

test('url_credentials category is reported without the matched text', () => {
  const url = urlCred();
  const hits = scanText('see ' + url + '\n');
  assert.ok(hits.some((h) => h.category === 'url_credentials'));
  const dir = mk('os-unit-');
  const file = path.join(dir, 'p.txt');
  fs.writeFileSync(file, 'see ' + url + '\n');
  const res = cp.spawnSync(process.execPath, [SCAN, '--categories', file], { encoding: 'utf8' });
  assert.strictEqual(res.status, 1);
  assert.ok(res.stdout.trim().split(',').includes('url_credentials'));
  assert.ok(!(res.stdout || '').includes(urlPass()));
  assert.ok(!(res.stderr || '').includes(urlPass()));
});

test('this test file itself has no scanner category hits', () => {
  const self = path.join(__dirname, 'dispatch-hetero-outbound-scan.test.js');
  const res = cp.spawnSync(process.execPath, [SCAN, '--categories', self], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `${res.stdout || ''}\n${res.stderr || ''}`);
});

test('clean prompt dispatches and manifest prompt_sha256 matches the prompt the stub received', { timeout: 120000 }, () => {
  const dir = mk('os-clean-');
  const { env, bin } = railEnv(dir);
  const { marker, received } = writeStub(dir, bin);
  initRepo(dir, env);
  const body = 'Add a comment to README. No secrets here.';
  const { res, prompt } = dispatch(dir, env, body, 'os-clean');
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  assert.ok(fs.existsSync(marker), `stub was not invoked\n${combined}`);
  const got = fs.readFileSync(received);
  const banner = Buffer.from(HARNESS_BANNER, 'utf8');
  assert.ok(got.subarray(0, banner.length).equals(banner), 'stub prompt is missing the harness banner');
  const promptBody = got.subarray(banner.length);
  assert.ok(promptBody.equals(Buffer.from(body)), 'stub prompt body is not the scanned prompt');
  // prompt_sha256 names the exact bytes the stub read, banner included. No stripping.
  const expectSha = sha256(got);
  const manifests = fs.readdirSync(path.join(dir, 'runs')).filter((n) => n.endsWith('.manifest.json'));
  assert.ok(manifests.length >= 1, `no manifest\n${combined}`);
  const raw = fs.readFileSync(path.join(dir, 'runs', manifests[0]), 'utf8');
  const manifest = JSON.parse(raw);
  assert.strictEqual(manifest.prompt_sha256, expectSha);
  assert.strictEqual(manifest.prompt_file.length > 0, true);
});
