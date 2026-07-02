'use strict';

const EVENT_MAP = Object.freeze({
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PermissionRequest: 'permission_request',
  PostToolUse: 'post_tool_use',
  PostToolUseFailure: 'post_tool_use_failure',
  PreCompact: 'pre_compact',
  PostCompact: 'post_compact',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
  Stop: 'stop',
});
const NORMALIZED_EVENTS = Object.freeze(new Set(Object.values(EVENT_MAP)));

function normalizeEventName(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  if (EVENT_MAP[name]) return EVENT_MAP[name];
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return NORMALIZED_EVENTS.has(normalized) ? normalized : 'unknown';
}

module.exports = {
  EVENT_MAP,
  NORMALIZED_EVENTS,
  normalizeEventName,
};
