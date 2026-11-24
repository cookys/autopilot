'use strict';
// scripts/pm-ask.test.js — Request register CLI & views (P1).
// Run: node --test scripts/pm-ask.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, 'pm-ask.js');
const SCHEMA = 'autopilot.askpm/1';
const VALID_ULID = '01M7KZZ1ZT3V1KTKNR3E4MFK4B';

function makeStore(rows) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ask-test-'));
  const state = path.join(home, 'state');
  fs.mkdirSync(state, { recursive: true });
  if (rows && rows.length > 0) {
    fs.writeFileSync(
      path.join(state, 'askpm.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8',
    );
  }
  return {
    home,
    state,
    run(args) {
      return spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: home,
          TMPDIR: home,
          AUTOPILOT_STATE_DIR: state,
        },
      });
    },
    readRows() {
      const f = path.join(state, 'askpm.jsonl');
      if (!fs.existsSync(f)) return [];
      return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

function askRow(id, text, atIso, sessionId = 's1') {
  return { schema: SCHEMA, kind: 'ask', at: atIso, ask_id: id, session_id: sessionId, text };
}

test('close accepts valid evidence formats and refuses missing or invalid evidence', () => {
  const now = new Date().toISOString();
  const s = makeStore([askRow('a-11111111', 'check build', now)]);
  try {
    const absFile = path.join(s.home, 'proof.txt');
    fs.writeFileSync(absFile, 'ok');

    // Refused cases
    const missingFlag = s.run(['close', 'a-11111111']);
    assert.equal(missingFlag.status, 2);

    const doneRefused = s.run(['close', 'a-11111111', '--evidence', 'done']);
    assert.equal(doneRefused.status, 2);

    const shortSha = s.run(['close', 'a-11111111', '--evidence', 'abc123']);
    assert.equal(shortSha.status, 2);

    const httpRefused = s.run(['close', 'a-11111111', '--evidence', 'http://example.com/1']);
    assert.equal(httpRefused.status, 2);

    const missingAbs = s.run(['close', 'a-11111111', '--evidence', path.join(s.home, 'missing.txt')]);
    assert.equal(missingAbs.status, 2);

    const unknownId = s.run(['close', 'a-99999999', '--evidence', 'abc1234']);
    assert.equal(unknownId.status, 2);

    assert.equal(s.readRows().filter((r) => r.kind === 'disposition').length, 0);

    // Accepted cases: 7-40 hex sha, 26-char ULID, d-8hex card, https URL, existing abs path
    for (const ref of ['abc1234', VALID_ULID, 'd-522f32f4', 'https://example.com/pr/42', absFile]) {
      const ok = s.run(['close', 'a-11111111', '--evidence', ref]);
      assert.equal(ok.status, 0, `${ref} should succeed: ${ok.stderr}`);
    }
    const dispositions = s.readRows().filter((r) => r.kind === 'disposition');
    assert.equal(dispositions.length, 5);
    assert.deepEqual(
      dispositions.map((d) => ({ ask_id: d.ask_id, action: d.action, evidence: d.evidence })),
      [
        { ask_id: 'a-11111111', action: 'close', evidence: 'abc1234' },
        { ask_id: 'a-11111111', action: 'close', evidence: VALID_ULID },
        { ask_id: 'a-11111111', action: 'close', evidence: 'd-522f32f4' },
        { ask_id: 'a-11111111', action: 'close', evidence: 'https://example.com/pr/42' },
        { ask_id: 'a-11111111', action: 'close', evidence: absFile },
      ],
    );
  } finally {
    s.cleanup();
  }
});

test('progress validates task ULID and ask_id existence', () => {
  const now = new Date().toISOString();
  const s = makeStore([askRow('a-22222222', 'run p1', now)]);
  try {
    assert.equal(s.run(['progress', 'a-22222222', '--task', 'bad-ulid']).status, 2);
    assert.equal(s.run(['progress', 'a-unknown1', '--task', VALID_ULID]).status, 2);
    const ok = s.run(['progress', 'a-22222222', '--task', VALID_ULID]);
    assert.equal(ok.status, 0, ok.stderr);
    const disp = s.readRows().find((r) => r.kind === 'disposition');
    assert.equal(disp.schema, SCHEMA);
    assert.equal(disp.ask_id, 'a-22222222');
    assert.equal(disp.action, 'progress');
    assert.equal(disp.task, VALID_ULID);
  } finally {
    s.cleanup();
  }
});

test('supersede rejects self, unknown, or older target, and accepts newer target', () => {
  const t1 = '2026-11-16T01:00:00.000Z';
  const t2 = '2026-11-16T02:00:00.000Z';
  const s = makeStore([
    askRow('a-11111111', 'old ask', t1),
    askRow('a-22222222', 'new ask', t2),
  ]);
  try {
    assert.equal(s.run(['supersede', 'a-11111111', 'a-11111111']).status, 2, 'self supersede refused');
    assert.equal(s.run(['supersede', 'a-11111111', 'a-missing0']).status, 2, 'unknown new refused');
    assert.equal(s.run(['supersede', 'a-missing0', 'a-22222222']).status, 2, 'unknown old refused');
    assert.equal(s.run(['supersede', 'a-22222222', 'a-11111111']).status, 2, 'older target refused');

    const ok = s.run(['supersede', 'a-11111111', 'a-22222222']);
    assert.equal(ok.status, 0, ok.stderr);
    const disp = s.readRows().find((r) => r.kind === 'disposition');
    assert.equal(disp.ask_id, 'a-11111111');
    assert.equal(disp.action, 'supersede');
    assert.equal(disp.superseded_by, 'a-22222222');
  } finally {
    s.cleanup();
  }
});

test('overdue shows 25h ask, excludes 23h and disposed asks, and ignores legacy rows', () => {
  const now = Date.now();
  const h25 = new Date(now - 25 * 3600 * 1000).toISOString();
  const h23 = new Date(now - 23 * 3600 * 1000).toISOString();
  const h48 = new Date(now - 48 * 3600 * 1000).toISOString();
  const s = makeStore([
    // Legacy rows before first ask_id must be ignored
    { schema: SCHEMA, kind: 'ask', at: h48, text: 'legacy ask should be ignored' },
    { schema: SCHEMA, kind: 'reply', at: h48, lines: ['legacy reply'], text: 'legacy reply' },
    askRow('a-25hours0', 'ask from 25h ago', h25),
    askRow('a-23hours0', 'ask from 23h ago', h23),
    askRow('a-closed00', 'closed 25h ask', h25),
    { schema: SCHEMA, kind: 'disposition', at: h23, ask_id: 'a-closed00', action: 'close', evidence: 'abc1234' },
  ]);
  try {
    const overdue = s.run(['overdue']);
    assert.equal(overdue.status, 0, overdue.stderr);
    assert.match(overdue.stdout, /^a-25hours0 25h ask from 25h ago\n?$/);
    assert.equal(overdue.stdout.includes('a-23hours0'), false);
    assert.equal(overdue.stdout.includes('a-closed00'), false);
    assert.equal(overdue.stdout.includes('legacy ask'), false);

    const openList = s.run(['list', '--open']);
    assert.equal(openList.status, 0, openList.stderr);
    const openLines = openList.stdout.trim().split('\n');
    assert.equal(openLines.length, 2);
    assert.match(openLines[0], /^a-25hours0 /);
    assert.match(openLines[1], /^a-23hours0 /);

    const allList = s.run(['list']);
    assert.equal(allList.status, 0, allList.stderr);
    assert.equal(allList.stdout.trim().split('\n').length, 3, 'legacy row ignored in list');
  } finally {
    s.cleanup();
  }
});

test('list and overdue cap at 30 lines plus "… N more"', () => {
  const now = Date.now();
  const rows = [];
  for (let i = 1; i <= 31; i += 1) {
    const hex = i.toString(16).padStart(8, '0');
    const at = new Date(now - (25 + i) * 3600 * 1000).toISOString();
    rows.push(askRow(`a-${hex}`, `ask number ${i} with some extra text that is long enough to verify truncation beyond 60 chars`, at));
  }
  const s = makeStore(rows);
  try {
    const res = s.run(['overdue']);
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 31, '30 ask lines + 1 overflow line');
    assert.equal(lines[30], '… 1 more');
    for (let i = 0; i < 30; i += 1) {
      const parts = lines[i].split(' ');
      assert.ok(parts[0].startsWith('a-'));
      assert.ok(parts.slice(2).join(' ').length <= 60);
    }

    const listRes = s.run(['list', '--open']);
    assert.equal(listRes.status, 0, listRes.stderr);
    const listLines = listRes.stdout.trim().split('\n');
    assert.equal(listLines.length, 31);
    assert.equal(listLines[30], '… 1 more');
  } finally {
    s.cleanup();
  }
});

