#!/usr/bin/env node
// dispatch-anthropic-review.js — Direct HTTP Anthropic-compatible API reviewer dispatch.
//
// READ-ONLY reviewer: feeds a diff as TEXT in the prompt, POSTs to an Anthropic-compatible
// /v1/messages endpoint, parses VERDICT/FINDINGS. No CLI shim (not claude/cc-shim).
//
// USAGE:
//   scripts/dispatch-anthropic-review.js --model <name> --diff-file <file>
//       [--timeout-ms <ms>]   # default 300000 (5m)
//       [--base-url <url>]    # default ANTHROPIC_COMPATIBLE_BASE_URL,
//                             # AUTOPILOT_MINIMAX_BASE_URL, or https://api.minimax.io/anthropic
//
// AUTH (env only — never accepted as a CLI argument):
//   MINIMAX_API_KEY for minimax.io; ANTHROPIC_COMPATIBLE_AUTH_TOKEN for other
//   third-party compatible endpoints. This direct runner does not accept
//   ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN; keep Claude/Anthropic auth on its
//   own adapter surface.
// Sent as Authorization: Bearer <token>. Provider-specific alternate auth
// schemes should be added behind explicit adapter configuration, not by default.
//
// OUTPUT: one JSON object on stdout (same shape as dispatch-review.sh):
//   { runner, model, status, verdict, findings, raw_log, error }
//
// EXIT: 0 = reviewed ; 1 = no_verdict (HTTP/timeout/unparseable) ; 2 = precondition_failed

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

let sharedRedact = (text) => String(text);
try {
  const secretPatterns = require(path.join(__dirname, '..', 'hooks', '_shared', 'secret-patterns'));
  if (secretPatterns && typeof secretPatterns.redact === 'function') {
    sharedRedact = secretPatterns.redact;
  }
} catch (_err) {
  // Exact-token redaction below still protects runner auth if this script is copied standalone.
}

const RUNNER = 'anthropic-compatible';
// Live-probed on 2026-07-01: appending /v1/messages gives
// https://api.minimax.io/anthropic/v1/messages for MiniMax-M3.
const DEFAULT_BASE_URL = 'https://api.minimax.io/anthropic';
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function printHelp() {
  const text = `dispatch-anthropic-review.js — Direct HTTP Anthropic-compatible reviewer dispatch.

USAGE:
  scripts/dispatch-anthropic-review.js --model <name> --diff-file <file>
      [--timeout-ms <ms>]   # default 300000 (5m)
      [--base-url <url>]    # default ANTHROPIC_COMPATIBLE_BASE_URL,
                            # AUTOPILOT_MINIMAX_BASE_URL, or https://api.minimax.io/anthropic

AUTH (env only — never accepted as a CLI argument):
  MINIMAX_API_KEY for minimax.io; ANTHROPIC_COMPATIBLE_AUTH_TOKEN for other
  third-party compatible endpoints. ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN are
  intentionally not accepted by this direct runner.

OUTPUT: one JSON object on stdout (same shape as dispatch-review.sh).

EXIT: 0 = reviewed ; 1 = no_verdict ; 2 = precondition_failed`;
  process.stdout.write(`${text}\n`);
}

function parseArgs(argv) {
  const out = { model: '', diffFile: '', timeoutMs: DEFAULT_TIMEOUT_MS, baseUrl: '', help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--model':
        out.model = argv[++i] || '';
        break;
      case '--diff-file':
        out.diffFile = argv[++i] || '';
        break;
      case '--timeout-ms':
        out.timeoutMs = Number(argv[++i]);
        break;
      case '--base-url':
        out.baseUrl = argv[++i] || '';
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
      default:
        return { error: `unknown arg: ${arg}` };
    }
  }
  return out;
}

function isMiniMaxHostname(hostname) {
  return hostname === 'minimax.io' || hostname.endsWith('.minimax.io');
}

function resolveToken(baseUrl) {
  let hostname = '';
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch (_err) {
    return { token: '', error: 'invalid base URL' };
  }

  if (isMiniMaxHostname(hostname)) {
    const token = process.env.MINIMAX_API_KEY || '';
    return {
      token,
      error: token ? '' : 'missing MiniMax auth token in env (set MINIMAX_API_KEY)',
    };
  }

  const token = process.env.ANTHROPIC_COMPATIBLE_AUTH_TOKEN || '';
  return {
    token,
    error: token ? '' : 'missing explicit compatible auth token in env (set ANTHROPIC_COMPATIBLE_AUTH_TOKEN for non-Anthropic third-party endpoints)',
  };
}

