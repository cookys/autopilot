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

function setupSandbox(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-t5a-'));
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  const fleetBin = path.join(dir, 'fake-fleet');
  const stateFile = path.join(dir, 'fleet-state.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });

  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      whoami: 'ns/courier/requester-1',
      omitMessageId: Boolean(options.omitMessageId),
      calls: [],
      seq: 0,
    }),
  );

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
if (cmd === 'send') {
  state.seq += 1;
  state.calls.push({ to, text });
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
  const payload = state.omitMessageId
    ? { ok: true, to, text }
    : { ok: true, message_id: 'msg-' + state.seq, to, text };
  process.stdout.write(JSON.stringify(payload) + '\\n');
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
  return { dir, repo, env, stateFile };
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

const CLOSED_FIXTURES = [
  {
    category: 'authority',
    question: '是否允許升級生產環境資料庫？',
    answer: '同意升級',
    altAnswer: '暫緩升級',
  },
  {
    category: 'goal',
    question: '本週是否凍結新功能開發？',
    answer: '凍結一週',
    altAnswer: '繼續開發',
  },
  {
    category: 'money',
    question: '是否核准額外雲端運算預算？',
    answer: '核准五百',
    altAnswer: '維持原狀',
  },
  {
    category: 'public-release',
    question: '是否於今日發布 v2.1.0 公開版本？',
    answer: '今日發布',
    altAnswer: '延後發布',
  },
];

for (const fx of CLOSED_FIXTURES) {
  test(`T5a(a): closed answered card refuses reopen (${fx.category}: ${fx.question})`, () => {
    const { dir, repo, env } = setupSandbox();
    try {
      const r1 = runCli(
        [
          'open',
          '--category', fx.category,
          '--title', fx.question,
          '--question', fx.question,
          '--option', `${fx.answer}::選一`,
          '--option', `${fx.altAnswer}::選二`,
          '--recommendation', fx.answer,
          '--not-authorized', 'goal-change:owner only',
          '--executor', 'ns/courier/pm',
          '--cwd', repo,
          '--json',
        ],
        { repo, env },
      );
      assert.equal(r1.status, 0, `initial open failed: ${r1.stderr}`);
      const opened = JSON.parse(r1.stdout);

      const rc = runCli(['close', '--id', opened.id, '--answer', fx.answer, '--cwd', repo], { repo, env });
      assert.equal(rc.status, 0, `close failed: ${rc.stderr}`);

      const rd = runCli(['close', '--id', opened.id, '--dispatched', 'task-t5a', '--cwd', repo], { repo, env });
      assert.equal(rd.status, 0, `dispatched close failed: ${rd.stderr}`);

      const countBefore = readCards(repo, env).length;

      const r2 = runCli(
        [
          'open',
          '--category', fx.category,
          '--title', fx.question,
          '--question', fx.question,
          '--option', `${fx.answer}::選一`,
          '--option', `${fx.altAnswer}::選二`,
          '--recommendation', fx.answer,
          '--not-authorized', 'goal-change:owner only',
          '--executor', 'ns/courier/pm',
          '--cwd', repo,
          '--json',
        ],
        { repo, env },
      );

      assert.notEqual(r2.status, 0, 'reopening closed answered card must exit non-zero');
      const countAfter = readCards(repo, env).length;
      assert.equal(countAfter, countBefore, 'card count must not increase on refused reopen');
      const combinedOutput = `${r2.stdout}\n${r2.stderr}`;
      assert.ok(
        combinedOutput.includes(fx.answer),
        `output must include original answer "${fx.answer}", got: ${combinedOutput}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('T5a(b): from_request forwarding delivers once with same request id, and missing message_id is rejected', () => {
  const { dir, repo, env, stateFile } = setupSandbox();
  try {
    const reqId = 'r-5a987650';
    const openRes = runCli(
      [
        'open',
        '--cwd', repo,
        '--category', 'goal',
        '--question', '要轉送請求嗎？',
        '--title', '要轉送請求嗎？',
        '--option', '同意::執行',
        '--option', '拒絕::取消',
        '--recommendation', '同意',
        '--not-authorized', 'goal-change:need owner',
        '--executor', 'ns/courier/exec-1',
        '--from-request', reqId,
      ],
      { repo, env },
    );
    assert.ok(openRes.status === 0 || openRes.status === 5, openRes.stderr);
    const cardId = openRes.stdout.trim();
    assert.match(cardId, /^d-[0-9a-f]{8}$/);

    const { deliverAnswer } = require(SCRIPT);
    process.env.FLEET_BIN = env.FLEET_BIN;
    process.env.AUTOPILOT_FLEET_BIN = env.AUTOPILOT_FLEET_BIN;

    const deliv = deliverAnswer(scopeFileOf(repo), cardId, {
      answer_id: 'ans-t5a',
      answer: { option: '同意', free_text: null },
    });
    assert.equal(deliv.status, 'sent');

    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const forwardCalls = st.calls.filter((c) => c.to === 'ns/courier/requester-1');
    assert.equal(forwardCalls.length, 1, 'requester forward should be called once');
    assert.ok(
      forwardCalls[0].text.includes(reqId),
      `forwarded payload should include request id ${reqId}, got: ${forwardCalls[0].text}`,
    );

    const card = readCards(repo, env).find((c) => c.id === cardId);
    assert.equal(card.status, 'closed');
    assert.equal(card.forward_status, 'sent');
    assert.ok(card.forward_message_id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Negative control: fleet send response without message_id must be rejected
  const sbNoMsg = setupSandbox({ omitMessageId: true });
  try {
    const openRes = runCli(
      [
        'open',
        '--cwd', sbNoMsg.repo,
        '--category', 'goal',
        '--question', '缺少 message_id 會被拒嗎？',
        '--title', '缺少 message_id 會被拒嗎？',
        '--option', '是::確認',
        '--option', '否::取消',
        '--recommendation', '是',
        '--not-authorized', 'goal-change:need owner',
        '--executor', 'ns/courier/exec-1',
        '--from-request', 'r-0a0b0c0d',
      ],
      { repo: sbNoMsg.repo, env: sbNoMsg.env },
    );
    const cardId = openRes.stdout.trim();
    const { deliverAnswer } = require(SCRIPT);
    process.env.FLEET_BIN = sbNoMsg.env.FLEET_BIN;
    process.env.AUTOPILOT_FLEET_BIN = sbNoMsg.env.AUTOPILOT_FLEET_BIN;

    const deliv = deliverAnswer(scopeFileOf(sbNoMsg.repo), cardId, {
      answer_id: 'ans-nomsgid',
      answer: { option: '是', free_text: null },
    });
    assert.equal(deliv.status, 'failed', 'deliverAnswer without message_id must fail, got ' + JSON.stringify(deliv));
    assert.match(deliv.error, /message_id/);
    const stillOpen = readCards(sbNoMsg.repo, sbNoMsg.env).find((c) => c.id === cardId);
    assert.notEqual(stillOpen.forward_status, 'sent');
  } finally {
    fs.rmSync(sbNoMsg.dir, { recursive: true, force: true });
  }
});

function openCard(repo, env, title, question) {
  return runCli([
    "open", "--category", "goal", "--title", title, "--question", question,
    "--option", "同意::選一", "--option", "暫緩::選二", "--recommendation", "同意",
    "--not-authorized", "goal-change:owner only", "--executor", "ns/courier/pm",
    "--cwd", repo, "--json",
  ], { repo, env });
}

test("T5a(c): same question with a different title is still refused, and the refusal points at the original card", () => {
  const { dir, repo, env } = setupSandbox();
  try {
    const r1 = openCard(repo, env, "GPU線可代按權限框嗎？", "GPU 線可以代操作員按權限確認框嗎？");
    assert.equal(r1.status, 0, r1.stderr);
    const orig = JSON.parse(r1.stdout);
    assert.equal(runCli(["close", "--id", orig.id, "--answer", "同意", "--cwd", repo], { repo, env }).status, 0);
    assert.equal(runCli(["close", "--id", orig.id, "--dispatched", "task-t5a", "--cwd", repo], { repo, env }).status, 0);
    const before = readCards(repo, env).length;
    const r2 = openCard(repo, env, "GPU 負責人代按框嗎？", "GPU 線可以代操作員按權限確認框嗎？");
    assert.equal(r2.status, 15, `title swap must be refused, got ${r2.status}: ${r2.stderr}`);
    assert.equal(readCards(repo, env).length, before);
    assert.ok(`${r2.stdout}${r2.stderr}`.includes(orig.id), "refusal must name the original card");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T5a(d): a withdrawn card does not count as the answered original", () => {
  const { dir, repo, env } = setupSandbox();
  try {
    const r1 = openCard(repo, env, "要發布嗎？", "今天要發布 v3 嗎？");
    const first = JSON.parse(r1.stdout);
    assert.equal(runCli(["close", "--id", first.id, "--withdraw", "test", "--by", "pm", "--cwd", repo], { repo, env }).status, 0);
    const r2 = openCard(repo, env, "要發布嗎？", "今天要發布 v3 嗎？");
    assert.equal(r2.status, 0, `a withdrawn card must not block a fresh open: ${r2.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
