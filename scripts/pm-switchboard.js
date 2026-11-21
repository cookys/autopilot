#!/usr/bin/env node
'use strict';

// pm-switchboard.js — 10-minute deterministic batch triage (+ bounded Sonnet residue fallback)
// for the PM inbox.
//
// Side effects are restricted by construction to:
//   - the inbox adapter (mark, wake, accept, getTask),
//   - optional residue-only authoring call via scripts/dispatch-author.sh (claude-native sonnet),
//   - local receipt files and dedupe state.json under $XDG_RUNTIME_DIR/autopilot/pm-switchboard/.
//
// Subcommands:
//   run [--dry-run] [--max-items 200] [--receipt-dir <dir>] [--state-file <path>]
//       [--fallback-model <id>] [--immediate]
//   residue-report [--since 24h] [--receipt-dir <dir>] [--json]
//   fallback-status [--since 24h] [--receipt-dir <dir>] [--json]
//
// Knobs:
//   AUTOPILOT_PM_SWITCHBOARD=off           -> `run` exits 0 doing nothing
//   AUTOPILOT_PM_SWITCHBOARD_FALLBACK=on|off (default on)
//   AUTOPILOT_PM_AUTO_ACCEPT=on|off        (default on; off stops auto-accept -> pending)
//   AUTOPILOT_PM_LEAK_STATUS_FILE=<json>   (4 leak check counts for fallback-status)
//
// Exit codes: 0 ok | 1 runtime error | 2 CLI usage, model refusal, or adapter precondition | 3 waiting on fleet inbox CLI (systemd service uses SuccessExitStatus=3).
// Node built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createAdapter } = require('./lib/pm-inbox-adapter.js');
const { extractItemStatus, evaluateTaskResult } = require('./lib/pm-result-rules.js');
const { isClaudeNativeModel } = require('./lib/seat-model-id.js');
const cnGate = require('./lib/cn-model-dispatch-gate.js');

const RECEIPT_SCHEMA = 'autopilot.pm-switchboard/1';
const STATE_SCHEMA = 'autopilot.pm-switchboard-state/1';
const MAX_PACKET_ITEMS = 5;
const MAX_PACKET_TOKENS = 1500;
const MAX_FALLBACK_INPUT_TOKENS = 30000;
const DEFAULT_FALLBACK_MODEL = 'sonnet';
const ANTHROPIC_FALLBACK_MODEL_RE = /^(?:sonnet|opus|haiku|claude-(?:sonnet|opus|haiku)-[a-z0-9.-]+(?:\[1m\])?)$/;
const DISPATCH_AUTHOR_SH = path.join(__dirname, 'dispatch-author.sh');
const REPO_ROOT = path.resolve(__dirname, '..');
const STATE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const STATE_MAX_KEYS = 2000;
const REOPEN_WINDOW_MS = 24 * 3600 * 1000;
const ONE_HOUR_MS = 3600 * 1000;

const GIT_REPO_ENV_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_SUPER_PREFIX',
  'GIT_INTERNAL_SUPER_PREFIX',
]);

const CREDENTIAL_REDLINE_ZH = Object.freeze(['憑證', '金鑰', '紅線']);
const CREDENTIAL_REDLINE_EN_RE = /\b(?:token|scope)\b/i;
const LEAK_META_KEYS = new Set(['schema', 'at', 'updated_at', 'generated_at', 'since', 'window', 'note']);

function usageError(message) {
  const err = new Error(`pm-switchboard: ${message}`);
  err.exitCode = 2;
  return err;
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/pm-switchboard.js run [--dry-run] [--max-items 200] [--receipt-dir <dir>] [--state-file <path>] [--fallback-model <id>] [--immediate]',
    '  node scripts/pm-switchboard.js residue-report [--since 24h] [--receipt-dir <dir>] [--json]',
    '  node scripts/pm-switchboard.js fallback-status [--since 24h] [--receipt-dir <dir>] [--json]',
  ].join('\n');
}

function parseOnOffKnob(raw, varName, defaultVal = 'on') {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultVal;
  }
  const low = String(raw).trim().toLowerCase();
  if (low === 'on' || low === 'off') return low;
  throw usageError(`${varName} must be "on" or "off" (got "${raw}")`);
}

function assertAnthropicFallbackModel(model, env = process.env) {
  const m = String(model || '').trim();
  if (!m || !ANTHROPIC_FALLBACK_MODEL_RE.test(m) || !isClaudeNativeModel(m)) {
    throw usageError(`refusing non-Anthropic fallback model "${m || '(empty)'}" (only Anthropic models are permitted)`);
  }
  const runnerName = 'claude-native';
  const gateFamily = cnGate.familyOf(runnerName, m, '');
  const gateCheck = cnGate.check({
    runner: runnerName,
    model: m,
    endpoint: '',
    env: {
      ...(env || process.env),
      AUTOPILOT_TEST_CN_GATE_OFF: '0',
    },
    cwd: REPO_ROOT,
  });
  if (gateFamily !== 'anthropic' || cnGate.BARRED_FAMILIES.includes(gateFamily) || !gateCheck.allowed) {
    const detail = gateCheck.line || `family=${gateFamily}`;
    throw usageError(`refusing non-Anthropic fallback model "${m}": ${detail}`);
  }
  return m;
}

function parseRunArgs(argv) {
  const opts = {
    dryRun: false,
    immediate: false,
    maxItems: 200,
    receiptDir: null,
    stateFile: null,
    fallbackModel: DEFAULT_FALLBACK_MODEL,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--immediate') {
      opts.immediate = true;
    } else if (arg === '--max-items') {
      if (i + 1 >= argv.length) throw usageError('--max-items requires a positive integer');
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw usageError(`invalid --max-items "${raw}"`);
      opts.maxItems = n;
    } else if (arg.startsWith('--max-items=')) {
      const raw = arg.slice('--max-items='.length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw usageError(`invalid --max-items "${raw}"`);
      opts.maxItems = n;
    } else if (arg === '--receipt-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--receipt-dir=')) {
      const val = arg.slice('--receipt-dir='.length);
      if (!val) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(val);
    } else if (arg === '--state-file') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--state-file requires a path');
      opts.stateFile = path.resolve(argv[++i]);
    } else if (arg.startsWith('--state-file=')) {
      const val = arg.slice('--state-file='.length);
      if (!val) throw usageError('--state-file requires a path');
      opts.stateFile = path.resolve(val);
    } else if (arg === '--fallback-model') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--fallback-model requires a model id');
      opts.fallbackModel = argv[++i];
    } else if (arg.startsWith('--fallback-model=')) {
      opts.fallbackModel = arg.slice('--fallback-model='.length);
    } else {
      throw usageError(`unknown argument for run: ${arg}`);
    }
  }
  return opts;
}

function parseDurationMs(spec) {
  const raw = String(spec || '').trim();
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(raw);
  if (!m) throw usageError(`invalid duration "${spec}" (expected e.g. 24h, 30m, 7d)`);
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) throw usageError(`invalid duration "${spec}"`);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return Math.round(val * mult);
}