function resolveBaseUrl(cliBaseUrl) {
  const raw = cliBaseUrl
    || process.env.ANTHROPIC_COMPATIBLE_BASE_URL
    || process.env.AUTOPILOT_MINIMAX_BASE_URL
    || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

function validateBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (err) {
    return `invalid base URL: ${err.message}`;
  }
  if (parsed.protocol === 'https:') {
    return '';
  }
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) {
    return '';
  }
  return 'base URL must use https:// unless it is an http:// loopback test endpoint';
}

function resolveEndpointUrl(baseUrl) {
  const clean = baseUrl.replace(/\/+$/, '');
  if (clean.endsWith('/v1/messages')) {
    return clean;
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/messages`;
  }
  return `${clean}/v1/messages`;
}

function readDiffFile(filePath) {
  if (!filePath) {
    return { error: '--diff-file is required and must be readable' };
  }
  try {
    if (!fs.statSync(filePath).isFile()) {
      return { error: '--diff-file must be a readable regular file' };
    }
    return { text: fs.readFileSync(filePath, 'utf8') };
  } catch (_err) {
    return { error: '--diff-file is required and must be readable' };
  }
}

function buildPrompt(diffText) {
  return [
    'You are a code reviewer. Review ONLY the diff below for correctness, security, and',
    'completeness. Do NOT edit any file, do NOT create any project, do NOT run commands.',
    'Output your verdict in EXACTLY this format and nothing else:',
    'VERDICT: <SHIP-AS-IS | FIX-THEN-SHIP>',
    'FINDINGS: <one finding per line, or the single word none>',
    '',
    'Diff under review:',
    '```',
    diffText,
    '```',
    '',
  ].join('\n');
}

function createRawLogPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-anthropic-review-'));
  fs.chmodSync(dir, 0o700);
  const filePath = path.join(dir, 'raw.log');
  fs.writeFileSync(filePath, '', { mode: 0o600 });
  return filePath;
}

function appendRawLog(filePath, chunk) {
  fs.appendFileSync(filePath, chunk);
}

function redactForLog(value, token) {
  let result = sharedRedact(String(value));
  if (token) {
    result = result.split(token).join('<REDACTED>');
  }
  return result;
}

function jsonField(value) {
  if (value === null) return 'null';
  return JSON.stringify(value);
}

function emitResult(result) {
  process.stdout.write(
    `{ "runner": ${jsonField(result.runner)}, "model": ${jsonField(result.model)}, `
    + `"status": ${jsonField(result.status)}, "verdict": ${jsonField(result.verdict)}, `
    + `"findings": ${jsonField(result.findings)}, "raw_log": ${jsonField(result.raw_log)}, `
    + `"error": ${jsonField(result.error)} }\n`,
  );
}

function diePrecondition(model, error) {
  emitResult({
    runner: RUNNER,
    model,
    status: 'precondition_failed',
    verdict: null,
    findings: '',
    raw_log: null,
    error,
  });
  process.exit(2);
}

function dieNoVerdict(model, rawLog, error) {
  emitResult({
    runner: RUNNER,
    model,
    status: 'no_verdict',
    verdict: null,
    findings: '',
    raw_log: rawLog,
    error,
  });
  process.exit(1);
}

function parseVerdict(text) {
  const lines = text.split(/\r?\n/);
  const verdictLines = [];
  let findingsIndex = -1;
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^\s*VERDICT:\s*(SHIP-AS-IS|FIX-THEN-SHIP)\s*$/.test(line)) {
      verdictLines.push(line);
      return;
    }
    if (findingsIndex < 0 && /^\s*FINDINGS:/.test(line)) {
      findingsIndex = index;
    }
  });

  let verdict = '';
  if (verdictLines.some((line) => /FIX-THEN-SHIP/i.test(line))) {
    verdict = 'FIX-THEN-SHIP';
  } else if (verdictLines.some((line) => /SHIP-AS-IS/i.test(line))) {
    verdict = 'SHIP-AS-IS';
  }

  const hasFindings = findingsIndex >= 0;
  let findings = 'none';
  if (hasFindings) {
    const first = lines[findingsIndex].replace(/^\s*FINDINGS:\s*/, '').trim();
    const collected = [];
    if (first) {
      collected.push(first);
    }
    let findingsFence = false;
    for (let i = findingsIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        findingsFence = !findingsFence;
        continue;
      }
      if (!findingsFence && /^\s*VERDICT:/.test(line)) break;
      if (line.trim()) collected.push(line.trim());
    }
    findings = collected.length ? collected.join('\n') : 'none';
  }

  return { verdict, findings, hasFindings };
}

