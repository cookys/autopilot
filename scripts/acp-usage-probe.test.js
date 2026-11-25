'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseJsonRpcStream,
  extractAcpUsage,
  extractRunJsonUsage,
  evaluateGate,
} = require('./acp-usage-probe.js');

test('extractAcpUsage returns absent when stream has no usage fields', () => {
  const stream = [
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'OK' },
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      result: { stopReason: 'end_turn' },
    }),
  ].join('\n');

  const { messages, errors } = parseJsonRpcStream(stream);
  assert.equal(errors.length, 0);

  const acpUsage = extractAcpUsage(messages);
  assert.equal(acpUsage.found, false);
  assert.equal(acpUsage.usage, null);

  const verdict = evaluateGate(acpUsage, {
    found: true,
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
  });
  assert.equal(verdict.gate, 'absent');
});

test('extractAcpUsage and evaluateGate return exact when ACP usage matches CLI run usage', () => {
  const acpStream = [
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'usage_update',
          usage: {
            inputTokens: 120,
            outputTokens: 5,
            cacheReadTokens: 80,
            cacheWriteTokens: 0,
            totalTokens: 205,
          },
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      result: { stopReason: 'end_turn' },
    }),
  ].join('\n');

  const cliStream = JSON.stringify({
    type: 'step_finish',
    part: {
      tokens: {
        input: 120,
        output: 5,
        cacheRead: 80,
        cacheWrite: 0,
        total: 205,
      },
    },
  });

  const { messages } = parseJsonRpcStream(acpStream);
  const acpUsage = extractAcpUsage(messages);
  const runUsage = extractRunJsonUsage(cliStream);

  assert.equal(acpUsage.found, true);
  assert.deepEqual(acpUsage.usage, {
    input: 120,
    output: 5,
    cacheRead: 80,
    cacheWrite: 0,
    total: 205,
  });

  const verdict = evaluateGate(acpUsage, runUsage);
  assert.equal(verdict.gate, 'exact');
});