function parseReportArgs(argv, subName = 'residue-report') {
  const opts = {
    since: '24h',
    sinceMs: 24 * 3600 * 1000,
    receiptDir: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--since') {
      if (i + 1 >= argv.length) throw usageError('--since requires a duration');
      opts.since = argv[++i];
      opts.sinceMs = parseDurationMs(opts.since);
    } else if (arg.startsWith('--since=')) {
      opts.since = arg.slice('--since='.length);
      opts.sinceMs = parseDurationMs(opts.since);
    } else if (arg === '--receipt-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--receipt-dir=')) {
      const val = arg.slice('--receipt-dir='.length);
      if (!val) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(val);
    } else if (arg === '--json') {
      opts.json = true;
    } else {
      throw usageError(`unknown argument for ${subName}: ${arg}`);
    }
  }
  return opts;
}

function defaultRuntimeDir(env = process.env) {
  const xdg = env && env.XDG_RUNTIME_DIR;
  if (typeof xdg === 'string' && xdg.trim() !== '' && path.isAbsolute(xdg.trim())) {
    return path.join(xdg.trim(), 'autopilot', 'pm-switchboard');
  }
  return path.join(os.homedir(), '.autopilot', 'pm-switchboard');
}

function resolveReceiptDir(explicitDir, env = process.env) {
  if (explicitDir) return path.resolve(explicitDir);
  return defaultRuntimeDir(env);
}

function resolveStatePath(explicitStateFile, env = process.env) {
  if (explicitStateFile) return path.resolve(explicitStateFile);
  return path.join(defaultRuntimeDir(env), 'state.json');
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 3);
}

function extractItemLane(item) {
  if (item && typeof item.lane === 'string' && item.lane.trim() !== '') {
    return item.lane.trim();
  }
  if (item && typeof item.from === 'string' && item.from.trim() !== '') {
    return item.from.trim().replace(/@.*$/, '');
  }
  return 'unknown';
}

function extractWaitingOnTarget(item) {
  if (item && typeof item.waiting_on === 'string' && item.waiting_on.trim() !== '') {
    return item.waiting_on.trim();
  }
  const content = item && typeof item.content === 'string' ? item.content : '';
  const kv = content.match(/^\s*(?:[-*]\s*)?waiting[_\s-]+on\s*[:=：]\s*(\S+)/im);
  if (kv) return kv[1].trim();
  const bracket = content.match(/\[\s*waiting[_\s-]+on\s*[:=]\s*([^\]]+)\]/i);
  if (bracket) return bracket[1].trim();
  const inline = content.match(/\bwaiting[_\s]+on\s+([A-Za-z0-9_./-]+)\b/i);
  if (inline) return inline[1].trim();
  if (/等待\s*pm\b/i.test(content)) return 'PM';
  return null;
}

function isPmHandle(target, member) {
  if (!target) return false;
  const low = String(target).trim().toLowerCase().replace(/[.,;:!?]+$/, '');
  const tail = low.includes('/') ? low.slice(low.lastIndexOf('/') + 1) : low;
  if (tail === 'pm' || tail.startsWith('pm--')) return true;
  if (member && (low === String(member).toLowerCase() || tail === String(member).toLowerCase())) return true;
  return false;
}

function hasCredentialRedlineMention(content) {
  const text = String(content || '');
  for (const w of CREDENTIAL_REDLINE_ZH) {
    if (text.includes(w)) return true;
  }
  return CREDENTIAL_REDLINE_EN_RE.test(text);
}

function hasQuestionToPm(content) {
  const text = String(content || '');
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, '');
  if (withoutUrls.includes('?') || text.includes('？')) return true;
  if (text.includes('嗎') || text.includes('請裁') || text.includes('要不要')) return true;
  if (/\bgo\?/i.test(text)) return true;
  return false;
}

const COURIER_FROM_RE = /(?:^|\/)courier$/;
const OPERATOR_FROM_RE = /(?:^|\/)operator$/;

// Courier-authored chat (from `*/courier`), classified by id/first-line prefix. Returns
// { disposition, rule } or null when the prefix is unknown (falls through to later rules).
function classifyCourierItem(item) {
  const id = String((item && (item.message_id || item.id)) || '');
  const first = String((item && item.content) || '').split('\n')[0].trim();
  if (/^result-wake-/.test(id) || /^\[fleet result\]/i.test(first)) {
    return { disposition: 'pending_decision', rule: 'courier_result' };
  }
  if (/^\[fleet patrol\][^\n]*\bescalat/i.test(first) || /^\[fleet task [^\]]+\]\s*(?:LOST|STUCK|ESCALAT)/i.test(first)) {
    return { disposition: 'pending_decision', rule: 'courier_patrol_escalation' };
  }
  if (/^\[fleet patrol\]/i.test(first) || /^patrol\b/i.test(first)
    || /^wait[-_]over\b/i.test(id) || /^\[(?:fleet )?wait[-_ ]over\]/i.test(first)
    || /^card[-_]audit\b/i.test(id) || /^\[(?:fleet )?card[-_ ]audit\]/i.test(first)) {
    return { disposition: 'no_action', rule: 'courier_digest' };
  }
  return null;
}

