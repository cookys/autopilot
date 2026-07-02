'use strict';

const { normalizeClaudeHookEvent, normalizeEventName } = require('./claude');
const { normalizeCodexHookEvent } = require('./codex');
const { EVENT_MAP } = require('./events');

module.exports = {
  normalizeClaudeHookEvent,
  normalizeCodexHookEvent,
  EVENT_MAP,
  normalizeEventName,
};
