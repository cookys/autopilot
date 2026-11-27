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
    run(args, extraEnv = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: home,
          TMPDIR: home,
          AUTOPILOT_STATE_DIR: state,
          ...(args[0] === 'list' ? { AUTOPILOT_PM_ASK_NOW: '2027-01-01T00:00:00.000Z' } : {}),
          ...extraEnv,
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

    // newest first: 11-17 00:30, 11-16 19:00, 11-16 18:00, 11-16 17:00
    // (b) + (d) UTC 16:30 -> Taipei 11-17 00:30
    assert.equal(lines[0], '未答 11-17 00:30 why did nightly build fail ｜ （尚無答案）');
    // (e) disposed without reply
    assert.equal(lines[1], '已處置 11-16 19:00 closed without reply ｜ （尚無答案）');
    // (a)
    assert.equal(lines[2], '已答 11-16 18:00 check deployment status for api server ｜ deployed v2 cleanly');
    // (c) merged into 1 line with latest reply
    assert.equal(lines[3], '已答 ×2 11-16 17:00 status of migration job ｜ latest migration reply');

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

test('list --answers marks pre-cutoff and no-reply-log asks as 舊紀錄, post-cutoff as 未答', () => {
  // (a) pre-cutoff without reply -> 舊紀錄; (b) post-cutoff without reply -> 未答
  const s = makeStore([
    askRow('a-old00001', 'old ask before reply writer', '2026-11-20T10:00:00.000Z'),
    askRow('a-rep00002', 'first ask with reply', '2026-11-24T01:00:00.000Z'),
    {
      schema: SCHEMA,
      kind: 'disposition',
      at: '2026-11-24T01:05:00.000Z',
      ask_id: 'a-rep00002',
      action: 'reply',
      text: 'writer is live',
    },
    askRow('a-new00003', 'new ask after cutoff', '2026-11-24T02:00:00.000Z'),
  ]);
  try {
    const res = s.run(['list', '--answers']);
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 3);
    // newest first
    assert.match(lines[0], /^未答 /);
    assert.match(lines[1], /^已答 /);
    assert.match(lines[2], /^舊紀錄 /);

    // --open still lists 舊紀錄
    const openRes = s.run(['list', '--open']);
    assert.equal(openRes.status, 0, openRes.stderr);
    assert.equal(openRes.stdout.includes('a-old00001'), true);
  } finally {
    s.cleanup();
  }

  // (c) no reply rows at all -> 舊紀錄
  const noReplyStore = makeStore([
    askRow('a-only0001', 'ask when no reply rows exist', '2026-11-20T10:00:00.000Z'),
  ]);
  try {
    const res = noReplyStore.run(['list', '--answers']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout.trim(), /^舊紀錄 /);
  } finally {
    noReplyStore.cleanup();
  }
});

