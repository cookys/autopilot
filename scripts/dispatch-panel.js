#!/usr/bin/env node
'use strict';

/*
 * dispatch-panel.js — parallel consultant barrier with fail-closed de-identification.
 *
 * Usage:
 *   node scripts/dispatch-panel.js --prompt-file F --seat <runner>:<model>[:<effort>] ... --out-dir D [--timeout 15m] [--author-cmd <path>]
 *
 * Flow (fail-closed before any disk write or model call):
 *   1. Read F once into memory; empty, binary, or unreadable -> exit 4.
 *   2. Run `fleet directory` (10 s timeout) to collect courier, member, and host names;
 *      non-zero exit, timeout, parse failure, or zero names -> exit 4.
 *   3. Scan in-memory prompt with `ar-redact.js`, `personal-data-redact.js` /
 *      `personal-data-patterns.js` (leak-guard host/LAN/email/home/secret rules), and
 *      the `fleet directory` identifier list; any hit, scanner error, or missing rule
 *      file -> exit 4, print rule ids only, write nothing, run zero seats.
 *   4. Only then: refuse a symlinked D, create or chmod D to 0700, write D/prompt.txt (0600).
 *   5. Per seat: resolve aliases, check `cn-model-dispatch-gate.js` + known runner/model/family;
 *      barred or unknown seats become {status:'barred'} in panel.json and are never spawned.
 *   6. Spawn `dispatch-author.sh` concurrently for allowed seats, each in a fresh empty 0700
 *      temp cwd with §2.5 scrubbed env (ANTHROPIC_BASE_URL, ANTHROPIC_MODEL,
 *      ANTHROPIC_DEFAULT_*, OPENAI_BASE_URL, OPENAI_API_BASE removed); output lands at
 *      D/<i>-<name>.out with <name> reduced to [a-z0-9.-].
 *   7. Wait via `wait-dispatch-results.js`; write D/panel.json (schema autopilot.panel/1);
 *      print one summary line.
 *
 * Test seams:
 *   --author-cmd <path> / AUTOPILOT_DISPATCH_AUTHOR_BIN   override dispatch-author.sh
 *   AUTOPILOT_FLEET_BIN                                   override fleet binary (default: fleet on PATH)
 *   AUTOPILOT_WAIT_RESULTS_BIN                            override wait-dispatch-results.js
 *
 * Exit codes:
 *   0  panel.json written (all seats completed or timed out with complete:false)
 *   2  usage / CLI argument error
 *   4  fail-closed refusal (unreadable/empty prompt, fleet directory failure,
 *      de-identification hit or scanner/rule-file error, or symlinked --out-dir)
 *
 * Node >= 20.10, built-ins only.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { CLAUDE_CLI_ALIASES: SEAT_CLAUDE_ALIASES, isClaudeNativeModel } = require('./lib/seat-model-id');
const NONCQ_POOLS = require('./lib/noncq-pools.json');
const PACE_ROLES = require('./lib/pace-roles.json');

const SELF_DIR = __dirname;
const DEFAULT_TIMEOUT = '15m';
const FLEET_TIMEOUT_MS = 10000;
const EFFORTS = new Set(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
const SUPPORTED_RUNNERS = new Set([
  'codex',
  'agy',
  'grok',
  'kimi',
  'cc-shim',
  'anthropic-compatible',
  'claude-native',
  'cursor',
]);
const RUNNER_ALIASES = Object.freeze({
  'codex-cli': { runner: 'codex' },
  'grok-cli': { runner: 'grok' },
  agyclaude: { runner: 'agy' },
  hydrogen: { runner: 'agy', defaultModel: 'gemini-4-hydrogen-high' },
  carbon: { runner: 'agy', defaultModel: 'gemini-4-carbon-high' },
  glm: { runner: 'cc-shim', endpoint: 'glm' },
  minimax: { runner: 'cc-shim', endpoint: 'minimax' },
  deepseek: { runner: 'anthropic-compatible', endpoint: 'deepseek' },
  qwen_local: { runner: 'cc-shim', endpoint: 'qwen_local' },
});
const MODEL_ALIASES = Object.freeze({
  hydrogen: 'gemini-4-hydrogen-high',
  carbon: 'gemini-4-carbon-high',
  astra: 'gpt-6.2-astra', // rollback: set back to 'gpt-6-astra'
  fable: 'opus',
});
const CLAUDE_CLI_ALIASES = new Set(SEAT_CLAUDE_ALIASES);
const ALLOWED_FAMILIES = new Set(['anthropic', 'openai', 'google', 'xai']);

// No single repo-wide JSON registry lists every non-CN (runner, model) pair:
// scripts/lib/noncq-pools.json + scripts/lib/pace-roles.json cover pace-managed pools,
// scripts/lib/seat-model-id.js owns claude-native, and the entries below cover the remaining
// runner models from project-config-template/review-loop-config.md, check-context-window.js,
// data-class-policy.json, and lib/cursor-model.sh.
const SUPPLEMENTAL_MODELS_BY_RUNNER = Object.freeze({
  codex: [
    'gpt-6.2-astra',
    'gpt-6-astra',
    'gpt-6.1-sol',
    'gpt-6-sol',
    'gpt-6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.5',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ],
  agy: [
    'gemini-4-carbon-high',
    'gemini-4-carbon-medium',
    'gemini-4-carbon-low',
    'gemini-4-hydrogen-high',
    'gemini-4-hydrogen-medium',
    'gemini-4-hydrogen-low',
    'gemini-4-argon-high',
    'gemini-4-argon-medium',
    'gemini-4-argon-low',
    'claude-opus-5-5-medium',
    'claude-opus-5-5-high',
    'claude-opus-5-5-low',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ],
  grok: [
    'grok-4.7',
    'grok-4.6',
    'grok-4.5',
    'grok-build',
    'grok-composer-2.5-fast',
  ],
  cursor: [
    'cursor-grok-4.6-low',
    'cursor-grok-4.6-medium',
    'cursor-grok-4.6-high',
    'cursor-grok-4.6-xhigh',
    'cursor-grok-4.6-low-fast',
    'cursor-grok-4.6-medium-fast',
    'cursor-grok-4.6-high-fast',
    'cursor-grok-4.6-xhigh-fast',
    'gpt-5.3-codex',
    'gpt-5.3-codex-low',
    'gpt-5.3-codex-high',
    'gpt-5.3-codex-xhigh',
    'gpt-5.3-codex-fast',
    'gpt-5.3-codex-low-fast',
    'gpt-5.3-codex-high-fast',
    'gpt-5.3-codex-xhigh-fast',
  ],
});

function buildKnownModelsByRunner() {
  const byRunner = new Map();
  const add = (runner, model) => {
    if (typeof runner !== 'string' || typeof model !== 'string') return;
    const r = runner.trim();
    const m = model.trim().toLowerCase();
    if (!r || !m) return;
    if (!byRunner.has(r)) byRunner.set(r, new Set());
    byRunner.get(r).add(m);
  };

  for (const entry of Object.values(NONCQ_POOLS || {})) {
    if (entry && typeof entry === 'object') add(entry.runner, entry.model);
  }
  for (const entry of Object.values((PACE_ROLES && PACE_ROLES.pools) || {})) {
    if (entry && typeof entry === 'object') add(entry.runner, entry.model);
  }
  for (const entry of ((PACE_ROLES && PACE_ROLES.fallback && PACE_ROLES.fallback.reviewer) || [])) {
    if (entry && typeof entry === 'object') add(entry.runner, entry.model);
  }
  const roleModels = (PACE_ROLES && PACE_ROLES.role_models) || {};
  for (const map of Object.values(roleModels)) {
    if (!map || typeof map !== 'object') continue;
    for (const [key, model] of Object.entries(map)) {
      const pool = Object.values(NONCQ_POOLS || {}).find((p) => p && p.key === key);
      if (pool) add(pool.runner, model);
    }
  }
  for (const [runner, models] of Object.entries(SUPPLEMENTAL_MODELS_BY_RUNNER)) {
    for (const model of models) add(runner, model);
  }
  return byRunner;
}

const KNOWN_MODELS_BY_RUNNER = buildKnownModelsByRunner();

function isKnownModelForRunner(runner, model) {
  if (typeof runner !== 'string' || typeof model !== 'string') return false;
  const norm = model.trim().toLowerCase();
  if (!norm) return false;
  if (runner === 'claude-native') return isClaudeNativeModel(norm);
  const models = KNOWN_MODELS_BY_RUNNER.get(runner);
  return Boolean(models && models.has(norm));
}

function usageText() {
  return 'usage: dispatch-panel.js --prompt-file F --seat <runner>:<model>[:<effort>] ... --out-dir D [--timeout 15m] [--author-cmd <path>]\n';
}

function fail(code, msg) {
  process.stderr.write(`dispatch-panel: ${msg}\n`);
  process.exit(code);
}

function parseTimeout(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d+(?:\.\d+)?)(s|m|h)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || 's').toLowerCase();
  const mult = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  const secs = n * mult;
  const authorStr = m[2] ? `${m[1]}${unit}` : `${m[1]}s`;
  return { secs, authorStr };
}

function parseSeat(spec) {
  if (typeof spec !== 'string' || !spec) return null;
  const parts = spec.split(':');
  if (parts.length < 2) return null;
  const runner = parts[0].trim();
  if (!runner) return null;
  let model = '';
  let effort = '';
  if (parts.length === 2) {
    model = parts[1].trim();
  } else if (parts.length === 3) {
    model = parts[1].trim();
    effort = parts[2].trim();
  } else {
    const last = parts[parts.length - 1].trim();
    if (EFFORTS.has(last)) {
      effort = last;
      model = parts.slice(1, -1).join(':').trim();
    } else {
      model = parts.slice(1).join(':').trim();
    }
  }
  if (!model) return null;
  if (effort && !EFFORTS.has(effort)) return null;
  return { raw: spec, runner, model, effort };
}

function parseArgs(argv) {
  const opts = {
    promptFile: '',
    outDir: '',
    timeout: DEFAULT_TIMEOUT,
    authorCmd: process.env.AUTOPILOT_DISPATCH_AUTHOR_BIN || path.join(SELF_DIR, 'dispatch-author.sh'),
    seats: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(usageText());
      process.exit(0);
    }
    const next = () => {
      if (i + 1 >= argv.length) fail(2, `${a} requires a value`);
      i += 1;
      return argv[i];
    };
    if (a === '--prompt-file') opts.promptFile = next();
    else if (a === '--out-dir') opts.outDir = next();
    else if (a === '--timeout') opts.timeout = next();
    else if (a === '--author-cmd') opts.authorCmd = next();
    else if (a === '--seat') {
      const parsed = parseSeat(next());
      if (!parsed) fail(2, 'invalid --seat format (expected <runner>:<model>[:<effort>])');
      opts.seats.push(parsed);
    } else {
      fail(2, `unknown argument: ${a}`);
    }
  }
  if (!opts.promptFile) fail(2, '--prompt-file is required');
  if (!opts.outDir) fail(2, '--out-dir is required');
  if (opts.seats.length === 0) fail(2, 'at least one --seat is required');
  const parsedTimeout = parseTimeout(opts.timeout);
  if (!parsedTimeout) fail(2, `invalid --timeout value: ${opts.timeout}`);
  opts.timeoutSpec = parsedTimeout;
  return opts;
}

function readPromptOnce(promptFile) {
  let st;
  try {
    st = fs.statSync(promptFile);
  } catch (err) {
    fail(4, `unreadable prompt file (${err.code || err.message})`);
  }
  if (!st.isFile()) fail(4, 'prompt path is not a regular file');
  let buf;
  try {
    buf = fs.readFileSync(promptFile);
  } catch (err) {
    fail(4, `unreadable prompt file (${err.code || err.message})`);
  }
  if (buf.length === 0 || buf.includes(0)) fail(4, 'prompt file is empty or binary');
  const text = buf.toString('utf8');
  if (text.trim().length === 0) fail(4, 'prompt file is empty');
  return text;
}

const DIRECTORY_ID_KEYS = new Set([
  'member', 'courier', 'namespace', 'host', 'hostname', 'name', 'address',
]);
const DIRECTORY_SKIP_KEYS = new Set([
  'labels', 'channels', 'message_kinds', 'state', 'liveness', 'schema',
  'courier_online', 'tasks',
]);
const DIRECTORY_CONTAINER_KEYS = new Set([
  'members', 'couriers', 'hosts', 'entries', 'directory', 'peers', 'nodes',
]);
const DIRECTORY_STRUCTURAL_KEYS = new Set([
  ...DIRECTORY_CONTAINER_KEYS,
  ...DIRECTORY_SKIP_KEYS,
  'info', 'declared', 'observed',
]);

function extractDirectoryIdentifiers(doc) {
  if (doc === null || typeof doc !== 'object') return null;
  const names = new Set();
  const add = (val) => {
    if (typeof val !== 'string') return;
    const s = val.trim();
    if (s.length < 2) return;
    names.add(s);
    const segments = s.split(/[/@]+/);
    if (segments.length > 1) {
      for (const seg of segments) {
        const part = seg.trim();
        if (part.length >= 2) names.add(part);
      }
    }
  };
  const visit = (node, allowStringItems = false) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (allowStringItems && typeof item === 'string') add(item);
        else visit(item);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const lower = k.toLowerCase();
      if (DIRECTORY_SKIP_KEYS.has(lower)) continue;
      if (DIRECTORY_ID_KEYS.has(lower)) {
        if (typeof v === 'string') add(v);
        else if (v && typeof v === 'object') visit(v, true);
        continue;
      }
      if (DIRECTORY_CONTAINER_KEYS.has(lower) && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [mapKey, mapVal] of Object.entries(v)) {
          if (!DIRECTORY_STRUCTURAL_KEYS.has(mapKey.toLowerCase()) && !Array.isArray(mapVal)) {
            add(mapKey);
          }
          if (mapVal && typeof mapVal === 'object') visit(mapVal);
        }
        continue;
      }
      if (v && typeof v === 'object') visit(v, DIRECTORY_CONTAINER_KEYS.has(lower));
    }
  };
  visit(doc, true);
  return [...names];
}

function loadFleetIdentifiers() {
  const fleetBin = process.env.AUTOPILOT_FLEET_BIN || 'fleet';
  let res = spawnSync(fleetBin, ['directory', '--json'], {
    encoding: 'utf8',
    timeout: FLEET_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!res.error && res.status !== 0 && /--json/i.test(res.stderr || '')) {
    res = spawnSync(fleetBin, ['directory'], {
      encoding: 'utf8',
      timeout: FLEET_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  if (res.error) {
    fail(4, `fleet directory failed (${res.error.code || res.error.message})`);
  }
  if (res.status !== 0) {
    fail(4, `fleet directory exited ${res.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(res.stdout || '').trim());
  } catch {
    fail(4, 'fleet directory output is not valid JSON');
  }
  const ids = extractDirectoryIdentifiers(parsed);
  if (!ids || ids.length === 0) {
    fail(4, 'fleet directory returned zero identifiers');
  }
  return ids;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanInMemory(promptText, identifiers) {
  const ruleIds = new Set();
  try {
    const ar = require('./ar-redact');
    const personalRedact = require('./lib/personal-data-redact');
    const patterns = require('./lib/personal-data-patterns');

    const arRes = ar.sanitize([{ text: promptText }], undefined, false);
    if (!arRes || !arRes.counts || typeof arRes.counts !== 'object') {
      throw new Error('ar-redact returned invalid result');
    }
    for (const [k, n] of Object.entries(arRes.counts)) {
      if (n > 0) ruleIds.add(k);
    }

    const prRes = personalRedact.redactText(promptText);
    if (!prRes || !Array.isArray(prRes.hits)) {
      throw new Error('redact-personal returned invalid result');
    }
    for (const h of prRes.hits) {
      if (h && (h.kind || h.category)) ruleIds.add(h.kind || h.category);
    }

    const patternHits = patterns.findAll(promptText);
    if (!Array.isArray(patternHits)) {
      throw new Error('personal-data-patterns returned invalid result');
    }
    for (const h of patternHits) {
      if (h && (h.kind || h.category)) ruleIds.add(h.kind || h.category);
    }
  } catch (err) {
    fail(4, `scanner_error (${err && err.code ? err.code : 'scanner_failed'})`);
  }

  const sortedIds = [...identifiers].sort((a, b) => b.length - a.length);
  for (const id of sortedIds) {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(id)}(?![A-Za-z0-9_])`, 'i');
    if (re.test(promptText)) {
      ruleIds.add('fleet_directory_identifier');
      break;
    }
  }

  if (ruleIds.size > 0) {
    fail(4, `blocked by rules: ${[...ruleIds].sort().join(', ')}`);
  }
}

function prepareOutDirAndPrompt(rawOutDir, promptText) {
  const outDir = path.resolve(rawOutDir);
  let st = null;
  try {
    st = fs.lstatSync(outDir);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') fail(4, `cannot inspect out-dir (${err.code || err.message})`);
  }
  if (st) {
    if (st.isSymbolicLink()) fail(4, 'out-dir must not be a symbolic link');
    if (!st.isDirectory()) fail(4, 'out-dir exists and is not a directory');
    try {
      fs.chmodSync(outDir, 0o700);
    } catch (err) {
      fail(4, `cannot chmod out-dir (${err.code || err.message})`);
    }
  } else {
    try {
      fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(outDir, 0o700);
    } catch (err) {
      fail(4, `cannot create out-dir (${err.code || err.message})`);
    }
  }
  const verify = fs.lstatSync(outDir);
  if (verify.isSymbolicLink() || !verify.isDirectory()) {
    fail(4, 'out-dir is invalid after creation');
  }

  const promptPath = path.join(outDir, 'prompt.txt');
  let pSt = null;
  try {
    pSt = fs.lstatSync(promptPath);
  } catch { /* absent */ }
  if (pSt && pSt.isSymbolicLink()) fail(4, 'prompt.txt must not be a symbolic link');
  fs.writeFileSync(promptPath, promptText, { mode: 0o600 });
  fs.chmodSync(promptPath, 0o600);
  return { outDir, promptPath };
}

