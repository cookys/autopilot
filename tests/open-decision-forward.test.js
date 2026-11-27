'use strict';
require('../scripts/lib/test-git-env'); // fixture repos must not run the account's global git config

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'open-decision.js');

function setupSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-forward-'));
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  const fleetBin = path.join(dir, 'fake-fleet');
  const stateFile = path.join(dir, 'fleet-state.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });

  fs.writeFileSync(stateFile, JSON.stringify({ whoami: 'ns/courier/requester-1', failSendTo: null, seq: 0 }));
  fs.writeFileSync(fleetBin, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const [cmd, to, text] = process.argv.slice(2);
if (cmd === 'whoami') {
  process.stdout.write(state.whoami + '\\n');
  process.exit(0);
}
if (cmd === 'send') {
  if (state.failSendTo && to === state.failSendTo) {
    process.stderr.write('simulated send failure\\n');
    process.exit(1);
  }
  state.seq += 1;
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
  process.stdout.write(JSON.stringify({ ok: true, message_id: 'msg-' + state.seq, to, text }) + '\\n');
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });

  const env = {
    ...process.env,
    HOME: home,
    FLEET_BIN: fleetBin,
    AUTOPILOT_FLEET_BIN: fleetBin,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_CARD_NOTIFY: 'off',
  };
  return { dir, repo, env, stateFile };
}

function readCards(repo) {
  const r = spawnSync(process.execPath, [SCRIPT, 'show', '--all', '--json', '--cwd', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).decisions;
}

function scopeFileOf(repo) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim();
  const absCommon = path.resolve(repo, common);
  const decDir = path.join(absCommon, 'autopilot', 'decisions');
  const files = fs.readdirSync(decDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'expected scope file in ' + decDir);
  return path.join(decDir, files[0]);
}

test('T2: open --from-request stores from_request_addr and deliverAnswer forwards to requester', () => {
  const { dir, repo, env } = setupSandbox();
  try {
    const openRes = spawnSync(process.execPath, [
      SCRIPT, 'open',
      '--cwd', repo,
      '--category', 'goal',
      '--question', '要繼續嗎？',
      '--title', '要繼續嗎？',
      '--option', '繼續::照計畫',
      '--option', '暫停::先停一下',
      '--recommendation', '繼續',
      '--not-authorized', 'goal-change:need owner',
      '--executor', 'ns/courier/exec-1',
      '--from-request', 'r-1234abcd',
    ], { encoding: 'utf8', env });
    assert.ok(openRes.status === 0 || openRes.status === 5, openRes.stderr);
    const cardId = openRes.stdout.trim();
    assert.match(cardId, /^d-[0-9a-f]{8}$/);

    const cardsBefore = readCards(repo);
    const card = cardsBefore.find((c) => c.id === cardId);
    assert.equal(card.from_request, 'r-1234abcd');
    assert.equal(card.from_request_addr, 'ns/courier/requester-1');

    const { deliverAnswer } = require(SCRIPT);
    process.env.FLEET_BIN = env.FLEET_BIN;
    process.env.AUTOPILOT_FLEET_BIN = env.AUTOPILOT_FLEET_BIN;
    const deliv = deliverAnswer(scopeFileOf(repo), cardId, {
      answer_id: 'ans-1',
      answer: { option: '繼續', free_text: null },
    });
    assert.equal(deliv.status, 'sent');

    const after = readCards(repo).find((c) => c.id === cardId);
    assert.equal(after.status, 'closed');
    assert.ok(after.dispatched_message_id);
    assert.equal(after.forward_status, 'sent');
    assert.ok(after.forward_message_id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T2: forward failure records failed status/error/attempts without changing closed status, and forward subcommand retries', () => {
  const { dir, repo, env, stateFile } = setupSandbox();
  try {
    const openRes = spawnSync(process.execPath, [
      SCRIPT, 'open',
      '--cwd', repo,
      '--category', 'goal',
      '--question', '要重試嗎？',
      '--title', '要重試嗎？',
      '--option', '好::執行',
      '--option', '不要::取消',
      '--recommendation', '好',
      '--not-authorized', 'goal-change:need owner',
      '--executor', 'ns/courier/exec-1',
      '--from-request', 'r-deadbeef',
    ], { encoding: 'utf8', env });
    const cardId = openRes.stdout.trim();

    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    st.failSendTo = 'ns/courier/requester-1';
    fs.writeFileSync(stateFile, JSON.stringify(st));

    const { deliverAnswer } = require(SCRIPT);
    process.env.FLEET_BIN = env.FLEET_BIN;
    process.env.AUTOPILOT_FLEET_BIN = env.AUTOPILOT_FLEET_BIN;
    const deliv = deliverAnswer(scopeFileOf(repo), cardId, {
      answer_id: 'ans-2',
      answer: { option: '好', free_text: null },
    });
    assert.equal(deliv.status, 'sent');

    const failedCard = readCards(repo).find((c) => c.id === cardId);
    assert.equal(failedCard.status, 'closed');
    assert.equal(failedCard.forward_status, 'failed');
    assert.ok(failedCard.forward_error);
    assert.equal(failedCard.forward_attempts, 1);

    st.failSendTo = null;
    fs.writeFileSync(stateFile, JSON.stringify(st));

    const retryRes = spawnSync(process.execPath, [SCRIPT, 'forward', cardId, '--cwd', repo], { encoding: 'utf8', env });
    assert.equal(retryRes.status, 0, retryRes.stderr);

    const sentCard = readCards(repo).find((c) => c.id === cardId);
    assert.equal(sentCard.forward_status, 'sent');
    assert.ok(sentCard.forward_message_id);

    const refuseRes = spawnSync(process.execPath, [SCRIPT, 'forward', cardId, '--cwd', repo], { encoding: 'utf8', env });
    assert.equal(refuseRes.status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T2: card without from_request is marked skipped_no_requester', () => {
  const { dir, repo, env } = setupSandbox();
  try {
    const openRes = spawnSync(process.execPath, [
      SCRIPT, 'open',
      '--cwd', repo,
      '--category', 'goal',
      '--question', '無請求者嗎？',
      '--title', '無請求者嗎？',
      '--option', '是::確認',
      '--option', '否::取消',
      '--recommendation', '是',
      '--not-authorized', 'goal-change:need owner',
      '--executor', 'ns/courier/exec-1',
    ], { encoding: 'utf8', env });
    const cardId = openRes.stdout.trim();

    const { deliverAnswer } = require(SCRIPT);
    process.env.FLEET_BIN = env.FLEET_BIN;
    process.env.AUTOPILOT_FLEET_BIN = env.AUTOPILOT_FLEET_BIN;
    const deliv = deliverAnswer(scopeFileOf(repo), cardId, {
      answer_id: 'ans-3',
      answer: { option: '是', free_text: null },
    });
    assert.equal(deliv.status, 'sent');

    const card = readCards(repo).find((c) => c.id === cardId);
    assert.equal(card.status, 'closed');
    assert.equal(card.forward_status, 'skipped_no_requester');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