test('groupAsks merges prefix-matching asks within 30m in same scope, and respects boundaries', () => {
  // (d) 3 asks with same >=8-char prefix, <=11m apart, same scope -> merged into 1 with count=3
  const sMerged = makeStore([
    askRow('a-pfx00001', 'fleet-glm 開好了沒?', '2026-11-24T04:49:00.000Z', 's1'),
    askRow('a-pfx00002', 'fleet-glm 開好了沒? 我等很久了', '2026-11-24T05:00:00.000Z', 's1'),
    askRow('a-pfx00003', 'fleet-glm 開好了沒? 我等很久了 請回我', '2026-11-24T05:07:00.000Z', 's1'),
  ]);
  try {
    const res = sMerged.run(['list']);
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\(x3\)/);
  } finally {
    sMerged.cleanup();
  }

  // (e) same 3 asks but 40m apart -> not merged
  const sFar = makeStore([
    askRow('a-far00001', 'fleet-glm 開好了沒?', '2026-11-24T04:00:00.000Z', 's1'),
    askRow('a-far00002', 'fleet-glm 開好了沒? 我等很久了', '2026-11-24T04:40:00.000Z', 's1'),
    askRow('a-far00003', 'fleet-glm 開好了沒? 我等很久了 請回我', '2026-11-24T05:20:00.000Z', 's1'),
  ]);
  try {
    const res = sFar.run(['list']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim().split('\n').length, 3);
  } finally {
    sFar.cleanup();
  }

  // (f) same time but different scope -> not merged
  const sDiffScope = makeStore([
    askRow('a-scp00001', 'fleet-glm 開好了沒?', '2026-11-24T04:49:00.000Z', 's1'),
    askRow('a-scp00002', 'fleet-glm 開好了沒? 我等很久了', '2026-11-24T04:55:00.000Z', 's2'),
  ]);
  try {
    const res = sDiffScope.run(['list']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim().split('\n').length, 2);
  } finally {
    sDiffScope.cleanup();
  }

  // (g) prefix only 5 chars -> not merged
  const sShort = makeStore([
    askRow('a-sht00001', 'abcde?', '2026-11-24T04:49:00.000Z', 's1'),
    askRow('a-sht00002', 'abcde extra text here', '2026-11-24T04:55:00.000Z', 's1'),
  ]);
  try {
    const res = sShort.run(['list']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim().split('\n').length, 2);
  } finally {
    sShort.cleanup();
  }
});

test('list --answers --open drops 舊紀錄 groups, shows ×N for merged asks, and where reports path, hook state and last ask', () => {
  const reply = { schema: 'autopilot.askpm/1', kind: 'disposition', action: 'reply', ask_id: 'a-new00001', at: '2026-11-24T02:00:00.000Z', text: '好了' }
  const s = makeStore([
    askRow('a-old00001', '很久以前的問題要夠長才行', '2026-11-19T07:07:00.000Z', 's0'),
    askRow('a-new00001', 'caddy 改好沒 請回報狀態', '2026-11-24T01:00:00.000Z', 's1'),
    reply,
    askRow('a-new00002', 'fleet-glm 開好了沒?', '2026-11-24T03:00:00.000Z', 's1'),
    askRow('a-new00003', 'fleet-glm 開好了沒? 再問一次', '2026-11-24T03:05:00.000Z', 's1'),
  ]);
  try {
    const all = s.run(['list', '--answers']);
    assert.equal(all.status, 0, all.stderr);
    assert.ok(all.stdout.includes('舊紀錄'), all.stdout);
    const open = s.run(['list', '--open', '--answers']);
    assert.equal(open.status, 0, open.stderr);
    assert.ok(!open.stdout.includes('舊紀錄'), open.stdout);
    assert.ok(open.stdout.includes('未答 ×2'), open.stdout);
    const where = s.run(['where']);
    assert.equal(where.status, 0, where.stderr);
    assert.ok(where.stdout.includes(path.join(s.state, 'askpm.jsonl')), where.stdout);
    assert.ok(where.stdout.includes('hook_enabled no'), where.stdout);
    assert.ok(where.stdout.includes('asks 4'), where.stdout);
  } finally {
    s.cleanup();
  }
});

test('list --answers shows the newest asks first so the 30-line cap drops the oldest', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const hh = String(Math.floor(i / 2)).padStart(2, '0');
    const mm = i % 2 === 0 ? '00' : '30';
    rows.push(askRow('a-nf' + String(i).padStart(6, '0'), 'distinct question number ' + i + ' ' + 'x'.repeat(i + 1), '2026-11-23T' + hh + ':' + mm + ':00.000Z', 's-' + i));
  }
  const s = makeStore(rows);
  try {
    const res = s.run(['list', '--answers']);
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 31);
    assert.ok(lines[0].includes('question number 39'), lines[0]);
    assert.ok(lines[29].includes('question number 10'), lines[29]);
    assert.equal(lines[30], '… 10 more');
  } finally {
    s.cleanup();
  }
});

