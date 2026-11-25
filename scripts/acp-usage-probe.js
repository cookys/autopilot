#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_TIMEOUT_MS = 120_000;
const PROMPT_TEXT = 'reply with the single word OK';

/**
 * Parse newline-delimited JSON-RPC 2.0 messages from a string.
 * @param {string} text
 * @returns {{ messages: object[], errors: { line: string, error: string }[] }}
 */
function parseJsonRpcStream(text) {
  const messages = [];
  const errors = [];
  if (!text) return { messages, errors };

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
    } catch (err) {
      errors.push({ line, error: err.message });
    }
  }
  return { messages, errors };
}

function pickNumber(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (typeof obj[key] === 'number' && Number.isFinite(obj[key])) {
      return obj[key];
    }
  }
  return undefined;
}

function normalizeUsageObject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = pickNumber(raw, ['input', 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens']);
  const output = pickNumber(raw, ['output', 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens']);
  const cacheRead = pickNumber(raw, [
    'cacheRead',
    'cache_read',
    'cacheReadTokens',
    'cache_read_tokens',
    'cache_read_input_tokens',
    'cachedInputTokens',
    'cached_input_tokens',
  ]);
  const cacheWrite = pickNumber(raw, [
    'cacheWrite',
    'cache_write',
    'cacheWriteTokens',
    'cache_write_tokens',
    'cache_creation_input_tokens',
  ]);
  const total = pickNumber(raw, ['total', 'totalTokens', 'total_tokens']);

  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    total === undefined
  ) {
    return null;
  }

  return {
    input: input ?? null,
    output: output ?? null,
    cacheRead: cacheRead ?? null,
    cacheWrite: cacheWrite ?? null,
    total: total ?? null,
  };
}

function findUsageCandidates(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) findUsageCandidates(item, out);
    return out;
  }
  if (node.usage && typeof node.usage === 'object') {
    const normalized = normalizeUsageObject(node.usage);
    if (normalized) out.push(normalized);
  }
  if (node.tokens && typeof node.tokens === 'object') {
    const normalized = normalizeUsageObject(node.tokens);
    if (normalized) out.push(normalized);
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'usage' || k === 'tokens') continue;
    if (v && typeof v === 'object') findUsageCandidates(v, out);
  }
  return out;
}

/**
 * Extract usage information from parsed ACP JSON-RPC messages.
 * @param {object[]} messages
 * @returns {{ found: boolean, usage: object | null, rawUsages: object[] }}
 */
function extractAcpUsage(messages) {
  const rawUsages = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.method === 'session/update' && msg.params) {
      findUsageCandidates(msg.params, rawUsages);
    } else if (msg.result) {
      findUsageCandidates(msg.result, rawUsages);
    }
  }

  if (rawUsages.length === 0) {
    return { found: false, usage: null, rawUsages: [] };
  }

  // Use the last reported usage snapshot as the final turn usage.
  const usage = rawUsages[rawUsages.length - 1];
  return { found: true, usage, rawUsages };
}

/**
 * Extract usage information from `opencode run --format json` output.
 * @param {string} text
 * @returns {{ found: boolean, usage: object | null, rawUsages: object[] }}
 */
function extractRunJsonUsage(text) {
  const { messages } = parseJsonRpcStream(text);
  const rawUsages = [];
  for (const msg of messages) {
    findUsageCandidates(msg, rawUsages);
  }
  if (rawUsages.length === 0) {
    return { found: false, usage: null, rawUsages: [] };
  }
  return { found: true, usage: rawUsages[rawUsages.length - 1], rawUsages };
}

/**
 * Evaluate the probe gate from ACP usage and CLI `opencode run` usage.
 * @param {{ found: boolean, usage: object | null }} acpUsage
 * @param {{ found: boolean, usage: object | null } | null} runUsage
 * @returns {{ gate: 'exact' | 'inexact' | 'absent', reason: string }}
 */
