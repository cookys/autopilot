'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSandboxArgs, runInSandbox, resolveAllowedEnv } = require('./replay-sandbox.js');
const { checkPool } = require('./replay-pool.js');

/**
 * Base-URL decision: the model call stays inside the sandbox and talks to a
 * localhost relay, not to the Claude CLI.
 *
 * Probe (also exported as probeBaseUrlDecision):
 * - resolveAllowedEnv drops ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY, so a CLI
 *   started through buildSandboxArgs cannot be pointed at the relay.
 * - A bind-mounted Unix socket still accepts connections under --unshare-net,
 *   and the sandbox's own 127.0.0.1 can host the TCP relay.
 * Therefore createRealModelRunner writes an inner script that relays
 * /proxy.sock to 127.0.0.1 and POSTs /v1/messages there. The credential stays
 * on the out-of-sandbox proxy. Hooks and plugins keep the same sandbox.
 */
const INNER_JS = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const http = require('node:http');",
  "const net = require('node:net');",
  "const payload = JSON.parse(fs.readFileSync('/work/event.json', 'utf8'));",
  "const relay = net.createServer((client) => {",
  "  const upstream = net.connect(payload.proxySock);",
  "  client.pipe(upstream);",
  "  upstream.pipe(client);",
  "  upstream.on('error', () => client.destroy());",
  "  client.on('error', () => upstream.destroy());",
  "});",
  "relay.listen(0, '127.0.0.1', () => {",
  "  const port = relay.address().port;",
  "  const body = JSON.stringify({ model: payload.model, max_tokens: payload.maxTokens, messages: payload.messages });",
  "  const req = http.request({",
  "    host: '127.0.0.1', port, method: 'POST', path: '/v1/messages',",
  "    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), connection: 'close' },",
  "  }, (res) => {",
  "    const parts = [];",
  "    res.on('data', (c) => parts.push(c));",
  "    res.on('end', () => {",
  "      fs.writeFileSync('/work/result.json', JSON.stringify({ status: res.statusCode, raw: Buffer.concat(parts).toString('utf8') }));",
  "      relay.close(() => process.exit(0));",
  "    });",
  "  });",
  "  req.on('error', (err) => {",
  "    fs.writeFileSync('/work/result.json', JSON.stringify({ status: 0, error: String(err.message) }));",
  "    relay.close(() => process.exit(1));",
  "  });",
  "  req.end(body);",
  "});",
  "",
].join('\n');

function probeBaseUrlDecision() {
  const env = resolveAllowedEnv({
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    ANTHROPIC_API_KEY: 'should-not-pass',
    SAFE_VAR: 'ok',
  });
  return {
    choice: 'in-sandbox-relay',
    anthropicBaseUrlStripped: env.ANTHROPIC_BASE_URL === undefined && env.ANTHROPIC_API_KEY === undefined,
    safeVarKept: env.SAFE_VAR === 'ok',
    why: 'sandbox env allowlist strips ANTHROPIC_*; unix socket bind-mount plus a 127.0.0.1 relay is reachable under --unshare-net',
  };
}

function textFromMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    const block = Array.isArray(parsed.content) ? parsed.content.find((b) => b.type === 'text') : null;
    return block ? String(block.text) : '';
  } catch {
    return '';
  }
}

function usageFromRaw(raw) {
  try {
    const u = JSON.parse(raw).usage || {};
    return {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
    };
  } catch {
    return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  }
}

/**
 * Real modelRunner. pool check is fail-closed. proxySocket is the host path of
 * an already-listening replay-api-proxy socket.
 */
function createRealModelRunner({ manifest, proxySocket, setArm } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is required');
  if (!proxySocket) throw new Error('proxySocket is required');
  return {
    async run({ arm, event, contextMessages, poolId }) {
      const pool = checkPool(manifest, poolId);
      if (!pool.ok) throw new Error(`Pool rejected: ${pool.reason}`);
      if (typeof setArm === 'function') setArm(arm);
      const hostWork = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-runner-'));
      const messages = Array.isArray(contextMessages) ? contextMessages.slice() : [];
      messages.push({ role: 'user', content: event && event.prompt ? String(event.prompt) : String((event && event.id) || 'event') });
      fs.writeFileSync(path.join(hostWork, 'event.json'), JSON.stringify({
        proxySock: '/proxy.sock',
        model: manifest.model || 'replay-fake',
        maxTokens: manifest.max_tokens || 64,
        messages,
      }));
      fs.writeFileSync(path.join(hostWork, 'inner.js'), INNER_JS);
      const args = buildSandboxArgs({
        workDir: hostWork,
        proxySocket,
        command: [process.execPath, '/work/inner.js'],
      });
      const res = runInSandbox(args, { timeout: 20000 });
      const resultPath = path.join(hostWork, 'result.json');
      const visible = `${res.stdout}\n${res.stderr}\n${fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : ''}`;
      let parsed = {};
      if (fs.existsSync(resultPath)) parsed = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      fs.rmSync(hostWork, { recursive: true, force: true });
      if (!parsed.status) {
        throw new Error(`sandbox model call failed status=${res.status} ${(res.stderr || '').slice(0, 200)}`);
      }
      return {
        arm,
        eventId: event && event.id !== undefined ? String(event.id) : 'unknown',
        turns: 1,
        prefillCount: Array.isArray(contextMessages) ? contextMessages.length : 0,
        output: textFromMessage(parsed.raw || ''),
        usage: usageFromRaw(parsed.raw || ''),
        httpStatus: parsed.status,
        refused: parsed.status === 429,
        sandboxVisible: visible,
      };
    },
  };
}

module.exports = { createRealModelRunner, probeBaseUrlDecision, INNER_JS };