test('list --answers never calls an ask from the last 24 hours an old record, even with no reply rows at all', () => {
  const s = makeStore([
    askRow('a-rc000001', 'older than a day question text', '2026-11-22T04:00:00.000Z', 's1'),
    askRow('a-rc000002', 'caddy 改好沒 請回報狀態', '2026-11-24T10:59:00.000Z', 's2'),
  ]);
  try {
    const res = s.run(['list', '--answers', '--open'], { AUTOPILOT_PM_ASK_NOW: '2026-11-24T12:00:00.000Z' });
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1, res.stdout);
    assert.match(lines[0], /^未答 11-24 18:59 caddy/);
    const all = s.run(['list', '--answers'], { AUTOPILOT_PM_ASK_NOW: '2026-11-24T12:00:00.000Z' });
    assert.ok(all.stdout.includes('舊紀錄 11-22'), all.stdout);
  } finally {
    s.cleanup();
  }
});

test('list --answers leaves out handoff resume instructions; a real question that mentions handoff stays', () => {
  const s = makeStore([
    askRow('a-hf000001', 'read /run/user/1001/autopilot/handoff/35c203e4-be96-4b82-824f-7b0a46c4969c.md 接續', '2026-11-24T10:00:00.000Z', 's1'),
    askRow('a-hf000002', '這個 handoff 是不是寫太長了', '2026-11-24T10:05:00.000Z', 's2'),
  ]);
  try {
    const res = s.run(['list', '--answers']);
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1, res.stdout);
    assert.ok(lines[0].includes('handoff 是不是寫太長'), lines[0]);
  } finally {
    s.cleanup();
  }
});

test('list --answers --json gives newest-first records with status, count, ask and answer', () => {
  const s = makeStore([
    askRow('a-js000001', '舊的問題', '2026-11-24T09:00:00.000Z', 's1'),
    askRow('a-js000002', '新的問題 caddy 好了嗎', '2026-11-24T10:00:00.000Z', 's2'),
  ]);
  try {
    const res = s.run(['list', '--answers', '--json'], { AUTOPILOT_PM_ASK_NOW: '2026-11-24T12:00:00.000Z' });
    assert.equal(res.status, 0, res.stderr);
    const recs = JSON.parse(res.stdout);
    assert.equal(recs.length, 2);
    assert.equal(recs[0].ask, '新的問題 caddy 好了嗎');
    assert.equal(recs[0].status, '未答');
    assert.equal(recs[0].answer, null);
    assert.equal(recs[0].count, 1);
    assert.equal(s.run(['list', '--json']).status === 0, false);
  } finally {
    s.cleanup();
  }
});