function resolveSeat(parsedSeat, promptPath) {
  const cnGate = require('./lib/cn-model-dispatch-gate');
  const rawRunner = parsedSeat.runner;
  const alias = Object.prototype.hasOwnProperty.call(RUNNER_ALIASES, rawRunner.toLowerCase())
    ? RUNNER_ALIASES[rawRunner.toLowerCase()]
    : null;
  const runner = alias ? alias.runner : rawRunner;
  const endpoint = alias && alias.endpoint ? alias.endpoint : '';
  const rawModel = parsedSeat.model;
  const modelAlias = MODEL_ALIASES[rawModel.toLowerCase()];
  const model = modelAlias || rawModel;

  if (!SUPPORTED_RUNNERS.has(runner)) {
    return { allowed: false, runner, model, endpoint, effort: parsedSeat.effort, reason: 'unknown_runner' };
  }

  let family = cnGate.familyOf(runner, model, endpoint);
  if (family === 'unknown' && runner === 'claude-native' && CLAUDE_CLI_ALIASES.has(model.toLowerCase())) {
    family = 'anthropic';
  }

  let gateRes;
  try {
    const gateEnv = { ...process.env, AUTOPILOT_TASK_READS_TRANSCRIPT: '1' };
    delete gateEnv.AUTOPILOT_TEST_CN_GATE_OFF;
    gateRes = cnGate.check({
      runner,
      model,
      endpoint,
      role: 'consult',
      files: [promptPath],
      env: gateEnv,
      cwd: process.cwd(),
    });
  } catch {
    return { allowed: false, runner, model, endpoint, effort: parsedSeat.effort, reason: 'cn_gate_error' };
  }

  if (!gateRes || !gateRes.allowed) {
    return {
      allowed: false,
      runner,
      model,
      endpoint,
      effort: parsedSeat.effort,
      reason: (gateRes && gateRes.cls) || 'barred',
    };
  }
  if (!ALLOWED_FAMILIES.has(family)) {
    return { allowed: false, runner, model, endpoint, effort: parsedSeat.effort, reason: 'unknown_or_barred_family' };
  }
  if (!isKnownModelForRunner(runner, model)) {
    return { allowed: false, runner, model, endpoint, effort: parsedSeat.effort, reason: 'unknown_model' };
  }
  return { allowed: true, runner, model, endpoint, effort: parsedSeat.effort, family };
}

