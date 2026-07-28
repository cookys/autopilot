'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_MAX_FILES,
  baseEvent,
  boundedJsonl,
  classifyCommand,
  contentText,
  fingerprint,
  firstString,
  heuristicSignals,
  parseStructuredResult,
  structuredSignals,
  usageSummary,
} = require('./common');

function utcDateParts(ms) {
  const date = new Date(ms);
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ];
}

function dateDirectories(root, cutoffMs, nowMs) {
  const result = [];
  const dayMs = 86400 * 1000;
  const start = Date.UTC(...utcDateParts(cutoffMs).map((value, index) => (
    index === 1 ? Number(value) - 1 : Number(value)
  )));
  const end = Date.UTC(...utcDateParts(nowMs).map((value, index) => (
    index === 1 ? Number(value) - 1 : Number(value)
  )));
  for (let current = start; current <= end; current += dayMs) {
    result.push(path.join(root, ...utcDateParts(current)));
  }
  return result;
}

function discover(root, options = {}) {
  const cutoffMs = options.cutoffMs || 0;
  const nowMs = options.nowMs || Date.now();
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
  if (!root || !fs.existsSync(root)) {
    return { status: 'not_present', root, candidates: [], truncated: false };
  }
  const candidates = [];
  let unreadable = false;
  for (const directory of dateDirectories(root, cutoffMs, nowMs)) {
    if (!fs.existsSync(directory)) continue;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      unreadable = true;
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(directory, entry.name);
      try {
        const stat = fs.statSync(file);
        candidates.push({
          file,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          harness: 'codex',
        });
      } catch {
        unreadable = true;
      }
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return {
    status: unreadable && candidates.length === 0 ? 'unreadable' : 'scanned',
    root,
    candidates: candidates.slice(0, maxFiles),
    truncated: candidates.length > maxFiles,
    unreadable,
  };
}

function eventTimestamp(row) {
  return firstString(row.timestamp, row.created_at, row.payload && row.payload.timestamp);
}

function extractCommand(payload) {
  const args = payload.arguments;
  if (typeof args === 'object' && args !== null) {
    return firstString(args.cmd, args.command) || '';
  }
  if (typeof args !== 'string') return '';
  const parsed = parseStructuredResult(args);
  if (parsed && typeof parsed === 'object') {
    return firstString(parsed.cmd, parsed.command) || '';
  }
  return payload.name === 'exec_command' ? args : '';
}

function mergeControl(primary, secondary) {
  const left = primary || {};
  const right = secondary || {};
  return {
    dispatch_kind: left.dispatch_kind || right.dispatch_kind || null,
    provider: left.provider || right.provider || null,
    ticket_fingerprint: left.ticket_fingerprint || right.ticket_fingerprint || null,
    generation: left.generation === null || left.generation === undefined
      ? (right.generation === undefined ? null : right.generation)
      : left.generation,
    lifecycle_fingerprint: left.lifecycle_fingerprint || right.lifecycle_fingerprint || null,
    state: left.state || right.state || null,
    owned: left.owned === null || left.owned === undefined
      ? (right.owned === undefined ? null : right.owned)
      : left.owned,
  };
}

function parse(candidate, options = {}) {
  const bounded = boundedJsonl(candidate.file, options);
  const rows = bounded.rows;
  const fallbackId = path.basename(candidate.file, '.jsonl');
  let sessionId = fallbackId;
  let defaultCwd = null;
  let defaultRepo = null;

  for (const { value } of rows) {
    const payload = value && value.payload && typeof value.payload === 'object'
      ? value.payload : {};
    if (value && value.type === 'session_meta') {
      sessionId = firstString(payload.id, payload.session_id, sessionId) || fallbackId;
    }
    defaultCwd = firstString(payload.cwd, value && value.cwd, defaultCwd);
    defaultRepo = firstString(payload.repo, payload.repo_root, value && value.repo, defaultRepo);
  }

  const events = [];
  const pending = new Map();
  for (const { line, value } of rows) {
    if (!value || typeof value !== 'object') continue;
    const payload = value.payload && typeof value.payload === 'object' ? value.payload : {};
    const timestamp = eventTimestamp(value);
    const cwd = firstString(payload.cwd, value.cwd, defaultCwd);
    const repoHint = firstString(payload.repo, payload.repo_root, value.repo, defaultRepo);

    if (value.type === 'session_meta' || value.type === 'turn_context') {
      events.push(baseEvent({
        harness: 'codex',
        sessionId,
        timestamp,
        eventClass: 'session',
        actor: 'system',
        category: 'session_metadata',
        cwd,
        repoHint,
        line,
      }));
      continue;
    }

    if (value.type === 'event_msg' && payload.type === 'token_count') {
      const usage = usageSummary(payload.info);
      if (usage) {
        events.push(baseEvent({
          harness: 'codex',
          sessionId,
          timestamp,
          eventClass: 'usage',
          actor: 'assistant',
          category: 'usage',
          usage,
          cwd,
          repoHint,
          line,
        }));
      }
      continue;
    }

    if (value.type !== 'response_item') continue;
    if (payload.type === 'reasoning') continue;

    if (payload.type === 'message') {
      const actor = payload.role === 'user'
        ? 'user' : (payload.role === 'assistant' ? 'assistant' : 'system');
      if (actor === 'system') continue;
      const text = contentText(payload.content);
      events.push(baseEvent({
        harness: 'codex',
        sessionId,
        timestamp,
        eventClass: 'message',
        actor,
        category: actor === 'user' ? 'user_message' : 'assistant_message',
        signals: actor === 'user' ? heuristicSignals(text) : [],
        cwd,
        repoHint,
        line,
      }));
      continue;
    }

    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const rawCallId = firstString(payload.call_id, payload.id);
      const name = firstString(payload.name) || 'unknown';
      const classified = classifyCommand(extractCommand(payload));
      const event = baseEvent({
        harness: 'codex',
        sessionId,
        timestamp,
        eventClass: classified.category.startsWith('worktree_') ? 'lifecycle' : 'tool_call',
        actor: 'assistant',
        category: classified.category,
        tool: {
          name,
          status: 'requested',
          call_id: fingerprint(rawCallId),
        },
        cwd,
        repoHint,
        control: classified.control,
        line,
      });
      events.push(event);
      if (rawCallId) {
        pending.set(rawCallId, {
          name,
          category: classified.category,
          control: classified.control,
        });
      }
      continue;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const rawCallId = firstString(payload.call_id, payload.id);
      const linked = rawCallId ? pending.get(rawCallId) : null;
      const output = typeof payload.output === 'string'
        ? payload.output : JSON.stringify(payload.output || {});
      const structured = structuredSignals(parseStructuredResult(output));
      const explicitFailure = payload.status === 'failed' || payload.status === 'error';
      const failed = explicitFailure
        || structured.nonzeroExitCode
        || structured.signals.includes('transport_failure');
      const signals = [...structured.signals];
      if (failed && linked && linked.category === 'provider_dispatch'
          && !signals.includes('transport_failure')) {
        signals.push('transport_failure');
      }
      const stateSignal = signals.find((item) => item === 'code_ready' || item === 'merge_ready');
      const category = stateSignal
        ? 'state_transition'
        : (structured.lifecycleCategory
          || (linked && linked.category === 'provider_dispatch' ? 'provider_result' : 'tool_result'));
      const eventClass = stateSignal
        ? 'state_transition' : (structured.lifecycleCategory ? 'lifecycle' : 'tool_result');
      events.push(baseEvent({
        harness: 'codex',
        sessionId,
        timestamp,
        eventClass,
        actor: 'tool',
        category,
        signals,
        tool: {
          name: linked ? linked.name : 'unknown',
          status: failed ? 'failed' : (payload.status === 'success' ? 'success' : 'unknown'),
          call_id: fingerprint(rawCallId),
        },
        cwd,
        repoHint,
        control: mergeControl(linked && linked.control, structured.control),
        line,
      }));
    }
  }

  return {
    ...candidate,
    sessionId,
    events,
    parseErrors: bounded.parseErrors,
    truncatedBytes: bounded.truncatedBytes,
    truncatedLines: bounded.truncatedLines,
  };
}

module.exports = {
  harness: 'codex',
  discover,
  parse,
};
