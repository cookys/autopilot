'use strict';

const { normalizeEventName } = require('./events');

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function normalizeClaudeHookEvent(payload = {}, options = {}) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const env = options.env || {};
  const hostEvent = firstString(raw.hook_event_name, options.hookEventName);
  const transcriptPath = firstString(raw.transcript_path, env.CLAUDE_TRANSCRIPT_PATH);

  return {
    schema_version: 1,
    platform: 'claude-code',
    event: normalizeEventName(hostEvent),
    host_event: hostEvent || null,
    ts: firstString(options.nowIso, options.ts) || new Date().toISOString(),
    session_id: firstString(options.sessionId, env.CLAUDE_CODE_SESSION_ID, env.CLAUDE_SESSION_ID, raw.session_id),
    cwd: firstString(options.cwd, raw.cwd),
    source: firstString(raw.source),
    tool: firstString(raw.tool_name),
    tool_input: Object.prototype.hasOwnProperty.call(raw, 'tool_input') ? raw.tool_input : null,
    tool_output: Object.prototype.hasOwnProperty.call(raw, 'tool_output') ? raw.tool_output : null,
    session: {
      transcript_path: transcriptPath,
    },
    raw,
  };
}

module.exports = {
  normalizeClaudeHookEvent,
  normalizeEventName,
};