function classifyItem(item, opts = {}) {
  const category = item && typeof item.category === 'string' ? item.category.trim().toLowerCase() : '';
  const kind = item && typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
  const content = item && typeof item.content === 'string' ? item.content : '';
  const status = extractItemStatus(item);
  const waitingTarget = extractWaitingOnTarget(item);
  const member = opts.member || '';

  // 1. operator (batched) / urgent & credential_redline (only rules that wake immediately)
  if (category === 'operator') {
    return { disposition: 'pending_decision', rule: 'operator', failedChecks: [], isResidue: false, immediate: false };
  }
  if (category === 'urgent') {
    return { disposition: 'pending_decision', rule: 'urgent', failedChecks: [], isResidue: false, immediate: true };
  }
  if (category === 'credential_redline' || hasCredentialRedlineMention(content)) {
    return { disposition: 'pending_decision', rule: 'credential_redline', failedChecks: [], isResidue: false, immediate: true };
  }

  // 1b. courier's own messages: known prefixes only; unknown prefixes fall through unchanged
  const from = item && typeof item.from === 'string' ? item.from.trim() : '';
  if (COURIER_FROM_RE.test(from)) {
    const c = classifyCourierItem(item);
    if (c) return { ...c, failedChecks: [], isResidue: false, immediate: false };
  }

  // 2. decision_request, waiting_on PM, declined, failed, question to PM -> batched pending_decision
  if (category === 'decision_request' || kind === 'decision_request') {
    return { disposition: 'pending_decision', rule: 'decision_request', failedChecks: [], isResidue: false, immediate: false };
  }
  if (waitingTarget && isPmHandle(waitingTarget, member)) {
    return { disposition: 'pending_decision', rule: 'waiting_on_pm', failedChecks: [], isResidue: false, immediate: false };
  }
  if (status === 'declined' || kind === 'declined' || /\bdeclined\b/i.test(content)) {
    return { disposition: 'pending_decision', rule: 'declined', failedChecks: [], isResidue: false, immediate: false };
  }
  if (status === 'failed' || kind === 'failed' || /(?<!\b0\s)\bfailed\b/i.test(content)) {
    return { disposition: 'pending_decision', rule: 'failed', failedChecks: [], isResidue: false, immediate: false };
  }
  if (hasQuestionToPm(content)) {
    return { disposition: 'pending_decision', rule: 'question_to_pm', failedChecks: [], isResidue: false, immediate: false };
  }

  // 3. task_result -> rollback knob + 6-check verification via pm-result-rules
  if (category === 'task_result' || kind === 'task_result') {
    if (opts.autoAccept === false) {
      return {
        disposition: 'pending_decision',
        rule: 'auto_accept_disabled',
        failedChecks: ['auto_accept_off'],
        isResidue: false,
        immediate: false,
      };
    }
    const taskId = item && typeof item.task_id === 'string' ? item.task_id.trim() : '';
    const baseRuleOpts = opts.resultRuleOpts || {};
    const task = baseRuleOpts.task !== undefined
      ? baseRuleOpts.task
      : ((typeof opts.getTask === 'function' && taskId) ? opts.getTask(taskId) : null);
    const evalRes = evaluateTaskResult(item, {
      ...baseRuleOpts,
      task,
      taskShowAvailable: opts.canShowTask !== false,
    });
    if (!evalRes.pass) {
      const failedChecks = opts.canAccept === false && !evalRes.failed.includes('accept_unavailable')
        ? [...evalRes.failed, 'accept_unavailable']
        : evalRes.failed;
      return {
        disposition: 'pending_decision',
        rule: 'result_check_failed',
        failedChecks,
        checks: evalRes.checks,
        isResidue: false,
        immediate: false,
      };
    }
    if (opts.canAccept === false) {
      return {
        disposition: 'pending_decision',
        rule: 'result_accept_unavailable',
        failedChecks: ['accept_unavailable'],
        checks: evalRes.checks,
        isResidue: false,
        immediate: false,
      };
    }
    if (!taskId) {
      return {
        disposition: 'pending_decision',
        rule: 'result_check_failed',
        failedChecks: ['missing_task_id'],
        checks: evalRes.checks,
        isResidue: false,
        immediate: false,
      };
    }
    return {
      disposition: 'done',
      rule: 'result_auto_accept',
      failedChecks: [],
      checks: evalRes.checks,
      isResidue: false,
      immediate: false,
    };
  }

  // 4. in_progress progress notes, or waiting on someone other than PM -> no_action
  if (waitingTarget && !isPmHandle(waitingTarget, member)) {
    return { disposition: 'no_action', rule: 'waiting_on_other', failedChecks: [], isResidue: false, immediate: false };
  }
  if (
    status === 'in_progress'
    || kind === 'in_progress'
    || category === 'in_progress'
    || /\[stage:[a-z0-9_/-]+\]/i.test(content)
  ) {
    return { disposition: 'no_action', rule: 'in_progress', failedChecks: [], isResidue: false, immediate: false };
  }

  // 5. ack, auto_merged (`[auto] merged`), fyi=true, patrol_summary, wake-kind -> no_action
  if (category === 'ack' || kind === 'ack') {
    return { disposition: 'no_action', rule: 'ack', failedChecks: [], isResidue: false, immediate: false };
  }
  if (category === 'auto_merged' || content.toLowerCase().includes('[auto] merged')) {
    return { disposition: 'no_action', rule: 'auto_merged', failedChecks: [], isResidue: false, immediate: false };
  }
  if ((item && item.fyi === true) || category === 'fyi') {
    return { disposition: 'no_action', rule: 'fyi', failedChecks: [], isResidue: false, immediate: false };
  }
  if (category === 'patrol_summary' || kind === 'patrol_summary') {
    return { disposition: 'no_action', rule: 'patrol_summary', failedChecks: [], isResidue: false, immediate: false };
  }
  if (kind === 'wake' || category === 'wake') {
    return { disposition: 'no_action', rule: 'wake', failedChecks: [], isResidue: false, immediate: false };
  }

  // 5b. plain chat from a lane (not courier, not operator) with no status header and no fyi
  if (kind === 'chat' && from && !COURIER_FROM_RE.test(from) && !OPERATOR_FROM_RE.test(from) && !status) {
    return { disposition: 'pending_decision', rule: 'lane_chat', failedChecks: [], isResidue: false, immediate: false };
  }

  // 6. anything else -> pending_decision tagged 「未分類」, counted as residue
  return { disposition: 'pending_decision', rule: 'unclassified', failedChecks: [], isResidue: true, immediate: false };
}

function formatFallbackPrompt(itemsForPrompt) {
  return [
    'Engine: sonnet | Role: author | Lane: autopilot | Size: S',
    'Reads-Transcript: yes',
    'Scope: scripts/pm-switchboard.js',
    '',
    'Triage each unclassified PM inbox item below.',
    'Allowed classes ONLY: "pending_decision" or "no_action".',
    'NEVER close ("done") or accept anything; when uncertain choose "pending_decision".',
    'Return STRICT JSON ONLY (no prose, no fences):',
    '[{"message_id":"<id>","class":"pending_decision"|"no_action","reason":"<non-empty reason>"}]',
    '',
    'ITEMS_JSON:',
    JSON.stringify(itemsForPrompt),
  ].join('\n');
}

function projectItemForFallback(item, index) {
  const msgId = String((item && item.message_id) || `residue-${index}`);
  return {
    message_id: msgId,
    from: (item && typeof item.from === 'string') ? item.from : '',
    category: (item && typeof item.category === 'string') ? item.category : '',
    kind: (item && typeof item.kind === 'string') ? item.kind : '',
    task_id: (item && typeof item.task_id === 'string') ? item.task_id : null,
    content: (item && typeof item.content === 'string') ? item.content : '',
  };
}

function fitSingleItemToCap(projected) {
  let prompt = formatFallbackPrompt([projected]);
  if (estimateTokens(prompt) <= MAX_FALLBACK_INPUT_TOKENS) {
    return prompt;
  }
  const emptyPrompt = formatFallbackPrompt([{ ...projected, content: '' }]);
  const maxChars = Math.max(0, (MAX_FALLBACK_INPUT_TOKENS * 3) - emptyPrompt.length - 32);
  let trimmed = projected.content.slice(0, maxChars);
  prompt = formatFallbackPrompt([{ ...projected, content: trimmed }]);
  while (trimmed.length > 0 && estimateTokens(prompt) > MAX_FALLBACK_INPUT_TOKENS) {
    trimmed = trimmed.slice(0, Math.max(0, trimmed.length - 512));
    prompt = formatFallbackPrompt([{ ...projected, content: trimmed }]);
  }
  return prompt;
}

function buildFallbackChunks(residueEntries) {
  const chunks = [];
  let currentEntries = [];
  let currentProjected = [];

  for (let i = 0; i < residueEntries.length; i += 1) {
    const entry = residueEntries[i];
    const proj = projectItemForFallback(entry.item, i + 1);
    if (currentEntries.length === 0) {
      currentEntries = [entry];
      currentProjected = [proj];
      continue;
    }
    const candidateProjected = [...currentProjected, proj];
    const candidatePrompt = formatFallbackPrompt(candidateProjected);
    if (estimateTokens(candidatePrompt) > MAX_FALLBACK_INPUT_TOKENS) {
      chunks.push({
        entries: currentEntries,
        prompt: currentEntries.length === 1
          ? fitSingleItemToCap(currentProjected[0])
          : formatFallbackPrompt(currentProjected),
      });
      currentEntries = [entry];
      currentProjected = [proj];
    } else {
      currentEntries.push(entry);
      currentProjected = candidateProjected;
    }
  }

  if (currentEntries.length > 0) {
    chunks.push({
      entries: currentEntries,
      prompt: currentEntries.length === 1
        ? fitSingleItemToCap(currentProjected[0])
        : formatFallbackPrompt(currentProjected),
    });
  }

  return chunks;
}