function extractResponseText(body) {
  if (typeof body === 'string') {
    return body;
  }
  if (!body || typeof body !== 'object') {
    return '';
  }
  if (typeof body.text === 'string') {
    return body.text;
  }
  if (Array.isArray(body.content)) {
    return body.content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function isTruncatedResponse(body) {
  return !!(body && typeof body === 'object' && body.stop_reason === 'max_tokens');
}

function postMessages({ endpointUrl, token, model, prompt, timeoutMs, rawLog }) {
  const url = new URL(endpointUrl);
  const payload = JSON.stringify({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          authorization: `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          connection: 'close',
        },
      },
      (res) => {
        const chunks = [];
        let responseBytes = 0;
        res.on('data', (chunk) => {
          responseBytes += chunk.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            req.destroy(new Error(`response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          appendRawLog(rawLog, `[http_status=${res.statusCode}]\n`);
          appendRawLog(rawLog, redactForLog(rawBody, token));
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(rawBody);
          } catch (err) {
            reject(new Error(`unparseable JSON response: ${err.message}`));
            return;
          }
          resolve(parsed);
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error('timeout'));
    }, timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on('close', () => clearTimeout(timer));
    req.write(payload);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.error) {
    diePrecondition('', args.error);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const model = args.model;
  if (!model) {
    diePrecondition('', '--model is required');
  }
  const diff = readDiffFile(args.diffFile);
  if (diff.error) {
    diePrecondition(model, diff.error);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    diePrecondition(model, '--timeout-ms must be a positive integer');
  }

  const baseUrl = resolveBaseUrl(args.baseUrl);
  const baseUrlError = validateBaseUrl(baseUrl);
  if (baseUrlError) {
    diePrecondition(model, baseUrlError);
  }
  const { token, error: tokenError } = resolveToken(baseUrl);
  if (!token) {
    diePrecondition(model, tokenError);
  }
  const endpointUrl = resolveEndpointUrl(baseUrl);
  const diffText = diff.text;
  const prompt = buildPrompt(diffText);
  const rawLog = createRawLogPath();

  let responseBody;
  try {
    responseBody = await postMessages({
      endpointUrl,
      token,
      model,
      prompt,
      timeoutMs: args.timeoutMs,
      rawLog,
    });
  } catch (err) {
    const msg = redactForLog(err && err.message ? err.message : String(err), token);
    appendRawLog(rawLog, `\n[dispatch-anthropic-review: request failed — ${msg}]\n`);
    dieNoVerdict(model, rawLog, `request failed: ${msg}`);
  }

  const text = extractResponseText(responseBody);
  if (!text) {
    appendRawLog(rawLog, '\n[dispatch-anthropic-review: empty or unparseable model text]\n');
    dieNoVerdict(model, rawLog, 'empty or unparseable model response text');
  }
  if (isTruncatedResponse(responseBody)) {
    appendRawLog(rawLog, '\n[dispatch-anthropic-review: response stopped at max_tokens]\n');
    dieNoVerdict(model, rawLog, 'response stopped at max_tokens — fail-closed, NOT a pass');
  }

  appendRawLog(rawLog, `\n[extracted_text]\n${redactForLog(text, token)}\n`);
  const { verdict, findings, hasFindings } = parseVerdict(text);
  if (verdict !== 'SHIP-AS-IS' && verdict !== 'FIX-THEN-SHIP') {
    dieNoVerdict(
      model,
      rawLog,
      'no parseable VERDICT line (empty capture or unparseable response) — fail-closed, NOT a pass',
    );
  }
  if (!hasFindings) {
    dieNoVerdict(
      model,
      rawLog,
      'missing parseable FINDINGS line — fail-closed, NOT a pass',
    );
  }

  emitResult({
    runner: RUNNER,
    model,
    status: 'reviewed',
    verdict,
    findings: redactForLog(findings || 'none', token),
    raw_log: rawLog,
    error: null,
  });
  process.exit(0);
}

main().catch((err) => {
  diePrecondition('', err && err.message ? err.message : String(err));
});
