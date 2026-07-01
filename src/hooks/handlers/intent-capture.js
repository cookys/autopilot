'use strict';

function buildIntentCaptureRecord({
  event,
  fallbackSessionId,
  hostname,
  nowIso,
  toolCount,
  gitBranch,
  summarizeToolInput,
}) {
  const normalized = event && typeof event === 'object' ? event : {};
  const toolName = normalized.tool || '<unknown>';
  const toolInput = normalized.tool_input === null || normalized.tool_input === undefined
    ? {}
    : normalized.tool_input;

  return {
    session_id: normalized.session_id || fallbackSessionId || null,
    hostname,
    last_updated: nowIso,
    last_tool: toolName,
    last_tool_source: normalized.input_source || 'stdin',
    last_tool_input_summary: summarizeToolInput(toolName, toolInput),
    tool_count_session: toolCount,
    cwd: normalized.cwd,
    git_branch: gitBranch,
  };
}

module.exports = {
  buildIntentCaptureRecord,
};
