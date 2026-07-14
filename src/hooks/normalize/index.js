'use strict';

const { normalizeClaudeHookEvent, normalizeEventName } = require('./claude');
const { normalizeCodexHookEvent } = require('./codex');
const { normalizeOpenCodeToolEvent } = require('./opencode');
const { EVENT_MAP } = require('./events');

module.exports = {
  normalizeClaudeHookEvent,
  normalizeCodexHookEvent,
  normalizeOpenCodeToolEvent,
  EVENT_MAP,
  normalizeEventName,
};
