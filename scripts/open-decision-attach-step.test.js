'use strict';
require('./lib/test-git-env.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OD = path.join(__dirname, 'open-decision.js');
const SCHEMA_PATH = path.join(__dirname, '..', 'schemas', 'decision.schema.json');
const { readDecision } = require('../src/status/decision-input');
const { buildJobModel } = require('./render-review-page');
const { findDuplicateCards } = require('./open-decision.js');

const EXEC = 'ns/courier/member';

// identity/presence cards need concrete operator steps (open-decision refuses otherwise); these tests are about executors and duplicates, so declare none
function withStep(args) {
  const c = args.indexOf('--category');
  const needs = args[0] === 'open' && c >= 0 && ['identity', 'presence'].includes(args[c + 1]) && !args.some((a) => a.startsWith('--operator-step'));
  return needs ? [...args, '--operator-step-none', 'test fixture: not about operator steps'] : args;
}

function scratch(role = 'solo') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'od-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'od-repo-'));
  const g = spawnSync('git', ['init', '-q'], { cwd: repo, env: process.env });
  if (g.status !== 0) throw new Error(`git init failed: ${g.stderr}`);
  const d = path.join(home, '.autopilot');
  fs.mkdirSync(d, { recursive: true });
  if (role) fs.writeFileSync(path.join(d, 'team.json'), `${JSON.stringify({ role })}\n`);
  const env = {
    ...process.env,
    HOME: home,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_CARD_NOTIFY: 'off',
  };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  delete env.CODEX_THREAD_ID;
  delete env.XDG_CONFIG_HOME;
  return {
    home,
    repo,
    env,
    run(args) {
      return spawnSync(process.execPath, [OD, ...withStep(args)], { env, encoding: 'utf8' });
    },
    runAsync(args) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [OD, ...withStep(args)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (status) => resolve({ status, stdout, stderr }));
      });
    },
    files() {
      const dir = path.join(repo, '.git', 'autopilot', 'decisions');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
    },
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    },
  };
}

function assertMatchesDecisionSchema(doc) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const topAllowed = new Set(Object.keys(schema.properties));
  for (const k of schema.required) assert.ok(k in doc, `missing top-level required field ${k}`);
  for (const k of Object.keys(doc)) assert.ok(topAllowed.has(k), `unexpected top-level field ${k}`);
  const itemSchema = schema.properties.decisions.items;
  const itemAllowed = new Set(Object.keys(itemSchema.properties));
  assert.ok(Array.isArray(doc.decisions) && doc.decisions.length >= 1);
  for (const entry of doc.decisions) {
    for (const k of itemSchema.required) assert.ok(k in entry, `missing entry required field ${k}`);
    for (const k of Object.keys(entry)) assert.ok(itemAllowed.has(k), `unexpected entry field ${k}`);
    if (entry.kind !== undefined) assert.ok(itemSchema.properties.kind.enum.includes(entry.kind), `invalid kind ${entry.kind}`);
    if (entry.attachments !== undefined) {
      assert.ok(Array.isArray(entry.attachments));
      for (const a of entry.attachments) assert.equal(typeof a, 'string');
    }
  }
}