function evaluateGate(acpUsage, runUsage) {
  if (!acpUsage || !acpUsage.found || !acpUsage.usage) {
    return {
      gate: 'absent',
      reason: 'No usage fields (input/output/cacheRead/cacheWrite) found in ACP session/update or session/prompt response.',
    };
  }

  if (!runUsage || !runUsage.found || !runUsage.usage) {
    return {
      gate: 'inexact',
      reason: 'ACP returned usage fields, but `opencode run --format json` did not return comparable usage fields.',
    };
  }

  const keys = ['input', 'output', 'cacheRead', 'cacheWrite'];
  const diffs = [];
  for (const key of keys) {
    const a = acpUsage.usage[key];
    const b = runUsage.usage[key];
    if (a !== null && b !== null && a !== b) {
      diffs.push(`${key}: acp=${a} vs run=${b}`);
    }
  }

  if (diffs.length > 0) {
    return {
      gate: 'inexact',
      reason: `ACP usage differs from CLI run usage (${diffs.join(', ')}).`,
    };
  }

  return {
    gate: 'exact',
    reason: 'ACP usage matches CLI `opencode run --format json` usage.',
  };
}

function killChildTree(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
  const timer = setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

function runAcpProbe(tmpDir, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn('opencode', ['acp'], {
      cwd: tmpDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rawMessages = [];
    const stderrChunks = [];
    const pending = new Map();
    let nextId = 1;
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killChildTree(child);
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      finish(new Error(`opencode acp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const send = (obj) => {
      child.stdin.write(JSON.stringify(obj) + '\n');
    };

    const request = (method, params) => {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej, method });
        send({ jsonrpc: '2.0', id, method, params });
      });
    };

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch (err) {
        rawMessages.push({ parseError: err.message, raw: trimmed });
        return;
      }
      rawMessages.push(msg);

      // Handle server-initiated permission requests by always denying.
      if (msg.id !== undefined && msg.method && /permission/i.test(msg.method)) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { outcome: { outcome: 'cancelled' } },
        });
        return;
      }

      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          entry.rej(new Error(`${entry.method} failed: ${JSON.stringify(msg.error)}`));
        } else {
          entry.res(msg.result);
        }
      }
    });

    child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (!settled) {
        finish(new Error(`opencode acp exited prematurely with code ${code}: ${stderrChunks.join('')}`));
      }
    });

    (async () => {
      await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
      });

      const sessionRes = await request('session/new', {
        cwd: tmpDir,
        mcpServers: [],
      });
      const sessionId = sessionRes && sessionRes.sessionId;
      if (!sessionId) {
        throw new Error(`session/new did not return sessionId: ${JSON.stringify(sessionRes)}`);
      }

      const promptRes = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: PROMPT_TEXT }],
      });

      finish(null, {
        rawMessages,
        promptResult: promptRes,
        stderr: stderrChunks.join(''),
      });
    })().catch((err) => finish(err));
  });
}

function runCliProbe(tmpDir, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn('opencode', ['run', '--format', 'json', PROMPT_TEXT], {
      cwd: tmpDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killChildTree(child);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        exitCode: null,
        timedOut: true,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    }, timeoutMs);

    child.stdout.on('data', (c) => stdoutChunks.push(c.toString('utf8')));
    child.stderr.on('data', (c) => stderrChunks.push(c.toString('utf8')));
    child.on('error', (err) => {
      finish({
        exitCode: null,
        error: err.message,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
    child.on('close', (code) => {
      finish({
        exitCode: code,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

function parseArgs(argv) {
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      outPath = argv[i + 1];
      i++;
    }
  }
  return {
    outPath: outPath || path.join(os.tmpdir(), `acp-usage-probe-${Date.now()}.json`),
  };
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-usage-probe-'));

  try {
    const acpResult = await runAcpProbe(tmpDir, DEFAULT_TIMEOUT_MS);
    const cliResult = await runCliProbe(tmpDir, DEFAULT_TIMEOUT_MS);

    const acpUsage = extractAcpUsage(acpResult.rawMessages);
    const runUsage = extractRunJsonUsage(cliResult.stdout);
    const verdict = evaluateGate(acpUsage, runUsage);

    const payload = {
      prompt: PROMPT_TEXT,
      acp: {
        messages: acpResult.rawMessages,
        usage: acpUsage,
        stderr: acpResult.stderr,
      },
      cliRun: {
        exitCode: cliResult.exitCode,
        stdout: cliResult.stdout,
        stderr: cliResult.stderr,
        usage: runUsage,
      },
      verdict,
    };

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(`RAW_OUT: ${path.resolve(outPath)}`);
    console.log(`ACP_USAGE: ${JSON.stringify(acpUsage.usage)}`);
    console.log(`CLI_USAGE: ${JSON.stringify(runUsage.usage)}`);
    console.log(`GATE: ${verdict.gate} - ${verdict.reason}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  parseJsonRpcStream,
  extractAcpUsage,
  extractRunJsonUsage,
  evaluateGate,
};
