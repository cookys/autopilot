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

function discover(root, options = {}) {
  const cutoffMs = options.cutoffMs || 0;
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
  if (!root || !fs.existsSync(root)) {
    return { status: 'not_present', root, candidates: [], truncated: false };
  }
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { status: 'unreadable', root, candidates: [], truncated: false };
  }
  const candidates = [];
  let unreadable = false;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.jsonl')) continue;
    const file = path.join(root, entry.name);
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs >= cutoffMs) {
        candidates.push({
          file,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          harness: 'claude',
        });
      }
    } catch {
      unreadable = true;
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return {
    status: 'scanned',
    root,
    candidates: candidates.slice(0, maxFiles),
    truncated: candidates.length > maxFiles,
    unreadable,
  };
}

function eventTimestamp(row) {
  return firstString(
    row.timestamp,
    row.created_at,
    row.message && row.message.timestamp,
  );
}

function eventCwd(row, fallback) {
  return firstString(
    row.cwd,
    row.project_path,
    row.message && row.message.cwd,
    fallback,
  );
}

function eventRepo(row, fallback) {
  return firstString(
    row.repo,
    row.repo_root,
    row.repository,
    fallback,
  );
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

function resultEvent({
  harness,
  sessionId,
  timestamp,
  line,
  cwd,
  repoHint,
  block,
  pending,
}) {
  const rawCallId = firstString(block.tool_use_id, block.call_id, block.id);
  const linked = rawCallId ? pending.get(rawCallId) : null;
  const output = typeof block.content === 'string'
    ? block.content : contentText(block.content);
  const parsed = parseStructuredResult(output);
  const structured = structuredSignals(parsed);
  const explicitFailure = block.is_error === true
    || block.status === 'failed'
    || block.status === 'error';
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
  return baseEvent({
    harness,
    sessionId,
    timestamp,
    eventClass,
    actor: 'tool',
    category,
    signals,
    tool: {
      name: linked ? linked.name : 'unknown',
      status: failed ? 'failed' : (block.status === 'success' ? 'success' : 'unknown'),
      call_id: fingerprint(rawCallId),
    },
    cwd,
    repoHint,
    control: mergeControl(linked && linked.control, structured.control),
    line,
  });
}

function parse(candidate, options = {}) {
  const bounded = boundedJsonl(candidate.file, options);
  const rows = bounded.rows;
  const fallbackId = path.basename(candidate.file, '.jsonl');
  let sessionId = fallbackId;
  let defaultCwd = null;
  let defaultRepo = null;

  for (const { value } of rows) {
    sessionId = firstString(value.sessionId, value.session_id, sessionId) || fallbackId;
    defaultCwd = eventCwd(value, defaultCwd);
    defaultRepo = eventRepo(value, defaultRepo);
  }

  const events = [];
  const pending = new Map();
  let emittedSession = false;
  for (const { line, value } of rows) {
    if (!value || typeof value !== 'object') continue;
    const timestamp = eventTimestamp(value);
    const cwd = eventCwd(value, defaultCwd);
    const repoHint = eventRepo(value, defaultRepo);
    if (!emittedSession && (cwd || repoHint || value.sessionId || value.session_id)) {
      events.push(baseEvent({
        harness: 'claude',
        sessionId,
        timestamp,
        eventClass: 'session',
        actor: 'system',
        category: 'session_metadata',
        cwd,
        repoHint,
        line,
      }));
      emittedSession = true;
    }

    const message = value.message && typeof value.message === 'object' ? value.message : null;
    if (value.type === 'assistant' && message && Array.isArray(message.content)) {
      const assistantText = contentText(
        message.content.filter((item) => item && item.type === 'text'),
      );
      if (assistantText) {
        events.push(baseEvent({
          harness: 'claude',
          sessionId,
          timestamp,
          eventClass: 'message',
          actor: 'assistant',
          category: 'assistant_message',
          cwd,
          repoHint,
          line,
        }));
      }
      for (const block of message.content) {
        if (!block || block.type !== 'tool_use') continue;
        const rawCallId = firstString(block.id, block.call_id);
        const name = firstString(block.name) || 'unknown';
        const command = name === 'Bash'
          ? firstString(block.input && block.input.command) || ''
          : '';
        const classified = classifyCommand(command);
        const eventClass = classified.category.startsWith('worktree_')
          ? 'lifecycle' : 'tool_call';
        const event = baseEvent({
          harness: 'claude',
          sessionId,
          timestamp,
          eventClass,
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
      }
      const usage = usageSummary(message.usage);
      if (usage) {
        events.push(baseEvent({
          harness: 'claude',
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
    } else if (value.type === 'user' && message) {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const text = typeof message.content === 'string'
        ? message.content
        : contentText(blocks.filter((item) => item && item.type === 'text'));
      if (text) {
        events.push(baseEvent({
          harness: 'claude',
          sessionId,
          timestamp,
          eventClass: 'message',
          actor: 'user',
          category: 'user_message',
          signals: heuristicSignals(text),
          cwd,
          repoHint,
          line,
        }));
      }
      for (const block of blocks) {
        if (!block || block.type !== 'tool_result') continue;
        events.push(resultEvent({
          harness: 'claude',
          sessionId,
          timestamp,
          line,
          cwd,
          repoHint,
          block,
          pending,
        }));
      }
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
  harness: 'claude',
  discover,
  parse,
};