function sanitizeOutName(model) {
  const reduced = String(model || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '');
  return reduced || 'seat';
}

function safeOutPath(outDir, index, model) {
  const fileName = `${index}-${sanitizeOutName(model)}.out`;
  const target = path.resolve(outDir, fileName);
  const rel = path.relative(outDir, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    fail(4, 'output path escaped out-dir');
  }
  return target;
}

function buildChildEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_MODEL;
  delete env.OPENAI_BASE_URL;
  delete env.OPENAI_API_BASE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('ANTHROPIC_DEFAULT_')) delete env[key];
  }
  return env;
}

function writeAtomic(filePath, content, mode = 0o600) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, content, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
}

function extractSeatOutput(stdoutBuf) {
  const text = stdoutBuf.toString('utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let obj = null;
    let isJson = false;
    try {
      obj = JSON.parse(trimmed);
      isJson = true;
    } catch {
      isJson = false;
    }
    if (isJson && obj && typeof obj === 'object' && typeof obj.status === 'string'
        && (Object.prototype.hasOwnProperty.call(obj, 'raw_log') || obj.status === 'authored')) {
      if (obj.status !== 'authored') return { envelopeOk: false, bytesBuf: Buffer.alloc(0) };
      if (typeof obj.raw_log !== 'string' || obj.raw_log.trim() === '') {
        return { envelopeOk: false, bytesBuf: Buffer.alloc(0) };
      }
      try {
        const st = fs.statSync(obj.raw_log);
        if (!st.isFile()) return { envelopeOk: false, bytesBuf: Buffer.alloc(0) };
        const bytesBuf = fs.readFileSync(obj.raw_log);
        if (!bytesBuf || bytesBuf.length === 0) return { envelopeOk: false, bytesBuf: Buffer.alloc(0) };
        return { envelopeOk: true, bytesBuf };
      } catch {
        return { envelopeOk: false, bytesBuf: Buffer.alloc(0) };
      }
    }
  }
  return { envelopeOk: true, bytesBuf: stdoutBuf };
}

