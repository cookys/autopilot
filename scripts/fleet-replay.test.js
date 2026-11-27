'use strict';

/**
 * Tests for scripts/fleet-replay.js.
 * Run:
 *   unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID AUTOPILOT_FLEET_TASK AUTOPILOT_UPSTREAM_TASK_ID
 *   node --test scripts/fleet-replay.test.js < /dev/null
 */

require('./lib/test-git-env.js');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'fleet-replay.js');
const {
  parseJsonl,
  replaySwitchboard,
  replayGuard,
  verdictForRatio,
} = require('./fleet-replay.js');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-replay-test-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function runGit(cwd, args) {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return String(res.stdout || '').trim();
}

function makeHermeticRepo(name) {
  const base = path.join(TMP_ROOT, name);
  const originDir = path.join(base, 'origin.git');
  const repoDir = path.join(base, 'repo');
  fs.mkdirSync(originDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });

  runGit(originDir, ['init', '--bare', '-q']);
  runGit(repoDir, ['init', '-q']);
  runGit(repoDir, ['remote', 'add', 'origin', originDir]);
  fs.writeFileSync(path.join(repoDir, 'app.txt'), 'v1\n', 'utf8');
  runGit(repoDir, ['add', 'app.txt']);
  runGit(repoDir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'initial commit']);
  const branch = runGit(repoDir, ['symbolic-ref', '--short', 'HEAD']);
  runGit(repoDir, ['push', '-q', '-u', 'origin', branch]);

  const fullSha = runGit(repoDir, ['rev-parse', 'HEAD']);
  const shortSha = runGit(repoDir, ['rev-parse', '--short=7', 'HEAD']);
  const commitEpoch = Number(runGit(repoDir, ['show', '-s', '--format=%ct', 'HEAD']));
  const dispatchedAt = new Date((commitEpoch - 120) * 1000).toISOString();

  return { base, repoDir, fullSha, shortSha, dispatchedAt };
}

function buildSwitchboardFixture(repoInfo) {
  const receiptHex = repoInfo.fullSha.startsWith('0') ? '1122334455667788' : '0011223344556677';
  const tasks = {
    '01M7REPLAY0000000000000001': {
      assignee: 'ns/host/lane-c',
      attempt: 1,
      dispatched_at: repoInfo.dispatchedAt,
      acceptance: ['replay test green'],
    },
  };

  const messages = [
    // Hour 1 (10:00Z): 1 auto_accept, 3 needs_decision, 3 residue -> wakes = 1
    {
      source: 'inbox',
      from: 'ns/host/lane-c',
      message_id: 'm01',
      kind: 'task_result',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: [
        `Repo: ${repoInfo.repoDir}`,
        'Task: 01M7REPLAY0000000000000001',
        'Status: done',
        'Attempt: 1',
        `Commit: ${repoInfo.shortSha}`,
        `Verify: rc=0 receipt=${receiptHex}`,
        '- [x] replay test green',
        'Used: e2e verified fleet replay',
      ].join('\n'),
      seen_at: '2026-11-18T10:05:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/operator',
      message_id: 'm02',
      kind: 'chat',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: 'hold release until tomorrow',
      seen_at: '2026-11-18T10:10:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-a',
      message_id: 'm03',
      kind: 'decision_request',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: 'Choose rollout A or B?',
      seen_at: '2026-11-18T10:15:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-b',
      message_id: 'm04',
      kind: 'chat',
      reply_to: null,
      disposition: 'unread',
      fyi: true,
      attachments: [],
      body: 'Should we merge this branch?',
      seen_at: '2026-11-18T10:20:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-a',
      message_id: 'm05',
      kind: 'note',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: 'general status update without markers',
      seen_at: '2026-11-18T10:25:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-b',
      message_id: 'm06',
      kind: 'note',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: 'another freeform observation note',
      seen_at: '2026-11-18T10:30:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-d',
      message_id: 'm07',
      kind: 'note',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: 'misc note from lane d',
      seen_at: '2026-11-18T10:35:00Z',
    },
    // Hour 2 (11:00Z): 5 no_action -> wakes = 0
    {
      source: 'inbox',
      from: 'ns/host/lane-a',
      message_id: 'm08',
      kind: 'ack',
      reply_to: 'm00',
      disposition: 'no_action',
      fyi: false,
      attachments: [],
      body: 'received work order',
      seen_at: '2026-11-18T11:05:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-b',
      message_id: 'm09',
      kind: 'wake',
      reply_to: null,
      disposition: 'no_action',
      fyi: false,
      attachments: [],
      body: 'scheduled heartbeat',
      seen_at: '2026-11-18T11:10:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-c',
      message_id: 'm10',
      kind: 'chat',
      reply_to: null,
      disposition: 'no_action',
      fyi: true,
      attachments: [],
      body: 'metrics snapshot completed',
      seen_at: '2026-11-18T11:15:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-d',
      message_id: 'm11',
      kind: 'chat',
      reply_to: null,
      disposition: 'no_action',
      fyi: false,
      attachments: [],
      body: '[stage:build/implement] working on module',
      seen_at: '2026-11-18T11:20:00Z',
    },
    {
      source: 'inbox',
      from: 'ns/host/lane-e',
      message_id: 'm12',
      kind: 'chat',
      reply_to: null,
      disposition: 'no_action',
      fyi: false,
      attachments: [],
      body: '[auto] merged branch feat/replay',
      seen_at: '2026-11-18T11:25:00Z',
    },
  ];

  const jsonlText = [
    ...messages.slice(0, 4).map((m) => JSON.stringify(m)),
    '{corrupt-json-line',
    ...messages.slice(4).map((m) => JSON.stringify(m)),
    '',
  ].join('\n');

  return { tasks, messages, jsonlText };
}

