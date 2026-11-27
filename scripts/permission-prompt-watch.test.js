#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/permission-prompt-watch.js parse/main exports and CLI with --text-file only (no tmux).
 * Run: node --test scripts/permission-prompt-watch.test.js < /dev/null
 */

require('./lib/test-git-env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WATCH = path.join(__dirname, 'permission-prompt-watch.js');
const { parse, main } = require('./permission-prompt-watch.js');
const PANE = fs.readFileSync(path.join(__dirname, '..', 'hooks', 'fixtures', 'permission-prompt-pane.txt'), 'utf8');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'permwatch-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function initRepo() {
  const repo = path.join(TMP_ROOT, `repo-${Date.now()}`);
  fs.mkdirSync(repo, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: fs.mkdtempSync(path.join(TMP_ROOT, 'permwatch-home-')),
    TMPDIR: TMP_ROOT,
    AUTOPILOT_CARD_NOTIFY: 'off',
    GIT_CONFIG_GLOBAL: path.join(__dirname, 'lib', 'test-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8', env });
  assert.equal(init.status, 0, init.stderr);
  return { repo, env };
}

function runCli(env, repo, stateDir, textFile, nowMs, extra = []) {
  return spawnSync(process.execPath, [
    WATCH,
    '--pane', '%7',
    '--cwd', repo,
    '--state-dir', stateDir,
    '--text-file', textFile,
    '--now-ms', String(nowMs),
    ...extra,
  ], { encoding: 'utf8', env });
}

// ---------- parse() ----------

test('parse: required flags map to fields', () => {
  const o = parse(['--pane', '%0', '--cwd', '/tmp/w', '--hold-s', '5', '--session', 's1']);
  assert.ok(o);
  assert.equal(o.pane, '%0');
  assert.equal(o.cwd, '/tmp/w');
  assert.equal(o.holdS, 5);
  assert.equal(o.session, 's1');
});

test('parse: missing value or unknown key returns null', () => {
  assert.equal(parse(['--pane', '%0']), null);
  assert.equal(parse(['--bogus', 'x', '--cwd', '/tmp']), null);
});

test('parse: non-finite or negative hold-s returns null', () => {
  assert.equal(parse(['--pane', '%0', '--cwd', '/x', '--hold-s', 'nope']), null);
  assert.equal(parse(['--pane', '%0', '--cwd', '/x', '--hold-s', '-1']), null);
});

// ---------- main() via module (no tmux) ----------

test('main: usage error returns 2', () => {
  assert.equal(main(['--pane']), 2);
});

test('CLI: idle pane -> verdict idle', () => {
  const { repo, env } = initRepo();
  const stateDir = fs.mkdtempSync(path.join(TMP_ROOT, 'state-'));
  const text = path.join(stateDir, 'idle.txt');
  fs.writeFileSync(text, 'ordinary transcript\n❯ \n');
  const r = runCli(env, repo, stateDir, text, 0);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.verdict, 'idle');
  assert.equal(out.pane, '%7');
});

test('CLI: held prompt -> pending then BLOCKED_ON_PERMISSION with one card', () => {
  const { repo, env } = initRepo();
  const stateDir = fs.mkdtempSync(path.join(TMP_ROOT, 'state-'));
  const text = path.join(stateDir, 'pane.txt');
  fs.writeFileSync(text, PANE);
  let r = runCli(env, repo, stateDir, text, 1000);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).verdict, 'pending');
  r = runCli(env, repo, stateDir, text, 11500);
  assert.equal(r.status, 0, r.stderr);
  const hit = JSON.parse(r.stdout.trim());
  assert.equal(hit.verdict, 'BLOCKED_ON_PERMISSION');
  assert.match(hit.command, /rm -rf/);
  const decisions = path.join(repo, '.git', 'autopilot', 'decisions');
  const open = fs.existsSync(decisions)
    ? fs.readdirSync(decisions).flatMap((f) => {
      const j = JSON.parse(fs.readFileSync(path.join(decisions, f), 'utf8'));
      return (j.decisions || []).filter((d) => !d.status || d.status === 'open');
    })
    : [];
  assert.equal(open.length, 1);
  fs.writeFileSync(text, 'answered\n');
  r = runCli(env, repo, stateDir, text, 12000);
  assert.equal(JSON.parse(r.stdout.trim()).verdict, 'cleared');
});

test('CLI: unreadable --text-file exits 3', () => {
  const { repo, env } = initRepo();
  const stateDir = fs.mkdtempSync(path.join(TMP_ROOT, 'state-'));
  const missing = path.join(stateDir, 'missing.txt');
  const r = runCli(env, repo, stateDir, missing, 0);
  assert.equal(r.status, 3);
  assert.ok(r.stderr.length > 0);
});

test.skip('CLI tmux capture-pane path — not exercised; hooks/permission-block.test.js covers tmux-less text-file E2E', () => {});