function parseLastJsonObject(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (!t.startsWith('{') || !t.endsWith('}')) continue;
    try {
      return JSON.parse(t);
    } catch {
      // continue scanning earlier lines
    }
  }
  const trimmed = String(stdout || '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function parseStrictFallbackVerdicts(rawOutput, expectedIds) {
  const verdicts = new Map();
  const expectedSet = new Set(expectedIds);
  let parsed;
  try {
    parsed = JSON.parse(String(rawOutput || '').trim());
  } catch {
    return verdicts;
  }
  if (!Array.isArray(parsed)) {
    return verdicts;
  }

  const seen = new Set();
  for (const el of parsed) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
    const id = typeof el.message_id === 'string' ? el.message_id.trim() : '';
    if (!id || !expectedSet.has(id)) continue;
    if (seen.has(id)) {
      verdicts.set(id, { disposition: 'pending_decision', reason: '' });
      continue;
    }
    seen.add(id);
    const cls = typeof el.class === 'string' ? el.class.trim() : '';
    const reason = typeof el.reason === 'string' ? el.reason.trim() : '';
    if (cls === 'no_action' && reason !== '') {
      verdicts.set(id, { disposition: 'no_action', reason });
    } else {
      // Model may NEVER close (done) or accept; missing/unknown/done => pending_decision
      verdicts.set(id, { disposition: 'pending_decision', reason });
    }
  }
  return verdicts;
}