function assertSwitchboardFixtureCounts(report) {
  assert.equal(report.total_messages, 12);
  assert.equal(report.bad_lines, 1);
  assert.equal(report.counts.auto_accept, 1);
  assert.equal(report.counts.needs_decision, 3);
  assert.equal(report.counts.no_action, 5);
  assert.equal(report.counts.residue, 3);
  assert.equal(report.counts.needs_decision_incl_residue, 6);
}

test('switchboard mode: 12-line synthetic fixture counts, bad_lines, both ratios, wakes/hour, breakdowns, CLI', () => {
  const repoInfo = makeHermeticRepo('swb-fx');
  const fx = buildSwitchboardFixture(repoInfo);
  const inputFile = path.join(repoInfo.base, 'messages.jsonl');
  const tasksFile = path.join(repoInfo.base, 'tasks.json');
  const outDir = path.join(repoInfo.base, 'out-with-op');
  fs.writeFileSync(inputFile, fx.jsonlText, 'utf8');
  fs.writeFileSync(tasksFile, JSON.stringify(fx.tasks, null, 2), 'utf8');

  const cliRun = spawnSync(
    process.execPath,
    [
      CLI,
      '--input', inputFile,
      '--mode', 'switchboard',
      '--operator', 'ns/host/operator',
      '--tasks', tasksFile,
      '--out', outDir,
    ],
    { encoding: 'utf8', input: '' },
  );
  assert.equal(cliRun.status, 0, cliRun.stderr);
  const report = JSON.parse(cliRun.stdout);

  assertSwitchboardFixtureCounts(report);
  assert.equal(report.operator_messages, 1);
  assert.equal(report.non_operator_messages, 11);
  assert.equal(report.residue_ratio.all, 0.25);
  assert.equal(report.residue_ratio.non_operator, Number((3 / 11).toFixed(6)));
  assert.equal(report.verdict, 'add_sonnet_fallback');
  assert.match(report.verdict_line, /add_sonnet_fallback/);
  assert.match(report.human_check_note, /human or engine review/i);

  // Two hours: 10:00Z has wakes, 11:00Z has 0 wakes -> span=2, wake_hours=1, mean=0.5, max=1
  assert.equal(report.wakes_per_hour.span_hours, 2);
  assert.equal(report.wakes_per_hour.wake_hours, 1);
  assert.equal(report.wakes_per_hour.mean, 0.5);
  assert.equal(report.wakes_per_hour.max, 1);

  assert.deepEqual(report.by_kind.chat, {
    total: 5,
    auto_accept: 0,
    needs_decision: 2,
    no_action: 3,
    residue: 0,
  });
  assert.equal(report.by_kind.note.residue, 3);
  assert.equal(report.by_kind.task_result.auto_accept, 1);
  assert.equal(report.by_from_top20.length, 6);
  assert.equal(report.by_from_top20[0].from, 'ns/host/lane-a');
  assert.equal(report.by_from_top20[0].total, 3);

  // Sample files written by CLI
  assert.equal(fs.existsSync(path.join(outDir, 'residue-sample.jsonl')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'no-action-sample.jsonl')), true);
  const resLines = fs.readFileSync(path.join(outDir, 'residue-sample.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const naLines = fs.readFileSync(path.join(outDir, 'no-action-sample.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(resLines.length, 3);
  assert.equal(naLines.length, 5);

  // Without --operator: operator_patterns empty, reported explicitly, non_operator === all
  const noOpRun = spawnSync(
    process.execPath,
    [CLI, '--input', inputFile, '--mode', 'switchboard', '--tasks', tasksFile],
    { encoding: 'utf8', input: '' },
  );
  assert.equal(noOpRun.status, 0, noOpRun.stderr);
  const noOpReport = JSON.parse(noOpRun.stdout);
  assert.deepEqual(noOpReport.operator_patterns, []);
  assert.match(noOpReport.operator_filter_note, /none/);
  assert.equal(noOpReport.non_operator_messages, 12);
  assert.equal(noOpReport.counts.residue, 4);
  assert.equal(noOpReport.residue_ratio.all, noOpReport.residue_ratio.non_operator);

  // --human prints zh-TW table
  const humanRun = spawnSync(
    process.execPath,
    [CLI, '--input', inputFile, '--mode', 'switchboard', '--tasks', tasksFile, '--human'],
    { encoding: 'utf8', input: '' },
  );
  assert.equal(humanRun.status, 0, humanRun.stderr);
  assert.match(humanRun.stdout, /自動驗收/);
  assert.match(humanRun.stdout, /待裁/);
  assert.match(humanRun.stdout, /不需處理/);
  assert.match(humanRun.stdout, /殘餘/);
  assert.match(humanRun.stdout, /未指定 --operator/);
  assert.match(humanRun.stdout, /切換判定/);
});

test('switchboard samples: 50 deterministic rows each, exact 4 fields, body120 <= 120, top-20 from cap', () => {
  const msgs = [];
  for (let i = 80; i >= 1; i -= 1) {
    const id = String(i).padStart(3, '0');
    const sender = `ns/host/lane-${String((i % 25) + 1).padStart(2, '0')}`;
    msgs.push({
      source: 'inbox',
      from: sender,
      message_id: `res-${id}`,
      kind: 'note',
      reply_to: null,
      disposition: 'unread',
      fyi: false,
      attachments: [],
      body: `RES-${id}-` + 'A'.repeat(160),
      seen_at: '2026-11-18T12:00:00Z',
    });
    msgs.push({
      source: 'inbox',
      from: sender,
      message_id: `na-${id}`,
      kind: 'ack',
      reply_to: null,
      disposition: 'no_action',
      fyi: false,
      attachments: [],
      body: `NA-${id}-` + 'B'.repeat(160),
      seen_at: '2026-11-18T12:00:00Z',
    });
  }

  const outDir1 = path.join(TMP_ROOT, 'samples-1');
  const outDir2 = path.join(TMP_ROOT, 'samples-2');
  const r1 = replaySwitchboard(msgs, { outDir: outDir1 });
  const r2 = replaySwitchboard(msgs, { outDir: outDir2 });

  assert.equal(r1.by_from_top20.length, 20, 'top 20 senders cap respected');
  assert.equal(r1.samples.residue_count, 50);
  assert.equal(r1.samples.no_action_count, 50);

  for (const name of ['residue-sample.jsonl', 'no-action-sample.jsonl']) {
    const raw1 = fs.readFileSync(path.join(outDir1, name), 'utf8');
    const raw2 = fs.readFileSync(path.join(outDir2, name), 'utf8');
    assert.equal(raw1, raw2, `${name} must be deterministic`);

    const rows = raw1.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 50, `${name} must have 50 lines`);
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      assert.deepEqual(
        Object.keys(row).sort(),
        ['body120', 'from', 'kind', 'message_id'],
        `${name} row must have exact 4 keys only`,
      );
      assert.ok(row.body120.length <= 120, 'body120 length <= 120');
      assert.equal(row.body120.length, 120, 'long body sliced to 120 chars');
      if (idx > 0) {
        assert.ok(rows[idx - 1].message_id <= row.message_id, `${name} must be sorted by message_id`);
      }
    }
  }
});