test('open --attach is repeatable on decision cards, stored in attachments, and round-trips through decision-input and buildJobModel', () => {
  const s = scratch('pm');
  try {
    const r = s.run([
      'open', '--category', 'goal', '--cwd', s.repo,
      '--executor', EXEC,
      '--not-authorized', 'external:owner must verify artifact',
      '--title', '要改嗎',
      '--question', '核對這份計畫與 artifact 後決定要不要合併？',
      '--option', '合併::照計畫合併',
      '--option', '退回::重寫',
      '--recommendation', '合併',
      '--attach', 'docs/plans/review.md:42',
      '--attach', 'https://claude.ai/public/artifacts/00000000-1111-2222-3333-444444444444',
    ]);
    assert.equal(r.status, 0, r.stderr);
    const id = r.stdout.trim();
    assert.match(id, /^d-[0-9a-f]{8}$/);

    const docs = s.files();
    assert.equal(docs.length, 1);
    assertMatchesDecisionSchema(docs[0]);
    const card = docs[0].decisions[0];
    assert.deepEqual(card.attachments, [
      'docs/plans/review.md:42',
      'https://claude.ai/public/artifacts/00000000-1111-2222-3333-444444444444',
    ]);

    const shown = s.run(['show', '--cwd', s.repo]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /attach: docs\/plans\/review\.md:42, https:\/\/claude\.ai\/public\/artifacts\//);

    const commonDir = path.join(s.repo, '.git');
    const read = readDecision({
      commonDir,
      key: docs[0].project_key,
      identity: docs[0].repo_identity,
      nowMs: Date.now(),
      liveBase: null,
    });
    assert.ok(read);
    assert.equal(read.value.length, 1);
    assert.deepEqual(read.value[0].attachments, card.attachments);

    const model = buildJobModel({
      project: docs[0].project_key,
      decisions: read.value,
      now: Date.now(),
    });
    assert.equal(model.needs_decision, true);
    assert.deepEqual(model.decisions[0].attachments, card.attachments);
  } finally {
    s.cleanup();
  }
});

test('open --kind step requires no options or not-authorized; allows --attach; works across roles; closes cleanly', () => {
  for (const role of ['solo', 'pm', 'lane', 'lead']) {
    const s = scratch(role);
    try {
      const r = s.run([
        'open', '--category', 'goal', '--cwd', s.repo,
        '--kind', 'step',
        '--executor', EXEC,
        '--question', '請替換過期的 token 並套用補丁',
        '--background', '舊 token 已在 09:00 到期',
        '--attach', 'patches/fix-auth.patch',
        '--attach', 'https://claude.ai/public/artifacts/step-guide',
      ]);
      assert.equal(r.status, 0, `${role}: ${r.stderr}`);
      const id = r.stdout.trim();
      assert.match(id, /^d-[0-9a-f]{8}$/);

      const docs = s.files();
      assert.equal(docs.length, 1);
      assertMatchesDecisionSchema(docs[0]);
      const card = docs[0].decisions[0];
      assert.equal(card.kind, 'step');
      assert.equal(card.options, null);
      assert.equal(card.executor, EXEC);
      assert.equal(card.not_authorized, null);
      assert.deepEqual(card.attachments, [
        'patches/fix-auth.patch',
        'https://claude.ai/public/artifacts/step-guide',
      ]);

      const read = readDecision({
        commonDir: path.join(s.repo, '.git'),
        key: docs[0].project_key,
        identity: docs[0].repo_identity,
        nowMs: Date.now(),
        liveBase: null,
      });
      assert.ok(read);
      assert.equal(read.value[0].kind, 'step');
      assert.deepEqual(read.value[0].attachments, card.attachments);

      const model = buildJobModel({
        project: docs[0].project_key,
        decisions: read.value,
        now: Date.now(),
      });
      assert.equal(model.needs_decision, true);
      assert.equal(model.decisions[0].kind, 'step');
      assert.deepEqual(model.decisions[0].attachments, card.attachments);

      const closed = s.run(['close', '--cwd', s.repo, '--id', id, '--withdraw', 'step complete', '--by', EXEC]);
      assert.equal(closed.status, 0, closed.stderr);
      const after = readDecision({
        commonDir: path.join(s.repo, '.git'),
        key: docs[0].project_key,
        identity: docs[0].repo_identity,
        nowMs: Date.now(),
        liveBase: null,
      });
      assert.equal(after, null);
    } finally {
      s.cleanup();
    }
  }
});

test('presence and step cards require an executor while other categories retain the existing requirement', () => {
  const s = scratch('pm');
  try {
    for (const args of [
      ['--category', 'presence', '--kind', 'step', '--question', '檢查 cookys-openclaw hub 是否重開'],
      ['--category', 'goal', '--kind', 'step', '--question', '檢查 cookys-openclaw hub 是否重開'],
    ]) {
      const r = s.run(['open', '--cwd', s.repo, ...args]);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /拒絕開卡/);
      assert.match(r.stderr, /--executor/);
      assert.equal(s.files().length, 0);
    }
    const other = s.run(['open', '--cwd', s.repo, '--category', 'goal', '--executor', EXEC, '--title', '改設定嗎', '--question', '要不要改設定？', '--option', '改', '--option', '不改', '--recommendation', '改', '--not-authorized', 'external']);
    assert.equal(other.status, 0, other.stderr);
    assert.equal(s.files()[0].decisions.length, 1);
  } finally { s.cleanup(); }
});

