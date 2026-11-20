#!/usr/bin/env node
'use strict';
/**
 * Tests for scripts/lib/cursor-broker-run.js — stub broker socket only, temp git worktree.
 * Run: node --test scripts/cursor-broker-run.test.js < /dev/null
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const RUN_JS = path.join(__dirname, 'lib', 'cursor-broker-run.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-broker-run-test-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function initRepo(dir) {
  const git = (args, opts = {}) => {
    const r = spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      ...opts,
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
    return r;
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'broker-test@example.com']);
  git(['config', 'user.name', 'broker-test']);
  fs.writeFileSync(path.join(dir, 'README'), 'seed\n');
  git(['add', 'README']);
  git(['commit', '-q', '-m', 'init']);
  return dir;
}

function stubBroker(socketPath, reply) {
  const server = net.createServer((conn) => {
    conn.on('data', () => {
      conn.write(`${JSON.stringify(reply)}\n`);
      conn.destroy();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve(server));
  });
}

function runBrokerCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUN_JS, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`cursor-broker-run timed out\n${stderr}`));
    }, 60_000);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

test('invalid run id -> exit 2', () => {
  const workRoot = fs.mkdtempSync(path.join(TMP, 'wr-'));
  const worktree = initRepo(fs.mkdtempSync(path.join(TMP, 'wt-')));
  const prompt = path.join(workRoot, 'prompt.txt');
  fs.writeFileSync(prompt, 'task body');
  const out = path.join(workRoot, 'out.json');
  const env = {
    PATH: process.env.PATH,
    HOME: TMP,
    TMPDIR: TMP,
    AUTOPILOT_CURSOR_WORK_ROOT: workRoot,
    AUTOPILOT_CURSOR_BROKER_SOCK: path.join(workRoot, 'unused.sock'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const res = spawnSync(process.execPath, [RUN_JS, worktree, prompt, 'composer-2.5', '120', 'bad/run', out], {
    encoding: 'utf8',
    env,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /invalid/);
});

test('successful broker response writes out file and exits 0', async () => {
  const workRoot = fs.mkdtempSync(path.join(TMP, 'ok-'));
  const socketPath = path.join(workRoot, 'broker.sock');
  const worktree = initRepo(fs.mkdtempSync(path.join(TMP, 'repo-')));
  const prompt = path.join(workRoot, 'prompt.txt');
  fs.writeFileSync(prompt, 'do work');
  const out = path.join(workRoot, 'response.json');
  const runId = 'run-ok-test-1';
  const reply = {
    ok: true,
    diff: '',
    log: 'broker ok\n',
    run_id: runId,
    verdict: 'done',
  };
  const server = await stubBroker(socketPath, reply);
  const env = {
    PATH: process.env.PATH,
    HOME: TMP,
    TMPDIR: TMP,
    AUTOPILOT_CURSOR_WORK_ROOT: workRoot,
    AUTOPILOT_CURSOR_BROKER_SOCK: socketPath,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const res = await runBrokerCli([worktree, prompt, 'composer-2.5', '120', runId, out], env);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.ok(fs.existsSync(out));
  const body = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(body.verdict, 'done');
  assert.equal(fs.existsSync(path.join(workRoot, runId)), false, 'clone cleaned up');
});

test('broker hard-fail verdict returns exit 1 but still writes response', async () => {
  const workRoot = fs.mkdtempSync(path.join(TMP, 'fail-'));
  const socketPath = path.join(workRoot, 'broker.sock');
  const worktree = initRepo(fs.mkdtempSync(path.join(TMP, 'repo2-')));
  const prompt = path.join(workRoot, 'prompt.txt');
  fs.writeFileSync(prompt, 'task');
  const out = path.join(workRoot, 'out-fail.json');
  const runId = 'run-fail-1';
  const server = await stubBroker(socketPath, {
    ok: true,
    diff: '',
    log: 'stopped\n',
    run_id: runId,
    verdict: 'stopped_billing',
  });
  const env = {
    PATH: process.env.PATH,
    HOME: TMP,
    TMPDIR: TMP,
    AUTOPILOT_CURSOR_WORK_ROOT: workRoot,
    AUTOPILOT_CURSOR_BROKER_SOCK: socketPath,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const res = await runBrokerCli([worktree, prompt, 'composer-2.5', '120', runId, out], env);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(res.status, 1);
  assert.ok(fs.existsSync(out));
});