test('verdict thresholds: 9% keep_rules, 16% add_sonnet_fallback, 12% borderline (plus 10%/15% boundaries)', () => {
  assert.equal(verdictForRatio(0.09), 'keep_rules');
  assert.equal(verdictForRatio(0.10), 'keep_rules');
  assert.equal(verdictForRatio(0.12), 'borderline');
  assert.equal(verdictForRatio(0.15), 'borderline');
  assert.equal(verdictForRatio(0.16), 'add_sonnet_fallback');

  const makeBatch = (residueCount) => {
    const out = [];
    for (let i = 0; i < 100; i += 1) {
      out.push({
        source: 'inbox',
        from: 'ns/host/lane-a',
        message_id: `v-${String(i).padStart(3, '0')}`,
        kind: i < residueCount ? 'note' : 'ack',
        reply_to: null,
        disposition: 'unread',
        fyi: false,
        attachments: [],
        body: i < residueCount ? `unclassified note ${i}` : 'ack',
        seen_at: '2026-11-18T10:00:00Z',
      });
    }
    return out;
  };

  assert.equal(replaySwitchboard(makeBatch(9)).verdict, 'keep_rules');
  assert.equal(replaySwitchboard(makeBatch(12)).verdict, 'borderline');
  assert.equal(replaySwitchboard(makeBatch(16)).verdict, 'add_sonnet_fallback');
});

