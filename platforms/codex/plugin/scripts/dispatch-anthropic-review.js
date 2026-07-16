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
//       [--prompt-file <file>] # optional: exact message body to send instead of --diff-file
//       [--raw]               # when present, output raw model response text only
//       [--max-tokens <n>]    # response token cap (default 4096; large authoring
//                             # payloads need more — a truncated response fail-closes)
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
// In --raw mode, outputs ONLY the raw model response text to stdout; NO review JSON.
//
// EXIT: 0 = reviewed ; 1 = no_verdict (HTTP/timeout/unparseable) ; 2 = precondition_failed

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { loadEndpointsEnv } = require(path.join(__dirname, 'lib', 'load-endpoints-env'));

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
  const out = {
    model: '',
    diffFile: '',
    promptFile: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
    baseUrl: '',
    tokenEnv: '',
    raw: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--model':
        out.model = argv[++i] || '';
        break;
      case '--diff-file':
        out.diffFile = argv[++i] || '';
        break;
      case '--prompt-file':
        out.promptFile = argv[++i] || '';
        break;
      case '--timeout-ms':
        out.timeoutMs = Number(argv[++i]);
        break;
      case '--max-tokens':
        out.maxTokens = Number(argv[++i]);
        break;
      case '--base-url':
        out.baseUrl = argv[++i] || '';
        break;
      case '--token-env': {
        // Require a non-empty value: a dangling `--token-env` (no arg) must NOT silently
        // fall back to hostname token resolution — that would be fail-open (gpt-5.5 R3).
        const v = argv[++i];
        if (v === undefined || v === '') {
          return { error: '--token-env requires a non-empty env-var NAME' };
        }
        out.tokenEnv = v;
        break;
      }
      case '--raw':
        out.raw = true;
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

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function resolveToken(baseUrl, tokenEnv) {
  // --token-env <NAME> (from resolve-endpoint.sh): use THAT var INSTEAD OF the
  // hostname fallback. An unset/empty named token is a fail-closed error, NOT a
  // silent drop to MINIMAX_API_KEY/ANTHROPIC_COMPATIBLE_AUTH_TOKEN — that would
  // reintroduce the cross-token collision this design removes (spec R2 F2).
  if (tokenEnv) {
    if (!ENV_NAME_RE.test(tokenEnv)) {
      return { token: '', error: `invalid --token-env name: ${tokenEnv}` };
    }
    const token = process.env[tokenEnv] || '';
    return {
      token,
      error: token ? '' : `missing auth token in env (--token-env ${tokenEnv} is unset/empty)`,
    };
  }

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

function readPromptFile(filePath) {
  if (!filePath) {
    return { error: '--prompt-file is required when --raw is used' };
  }
  try {
    if (!fs.statSync(filePath).isFile()) {
      return { error: '--prompt-file must be a readable regular file' };
    }
    return { text: fs.readFileSync(filePath, 'utf8') };
  } catch (_err) {
    return { error: '--prompt-file is required and must be readable' };
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

function postMessages({ endpointUrl, token, model, prompt, timeoutMs, maxTokens, rawLog }) {
  const url = new URL(endpointUrl);
  const payload = JSON.stringify({
    model,
    max_tokens: maxTokens,
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
        let responseClosed = false;
        const failResponse = (err) => {
          if (responseClosed) return;
          responseClosed = true;
          reject(err);
          req.destroy(err);
        };
        res.on('data', (chunk) => {
          if (responseClosed) return;
          responseBytes += chunk.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            failResponse(new Error(`response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', (err) => {
          failResponse(err);
        });
        res.on('aborted', () => {
          failResponse(new Error('response aborted'));
        });
        res.on('end', () => {
          if (responseClosed) return;
          responseClosed = true;
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

  // Populate endpoint credential env from the canonical ~/.autopilot/endpoints.env before any
  // token/base-url resolution. Best-effort: a rejected/absent file is a no-op and the normal
  // "missing auth token" precondition fires. Usually dispatch-review.sh already loaded these
  // via the shell twin, but direct invocation must honor the same one-credential-home contract.
  loadEndpointsEnv();

  const rawMode = !!args.raw;
  const model = args.model;
  const failPrecondition = (error) => {
    if (rawMode) {
      process.stderr.write(`${error}\n`);
      process.exit(2);
    }
    diePrecondition(model || '', error);
  };
  const failNoVerdict = (rawLog, error) => {
    if (rawMode) {
      appendRawLog(rawLog, `\n[dispatch-anthropic-review: ${error}]\n`);
      process.exit(1);
    }
    dieNoVerdict(model, rawLog, error);
  };

  if (!model) {
    failPrecondition('--model is required');
  }

  if (rawMode && !args.promptFile) {
    failPrecondition('--raw requires --prompt-file');
  }
  // --prompt-file is the transport surface for the shell's nonce-wrapped prompt and is ONLY
  // valid with --raw. Without --raw it would feed an arbitrary prompt to this script's own
  // (echo-prone) parseVerdict — the exact class of gap the nonce protocol closes. Bind the two
  // flags: the only prompt-file path is the raw passthrough; the legacy standalone path stays
  // --diff-file-only. (depth-0 qc, gpt-5.5 anthropic-review MAJOR)
  if (args.promptFile && !rawMode) {
    failPrecondition('--prompt-file requires --raw (the standalone path builds its prompt from --diff-file)');
  }

  let prompt = '';
  if (args.promptFile) {
    const promptFile = readPromptFile(args.promptFile);
    if (promptFile.error) {
      failPrecondition(promptFile.error);
    }
    prompt = promptFile.text;
  } else {
    const diff = readDiffFile(args.diffFile);
    if (diff.error) {
      failPrecondition(diff.error);
    }
    prompt = buildPrompt(diff.text);
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    failPrecondition('--timeout-ms must be a positive integer');
  }
  if (!Number.isInteger(args.maxTokens) || args.maxTokens <= 0 || args.maxTokens > 200000) {
    failPrecondition('--max-tokens must be a positive integer no greater than 200000');
  }

  const baseUrl = resolveBaseUrl(args.baseUrl);
  const baseUrlError = validateBaseUrl(baseUrl);
  if (baseUrlError) {
    failPrecondition(baseUrlError);
  }
  const { token, error: tokenError } = resolveToken(baseUrl, args.tokenEnv);
  if (!token) {
    failPrecondition(tokenError);
  }
  const endpointUrl = resolveEndpointUrl(baseUrl);
  const rawLog = createRawLogPath();

  let responseBody;
  try {
    responseBody = await postMessages({
      endpointUrl,
      token,
      model,
      prompt,
      timeoutMs: args.timeoutMs,
      maxTokens: args.maxTokens,
      rawLog,
    });
  } catch (err) {
    const msg = redactForLog(err && err.message ? err.message : String(err), token);
    appendRawLog(rawLog, `\n[dispatch-anthropic-review: request failed — ${msg}]\n`);
    failNoVerdict(rawLog, `request failed: ${msg}`);
  }

  const text = extractResponseText(responseBody);
  if (!text) {
    appendRawLog(rawLog, '\n[dispatch-anthropic-review: empty or unparseable model text]\n');
    failNoVerdict(rawLog, 'empty or unparseable model response text');
  }
  if (isTruncatedResponse(responseBody)) {
    appendRawLog(rawLog, '\n[dispatch-anthropic-review: response stopped at max_tokens]\n');
    failNoVerdict(rawLog, 'response stopped at max_tokens — fail-closed, NOT a pass');
  }

  appendRawLog(rawLog, `\n[extracted_text]\n${redactForLog(text, token)}\n`);
  if (rawMode) {
    process.stdout.write(text);
    process.exit(0);
  }
  const { verdict, findings, hasFindings } = parseVerdict(text);
  if (verdict !== 'SHIP-AS-IS' && verdict !== 'FIX-THEN-SHIP') {
    failNoVerdict(
      rawLog,
      'no parseable VERDICT line (empty capture or unparseable response) — fail-closed, NOT a pass',
    );
  }
  if (!hasFindings) {
    failNoVerdict(rawLog, 'missing parseable FINDINGS line — fail-closed, NOT a pass');
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
