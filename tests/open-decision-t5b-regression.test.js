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
const { triage } = require(path.join(REPO_ROOT, 'scripts', 'card-triage.js'));

function setupSandbox(fleetConfig = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-t5b-'));
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  const fleetBin = path.join(dir, 'fake-fleet');
  const stateFile = path.join(dir, 'fleet-state.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  const initialState = {
    whoami: 'ns/courier/requester-1',
    verifyExit: 0,
    sendExit: 0,
    sendStdout: null,
    seq: 0,
    ...fleetConfig,
  };
  fs.writeFileSync(stateFile, JSON.stringify(initialState));

  fs.writeFileSync(
    fleetBin,
    `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const [cmd, to, text] = process.argv.slice(2);
if (cmd === 'whoami') {
  process.stdout.write(state.whoami + '\\n');
  process.exit(0);
}
if (cmd === 'verify') {
  if (state.verifyExit !== 0) {
    process.stderr.write('simulated verify failure\\n');
    process.exit(state.verifyExit);
  }
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (cmd === 'send') {
  if (state.sendStdout !== null && state.sendStdout !== undefined) {
    process.stdout.write(state.sendStdout === '' ? '' : state.sendStdout + '\\n');
    process.exit(state.sendExit || 0);
  }
  if (state.sendExit !== 0) {
    process.stderr.write('simulated send failure\\n');
    process.exit(state.sendExit);
  }
  state.seq += 1;
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
  process.stdout.write(JSON.stringify({ ok: true, message_id: 'msg-' + state.seq, to, text }) + '\\n');
  process.exit(0);
}
process.exit(2);
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    HOME: home,
    FLEET_BIN: fleetBin,
    AUTOPILOT_FLEET_BIN: fleetBin,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_CARD_NOTIFY: 'off',
    CLAUDE_CODE_SESSION_ID: '',
    AUTOPILOT_SESSION_ID: '',
    AUTOPILOT_ROOT_RUN_ID: '',
  };

  return { dir, home, repo, env, stateFile };
}

function runCli(args, { repo, env }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env,
  });
}

function readCards(repo, env) {
  const r = runCli(['show', '--all', '--json', '--cwd', repo], { repo, env });
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

const VERIFY_FAILED_CASES = [
  {
    name: 'send exits non-zero',
    fleetConfig: { sendExit: 1, sendStdout: null },
  },
  {
    name: 'send returns empty output',
    fleetConfig: { sendStdout: '', sendExit: 0 },
  },
  {
    name: 'send returns {ok:false}',
    fleetConfig: { sendStdout: JSON.stringify({ ok: false, error: 'courier_unreachable' }), sendExit: 0 },
  },
  {
    name: 'send returns {ok:true} without message_id',
    fleetConfig: { sendStdout: JSON.stringify({ ok: true }), sendExit: 0 },
  },
  {
    name: 'send returns non-JSON output',
    fleetConfig: { sendStdout: 'not-json-output', sendExit: 0 },
  },
];

VERIFY_FAILED_CASES.forEach((tc, idx) => {
  test(`T5b(a) verify_failed keeps card pending_dispatch: ${tc.name}`, () => {
    const { dir, repo, env } = setupSandbox(tc.fleetConfig);
    try {
      const openRes = runCli(
        [
          'open',
          '--cwd', repo,
          '--category', 'goal',
          '--title', `核實失敗 ${idx + 1}？`,
          '--question', `第 ${idx + 1} 組核實失敗是否仍待處理？`,
          '--option', '繼續::照計畫',
          '--option', '暫停::先停',
          '--recommendation', '繼續',
          '--not-authorized', 'goal-change:need owner',
          '--executor', 'ns/courier/exec-1',
          '--from-request', `r-0000000${idx + 1}`,
          '--json',
        ],
        { repo, env },
      );
      assert.ok(openRes.status === 0 || openRes.status === 5, openRes.stderr);
      const cardId = JSON.parse(openRes.stdout).id;
      assert.match(cardId, /^d-[0-9a-f]{8}$/);

      const { deliverAnswer } = require(SCRIPT);
      process.env.FLEET_BIN = env.FLEET_BIN;
      process.env.AUTOPILOT_FLEET_BIN = env.AUTOPILOT_FLEET_BIN;

      const scopeFile = scopeFileOf(repo);
      deliverAnswer(scopeFile, cardId, {
        answer_id: 'ans-1',
        answer: { option: '繼續', free_text: null },
      });

      const afterFirst = readCards(repo, env).find((c) => c.id === cardId);
      assert.equal(afterFirst.status, 'pending_dispatch');
      assert.notEqual(afterFirst.status, 'closed');
      assert.ok(afterFirst.dispatch_error, 'dispatch_error should be written');
      assert.equal(afterFirst.dispatch_attempts, 1);

      deliverAnswer(scopeFile, cardId, {
        answer_id: 'ans-1',
        answer: { option: '繼續', free_text: null },
      });

      const afterSecond = readCards(repo, env).find((c) => c.id === cardId);
      assert.equal(afterSecond.status, 'pending_dispatch');
      assert.notEqual(afterSecond.status, 'closed');
      assert.ok(afterSecond.dispatch_error, 'dispatch_error should remain set');
      assert.equal(afterSecond.dispatch_attempts, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('T5b(b) visibility incident: scope_mismatch is distinct from verify_failed and both report independently', () => {
  const card = {
    id: 'd-1a2b3c4d',
    status: 'open',
    cwd: '/tmp/other-repo',
  };
  const currentRepo = '/tmp/current-repo';

  const visOnly = triage({ card, visibleIds: [], repo: currentRepo });
  assert.equal(visOnly.visibility, "scope_mismatch");
  assert.notEqual(visOnly.delivery, "dispatch_failed");
  assert.equal(visOnly.ok, false);

  const combined = triage({
    card: { ...card, dispatch_error: 'verify_failed: exit 1' },
    visibleIds: [],
    receipt: {
      card_id: card.id,
      answer_id: 'ans-1',
      failure_class: 'verify_failed',
      timestamp: '2026-11-25T00:00:00Z',
    },
    repo: currentRepo,
  });

  assert.equal(combined.visibility, 'scope_mismatch');
  assert.equal(combined.delivery, 'dispatch_failed');
  assert.equal(combined.receipt, 'valid:verify_failed');
  assert.equal(combined.ok, false);
});

test("T5b(c): a card that failed auto-dispatch but was later delivered by hand is delivered, not dispatch_failed", () => {
  const out = triage({
    card: { id: "d-711f61af", status: "closed", dispatch_error: "fleet send exit 1", dispatched_message_id: "01M874RBEMFYTE53F2VRDTZY7H" },
    repo: "/tmp/x",
  });
  assert.equal(out.delivery, "delivered");
  assert.equal(out.ok, true);
});

test("T5b(d): card-triage CLI refuses a store file (not one card) with a non-zero exit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-store-"));
  try {
    const f = path.join(dir, "store.json");
    fs.writeFileSync(f, JSON.stringify({ decisions: [{ id: "d-1a2b3c4d" }] }));
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "card-triage.js"), "--card", f], { encoding: "utf8" });
    assert.equal(r.status, 2, `store file must exit 2, got ${r.status}: ${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T5b(e): the real hand-closed card shape (dispatched_msg_id + closed_via fleet_message + stale dispatch_error) is delivered", () => {
  const out = triage({
    card: { id: "d-711f61af", status: "closed", closed_via: "fleet_message", dispatched_msg_id: "01M874RBEMFYTE53F2VRDTZY7H", dispatch_error: "fleet send exit 1" },
    repo: "/tmp/x",
  });
  assert.equal(out.delivery, "delivered");
  assert.equal(out.ok, true);
});