test('guard mode: PM chat/dispatch work orders denied vs allowed, non-PM/other kinds skipped, 3+3 samples & review label', () => {
  const guardMessages = [
    // 4 PM chat/dispatch messages that guard MUST deny
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-a',
      message_id: 'g-d1',
      kind: 'chat',
      fyi: false,
      body: '請修這個 bug 並回報進度 ' + 'Z'.repeat(130),
      seen_at: '2026-11-18T10:00:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm',
      to: 'ns/host/lane-b',
      message_id: 'g-d2',
      kind: 'dispatch',
      fyi: false,
      body: 'please run the integration suite',
      seen_at: '2026-11-18T10:01:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-c',
      message_id: 'g-d3',
      kind: 'chat',
      fyi: true,
      body: '[no-task: quick] 去跑一下驗證',
      seen_at: '2026-11-18T10:02:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-d',
      message_id: 'g-d4',
      kind: 'chat',
      fyi: false,
      body: 'please implement parser and reply with sha',
      seen_at: '2026-11-18T10:03:00Z',
    },
    // 4 PM chat/dispatch messages that guard MUST allow
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-a',
      message_id: 'g-a1',
      kind: 'chat',
      fyi: false,
      body: '純狀態同步：目前主線已整合完成，無需回覆 ' + 'W'.repeat(130),
      seen_at: '2026-11-18T10:04:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-b',
      message_id: 'g-a2',
      kind: 'chat',
      fyi: true,
      // fyi=true exempts a pure fact only; an imperative ("請做...") under fyi is still a work order.
      body: 'FYI 參考即可，主線狀態已同步（fyi=true，無指令）',
      seen_at: '2026-11-18T10:05:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: '@all',
      message_id: 'g-a3',
      kind: 'chat',
      fyi: false,
      body: '請跑廣播測試通知',
      seen_at: '2026-11-18T10:06:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-c',
      message_id: 'g-a4',
      kind: 'dispatch',
      fyi: false,
      body: '純通知：今日里程碑已更新',
      seen_at: '2026-11-18T10:07:00Z',
    },
    // 2 skipped messages (non-PM, or non-chat/dispatch kind)
    {
      source: 'inbox',
      from: 'ns/host/lane-a',
      to: 'ns/host/pm--claude',
      message_id: 'g-skip-nonpm',
      kind: 'chat',
      fyi: false,
      body: '請修這個問題',
      seen_at: '2026-11-18T10:08:00Z',
    },
    {
      source: 'sent',
      from: 'ns/host/pm--claude',
      to: 'ns/host/lane-a',
      message_id: 'g-skip-kind',
      kind: 'ack',
      fyi: false,
      body: '請跑 ack',
      seen_at: '2026-11-18T10:09:00Z',
    },
  ];

  const guardInput = path.join(TMP_ROOT, 'guard-input.jsonl');
  const guardOut = path.join(TMP_ROOT, 'guard-out');
  fs.writeFileSync(guardInput, guardMessages.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8');

  const run = spawnSync(
    process.execPath,
    [CLI, '--input', guardInput, '--mode', 'guard', '--out', guardOut],
    {
      encoding: 'utf8',
      // Verify offline replay still evaluates even if host has off-knob set
      env: { ...process.env, AUTOPILOT_SEND_WORK_ORDER_GUARD: 'off' },
      input: '',
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);

  assert.equal(report.total_messages, 10);
  assert.equal(report.evaluated, 8);
  assert.equal(report.skipped, 2);
  assert.equal(report.deny_count, 4);
  assert.equal(report.allow_count, 4);
  assert.equal(Object.values(report.deny_by_reason).reduce((a, b) => a + b, 0), 4);
  assert.match(report.human_judgement_note, /Misfire judgement is human/);

  const samplePath = path.join(guardOut, 'guard-sample.jsonl');
  const reviewPath = path.join(guardOut, 'guard-sample-review.md');
  assert.equal(fs.existsSync(samplePath), true);
  assert.equal(fs.existsSync(reviewPath), true);

  const sampleRows = fs.readFileSync(samplePath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(sampleRows.length, 6, '3 deny + 3 allow samples');
  assert.equal(sampleRows.filter((r) => r.decision === 'deny').length, 3);
  assert.equal(sampleRows.filter((r) => r.decision === 'allow').length, 3);
  for (const row of sampleRows) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['body120', 'decision', 'message_id', 'reason'],
      'guard sample row must have exact 4 keys',
    );
    assert.ok(row.body120.length <= 120);
  }

  const reviewMd = fs.readFileSync(reviewPath, 'utf8');
  assert.match(reviewMd, /Misfire judgement is human/);
  assert.match(reviewMd, /誤殺/);
});