test('duplicate presence card is refused, explicit override is recorded, and unrelated cards remain allowed', () => {
  const s = scratch('pm');
  try {
    const original = s.run(['open', '--category', 'presence', '--cwd', s.repo, '--executor', EXEC, '--question', '檢查 cookys-openclaw 的 openclaw host，確認 hub 是否需要重開', '--kind', 'step', '--title', '檢查 hub']);
    assert.equal(original.status, 0, original.stderr);
    const doc = s.files()[0];
    doc.decisions[0].id = 'd-ca6233d5';
    doc.decisions[0].title = '檢查 hub';
    doc.decisions[0].blocks = '如果沒有檢查 cookys-openclaw，openclaw 的 hub 可能不能重開';
    const decisionFile = path.join(s.repo, '.git', 'autopilot', 'decisions', fs.readdirSync(path.join(s.repo, '.git', 'autopilot', 'decisions')).find((n) => n.endsWith('.json')));
    fs.writeFileSync(decisionFile, `${JSON.stringify(doc, null, 2)}\n`);
    const before = JSON.stringify(s.files());
    const duplicateArgs = ['open', '--category', 'presence', '--cwd', s.repo, '--kind', 'step', '--title', '檢查 host', '--question', '檢查 cookys-openclaw openclaw host，是否重開 hub？', '--blocks', '需要檢查 cookys-openclaw 的 hub'];
    const refused = s.run(duplicateArgs);
    assert.equal(refused.status, 14, refused.stderr);
    assert.match(refused.stderr, /拒絕開卡：已有 d-ca6233d5/);
    assert.equal(JSON.stringify(s.files()), before);

    const allowed = s.run([...duplicateArgs, '--executor', EXEC, '--not-duplicate-of', 'd-ca6233d5', '--not-duplicate-reason', '經確認是另一個服務']);
    assert.equal(allowed.status, 0, allowed.stderr);
    const cards = s.files()[0].decisions;
    assert.equal(cards.length, 2);
    assertMatchesDecisionSchema(s.files()[0]);
    assert.equal(cards[1].not_duplicate_of[0], 'd-ca6233d5');
    assert.equal(cards[1].not_duplicate_reason, '經確認是另一個服務');
    const currentDoc = s.files()[0];
    currentDoc.decisions[1].id = 'd-bf31ba56';
    fs.writeFileSync(decisionFile, `${JSON.stringify(currentDoc, null, 2)}\n`);

    const unrelated = s.run(['open', '--category', 'presence', '--cwd', s.repo, '--executor', EXEC, '--kind', 'step', '--title', '巡查 api', '--question', '檢查 aimax395 的 api gateway 是否重開？']);
    assert.equal(unrelated.status, 0, unrelated.stderr);
    const close = s.run(['close', '--cwd', s.repo, '--id', 'd-ca6233d5', '--withdraw', '已處理', '--by', EXEC]);
    assert.equal(close.status, 0, close.stderr);
    assert.match(close.stderr, /同主題還有 d-bf31ba56（檢查 host），請一併處理/);
  } finally { s.cleanup(); }
});

test('close and done print same-topic live cards without closing them', () => {
  const s = scratch('pm');
  try {
    const first = s.run(['open', '--category', 'presence', '--cwd', s.repo, '--executor', EXEC, '--kind', 'step', '--title', '檢查 hub', '--question', '檢查 cookys-openclaw openclaw host，確認 hub 是否重開？']);
    assert.equal(first.status, 0, first.stderr);
    const firstId = first.stdout.trim();
    const second = s.run(['open', '--category', 'presence', '--cwd', s.repo, '--executor', EXEC, '--kind', 'step', '--title', '檢查 host', '--question', '檢查 cookys-openclaw 的 openclaw host 是否重開 hub？', '--not-duplicate-of', firstId, '--not-duplicate-reason', '確認是另一個檢查工作']);
    assert.equal(second.status, 0, second.stderr);
    const secondId = second.stdout.trim();

    const answered = s.run(['close', '--cwd', s.repo, '--id', firstId, '--answer', '檢查完成', '--awaiting-operator', '確認服務正常']);
    assert.equal(answered.status, 0, answered.stderr);
    const done = s.run(['done', '--cwd', s.repo, '--id', firstId]);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stderr, new RegExp(`同主題還有 ${secondId}（檢查 host），請一併處理`));
    const remaining = s.files()[0].decisions.find((e) => e.id === secondId);
    assert.equal(remaining.status, 'open');
  } finally { s.cleanup(); }
});

test('concurrent duplicate opens serialize the similarity check and append', async () => {
  const s = scratch('pm');
  try {
    const args = ['open', '--category', 'presence', '--cwd', s.repo, '--executor', EXEC, '--kind', 'step', '--title', '檢查 hub', '--question', '檢查 cookys-openclaw openclaw host，確認 hub 是否重開？'];
    const results = await Promise.all([s.runAsync(args), s.runAsync(args)]);
    assert.deepEqual(results.map((r) => r.status).sort((a, b) => a - b), [0, 14]);
    assert.equal(s.files().reduce((n, doc) => n + doc.decisions.length, 0), 1);
  } finally { s.cleanup(); }
});