test('list --answers masks credential-looking strings in ask text (old rows stored raw)', () => {
  const fake = ['Zq', '8Kx', 'Lm3Np', '7Rt2Vw', 'Yb5Hc', '9Df4Gj', '1Sa6Pe'].join('');
  const s = makeStore([askRow('a-mk000001', '這組給你 ' + fake + ' 收好', '2026-11-24T10:00:00.000Z', 's1')]);
  try {
    const res = s.run(['list', '--answers', '--json'], { AUTOPILOT_PM_ASK_NOW: '2026-11-24T12:00:00.000Z' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.includes(fake), false);
    assert.ok(JSON.parse(res.stdout)[0].ask.includes('〔已遮罩〕'));
  } finally {
    s.cleanup();
  }
});

test('list --answers joins the hook-written kind "reply" rows back to their ask', () => {
  const s = makeStore([
    askRow('a-rk000001', '好了嗎', '2026-11-24T10:00:00.000Z', 's1'),
    { schema: SCHEMA, kind: 'reply', at: '2026-11-24T10:05:00.000Z', ts: '2026-11-24T10:05:00.000Z', ask_id: 'a-rk000001', session_id: 's1', turn: 1, lines: ['好了'], text: '好了\n細節' },
  ]);
  try {
    const res = s.run(['list', '--answers', '--json'], { AUTOPILOT_PM_ASK_NOW: '2026-11-24T12:00:00.000Z' });
    assert.equal(res.status, 0, res.stderr);
    const rec = JSON.parse(res.stdout)[0];
    assert.equal(rec.status, '已答');
    assert.equal(rec.answer, '好了\n細節');
  } finally {
    s.cleanup();
  }
});

test('an ask made before the first linked reply is 舊紀錄 even when it is under 24 hours old', () => {
  const s = makeStore([
    askRow('a-co000001', '更早的問題', '2026-11-24T09:00:00.000Z', 's1'),
    askRow('a-co000002', '之後的問題', '2026-11-24T11:30:00.000Z', 's1'),
    askRow('a-co000003', '已答的問題', '2026-11-24T11:00:00.000Z', 's1'),
    { schema: SCHEMA, kind: 'reply', at: '2026-11-24T11:04:00.000Z', ask_id: 'a-co000003', session_id: 's1', text: '好' },
  ]);
  try {
    const res = s.run(['list', '--answers', '--json'], { AUTOPILOT_PM_ASK_NOW: '2026-11-24T12:00:00.000Z' });
    const by = Object.fromEntries(JSON.parse(res.stdout).map(r => [r.ask, r.status]));
    assert.equal(by['更早的問題'], '舊紀錄');
    assert.equal(by['之後的問題'], '未答');
    assert.equal(by['已答的問題'], '已答');
  } finally {
    s.cleanup();
  }
});

test('list hides old polluted and voided asks; purge-injected dry-run and --apply work with backup and --drop-prefix', () => {
  const t = '2026-11-24T10:00:00.000Z';
  const s = makeStore([]);
  try {
    const file = path.join(s.state, 'askpm.jsonl');
    const rawLines = [
      JSON.stringify(askRow('a-real0001', '正常的問題', t, 's1')),
      'not-valid-json-line-kept-verbatim',
      JSON.stringify(askRow('a-fleet002', '[fleet] from ns/host-a/dev--claude: hi', t, 's1')),
      JSON.stringify({ schema: SCHEMA, kind: 'reply', at: t, ask_id: 'a-fleet002', text: 'reply to fleet' }),
      JSON.stringify(askRow('a-void0003', '假裝人類', t, 's1')),
      JSON.stringify({ schema: SCHEMA, kind: 'void', at: t, ask_id: 'a-void0003' }),
      JSON.stringify(askRow('a-cron0004', '[S8-S12 5 分鐘追蹤] check status', t, 's1')),
    ];
    const original = rawLines.join('\n') + '\n';
    fs.writeFileSync(file, original, 'utf8');

    const listed = s.run(['list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.ok(listed.stdout.includes('a-real0001'));
    assert.equal(listed.stdout.includes('a-fleet002'), false);
    assert.equal(listed.stdout.includes('a-void0003'), false);

    const dry = s.run(['purge-injected', '--drop-prefix', '[S8-S12 5 分鐘追蹤]']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(dry.stdout.trim(), 'would remove 5 rows (3 asks) of 7');
    assert.equal(fs.readFileSync(file, 'utf8'), original);

    const applied = s.run(['purge-injected', '--drop-prefix', '[S8-S12 5 分鐘追蹤]', '--apply']);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /removed 5 rows \(3 asks\) of 7/);
    const bakMatch = applied.stdout.match(/^backup (.+)$/m);
    assert.ok(bakMatch, 'backup path printed');
    assert.equal(fs.readFileSync(bakMatch[1], 'utf8'), original);
    assert.ok(applied.stdout.includes(`cp ${bakMatch[1]} ${file}`));

    const after = fs.readFileSync(file, 'utf8');
    assert.equal(after, `${rawLines[0]}\n${rawLines[1]}\n`);
  } finally {
    s.cleanup();
  }
});
