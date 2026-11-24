#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkMapDrift } = require('./map-drift-check');

const SCRIPT_PATH = path.join(__dirname, 'map-drift-check.js');

function makeSandbox(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `map-drift-${name}-`));
  const repo = path.join(base, 'demo-repo');
  fs.mkdirSync(repo, { recursive: true });
  return { base, repo };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeArch(repo, content) {
  fs.writeFileSync(path.join(repo, 'ARCHITECTURE.md'), content, 'utf8');
}

function writeTasks(base, tasks) {
  const p = path.join(base, 'tasks.json');
  fs.writeFileSync(p, JSON.stringify(tasks), 'utf8');
  return p;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Rule 1: no_map & not_map_ready
test('Rule 1: skips when ARCHITECTURE.md is missing (no_map)', () => {
  const { base, repo } = makeSandbox('no-map');
  try {
    const tasksFile = writeTasks(base, []);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.deepEqual(res, { ok: true, findings: [], skipped: 'no_map' });
  } finally {
    cleanup(base);
  }
});

test('Rule 1: skips when map_ready: true is absent (not_map_ready)', () => {
  const { base, repo } = makeSandbox('not-ready');
  try {
    writeArch(
      repo,
      '# Architecture\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| feat | live | src/a.js | missing/path.js | 無 | node test.js |\n'
    );
    const tasksFile = writeTasks(base, [
      { id: '111122223333', title: 't', status: 'done', closed_at: '2026-11-20T00:00:00Z' },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.deepEqual(res, { ok: true, findings: [], skipped: 'not_map_ready' });
  } finally {
    cleanup(base);
  }
});

// Rule 2: done_task_no_row (hit & miss)
test('Rule 2: done_task_no_row hits when done task id/prefix not in any row', () => {
  const { base, repo } = makeSandbox('r2-hit');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| feat | live | src/a.js | docs/spec.md | 無 | 無 |\n'
    );
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/spec.md'), 'ok', 'utf8');
    const tasksFile = writeTasks(base, [
      { id: 'abcd1234efgh', title: 't1', status: 'done', closed_at: '2026-11-20T00:00:00Z' },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.equal(res.ok, false);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].key, 'demo-repo:task:abcd1234efgh');
    assert.equal(res.findings[0].rule, 'done_task_no_row');
    assert.equal(res.findings[0].task, 'abcd1234efgh');
  } finally {
    cleanup(base);
  }
});

test('Rule 2: done_task_no_row misses when first 8 chars appear in 依據', () => {
  const { base, repo } = makeSandbox('r2-miss');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| feat | live | src/a.js | task abcd1234 | 無 | 無 |\n'
    );
    const tasksFile = writeTasks(base, [
      { id: 'abcd1234efgh', title: 't1', status: 'done', closed_at: '2026-11-20T00:00:00Z' },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.deepEqual(res, { ok: true, findings: [] });
  } finally {
    cleanup(base);
  }
});

// Rule 3: live_row_missing_evidence (hit & miss)
test('Rule 3: live_row_missing_evidence hits when referenced path does not exist', () => {
  const { base, repo } = makeSandbox('r3-hit');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| auth | live | src/auth.js | docs/missing.md | 無 | tests/auth.test.js |\n'
    );
    const tasksFile = writeTasks(base, []);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.equal(res.ok, false);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].key, 'demo-repo:row:auth');
    assert.equal(res.findings[0].rule, 'live_row_missing_evidence');
    assert.match(res.findings[0].detail, /docs\/missing\.md/);
    assert.match(res.findings[0].detail, /tests\/auth\.test\.js/);
  } finally {
    cleanup(base);
  }
});

test('Rule 3: live_row_missing_evidence misses when referenced paths exist', () => {
  const { base, repo } = makeSandbox('r3-miss');
  try {
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/ok.md'), 'ok', 'utf8');
    fs.writeFileSync(path.join(repo, 'tests/ok.test.js'), 'ok', 'utf8');
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| auth | live | src/auth.js | docs/ok.md | 無 | tests/ok.test.js |\n'
    );
    const tasksFile = writeTasks(base, []);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.deepEqual(res, { ok: true, findings: [] });
  } finally {
    cleanup(base);
  }
});

