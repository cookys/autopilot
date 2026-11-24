'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { triage } = require('../scripts/card-triage');

const CLI_PATH = path.resolve(__dirname, '../scripts/card-triage.js');

// (a) 面板無顯示但資料存在 → visibility not_shown、delivery 可為 delivered
{
  const res = triage({
    card: {
      id: 'card-a',
      status: 'open',
      dispatched_message_id: 'msg-123',
    },
    visibleIds: ['card-other'],
  });
  assert.equal(res.id, 'card-a');
  assert.equal(res.visibility, 'not_shown');
  assert.equal(res.delivery, 'delivered');
  assert.equal(res.receipt, 'none');
  assert.equal(res.ok, false);
}

// (b) fleet send 失敗（dispatch_error）→ delivery dispatch_failed、visibility visible
{
  const res = triage({
    card: {
      id: 'card-b',
      status: 'open',
      dispatch_error: 'fleet send exited 1',
    },
    visibleIds: ['card-b'],
  });
  assert.equal(res.visibility, 'visible');
  assert.equal(res.delivery, 'dispatch_failed');
  assert.equal(res.ok, false);
}

// (c) 兩者同時異常 → 兩欄各自報，不得合併
{
  const res = triage({
    card: {
      id: 'card-c',
      status: 'open',
      dispatch_error: 'timeout',
    },
    visibleIds: [],
  });
  assert.equal(res.visibility, 'not_shown');
  assert.equal(res.delivery, 'dispatch_failed');
  assert.equal(res.ok, false);
}

// (d) forward_status failed → forward_failed
{
  const res = triage({
    card: {
      id: 'card-d',
      status: 'closed',
      forward_status: 'failed',
    },
  });
  assert.equal(res.visibility, 'unknown');
  assert.equal(res.delivery, 'forward_failed');
  assert.equal(res.ok, false);
}

// (e) 回執缺 failure_class 或缺 card_id → malformed；failure_class 不在列舉 → malformed
{
  const missingClass = triage({
    card: { id: 'card-e1', status: 'closed' },
    receipt: {
      card_id: 'card-e1',
      answer_id: 'ans-1',
      timestamp: '2026-11-24T00:00:00Z',
    },
  });
  assert.equal(missingClass.receipt, 'malformed');
  assert.deepEqual(missingClass.missing, ['failure_class']);
  assert.equal(missingClass.ok, false);

  const missingCardId = triage({
    card: { id: 'card-e2', status: 'closed' },
    receipt: {
      answer_id: 'ans-2',
      failure_class: 'verify_failed',
      timestamp: '2026-11-24T00:00:00Z',
    },
  });
  assert.equal(missingCardId.receipt, 'malformed');
  assert.deepEqual(missingCardId.missing, ['card_id']);
  assert.equal(missingCardId.ok, false);

  const badEnum = triage({
    card: { id: 'card-e3', status: 'closed' },
    receipt: {
      card_id: 'card-e3',
      answer_id: 'ans-3',
      failure_class: 'unknown_reason',
      timestamp: '2026-11-24T00:00:00Z',
    },
  });
  assert.equal(badEnum.receipt, 'malformed');
  assert.equal(badEnum.ok, false);
}

// (f) 合格回執 → valid:<class>
{
  const res = triage({
    card: { id: 'card-f', status: 'pending_dispatch' },
    receipt: {
      card_id: 'card-f',
      answer_id: 'ans-f',
      failure_class: 'courier_unreachable',
      timestamp: '2026-11-24T00:00:00Z',
    },
  });
  assert.equal(res.delivery, 'pending');
  assert.equal(res.receipt, 'valid:courier_unreachable');
  assert.equal(res.ok, true);
}

// (g) scope_mismatch
{
  const res = triage({
    card: {
      id: 'card-g',
      status: 'open',
      cwd: '/tmp/repo-a',
      forward_status: 'sent',
    },
    repo: '/tmp/repo-b',
  });
  assert.equal(res.visibility, 'scope_mismatch');
  assert.equal(res.delivery, 'delivered');
  assert.equal(res.ok, false);
}

// CLI smoke test in sandbox temp dir
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-triage-test-'));
  try {
    const cardPath = path.join(tmpDir, 'card.json');
    const visiblePath = path.join(tmpDir, 'visible.txt');
    const receiptPath = path.join(tmpDir, 'receipt.json');

    fs.writeFileSync(
      cardPath,
      JSON.stringify({ id: 'card-cli', status: 'open', dispatched_message_id: 'm-1' })
    );
    fs.writeFileSync(visiblePath, 'card-cli\n');
    fs.writeFileSync(
      receiptPath,
      JSON.stringify({
        card_id: 'card-cli',
        answer_id: 'ans-cli',
        failure_class: 'target_offline',
        timestamp: '2026-11-24T00:00:00Z',
      })
    );

    const stdout = execFileSync(
      process.execPath,
      [CLI_PATH, '--card', cardPath, '--visible-ids', visiblePath, '--receipt', receiptPath],
      { encoding: 'utf8' }
    );
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.deepEqual(parsed, {
      id: 'card-cli',
      visibility: 'visible',
      delivery: 'delivered',
      receipt: 'valid:target_offline',
      ok: true,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('card-triage.test.js: all assertions passed');