test('negative control: mapping every item to no_action turns the fixture counts test red', () => {
  const repoInfo = makeHermeticRepo('neg-ctrl');
  const fx = buildSwitchboardFixture(repoInfo);
  const parsed = parseJsonl(fx.jsonlText);

  const normal = replaySwitchboard(parsed.messages, {
    bad_lines: parsed.bad_lines,
    operators: ['ns/host/operator'],
    tasksMap: new Map(Object.entries(fx.tasks)),
  });
  assertSwitchboardFixtureCounts(normal);

  const broken = replaySwitchboard(parsed.messages, {
    bad_lines: parsed.bad_lines,
    operators: ['ns/host/operator'],
    tasksMap: new Map(Object.entries(fx.tasks)),
    classifyFn: () => ({
      disposition: 'no_action',
      rule: 'forced_no_action_mutant',
      failedChecks: [],
      isResidue: false,
      immediate: false,
    }),
  });
  assert.equal(broken.counts.no_action, 12);
  assert.equal(broken.counts.residue, 0);
  assert.throws(
    () => assertSwitchboardFixtureCounts(broken),
    assert.AssertionError,
    'counts test must fail red when every item is mapped to no_action',
  );
});

test('CLI usage & help handling', () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', input: '' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--mode switchboard\|guard/);

  const missingInput = spawnSync(process.execPath, [CLI], { encoding: 'utf8', input: '' });
  assert.equal(missingInput.status, 2);

  const badMode = spawnSync(process.execPath, [CLI, '--input', __filename, '--mode', 'bogus'], {
    encoding: 'utf8',
    input: '',
  });
  assert.equal(badMode.status, 2);
});