test('list --answers formats status, Taipei time, grouped latest reply, and --open filter', () => {
  // Empty store returns empty string and exit 0
  const emptyStore = makeStore([]);
  try {
    const emptyRes = emptyStore.run(['list', '--answers']);
    assert.equal(emptyRes.status, 0, emptyRes.stderr);
    assert.equal(emptyRes.stdout, '');
  } finally {
    emptyStore.cleanup();
  }

  const s = makeStore([
    // (a) Answered ask with multiline reply (first line only)
    askRow('a-ans00001', 'check deployment status for api server', '2026-11-16T10:00:00.000Z'),
    {
      schema: SCHEMA,
      kind: 'disposition',
      at: '2026-11-16T10:05:00.000Z',
      ask_id: 'a-ans00001',
      action: 'reply',
      text: 'deployed v2 cleanly\nsecond line ignored',
      ambiguous: true,
    },
    // (b) Unanswered ask + (d) UTC 16:30 -> Taipei next day 00:30
    askRow('a-unans002', 'why did nightly build fail', '2026-11-16T16:30:00.000Z'),
    // (c) Same topic asked twice, second one answered (and older reply vs newer reply)
    askRow('a-dup00003', 'status of migration job', '2026-11-16T08:00:00.000Z'),
    {
      schema: SCHEMA,
      kind: 'disposition',
      at: '2026-11-16T08:10:00.000Z',
      ask_id: 'a-dup00003',
      action: 'reply',
      text: 'earlier reply',
    },
    askRow('a-dup00004', 'status of migration job', '2026-11-16T09:00:00.000Z'),
    {
      schema: SCHEMA,
      kind: 'disposition',
      at: '2026-11-16T09:15:00.000Z',
      ask_id: 'a-dup00004',
      action: 'reply',
      text: 'latest migration reply',
    },
    // (e) Disposed without reply -> 已處置, excluded by --open
    askRow('a-disp0005', 'closed without reply', '2026-11-16T11:00:00.000Z'),
    {
      schema: SCHEMA,
      kind: 'disposition',
      at: '2026-11-16T11:05:00.000Z',
      ask_id: 'a-disp0005',
      action: 'close',
      evidence: 'abc1234',
    },
  ]);

  try {
    const allRes = s.run(['list', '--answers']);
    assert.equal(allRes.status, 0, allRes.stderr);
    const lines = allRes.stdout.trim().split('\n');
    assert.equal(lines.length, 4, `expected 4 grouped lines, got:\n${allRes.stdout}`);

    // (a)
    assert.equal(lines[0], '已答 11-16 18:00 check deployment status for api server ｜ deployed v2 cleanly');
    // (b) + (d) UTC 16:30 -> Taipei 11-17 00:30
    assert.equal(lines[1], '未答 11-17 00:30 why did nightly build fail ｜ （尚無答案）');
    // (c) merged into 1 line with latest reply
    assert.equal(lines[2], '已答 11-16 17:00 status of migration job ｜ latest migration reply');
    // (e) disposed without reply
    assert.equal(lines[3], '已處置 11-16 19:00 closed without reply ｜ （尚無答案）');

    // (e) --open excludes disposed
    const openRes = s.run(['list', '--answers', '--open']);
    assert.equal(openRes.status, 0, openRes.stderr);
    const openLines = openRes.stdout.trim().split('\n');
    assert.equal(openLines.length, 3);
    assert.equal(openRes.stdout.includes('closed without reply'), false);
  } finally {
    s.cleanup();
  }
});