test('findDuplicateCards requires category match and ignores closed cards', () => {
  const candidate = { id: 'd-new', category: 'presence', question: '檢查 cookys-openclaw openclaw host，是否重開 hub？', title: '檢查 hub', blocks: '需要檢查 cookys-openclaw 的 hub' };
  const sameTextDifferentCategory = { id: 'd-other-cat', category: 'goal', question: candidate.question, title: candidate.title, blocks: candidate.blocks, status: 'open' };
  const closed = { id: 'd-closed', category: 'presence', question: candidate.question, title: candidate.title, blocks: candidate.blocks, status: 'closed' };
  assert.deepEqual(findDuplicateCards([sameTextDifferentCategory, closed], candidate), []);
  const incidentOriginal = { id: 'd-ca6233d5', category: 'presence', status: 'open', question: '檢查 cookys-openclaw 的 openclaw host，確認 hub 是否需要重開', title: '檢查 hub', blocks: '如果沒有檢查 cookys-openclaw，openclaw 的 hub 可能不能重開' };
  const incidentSecond = { id: 'd-bf31ba56', category: 'presence', question: '檢查 cookys-openclaw openclaw host，是否重開 hub？', title: '檢查 host', blocks: '需要檢查 cookys-openclaw 的 hub' };
  assert.equal(findDuplicateCards([incidentOriginal], incidentSecond)[0].id, 'd-ca6233d5');

  const distinctPairs = [
    [
      { id: 'd-reopen', category: 'presence', question: '重開 cookys-openclaw hub？' },
      { id: 'd-token', category: 'presence', question: '替換 cookys-openclaw token？' },
    ],
    [
      { id: 'd-check', category: 'presence', question: '檢查 cookys-openclaw hub？' },
      { id: 'd-firmware', category: 'presence', question: '更新 cookys-openclaw hub 韌體？' },
    ],
    [
      { id: 'd-cookys', category: 'presence', question: '重開 cookys-openclaw hub？' },
      { id: 'd-aimax', category: 'presence', question: '重開 aimax395 hub？' },
    ],
    [
      { id: 'd-power', category: 'presence', question: '按下電源鍵' },
      { id: 'd-reset', category: 'presence', question: '按下重置鍵' },
    ],
  ];
  for (const [existing, next] of distinctPairs) {
    assert.deepEqual(findDuplicateCards([existing], next), [], `${existing.question} vs ${next.question}`);
  }
});

test('open --kind look stores look_target for persistent show items and round-trips until dismissed', () => {
  const s = scratch('lane');
  try {
    const target = { kind: 'path', path: 'mods/viewer/show.ts', start: 10, end: 30 };
    const r = s.run([
      'open', '--category', 'goal', '--cwd', s.repo,
      '--kind', 'look',
      '--question', '給你看：show.ts（autopilot）',
      '--source', 'autopilot',
      '--look-target', JSON.stringify(target),
    ]);
    assert.equal(r.status, 0, r.stderr);
    const id = r.stdout.trim();
    const docs = s.files();
    assertMatchesDecisionSchema(docs[0]);
    assert.equal(docs[0].decisions[0].kind, 'look');
    assert.deepEqual(docs[0].decisions[0].look_target, target);

    const read = readDecision({
      commonDir: path.join(s.repo, '.git'),
      key: docs[0].project_key,
      identity: docs[0].repo_identity,
      nowMs: Date.now(),
      liveBase: null,
    });
    assert.equal(read.value[0].kind, 'look');
    assert.deepEqual(read.value[0].look_target, target);

      const closed = s.run(['close', '--cwd', s.repo, '--id', id, '--withdraw', 'step complete', '--by', EXEC]);
    assert.equal(closed.status, 0, closed.stderr);
    assert.equal(readDecision({
      commonDir: path.join(s.repo, '.git'),
      key: docs[0].project_key,
      identity: docs[0].repo_identity,
      nowMs: Date.now(),
      liveBase: null,
    }), null);
  } finally {
    s.cleanup();
  }
});

test('negative controls: step rejects --option, invalid --kind exits 7, empty or misplaced --attach exits 2 and writes nothing', () => {
  const s = scratch('pm');
  try {
    const withOpt = s.run([
      'open', '--category', 'goal', '--cwd', s.repo, '--kind', 'step', '--question', 'do x', '--option', 'A::a', '--option', 'B::b',
    ]);
    assert.equal(withOpt.status, 2);
    assert.deepEqual(s.files(), []);

    const badKind = s.run([
      'open', '--category', 'goal', '--cwd', s.repo, '--kind', 'bogus', '--question', 'do x', '--free-text', '--executor', EXEC, '--not-authorized', 'external',
    ]);
    assert.equal(badKind.status, 7);
    assert.deepEqual(s.files(), []);

    const emptyAttach = s.run([
      'open', '--category', 'goal', '--cwd', s.repo, '--kind', 'step', '--question', 'do x', '--attach', '   ',
    ]);
    assert.equal(emptyAttach.status, 2);
    assert.deepEqual(s.files(), []);

    const showAttach = s.run(['show', '--cwd', s.repo, '--attach', 'README.md']);
    assert.equal(showAttach.status, 2);
    assert.deepEqual(s.files(), []);
  } finally {
    s.cleanup();
  }
});