const HOUR_MS = 3600 * 1000;
function realShapeMessages() {
  const base = Date.UTC(2026, 10, 18, 10, 0, 0);
  const mk = (i, hours, kind, body) => ({
    id: `real-${i}`,
    from: 'ns/courier/peer--claude',
    content: body,
    reply_to: i % 2 === 0 ? { id: 'real-0', kind: 'chat' } : null,
    kind,
    disposition: i % 3 === 0 ? { state: 'unread', at: 1 } : null,
    priority: 0,
    received_ms: base + hours * HOUR_MS + i * 1000,
  });
  return [
    mk(1, 0, 'chat', 'zzz opaque chatter alpha'),
    mk(2, 1, 'chat', 'zzz opaque chatter beta'),
    mk(3, 3, 'failure_notice', 'zzz opaque chatter gamma'),
    mk(4, 3, 'chat', 'zzz opaque chatter delta'),
  ];
}

test('real inbox shape (received_ms, object disposition/reply_to): span and mean are non-zero', () => {
  const report = replaySwitchboard(realShapeMessages());
  assert.equal(report.total_messages, 4);
  assert.equal(report.wakes_per_hour.invalid_seen_at, 0);
  assert.equal(report.wakes_per_hour.span_hours, 4);
  assert.ok(report.wakes_per_hour.mean > 0);
});

test('real inbox shape: id is accepted as message id and object fields are normalized', () => {
  const { normalizeInboxMessage } = require('./fleet-replay.js');
  const [m] = realShapeMessages().filter((x) => x.id === 'real-2');
  const n = normalizeInboxMessage(m);
  assert.equal(n.message_id, 'real-2');
  assert.equal(n.reply_to, 'real-0');
  const n3 = normalizeInboxMessage(realShapeMessages().find((x) => x.id === 'real-3'));
  assert.equal(n3.disposition, 'unread');
});

test('residue breakdown sums to the residue count and groups by (kind, from)', () => {
  const report = replaySwitchboard(realShapeMessages());
  const rb = report.residue_breakdown;
  assert.equal(rb.total, report.counts.residue);
  assert.ok(rb.total > 0);
  const topSum = rb.top_groups.reduce((n, g) => n + g.count, 0);
  assert.equal(topSum + rb.other_count, report.counts.residue);
  assert.equal(Object.values(rb.by_kind).reduce((n, c) => n + c, 0), report.counts.residue);
  assert.ok(rb.top_groups.length <= 10);
  assert.ok(rb.top_groups.every((g) => typeof g.kind === 'string' && typeof g.from === 'string'));
});

test('residue breakdown appears in --human output', () => {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'real-shape-'));
  const f = path.join(dir, 'in.jsonl');
  fs.writeFileSync(f, realShapeMessages().map((m) => JSON.stringify(m)).join('\n') + '\n');
  const res = spawnSync('node', [CLI, '--mode', 'switchboard', '--input', f, '--human'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /殘餘分組/);
});

