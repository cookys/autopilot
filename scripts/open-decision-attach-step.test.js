'use strict';
require('./lib/test-git-env.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OD = path.join(__dirname, 'open-decision.js');
const SCHEMA_PATH = path.join(__dirname, '..', 'schemas', 'decision.schema.json');
const { readDecision } = require('../src/status/decision-input');
const { buildJobModel } = require('./render-review-page');

const EXEC = 'ns/courier/member';

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
      return spawnSync(process.execPath, [OD, ...args], { env, encoding: 'utf8' });
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
      'open', '--cwd', s.repo,
      '--executor', EXEC,
      '--not-authorized', 'external:owner must verify artifact',
      '--question', '核對這份計畫與 artifact 後決定要不要合併？',
      '--option', '合併::照計畫合併',
      '--option', '退回::重寫',
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

test('open --kind step requires no options, executor, or not-authorized; allows --attach; works across roles; closes cleanly', () => {
  for (const role of ['solo', 'pm', 'lane', 'lead']) {
    const s = scratch(role);
    try {
      const r = s.run([
        'open', '--cwd', s.repo,
        '--kind', 'step',
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
      assert.equal(card.executor, undefined);
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

      const closed = s.run(['close', '--cwd', s.repo, '--id', id]);
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

test('open --kind look stores look_target for persistent show items and round-trips until dismissed', () => {
  const s = scratch('lane');
  try {
    const target = { kind: 'path', path: 'mods/viewer/show.ts', start: 10, end: 30 };
    const r = s.run([
      'open', '--cwd', s.repo,
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

    const closed = s.run(['close', '--cwd', s.repo, '--id', id]);
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
      'open', '--cwd', s.repo, '--kind', 'step', '--question', 'do x', '--option', 'A::a', '--option', 'B::b',
    ]);
    assert.equal(withOpt.status, 2);
    assert.deepEqual(s.files(), []);

    const badKind = s.run([
      'open', '--cwd', s.repo, '--kind', 'bogus', '--question', 'do x', '--free-text', '--executor', EXEC, '--not-authorized', 'external',
    ]);
    assert.equal(badKind.status, 7);
    assert.deepEqual(s.files(), []);

    const emptyAttach = s.run([
      'open', '--cwd', s.repo, '--kind', 'step', '--question', 'do x', '--attach', '   ',
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
