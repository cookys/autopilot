'use strict';

const claude = require('./claude');
const codex = require('./codex');
const {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_LINES,
} = require('./common');

const ADAPTERS = new Map([
  ['claude', claude],
  ['codex', codex],
]);

const EVENT_KEYS = [
  'schema_version',
  'harness',
  'session_id',
  'timestamp',
  'event_class',
  'actor',
  'category',
  'signals',
  'tool',
  'usage',
  'cwd',
  'repo_hint',
  'control',
  'evidence',
];
const EVENT_CLASSES = [
  'session',
  'message',
  'tool_call',
  'tool_result',
  'usage',
  'control',
  'lifecycle',
  'state_transition',
];
const CATEGORIES = [
  'session_metadata',
  'user_message',
  'assistant_message',
  'tool_call',
  'tool_result',
  'provider_dispatch',
  'provider_result',
  'controller',
  'worktree_create',
  'worktree_remove',
  'state_transition',
  'usage',
];
const SIGNALS = [
  'transport_failure',
  'user_correction',
  'status_reversal',
  'code_ready',
  'merge_ready',
];
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_SCAN_TIMEOUT_MS = 5000;

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function validateNormalizedEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (Object.keys(event).sort().join('\0') !== [...EVENT_KEYS].sort().join('\0')) return false;
  if (event.schema_version !== 1 || !ADAPTERS.has(event.harness)) return false;
  if (typeof event.session_id !== 'string' || event.session_id.length === 0
      || event.session_id.length > 256) return false;
  if (event.timestamp !== null
      && (typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp)))) {
    return false;
  }
  if (!EVENT_CLASSES.includes(event.event_class) || !CATEGORIES.includes(event.category)) {
    return false;
  }
  if (!['user', 'assistant', 'tool', 'system', null].includes(event.actor)) return false;
  if (!Array.isArray(event.signals)
      || new Set(event.signals).size !== event.signals.length
      || event.signals.some((signal) => !SIGNALS.includes(signal))) return false;
  if (event.tool !== null) {
    if (!hasExactKeys(event.tool, ['name', 'status', 'call_id'])
        || typeof event.tool.name !== 'string' || event.tool.name.length > 256
        || !['requested', 'success', 'failed', 'unknown'].includes(event.tool.status)
        || (event.tool.call_id !== null && typeof event.tool.call_id !== 'string')) return false;
  }
  if (event.usage !== null) {
    if (!hasExactKeys(event.usage, ['input_tokens', 'cached_input_tokens',
      'output_tokens', 'reasoning_tokens', 'total_tokens'])) return false;
    for (const value of Object.values(event.usage)) {
      if (value !== null && (!Number.isInteger(value) || value < 0)) return false;
    }
  }
  if (event.cwd !== null && typeof event.cwd !== 'string') return false;
  if (event.repo_hint !== null && typeof event.repo_hint !== 'string') return false;
  if (event.control !== null) {
    if (!hasExactKeys(event.control, ['dispatch_kind', 'provider', 'ticket_fingerprint',
      'generation', 'lifecycle_fingerprint', 'state', 'owned'])) return false;
    if (event.control.generation !== null
        && (!Number.isInteger(event.control.generation) || event.control.generation < 0)) return false;
    if (![null, 'code_ready', 'merge_ready'].includes(event.control.state)) return false;
    if (![null, true, false].includes(event.control.owned)) return false;
    for (const key of ['dispatch_kind', 'provider', 'ticket_fingerprint',
      'lifecycle_fingerprint']) {
      if (event.control[key] !== null && typeof event.control[key] !== 'string') return false;
    }
  }
  if (!hasExactKeys(event.evidence, ['session_id', 'timestamp', 'event_class', 'line'])
      || event.evidence.session_id !== event.session_id
      || event.evidence.timestamp !== event.timestamp
      || event.evidence.event_class !== event.event_class
      || !Number.isInteger(event.evidence.line) || event.evidence.line < 1) return false;
  const forbidden = ['text', 'message', 'command', 'reasoning', 'prompt', 'output', 'arguments'];
  return !forbidden.some((key) => Object.prototype.hasOwnProperty.call(event, key));
}

function scanTranscriptAdapters(specs, options = {}) {
  const scanOptions = {
    cutoffMs: options.cutoffMs || 0,
    nowMs: options.nowMs || Date.now(),
    maxFiles: options.maxFiles || DEFAULT_MAX_FILES,
    maxFileBytes: options.maxFileBytes || DEFAULT_MAX_FILE_BYTES,
    maxLines: options.maxLines || DEFAULT_MAX_LINES,
  };
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const deadline = Date.now() + (options.scanTimeoutMs || DEFAULT_SCAN_TIMEOUT_MS);
  let consumedBytes = 0;
  return specs.map((spec) => {
    const adapter = ADAPTERS.get(spec.harness);
    if (!adapter) {
      return {
        harness: spec.harness,
        root: spec.root,
        status: 'unsupported',
        candidates: [],
        sessions: [],
        schemaErrors: 0,
        truncated: false,
        unreadable: false,
        budgetExceeded: 0,
        explicitOverride: Boolean(spec.explicitOverride),
      };
    }
    const discovery = adapter.discover(spec.root, scanOptions);
    const sessions = [];
    let schemaErrors = 0;
    let budgetExceeded = 0;
    for (const candidate of discovery.candidates) {
      const boundedBytes = Math.min(candidate.size || 0, scanOptions.maxFileBytes);
      if (Date.now() > deadline || consumedBytes + boundedBytes > maxTotalBytes) {
        budgetExceeded += 1;
        sessions.push({
          ...candidate,
          sessionId: candidate.file,
          events: [],
          parseErrors: 0,
          budgetError: true,
          truncatedBytes: false,
          truncatedLines: false,
        });
        continue;
      }
      consumedBytes += boundedBytes;
      try {
        const parsed = adapter.parse(candidate, scanOptions);
        const validEvents = [];
        for (const event of parsed.events) {
          if (validateNormalizedEvent(event)) validEvents.push(event);
          else schemaErrors += 1;
        }
        sessions.push({ ...parsed, events: validEvents });
      } catch {
        sessions.push({
          ...candidate,
          sessionId: candidate.file,
          events: [],
          parseErrors: 1,
          readError: true,
          truncatedBytes: false,
          truncatedLines: false,
        });
      }
    }
    return {
      harness: spec.harness,
      root: spec.root,
      status: discovery.status,
      candidates: discovery.candidates,
      sessions,
      schemaErrors,
      truncated: discovery.truncated,
      unreadable: Boolean(discovery.unreadable || discovery.status === 'unreadable'),
      budgetExceeded,
      explicitOverride: Boolean(spec.explicitOverride),
    };
  });
}

module.exports = {
  ADAPTERS,
  scanTranscriptAdapters,
  validateNormalizedEvent,
};