function runResidueFallback(residueEntries, model, env = process.env) {
  const chunks = buildFallbackChunks(residueEntries);
  const outcomes = new Map();
  if (chunks.length === 0) {
    return { calls: 0, outcomes };
  }

  const runnerName = 'claude-native';
  let scratchDir;
  try {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-switchboard-'));
    const childTmp = path.join(scratchDir, 'tmp');
    const runsDir = path.join(scratchDir, 'runs');
    const sessionModeDir = path.join(scratchDir, 'session-mode');
    const childCwd = path.join(scratchDir, 'cwd');
    fs.mkdirSync(childTmp, { recursive: true, mode: 0o700 });
    fs.mkdirSync(runsDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(sessionModeDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(childCwd, { recursive: true, mode: 0o700 });

    const childEnv = { ...(env || process.env) };
    delete childEnv.AUTOPILOT_TOKEN_SEAT;
    delete childEnv.AUTOPILOT_SESSION_ID;
    delete childEnv.AUTOPILOT_CHILD_SESSION_ID;
    for (const k of GIT_REPO_ENV_VARS) delete childEnv[k];
    childEnv.TMPDIR = childTmp;
    childEnv.DISPATCH_QUIET = '1';
    childEnv.DISPATCH_DETACH = '0';
    childEnv.AUTOPILOT_DISPATCH_USAGE = 'off';
    childEnv.AUTOPILOT_DISPATCH_MANIFEST = '0';
    childEnv.AUTOPILOT_DISPATCH_RUNS_DIR = runsDir;
    childEnv.AUTOPILOT_SESSION_MODE_DIR = sessionModeDir;
    childEnv.AUTOPILOT_SETTLE_MS = '50';
    childEnv.GIT_CEILING_DIRECTORIES = childEnv.GIT_CEILING_DIRECTORIES
      ? `${childEnv.GIT_CEILING_DIRECTORIES}:${scratchDir}`
      : scratchDir;

    for (let idx = 0; idx < chunks.length; idx += 1) {
      const chunk = chunks[idx];
      const promptPath = path.join(scratchDir, `residue-batch-${idx + 1}.txt`);
      fs.writeFileSync(promptPath, chunk.prompt, { mode: 0o600 });
      const expectedIds = chunk.entries.map((e, j) => String((e.item && e.item.message_id) || `residue-${j + 1}`));

      const authorArgs = [
        DISPATCH_AUTHOR_SH,
        '--runner',
        runnerName,
        '--model',
        model,
        '--effort',
        'default',
        '--timeout',
        '2m',
        '--context-window',
        'off',
        '--prompt-file',
        promptPath,
      ];
      const run = spawnSync('bash', authorArgs, {
        cwd: childCwd,
        env: childEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 140000,
      });

      let chunkVerdicts = new Map();
      if (!run.error && run.status === 0) {
        const resultObj = parseLastJsonObject(run.stdout);
        if (
          resultObj
          && resultObj.status === 'authored'
          && typeof resultObj.raw_log === 'string'
          && fs.existsSync(resultObj.raw_log)
        ) {
          try {
            const body = fs.readFileSync(resultObj.raw_log, 'utf8');
            chunkVerdicts = parseStrictFallbackVerdicts(body, expectedIds);
          } catch {
            chunkVerdicts = new Map();
          }
        }
      }

      for (let j = 0; j < chunk.entries.length; j += 1) {
        const entry = chunk.entries[j];
        const id = expectedIds[j];
        const v = chunkVerdicts.get(id) || { disposition: 'pending_decision', reason: '' };
        outcomes.set(entry, v);
      }
    }
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }

  return { calls: chunks.length, outcomes };
}

function buildSuggestionForRule(rule, failedChecks) {
  switch (rule) {
    case 'operator':
    case 'urgent':
    case 'credential_redline':
      return '優先審閱此高優先／紅線項目並親自裁示';
    case 'result_check_failed':
      return `檢查未通過項目（${failedChecks.join(', ')}），確認補件或退回重修`;
    case 'result_accept_unavailable':
      return '驗收指令未設定，請人工核對工單成果後結案';
    case 'auto_accept_disabled':
      return '自動驗收目前已關閉（AUTOPILOT_PM_AUTO_ACCEPT=off），請人工核對後結案';
    case 'unclassified':
      return '檢視完整原文，判斷需執行動作或以 --no-action 歸檔';
    default:
      return '依工單脈絡裁示下一步，結案後以 pm-inbox-done.js 標記';
  }
}

function buildFactsForPending(entry) {
  const { item, rule, failedChecks, isResidue, fallbackReason } = entry;
  const msgId = String((item && item.message_id) || 'unknown');
  const rawContent = String((item && item.content) || '').trim();

  if (isResidue) {
    const facts = [
      `分類標籤：「未分類」（規則=${rule}，原類別=${(item && item.category) || '無'}） [evidence: ${msgId}]`,
      `完整原文：${rawContent || '（空內容）'} [evidence: ${msgId}]`,
    ];
    if (fallbackReason) {
      facts.push(`輔助判定理由：${fallbackReason} [evidence: ${msgId}]`);
    }
    return facts;
  }

  const facts = [];
  if (failedChecks && failedChecks.length > 0) {
    facts.push(`未通過檢查：${failedChecks.join(', ')} [evidence: ${msgId}]`);
  } else {
    facts.push(`觸發規則=${rule}，來源類別=${(item && item.category) || '無'} [evidence: ${msgId}]`);
  }
  facts.push(`完整原文：${rawContent || '（空內容）'} [evidence: ${msgId}]`);
  return facts;
}

function renderPendingItemBlock(entry, indexOneBased) {
  const { item, rule, failedChecks, isResidue } = entry;
  const msgId = String((item && item.message_id) || `idx-${indexOneBased}`);
  const lane = (item && typeof item.from === 'string' && item.from.trim())
    ? item.from.trim()
    : ((item && typeof item.lane === 'string' && item.lane.trim()) ? item.lane.trim() : '無');
  const taskId = (item && typeof item.task_id === 'string' && item.task_id.trim()) ? item.task_id.trim() : '無';
  const typeLabel = isResidue
    ? `「未分類」 (${rule})`
    : (failedChecks && failedChecks.length > 0 ? `${rule} [${failedChecks.join(', ')}]` : rule);

  const suggestion = buildSuggestionForRule(rule, failedChecks || []);
  const optionsLine = `1) 裁示結案（pm-inbox-done.js ${msgId} --ref <id>）；2) 無需動作（pm-inbox-done.js ${msgId} --no-action <reason>）；3) 續留待決`;
  const factsList = buildFactsForPending(entry);

  // Never cut or truncate item text; oversized items receive their own packet in packBlockTier.
  return [
    `### 項目 ${indexOneBased}`,
    `- 編號：${indexOneBased} (${msgId})`,
    `- lane：${lane}`,
    `- 工單：${taskId}`,
    `- 類型：${typeLabel}`,
    '- 事實：',
    ...factsList.map((f, idx) => `  ${idx + 1}. ${f}`),
    `- 選項：${optionsLine}`,
    `- 建議（「建議，不是決定」）：${suggestion}`,
  ].join('\n');
}

function formatPacket(blocks, packetIndex, totalPackets, kind = 'batch') {
  const title = kind === 'immediate'
    ? 'PM 收件匣緊急立即喚醒包'
    : 'PM 收件匣待裁決批次包';
  const header = `## ${title}（第 ${packetIndex}/${totalPackets} 包，共 ${blocks.length} 筆）`;
  return `${header}\n\n${blocks.join('\n\n')}`;
}

function packBlockTier(renderedBlocks, kind) {
  const groups = [];
  let current = [];

  for (const block of renderedBlocks) {
    const soloProbe = formatPacket([block], 999, 999, kind);
    if (estimateTokens(soloProbe) > MAX_PACKET_TOKENS) {
      if (current.length > 0) {
        groups.push({ kind, blocks: current });
        current = [];
      }
      // Item over 1500 tokens gets its own intact packet (never truncated).
      groups.push({ kind, blocks: [block] });
      continue;
    }

    if (current.length === 0) {
      current.push(block);
      continue;
    }

    const candidate = [...current, block];
    const probeText = formatPacket(candidate, 999, 999, kind);
    if (candidate.length > MAX_PACKET_ITEMS || estimateTokens(probeText) > MAX_PACKET_TOKENS) {
      groups.push({ kind, blocks: current });
      current = [block];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    groups.push({ kind, blocks: current });
  }
  return groups;
}

function buildPackets(pendingEntries) {
  if (!pendingEntries || pendingEntries.length === 0) {
    return [];
  }

  const immediateEntries = pendingEntries.filter((e) => Boolean(e && e.immediate));
  const batchEntries = pendingEntries.filter((e) => !e || !e.immediate);

  let itemIndex = 0;
  const immediateBlocks = immediateEntries.map((entry) => {
    itemIndex += 1;
    return renderPendingItemBlock(entry, itemIndex);
  });
  const batchBlocks = batchEntries.map((entry) => {
    itemIndex += 1;
    return renderPendingItemBlock(entry, itemIndex);
  });

  const allGroups = [
    ...packBlockTier(immediateBlocks, 'immediate'),
    ...packBlockTier(batchBlocks, 'batch'),
  ];

  return allGroups.map((grp, idx) => {
    const text = formatPacket(grp.blocks, idx + 1, allGroups.length, grp.kind);
    return {
      index: idx + 1,
      kind: grp.kind,
      item_count: grp.blocks.length,
      token_estimate: estimateTokens(text),
      text,
    };
  });
}

function mintTimestampStem(dir, now = new Date()) {
  const base = now.toISOString().replace(/[:.]/g, '-');
  let stem = base;
  let seq = 1;
  while (fs.existsSync(path.join(dir, `${stem}.json`))) {
    stem = `${base}-${seq}`;
    seq += 1;
  }
  return stem;
}

function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function pruneTimestampMap(mapObj, nowMs) {
  const entries = Object.entries(mapObj || {})
    .filter(([k, iso]) => {
      if (!k || typeof iso !== 'string') return false;
      const ts = Date.parse(iso);
      return Number.isFinite(ts) && (nowMs - ts) <= STATE_MAX_AGE_MS;
    })
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
  const trimmed = entries.length > STATE_MAX_KEYS
    ? entries.slice(entries.length - STATE_MAX_KEYS)
    : entries;
  return Object.fromEntries(trimmed);
}

function loadState(statePath, nowMs = Date.now()) {
  const empty = {
    schema: STATE_SCHEMA,
    woken_messages: {},
    woken_task_rules: {},
    deferred_batch: [],
  };
  if (!fs.existsSync(statePath)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!raw || typeof raw !== 'object') return empty;
    return {
      schema: STATE_SCHEMA,
      woken_messages: pruneTimestampMap(raw.woken_messages, nowMs),
      woken_task_rules: pruneTimestampMap(raw.woken_task_rules, nowMs),
      deferred_batch: Array.isArray(raw.deferred_batch) ? raw.deferred_batch : [],
    };
  } catch {
    return empty;
  }
}

function saveState(statePath, state, nowMs = Date.now()) {
  const normalized = {
    schema: STATE_SCHEMA,
    updated_at: new Date(nowMs).toISOString(),
    woken_messages: pruneTimestampMap(state.woken_messages, nowMs),
    woken_task_rules: pruneTimestampMap(state.woken_task_rules, nowMs),
    deferred_batch: Array.isArray(state.deferred_batch) ? state.deferred_batch : [],
  };
  writeFileAtomic(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
}

function dedupeKeysForEntry(entry) {
  const item = entry && entry.item;
  const msgId = (item && typeof item.message_id === 'string') ? item.message_id.trim() : '';
  const taskId = (item && typeof item.task_id === 'string') ? item.task_id.trim() : '';
  const rule = (entry && typeof entry.rule === 'string') ? entry.rule.trim() : '';
  return {
    msgKey: msgId || null,
    taskRuleKey: (taskId && rule) ? `${taskId}::${rule}` : null,
  };
}

function isEntryDeduped(entry, wokenMessages, wokenTaskRules) {
  const { msgKey, taskRuleKey } = dedupeKeysForEntry(entry);
  if (msgKey && Object.prototype.hasOwnProperty.call(wokenMessages, msgKey)) return true;
  if (taskRuleKey && Object.prototype.hasOwnProperty.call(wokenTaskRules, taskRuleKey)) return true;
  return false;
}

function recordEntryWoken(entry, wokenMessages, wokenTaskRules, atIso) {
  const { msgKey, taskRuleKey } = dedupeKeysForEntry(entry);
  if (msgKey) wokenMessages[msgKey] = atIso;
  if (taskRuleKey) wokenTaskRules[taskRuleKey] = atIso;
}

function listReceiptsSince(receiptDir, cutoffMs) {
  const out = [];
  if (!fs.existsSync(receiptDir)) return out;
  const names = fs.readdirSync(receiptDir)
    .filter((f) => f.endsWith('.json') && f !== 'state.json' && !f.includes('.tmp.'))
    .sort();
  for (const name of names) {
    const fullPath = path.join(receiptDir, name);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {
      continue;
    }
    if (!doc || doc.schema !== RECEIPT_SCHEMA) continue;
    let ts = Date.parse(doc.at);
    if (!Number.isFinite(ts)) {
      try { ts = fs.statSync(fullPath).mtimeMs; } catch { continue; }
    }
    if (ts < cutoffMs) continue;
    out.push({ ts, doc });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function hasHourlyResidueBurst(receiptDir, nowMs = Date.now()) {
  const allRows = listReceiptsSince(receiptDir, nowMs - REOPEN_WINDOW_MS);
  let startIdx = 0;
  for (let i = allRows.length - 1; i >= 0; i -= 1) {
    if (allRows[i].doc && allRows[i].doc.fallback_reopened === true) {
      startIdx = i + 1;
      break;
    }
  }
  const rows = allRows.slice(startIdx);
  for (let i = 0; i < rows.length; i += 1) {
    const winStart = rows[i].ts;
    let sum = 0;
    for (let j = i; j < rows.length && rows[j].ts < winStart + ONE_HOUR_MS; j += 1) {
      sum += Number(rows[j].doc.residue || 0);
      if (sum > 3) return true;
    }
  }
  return false;
}

function openInboxAdapter(env) {
  try {
    return createAdapter(env);
  } catch (err) {
    if (err && err.code === 'FLEET_REPO_UNSET') {
      const waitErr = new Error('pm-switchboard: waiting_on fleet 01M7R4FA (AUTOPILOT_FLEET_REPO unset)');
      waitErr.exitCode = 3;
      waitErr.code = err.code;
      throw waitErr;
    }
    if (err && err.code === 'FLEET_CLI_MISSING') {
      const missingPath = err.cliPath || '<unknown>';
      const waitErr = new Error(`pm-switchboard: waiting_on fleet 01M7R4FA (inbox CLI missing at ${missingPath})`);
      waitErr.exitCode = 3;
      waitErr.code = err.code;
      throw waitErr;
    }
    throw err;
  }
}

function runSwitchboard(opts, env = process.env) {
  const switchVal = typeof env.AUTOPILOT_PM_SWITCHBOARD === 'string'
    ? env.AUTOPILOT_PM_SWITCHBOARD.trim().toLowerCase()
    : '';
  if (switchVal === 'off') {
    return { killed: true };
  }

  const fallbackModel = assertAnthropicFallbackModel(opts.fallbackModel || DEFAULT_FALLBACK_MODEL, env);
  const fallbackKnob = parseOnOffKnob(env.AUTOPILOT_PM_SWITCHBOARD_FALLBACK, 'AUTOPILOT_PM_SWITCHBOARD_FALLBACK', 'on');
  const autoAcceptKnob = parseOnOffKnob(env.AUTOPILOT_PM_AUTO_ACCEPT, 'AUTOPILOT_PM_AUTO_ACCEPT', 'on');
  const autoAcceptEnabled = autoAcceptKnob === 'on';

  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const receiptDir = resolveReceiptDir(opts.receiptDir, env);
  const statePath = resolveStatePath(opts.stateFile, env);

  const fallbackReopened = fallbackKnob === 'off' && hasHourlyResidueBurst(receiptDir, nowMs);
  const fallbackEnabled = fallbackKnob === 'on' || fallbackReopened;

  const adapter = openInboxAdapter(env);
  const unreadAll = adapter.listUnread();
  const batch = unreadAll.slice(0, opts.maxItems);
  const canAccept = adapter.canAccept();
  const canShowTask = typeof adapter.canShowTask === 'function' ? adapter.canShowTask() : true;

  const initialDecisions = batch.map((item) => ({
    item,
    msgId: String((item && item.message_id) || ''),
    decision: classifyItem(item, {
      member: adapter.member,
      canAccept,
      canShowTask,
      autoAccept: autoAcceptEnabled,
      getTask: (taskId) => adapter.getTask(taskId),
    }),
  }));

  const residueCandidates = initialDecisions.filter((d) => d.decision.isResidue);
  let fallbackCalls = 0;
  let fallbackOutcomes = new Map();
  if (!opts.dryRun && fallbackEnabled && residueCandidates.length > 0) {
    const fbRes = runResidueFallback(residueCandidates, fallbackModel, env);
    fallbackCalls = fbRes.calls;
    fallbackOutcomes = fbRes.outcomes;
  }

  const countsByRule = {};
  const bumpRule = (r) => { countsByRule[r] = (countsByRule[r] || 0) + 1; };
  const decisionRequestByLane = {};

  let accepted = 0;
  let pending = 0;
  let noAction = 0;
  let residue = 0;
  let hiddenPending = 0;

  const state = loadState(statePath, nowMs);
  const wokenMessages = { ...state.woken_messages };
  const wokenTaskRules = { ...state.woken_task_rules };

  const runPendingEntries = [];
  const itemRecords = [];

  for (const row of initialDecisions) {
    const { item, msgId } = row;
    let { decision } = row;
    let fallbackReason = '';

    if (decision.isResidue) {
      residue += 1;
      if (fallbackOutcomes.has(row)) {
        const fb = fallbackOutcomes.get(row);
        fallbackReason = fb.reason || '';
        if (fb.disposition === 'no_action' && fallbackReason) {
          decision = {
            disposition: 'no_action',
            rule: 'fallback_no_action',
            reasonOverride: fallbackReason,
            failedChecks: [],
            isResidue: true,
            immediate: false,
          };
        } else {
          hiddenPending += 1;
        }
      } else if (!opts.dryRun && fallbackEnabled) {
        hiddenPending += 1;
      }
    }

    const rawCat = item && typeof item.category === 'string' ? item.category.trim().toLowerCase() : '';
    const rawKind = item && typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
    if (decision.rule === 'decision_request' || rawCat === 'decision_request' || rawKind === 'decision_request') {
      const laneKey = extractItemLane(item);
      decisionRequestByLane[laneKey] = (decisionRequestByLane[laneKey] || 0) + 1;
    }

    if (decision.disposition === 'done' && decision.rule === 'result_auto_accept') {
      if (!opts.dryRun) {
        try {
          adapter.accept(item.task_id, `result_auto_accept:${msgId}`);
          adapter.mark(msgId, 'done', { ref: msgId, rule: decision.rule });
          accepted += 1;
          bumpRule(decision.rule);
        } catch (err) {
          const fallbackCheck = err && err.code === 'ACCEPT_UNAVAILABLE' ? 'accept_unavailable' : 'accept_failed';
          decision = {
            disposition: 'pending_decision',
            rule: fallbackCheck === 'accept_unavailable' ? 'result_accept_unavailable' : 'result_check_failed',
            failedChecks: [fallbackCheck],
            isResidue: false,
            immediate: false,
          };
        }
      } else {
        accepted += 1;
        bumpRule(decision.rule);
      }
    }

    const record = {
      message_id: msgId,
      rule: decision.rule,
      disposition: decision.disposition,
      failed_checks: decision.failedChecks || [],
      deduped: false,
    };
    itemRecords.push(record);

    if (decision.disposition === 'no_action') {
      const naReason = decision.reasonOverride || decision.rule;
      if (!opts.dryRun) {
        adapter.mark(msgId, 'no_action', { reason: naReason, rule: decision.rule });
      }
      noAction += 1;
      bumpRule(decision.rule);
    } else if (decision.disposition === 'pending_decision') {
      const reasonDetail = decision.failedChecks && decision.failedChecks.length > 0
        ? `${decision.rule}:${decision.failedChecks.join(',')}`
        : (fallbackReason ? `${decision.rule}:${fallbackReason}` : decision.rule);
      if (!opts.dryRun) {
        adapter.mark(msgId, 'pending_decision', {
          reason: reasonDetail,
          rule: decision.rule,
          failed_checks: decision.failedChecks,
        });
      }
      pending += 1;
      bumpRule(decision.rule);
      const pendingEntry = {
        item,
        rule: decision.rule,
        failedChecks: decision.failedChecks || [],
        isResidue: Boolean(decision.isResidue),
        immediate: Boolean(decision.immediate),
        fallbackReason,
        record,
      };
      if (isEntryDeduped(pendingEntry, wokenMessages, wokenTaskRules)) {
        record.deduped = true;
      } else {
        runPendingEntries.push(pendingEntry);
      }
    }
  }

  const wakeEntries = [];
  const nextDeferredBatch = [];

  if (opts.immediate) {
    // Immediate arrival mode: only urgent and credential_redline wake now; batch items wait for 10m tick.
    const deferredSeenMsgs = { ...wokenMessages };
    const deferredSeenTasks = { ...wokenTaskRules };
    for (const prev of state.deferred_batch) {
      if (!isEntryDeduped(prev, deferredSeenMsgs, deferredSeenTasks)) {
        nextDeferredBatch.push(prev);
        recordEntryWoken(prev, deferredSeenMsgs, deferredSeenTasks, nowIso);
      }
    }
    for (const entry of runPendingEntries) {
      if (isEntryDeduped(entry, wokenMessages, wokenTaskRules)) {
        if (entry.record) entry.record.deduped = true;
        continue;
      }
      if (entry.immediate) {
        wakeEntries.push(entry);
        recordEntryWoken(entry, wokenMessages, wokenTaskRules, nowIso);
      } else if (!isEntryDeduped(entry, deferredSeenMsgs, deferredSeenTasks)) {
        nextDeferredBatch.push({
          item: entry.item,
          rule: entry.rule,
          failedChecks: entry.failedChecks,
          isResidue: entry.isResidue,
          immediate: false,
          fallbackReason: entry.fallbackReason,
        });
        recordEntryWoken(entry, deferredSeenMsgs, deferredSeenTasks, nowIso);
      }
    }
  } else {
    // 10-minute batch mode: flush previously deferred batch items plus current run's pending items.
    const deferredMsgIds = new Set(
      state.deferred_batch
        .map((e) => (e && e.item && typeof e.item.message_id === 'string' ? e.item.message_id.trim() : ''))
        .filter(Boolean),
    );
    const candidates = [...state.deferred_batch, ...runPendingEntries];
    for (const entry of candidates) {
      if (isEntryDeduped(entry, wokenMessages, wokenTaskRules)) {
        const entryMsgId = entry && entry.item && typeof entry.item.message_id === 'string'
          ? entry.item.message_id.trim()
          : '';
        if (entry.record && (!entryMsgId || !deferredMsgIds.has(entryMsgId))) {
          entry.record.deduped = true;
        }
        continue;
      }
      wakeEntries.push(entry);
      recordEntryWoken(entry, wokenMessages, wokenTaskRules, nowIso);
    }
  }

  const deduped = itemRecords.filter((r) => r.deduped).length;

  const packets = buildPackets(wakeEntries);
  const immediatePacketCount = packets.filter((p) => p.kind === 'immediate').length;
  const batchPacketCount = packets.filter((p) => p.kind !== 'immediate').length;
  const processed = batch.length;
  const operatorCount = Number(countsByRule.operator || 0);
  const nonOperatorProcessed = Math.max(0, processed - operatorCount);
  const residueRatio = processed === 0 ? 0 : Number((residue / processed).toFixed(6));

  let packetPath = null;
  let woke = false;

  if (!opts.dryRun) {
    fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
    const stem = mintTimestampStem(receiptDir, now);
    if (packets.length > 0) {
      packetPath = path.join(receiptDir, `${stem}.packet.md`);
      const combinedPacketText = `${packets.map((p) => p.text).join('\n\n---\n\n')}\n`;
      writeFileAtomic(packetPath, combinedPacketText);
      adapter.wake(packetPath);
      woke = true;
    }
    saveState(statePath, {
      woken_messages: wokenMessages,
      woken_task_rules: wokenTaskRules,
      deferred_batch: nextDeferredBatch,
    }, nowMs);

    const receiptPath = path.join(receiptDir, `${stem}.json`);
    const receipt = {
      schema: RECEIPT_SCHEMA,
      at: nowIso,
      member: adapter.member,
      adapter: adapter.mode,
      unread_total: unreadAll.length,
      processed,
      non_operator_processed: nonOperatorProcessed,
      counts_by_rule: countsByRule,
      decision_request_by_lane: decisionRequestByLane,
      accepted,
      pending,
      no_action: noAction,
      residue,
      hidden_pending: hiddenPending,
      deduped,
      residue_ratio: residueRatio,
      fallback_enabled: fallbackEnabled,
      fallback_calls: fallbackCalls,
      fallback_reopened: fallbackReopened,
      packets: packets.length,
      immediate_packets: immediatePacketCount,
      batch_packets: batchPacketCount,
      packet_item_counts: packets.map((p) => p.item_count),
      packet_token_estimates: packets.map((p) => p.token_estimate),
      packet_file: packetPath,
      woke,
      immediate_wake: Boolean(woke && immediatePacketCount > 0),
      items: itemRecords,
    };
    writeFileAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { ...receipt, receipt_path: receiptPath };
  }

  return {
    schema: RECEIPT_SCHEMA,
    dry_run: true,
    at: nowIso,
    member: adapter.member,
    adapter: adapter.mode,
    unread_total: unreadAll.length,
    processed,
    non_operator_processed: nonOperatorProcessed,
    counts_by_rule: countsByRule,
    decision_request_by_lane: decisionRequestByLane,
    accepted,
    pending,
    no_action: noAction,
    residue,
    hidden_pending: hiddenPending,
    deduped,
    residue_ratio: residueRatio,
    fallback_enabled: fallbackEnabled,
    fallback_calls: 0,
    fallback_reopened: fallbackReopened,
    packets: packets.length,
    immediate_packets: immediatePacketCount,
    batch_packets: batchPacketCount,
    packet_item_counts: packets.map((p) => p.item_count),
    packet_token_estimates: packets.map((p) => p.token_estimate),
    packet_file: null,
    woke: false,
    immediate_wake: false,
    items: itemRecords,
  };
}

function aggregateReceipts(receiptDir, cutoffMs) {
  let runs = 0;
  let processed = 0;
  let nonOperatorMessages = 0;
  let accepted = 0;
  let pending = 0;
  let noAction = 0;
  let residue = 0;
  let hiddenPending = 0;
  let packets = 0;
  let wakes = 0;
  const countsByRule = {};

  for (const { doc } of listReceiptsSince(receiptDir, cutoffMs)) {
    runs += 1;
    const itemTotal = Number.isFinite(doc.processed)
      ? doc.processed
      : (Number(doc.accepted || 0) + Number(doc.pending || 0) + Number(doc.no_action || 0));
    const opCount = Number((doc.counts_by_rule && doc.counts_by_rule.operator) || 0);
    const nonOp = Number.isFinite(doc.non_operator_processed)
      ? doc.non_operator_processed
      : Math.max(0, itemTotal - opCount);

    processed += itemTotal;
    nonOperatorMessages += nonOp;
    accepted += Number(doc.accepted || 0);
    pending += Number(doc.pending || 0);
    noAction += Number(doc.no_action || 0);
    residue += Number(doc.residue || 0);
    hiddenPending += Number(doc.hidden_pending || 0);
    packets += Number(doc.packets || 0);
    if (doc.woke) wakes += 1;
    if (doc.counts_by_rule && typeof doc.counts_by_rule === 'object') {
      for (const [rule, cnt] of Object.entries(doc.counts_by_rule)) {
        countsByRule[rule] = (countsByRule[rule] || 0) + Number(cnt || 0);
      }
    }
  }

  return {
    runs,
    processed,
    non_operator_messages: nonOperatorMessages,
    accepted,
    pending,
    no_action: noAction,
    residue,
    hidden_pending: hiddenPending,
    packets,
    wakes,
    counts_by_rule: countsByRule,
  };
}

function runResidueReport(opts, env = process.env, nowMs = Date.now()) {
  const receiptDir = resolveReceiptDir(opts.receiptDir, env);
  const agg = aggregateReceipts(receiptDir, nowMs - opts.sinceMs);
  const residueRatio = agg.processed === 0 ? 0 : Number((agg.residue / agg.processed).toFixed(6));

  const summary = {
    schema: RECEIPT_SCHEMA,
    since: opts.since,
    runs: agg.runs,
    processed: agg.processed,
    accepted: agg.accepted,
    pending: agg.pending,
    no_action: agg.no_action,
    residue: agg.residue,
    hidden_pending: agg.hidden_pending,
    residue_ratio: residueRatio,
    packets: agg.packets,
    wakes: agg.wakes,
    counts_by_rule: agg.counts_by_rule,
  };

  if (opts.json) {
    return JSON.stringify(summary);
  }
  return `pm-switchboard residue-report (since=${opts.since}): runs=${agg.runs} processed=${agg.processed} accepted=${agg.accepted} pending=${agg.pending} no_action=${agg.no_action} residue=${agg.residue} residue_ratio=${residueRatio} packets=${agg.packets} wakes=${agg.wakes}`;
}

function readLeakChecksFromFile(env = process.env) {
  const filePath = env && typeof env.AUTOPILOT_PM_LEAK_STATUS_FILE === 'string'
    ? env.AUTOPILOT_PM_LEAK_STATUS_FILE.trim()
    : '';
  if (!filePath) {
    return { status: 'unknown', pass: false, counts: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { status: 'unknown', pass: false, counts: null };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'unknown', pass: false, counts: null };
  }

  let container = parsed;
  if (!Array.isArray(parsed)) {
    for (const nestedKey of ['checks', 'leak_checks', 'leaks', 'counts']) {
      if (parsed[nestedKey] && typeof parsed[nestedKey] === 'object') {
        container = parsed[nestedKey];
        break;
      }
    }
  }

  if (Array.isArray(container)) {
    if (container.length !== 4) {
      return { status: 'unknown', pass: false, counts: null };
    }
    const nums = [];
    for (const el of container) {
      const v = (el && typeof el === 'object')
        ? (el.count !== undefined ? el.count : (el.leaks !== undefined ? el.leaks : el.failures))
        : el;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return { status: 'unknown', pass: false, counts: null };
      }
      nums.push(v);
    }
    const allZero = nums.every((n) => n === 0);
    return {
      status: allZero ? 'ok' : 'nonzero',
      pass: allZero,
      counts: nums,
    };
  }

  const entries = Object.entries(container).filter(([k]) => !LEAK_META_KEYS.has(k));
  if (entries.length !== 4) {
    return { status: 'unknown', pass: false, counts: null };
  }
  const countsMap = {};
  for (const [k, v] of entries) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return { status: 'unknown', pass: false, counts: null };
    }
    countsMap[k] = v;
  }
  const allZero = Object.values(countsMap).every((n) => n === 0);
  return {
    status: allZero ? 'ok' : 'nonzero',
    pass: allZero,
    counts: countsMap,
  };
}

function runFallbackStatus(opts, env = process.env, nowMs = Date.now()) {
  const knob = parseOnOffKnob(env.AUTOPILOT_PM_SWITCHBOARD_FALLBACK, 'AUTOPILOT_PM_SWITCHBOARD_FALLBACK', 'on');
  const receiptDir = resolveReceiptDir(opts.receiptDir, env);
  const agg = aggregateReceipts(receiptDir, nowMs - opts.sinceMs);
  const nonOp = agg.non_operator_messages;
  const nonOpResidueRatio = nonOp === 0 ? 0 : Number((agg.residue / nonOp).toFixed(6));
  const leak = readLeakChecksFromFile(env);

  const conditions = {
    min_non_operator_messages: nonOp >= 500,
    residue_under_2pct: nonOp > 0 && (agg.residue / nonOp) < 0.02,
    hidden_pending_zero: agg.hidden_pending === 0,
    leak_checks_zero: leak.pass === true,
  };
  const retirable = conditions.min_non_operator_messages
    && conditions.residue_under_2pct
    && conditions.hidden_pending_zero
    && conditions.leak_checks_zero;

  const doc = {
    schema: RECEIPT_SCHEMA,
    since: opts.since,
    knob,
    retirable,
    runs: agg.runs,
    processed: agg.processed,
    non_operator_messages: nonOp,
    residue: agg.residue,
    residue_ratio: nonOpResidueRatio,
    hidden_pending: agg.hidden_pending,
    leak_checks: leak.status === 'unknown' ? 'unknown' : leak.counts,
    leak_status: leak.status,
    conditions,
  };

  if (opts.json) {
    return JSON.stringify(doc);
  }
  const leakText = leak.status === 'unknown'
    ? 'unknown'
    : (leak.pass ? '0' : 'nonzero');
  return `pm-switchboard fallback-status (since=${opts.since}): knob=${knob} retirable=${retirable} non_operator_messages=${nonOp} residue=${agg.residue} residue_ratio=${nonOpResidueRatio} hidden_pending=${agg.hidden_pending} leak_checks=${leakText}`;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const sub = argv[0];
  if (!sub || sub === '-h' || sub === '--help') {
    if (!sub) {
      process.stderr.write(`${usageText()}\n`);
      process.exit(2);
    }
    process.stdout.write(`${usageText()}\n`);
    process.exit(0);
  }

  try {
    if (sub === 'run') {
      const opts = parseRunArgs(argv.slice(1));
      const res = runSwitchboard(opts, env);
      if (res.killed) {
        process.exit(0);
      }
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      process.exit(0);
    }
    if (sub === 'residue-report') {
      const opts = parseReportArgs(argv.slice(1), 'residue-report');
      const line = runResidueReport(opts, env);
      process.stdout.write(`${line}\n`);
      process.exit(0);
    }
    if (sub === 'fallback-status') {
      const opts = parseReportArgs(argv.slice(1), 'fallback-status');
      const line = runFallbackStatus(opts, env);
      process.stdout.write(`${line}\n`);
      process.exit(0);
    }
    throw usageError(`unknown subcommand "${sub}"`);
  } catch (err) {
    const code = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(code);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  RECEIPT_SCHEMA,
  STATE_SCHEMA,
  MAX_PACKET_ITEMS,
  MAX_PACKET_TOKENS,
  MAX_FALLBACK_INPUT_TOKENS,
  estimateTokens,
  assertAnthropicFallbackModel,
  classifyItem,
  buildFallbackChunks,
  parseStrictFallbackVerdicts,
  buildPackets,
  runSwitchboard,
  runResidueReport,
  runFallbackStatus,
  resolveReceiptDir,
  resolveStatePath,
};