// --- courier and lane-chat rules (synthetic fixtures only) ---
const { classifyItem: classifyForRules } = require('./pm-switchboard.js');

function chatItem(from, content, extra = {}) {
  return { message_id: extra.id || 'm-1', from, kind: 'chat', content, fyi: Boolean(extra.fyi) };
}
const COURIER = 'ns/host/courier';

test('courier [fleet result] and result-wake ids need ruling', () => {
  const a = classifyForRules(chatItem(COURIER, '[fleet result] task X done'));
  assert.equal(a.disposition, 'pending_decision');
  assert.equal(a.rule, 'courier_result');
  assert.equal(a.isResidue, false);
  const b = classifyForRules(chatItem(COURIER, 'something else', { id: 'result-wake-abc' }));
  assert.equal(b.rule, 'courier_result');
});

test('courier patrol escalation needs ruling', () => {
  const a = classifyForRules(chatItem(COURIER, '[fleet patrol] escalation: lane stuck?'));
  assert.equal(a.disposition, 'pending_decision');
  assert.equal(a.rule, 'courier_patrol_escalation');
  const b = classifyForRules(chatItem(COURIER, '[fleet task T1] LOST: a--claude unreachable'));
  assert.equal(b.rule, 'courier_patrol_escalation');
});

test('courier patrol digest, wait_over and card-audit are no action', () => {
  for (const [content, id] of [
    ['[fleet patrol] 3 tasks ok, anything?', 'm-1'],
    ['patrol ok', 'm-1'],
    ['x', 'wait_over-1'],
    ['x', 'card-audit-1'],
  ]) {
    const r = classifyForRules(chatItem(COURIER, content, { id }));
    assert.equal(r.disposition, 'no_action', content);
    assert.equal(r.rule, 'courier_digest');
  }
});

test('courier line with an unknown prefix is unchanged (unclassified residue)', () => {
  const r = classifyForRules(chatItem(COURIER, '[fleet rule] task T1 something'));
  assert.equal(r.rule, 'unclassified');
  assert.equal(r.isResidue, true);
});

test('plain lane chat needs ruling; fyi lane chat is no action', () => {
  const plain = classifyForRules(chatItem('ns/host/lane--claude', 'did a thing'));
  assert.equal(plain.disposition, 'pending_decision');
  assert.equal(plain.rule, 'lane_chat');
  assert.equal(plain.isResidue, false);
  const fyi = classifyForRules(chatItem('ns/host/lane--claude', 'did a thing', { fyi: true }));
  assert.equal(fyi.disposition, 'no_action');
  assert.equal(fyi.isResidue, false);
});

test('synthetic 50-line mixed fixture leaves under 10% residual', () => {
  const msgs = [];
  const add = (from, content, extra = {}) => msgs.push({
    id: `s-${msgs.length}`, from, kind: 'chat', content, fyi: extra.fyi === true, received_ms: 1000 + msgs.length,
    ...(extra.rest || {}),
  });
  for (let i = 0; i < 10; i++) add(COURIER, '[fleet result] done');
  for (let i = 0; i < 5; i++) add(COURIER, '[fleet patrol] escalation');
  for (let i = 0; i < 10; i++) add(COURIER, '[fleet patrol] digest');
  for (let i = 0; i < 4; i++) add(COURIER, 'wait', {}), msgs[msgs.length - 1].id = `wait_over-${i}`;
  for (let i = 0; i < 9; i++) add('ns/h/lane--claude', 'plain note');
  for (let i = 0; i < 9; i++) add('ns/h/lane--claude', 'fyi note', { fyi: true });
  add(COURIER, '[fleet rule] unknown-prefix');
  add('ns/h/other--claude', 'another note');
  assert.equal(msgs.length, 49);
  add(COURIER, '[fleet result] done');
  assert.equal(msgs.length, 50);
  const report = replaySwitchboard(msgs);
  assert.ok(report.counts.residue / 50 < 0.1, `residue ${report.counts.residue}/50`);
  assert.equal(report.counts.residue, 1);
});
