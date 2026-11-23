#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeWeightedCost, computeMetrics } = require('./pm-seat-cost-metrics.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-seat-cost-metrics-'));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8'
  );
}

describe('pm-seat-cost-metrics', () => {
  it('computes weighted cost with section 1/5 weights and skips synthetic + dedupes message id (negative control)', () => {
    const tmp = makeTempDir();
    try {
      const sessDir = path.join(tmp, 'sessions');
      fs.mkdirSync(sessDir);
      const entries = [
        {
          type: 'assistant',
          timestamp: '2026-11-20T10:00:00.000Z',
          message: {
            id: 'msg_dup_1',
            role: 'assistant',
            model: 'claude-opus-4',
            content: [{ type: 'text', text: 'ok' }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 1000,
              cache_creation: {
                ephemeral_5m_input_tokens: 40,
                ephemeral_1h_input_tokens: 50,
              },
            },
          },
        },
        // Duplicate of msg_dup_1 (must be deduped)
        {
          type: 'assistant',
          timestamp: '2026-11-20T10:00:01.000Z',
          message: {
            id: 'msg_dup_1',
            role: 'assistant',
            model: 'claude-opus-4',
            content: [{ type: 'text', text: 'ok' }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 1000,
              cache_creation: {
                ephemeral_5m_input_tokens: 40,
                ephemeral_1h_input_tokens: 50,
              },
            },
          },
        },
        // Synthetic entry (must be skipped)
        {
          type: 'assistant',
          isSynthetic: true,
          timestamp: '2026-11-20T10:00:02.000Z',
          message: {
            id: 'msg_syn_1',
            role: 'assistant',
            model: '<synthetic>',
            content: [{ type: 'text', text: 'synthetic' }],
            usage: { input_tokens: 500, output_tokens: 100 },
          },
        },
      ];
      writeJsonl(path.join(sessDir, 's1.jsonl'), entries);

      // Expected: 100*1 + 20*5 + 1000*0.1 + 40*1.25 + 50*2.0 = 100 + 100 + 100 + 50 + 100 = 450
      const expectedCost = 450;

      // Negative control: naive computation without dedupe/synthetic filter
      const naiveCost = entries.reduce(
        (sum, e) => sum + computeWeightedCost(e.message.usage),
        0
      );
      assert.notEqual(naiveCost, expectedCost, 'negative control: naive cost must differ');

      const rows = computeMetrics({ sessionsDirs: [sessDir] });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].day, '2026-11-20');
      assert.equal(rows[0].calls, 1);
      assert.equal(rows[0].weighted_cost, expectedCost);
      assert.equal(rows[0].rotations, null);
      assert.equal(rows[0].resume_check_passes, null);
      assert.equal(rows[0].resume_check_fallbacks, null);
      assert.equal(rows[0].bypass_auto_handled, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('computes corrections, latency, mechanical/failure shares, logs, slices, detectors, and gates without leaking text', () => {
    const tmp = makeTempDir();
    try {
      const sessDir = path.join(tmp, 'sessions');
      fs.mkdirSync(sessDir);
      const ledgerFile = path.join(tmp, 'ledger.jsonl');
      const courierFile = path.join(tmp, 'courier.jsonl');
      const rotationFile = path.join(tmp, 'rotation.jsonl');

      writeJsonl(path.join(sessDir, 's2.jsonl'), [
        {
          type: 'user',
          timestamp: '2026-11-21T01:00:00.000Z',
          message: { role: 'user', content: '不是這個意思，請重做' },
        },
        {
          type: 'assistant',
          timestamp: '2026-11-21T01:00:02.000Z',
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'mcp__fleet__inbox_mark', input: {} }],
            usage: { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 100000 },
          },
        },
        {
          type: 'user',
          timestamp: '2026-11-21T01:00:05.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'err' }],
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-11-21T01:00:06.000Z',
          message: {
            id: 'a2',
            role: 'assistant',
            content: [{ type: 'text', text: '收到' }],
            usage: { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 100000 },
          },
        },
      ]);

      writeJsonl(ledgerFile, [
        { task_id: '01M8350QM7GTW20VH5YP2EAK0H', origin: 'operator', status: 'open', timestamp: '2026-11-19T00:00:00.000Z' },
      ]);
      writeJsonl(courierFile, [
        { timestamp: '2026-11-21T02:00:00.000Z', bypass_class: true, auto_handled: true },
      ]);
      writeJsonl(rotationFile, [
        { timestamp: '2026-11-21T03:00:00.000Z', resume_check: 'pass' },
      ]);

      const rows = computeMetrics({
        sessionsDirs: [sessDir],
        ledger: ledgerFile,
        courierLog: courierFile,
        rotationLog: rotationFile,
        day: '2026-11-21',
      });

      assert.equal(rows.length, 1);
      const r = rows[0];
      assert.equal(r.calls, 2);
      assert.equal(r.operator_corrections, 1);
      assert.equal(r.operator_reply_latency_p50_ms, 6000);
      assert.equal(r.operator_reply_latency_p95_ms, 6000);
      assert.equal(r.mechanical_only_share, 1);
      assert.equal(r.failure_share, 1);
      assert.equal(r.rotations, 1);
      assert.equal(r.resume_check_passes, 1);
      assert.equal(r.resume_check_fallbacks, 0);
      assert.equal(r.bypass_auto_handled, 1);
      assert.equal(r.detectors.lost_asks, 1);
      assert.equal(r.gates.s2_failure_share_ok, false);
      assert.equal(r.gates.s3_avg_context_ok, true);
      assert.equal(r.gates.s4_zero_bypass_auto_handled, false);
      assert.equal(r.gates.s7_zero_lost_asks, false);

      const serialized = JSON.stringify(r);
      assert.equal(serialized.includes('不是這個意思'), false);
      assert.equal(serialized.includes('收到'), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('streams a session file larger than one read chunk without splitting multibyte text', () => {
    const tmp = makeTempDir();
    try {
      const sessDir = path.join(tmp, 'sessions');
      fs.mkdirSync(sessDir);
      const rows = [];
      for (let i = 0; i < 400; i++) {
        rows.push({
          type: 'assistant',
          timestamp: '2026-11-22T01:00:00.000Z',
          message: {
            id: 'm' + i,
            role: 'assistant',
            content: [{ type: 'text', text: '中'.repeat(3000) }],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        });
      }
      writeJsonl(path.join(sessDir, 'big.jsonl'), rows);
      assert.ok(fs.statSync(path.join(sessDir, 'big.jsonl')).size > 2 * (1 << 20));
      const out = computeMetrics({ sessionsDirs: [sessDir], day: '2026-11-22' });
      assert.equal(out[0].calls, 400);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
