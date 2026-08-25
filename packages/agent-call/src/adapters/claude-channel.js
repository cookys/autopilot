'use strict';

const net = require('net');
const { AgentCallError } = require('../errors');
const { readPrivateFile } = require('../runtime');

const MAX_RESPONSE_BYTES = 64 * 1024;

function requestChannel(descriptor, request, options = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  const token = readPrivateFile(descriptor.ingress.token_path).trim();
  if (!token) throw new AgentCallError('channel_token_invalid', 'Claude channel token is empty');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: descriptor.ingress.socket });
    let settled = false;
    let buffer = '';
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ v: 1, token, ...request })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
        finish(reject, new AgentCallError('channel_response_too_large', 'Claude channel response exceeded the limit'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response || response.ok !== true) {
          finish(reject, new AgentCallError(response?.code || 'channel_rejected', response?.error || 'Claude channel rejected the request'));
        } else {
          finish(resolve, response.result ?? {});
        }
      } catch (error) {
        finish(reject, new AgentCallError('channel_response_invalid', 'Claude channel returned invalid JSON', { cause: error }));
      }
    });
    socket.on('timeout', () => finish(reject, new AgentCallError('channel_timeout', `Claude channel did not respond within ${timeoutMs}ms`)));
    socket.on('error', (error) => finish(reject, new AgentCallError('channel_unreachable', `Claude channel is unreachable: ${error.message}`, { cause: error })));
    socket.on('end', () => {
      if (!settled) finish(reject, new AgentCallError('channel_closed', 'Claude channel closed without a response'));
    });
  });
}

class ClaudeChannelAdapter {
  constructor(options = {}) {
    this.request = options.request ?? requestChannel;
  }

  async deliver(descriptor, envelope) {
    const result = await this.request(descriptor, { op: 'deliver', envelope });
    return {
      status: 'channel_accepted',
      adapter: 'claude-channel',
      target: descriptor.name,
      message_id: envelope.id,
      ...result,
      note: 'the Channel MCP server accepted the notification; model observation is not acknowledged by the protocol',
    };
  }

  read() {
    throw new AgentCallError('read_unsupported', 'Claude Channel does not expose console capture');
  }

  async doctor(descriptor) {
    const result = await this.request(descriptor, { op: 'ping' });
    return {
      ok: true,
      adapter: 'claude-channel',
      target: descriptor.name,
      delivery_ceiling: 'channel_accepted',
      ...result,
    };
  }
}

module.exports = { ClaudeChannelAdapter, requestChannel };