// Rule 4: requested_task_done (hit & miss)
test('Rule 4: requested_task_done hits when requested row references done task', () => {
  const { base, repo } = makeSandbox('r4-hit');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| billing | requested | src/bill.js | task 99887766 | 無 | 無 |\n'
    );
    const tasksFile = writeTasks(base, [
      { id: '998877665544', title: 'bill', status: 'done', closed_at: '2026-11-20T00:00:00Z' },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.equal(res.ok, false);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].key, 'demo-repo:row:billing');
    assert.equal(res.findings[0].rule, 'requested_task_done');
  } finally {
    cleanup(base);
  }
});

test('Rule 4: requested_task_done misses when referenced task is still open', () => {
  const { base, repo } = makeSandbox('r4-miss');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| billing | requested | src/bill.js | task 99887766 | 無 | 無 |\n'
    );
    const tasksFile = writeTasks(base, [
      { id: '998877665544', title: 'bill', status: 'open', closed_at: null },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.deepEqual(res, { ok: true, findings: [] });
  } finally {
    cleanup(base);
  }
});

// Rule 5: intake_receipt_unreferenced (hit & miss)
test('Rule 5: intake_receipt_unreferenced hits when verdict is 沒有/部分, >24h, and no requested row references receipt', () => {
  const { base, repo } = makeSandbox('r5-hit');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| feat | live | src/a.js | 無 | 無 | 無 |\n'
    );
    const tasksFile = writeTasks(base, [
      {
        id: 't-open-1',
        title: 'intake',
        status: 'open',
        closed_at: null,
        intake: { verdict: '沒有', receipt: 'rcpt-001', at: '2026-11-23T00:00:00Z' },
      },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.equal(res.ok, false);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].key, 'demo-repo:receipt:rcpt-001');
    assert.equal(res.findings[0].rule, 'intake_receipt_unreferenced');
  } finally {
    cleanup(base);
  }
});

test('Rule 5: intake_receipt_unreferenced misses within 24h or when referenced by requested row', () => {
  const { base, repo } = makeSandbox('r5-miss');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| feat | requested | src/a.js | rcpt-002 | 無 | 無 |\n'
    );
    const tasksFile = writeTasks(base, [
      {
        id: 't-open-1',
        title: 'within 24h',
        status: 'open',
        closed_at: null,
        intake: { verdict: '沒有', receipt: 'rcpt-001', at: '2026-11-24T12:00:00Z' },
      },
      {
        id: 't-open-2',
        title: 'referenced',
        status: 'open',
        closed_at: null,
        intake: { verdict: '部分', receipt: 'rcpt-002', at: '2026-11-20T00:00:00Z' },
      },
    ]);
    const res = checkMapDrift({ repo, tasks: tasksFile, now: '2026-11-25T00:00:00Z' });
    assert.deepEqual(res, { ok: true, findings: [] });
  } finally {
    cleanup(base);
  }
});

// Deduplication + CLI exit 0
test('Deduplication: same key twice outputs one finding with merged detail and CLI exits 0', () => {
  const { base, repo } = makeSandbox('dedup');
  try {
    writeArch(
      repo,
      'map_ready: true\n\n| 名稱 | 狀態 | 在哪裡 | 依據 | 互動介面 | 驗收方式 |\n| --- | --- | --- | --- | --- | --- |\n| dup | live | src/a.js | docs/a.md | 無 | tests/b.test.js |\n'
    );
    const tasksFile = writeTasks(base, []);
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT_PATH, '--repo', repo, '--tasks', tasksFile, '--now', '2026-11-25T00:00:00Z'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.findings[0].key, 'demo-repo:row:dup');
    assert.match(parsed.findings[0].detail, /docs\/a\.md/);
    assert.match(parsed.findings[0].detail, /tests\/b\.test\.js/);
  } finally {
    cleanup(base);
  }
});

let passed = 0;
for (const t of tests) {
  t.fn();
  passed++;
  console.log(`PASS: ${t.name}`);
}
console.log(`All ${passed}/${tests.length} tests passed.`);