function spawnWaitResults(waitBin, resultsDir, expectKeys, timeoutSecs) {
  return new Promise((resolve, reject) => {
    const args = [waitBin, '--results-dir', resultsDir, '--timeout', String(timeoutSecs), '--poll', '0.1', '--json'];
    for (const k of expectKeys) args.push('--expect', k);
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (code !== 0 && code !== 1) {
        reject(new Error(`wait-dispatch-results exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`wait-dispatch-results invalid JSON: ${err.message}`));
      }
    });
  });
}

async function runPanel(opts, outDir, promptPath) {
  const waitBin = process.env.AUTOPILOT_WAIT_RESULTS_BIN || path.join(SELF_DIR, 'wait-dispatch-results.js');
  let resultsDir;
  const runId = `panel-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

  const tempDirs = new Set();
  const activeChildren = new Map();
  const timedOutKeys = new Set();
  let cleaned = false;

  const killChildTree = (child, sig) => {
    if (!child || !child.pid) return;
    try { process.kill(-child.pid, sig); } catch { /* not group leader or gone */ }
    try { child.kill(sig); } catch { /* already gone */ }
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const child of activeChildren.values()) {
      killChildTree(child, 'SIGKILL');
    }
    activeChildren.clear();
    for (const d of tempDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };

  const onSig = (sig) => {
    cleanup();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  process.once('exit', cleanup);
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);

  try {
    resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-panel-res-'));
    tempDirs.add(resultsDir);
    fs.chmodSync(resultsDir, 0o700);
    const resolvedSeats = opts.seats.map((s) => ({
      parsed: s,
      resolved: resolveSeat(s, promptPath),
    }));

    const childEnv = buildChildEnv();
    const expectKeys = [];
    const seatKeyMap = new Map();
    const seatMeta = [];

    for (let i = 0; i < resolvedSeats.length; i += 1) {
      const { parsed, resolved } = resolvedSeats[i];
      if (!resolved.allowed) {
        seatMeta.push({
          index: i,
          barred: true,
          record: {
            seat: parsed.raw,
            status: 'barred',
            rc: null,
            out_path: null,
            bytes: 0,
          },
        });
        continue;
      }

      const stage = `seat-${i}`;
      const expectKey = `${runId}.${stage}`;
      expectKeys.push(expectKey);

      let seatCwd;
      try {
        seatCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-panel-cwd-'));
        fs.chmodSync(seatCwd, 0o700);
        tempDirs.add(seatCwd);
      } finally {
        // Registered directories stay alive until the panel barrier's cleanup.
        if (seatCwd && !tempDirs.has(seatCwd)) {
          fs.rmSync(seatCwd, { recursive: true, force: true });
        }
      }

      const outPath = safeOutPath(outDir, i, resolved.model);
      const args = [
        '--runner', resolved.runner,
        '--model', resolved.model,
        '--prompt-file', promptPath,
        '--timeout', opts.timeoutSpec.authorStr,
      ];
      if (resolved.effort) args.push('--effort', resolved.effort);
      if (resolved.endpoint) args.push('--endpoint', resolved.endpoint);

      const child = spawn(opts.authorCmd, args, {
        cwd: seatCwd,
        env: childEnv,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      activeChildren.set(expectKey, child);
      seatKeyMap.set(expectKey, { index: i, seat: parsed.raw, outPath });
      seatMeta.push({ index: i, barred: false, expectKey, seat: parsed.raw });

      const outChunks = [];
      child.stdout.on('data', (d) => outChunks.push(d));
      child.stderr.on('data', () => { /* drain */ });

      let settled = false;
      const finishSeat = (code) => {
        if (settled) return;
        settled = true;
        activeChildren.delete(expectKey);
        if (cleaned || timedOutKeys.has(expectKey)) return;
        const rc = typeof code === 'number' ? code : 1;
        const { envelopeOk, bytesBuf } = extractSeatOutput(Buffer.concat(outChunks));
        const ok = rc === 0 && envelopeOk;
        let finalOutPath = null;
        let finalBytes = 0;
        if (ok) {
          writeAtomic(outPath, bytesBuf, 0o600);
          finalOutPath = outPath;
          finalBytes = bytesBuf.length;
        }
        const record = {
          seat: parsed.raw,
          status: ok ? 'ok' : 'failed',
          rc,
          out_path: finalOutPath,
          bytes: finalBytes,
        };
        const resultFile = path.join(resultsDir, `${expectKey}.result.json`);
        const exitFile = path.join(resultsDir, `${expectKey}.exit`);
        writeAtomic(resultFile, JSON.stringify(record) + '\n', 0o600);
        writeAtomic(exitFile, String(rc), 0o600);
      };

      child.on('error', () => finishSeat(1));
      child.on('close', (code) => finishSeat(code));
    }

    let waitResult = { complete: true, done: [], missing: [] };
    if (expectKeys.length > 0) {
      waitResult = await spawnWaitResults(waitBin, resultsDir, expectKeys, opts.timeoutSpec.secs);
    }

    const missingSet = new Set(Array.isArray(waitResult.missing) ? waitResult.missing : []);
    for (const key of missingSet) {
      timedOutKeys.add(key);
      const child = activeChildren.get(key);
      if (child) {
        killChildTree(child, 'SIGTERM');
        setTimeout(() => killChildTree(child, 'SIGKILL'), 200).unref();
      }
    }

    const finalSeats = seatMeta.map((m) => {
      if (m.barred) return m.record;
      if (missingSet.has(m.expectKey)) {
        return {
          seat: m.seat,
          status: 'timeout',
          rc: null,
          out_path: null,
          bytes: 0,
        };
      }
      const rf = path.join(resultsDir, `${m.expectKey}.result.json`);
      return JSON.parse(fs.readFileSync(rf, 'utf8'));
    });

    const complete = Boolean(waitResult.complete);
    const panelDoc = {
      schema: 'autopilot.panel/1',
      seats: finalSeats,
      complete,
    };
    const panelPath = path.join(outDir, 'panel.json');
    writeAtomic(panelPath, JSON.stringify(panelDoc, null, 2) + '\n', 0o600);

    const counts = { ok: 0, failed: 0, timeout: 0, barred: 0 };
    for (const s of finalSeats) counts[s.status] = (counts[s.status] || 0) + 1;
    process.stdout.write(
      `panel: ${counts.ok}/${finalSeats.length} ok, ${counts.failed} failed, ${counts.timeout} timeout, ${counts.barred} barred, complete=${complete} -> ${panelPath}\n`,
    );
  } finally {
    process.removeListener('exit', cleanup);
    process.removeListener('SIGINT', onSig);
    process.removeListener('SIGTERM', onSig);
    cleanup();
    if (resultsDir) fs.rmSync(resultsDir, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const promptText = readPromptOnce(opts.promptFile);
  const identifiers = loadFleetIdentifiers();
  scanInMemory(promptText, identifiers);
  const { outDir, promptPath } = prepareOutDirAndPrompt(opts.outDir, promptText);
  await runPanel(opts, outDir, promptPath);
}

if (require.main === module) {
  main().catch((err) => {
    fail(4, err && err.message ? err.message : String(err));
  });
}

module.exports = {
  resolveSeat,
  sanitizeOutName,
  safeOutPath,
  isKnownModelForRunner,
  extractDirectoryIdentifiers,
  extractSeatOutput,
};
