'use strict';

const { normalizeEventName } = require('./events');

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function normalizeCodexHookEvent(payload = {}, options = {}) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const hostEvent = firstString(raw.hook_event_name, raw.hookEventName, raw.event, options.hookEventName);
  const toolName = firstString(raw.tool_name, raw.tool, raw.name);

  return {
    schema_version: 1,
    platform: 'codex',
    event: normalizeEventName(hostEvent),
    host_event: hostEvent || null,
    ts: firstString(options.nowIso, options.ts) || new Date().toISOString(),
    session_id: firstString(raw.session_id),
    cwd: firstString(raw.cwd, options.cwd),
    source: firstString(raw.source),
    model: firstString(raw.model),
    permission_mode: firstString(raw.permission_mode),
    turn_id: firstString(raw.turn_id),
    tool: toolName,
    tool_input: Object.prototype.hasOwnProperty.call(raw, 'tool_input') ? raw.tool_input : null,
    tool_output: Object.prototype.hasOwnProperty.call(raw, 'tool_output') ? raw.tool_output : null,
    session: {
      transcript_path: firstString(raw.transcript_path),
    },
    raw,
  };
}

module.exports = {
  normalizeCodexHookEvent,
};
