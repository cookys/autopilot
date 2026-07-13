'use strict';

function normalizeOpenCodeToolEvent(event) {
  const input = event && typeof event === 'object' ? event : {};
  return {
    platform: 'opencode',
    event: 'post_tool_use',
    cwd: process.cwd(),
    tool: typeof input.tool === 'string' ? input.tool : '<unknown>',
    tool_input: input.input && typeof input.input === 'object' ? input.input : {},
    tool_output: input.output ?? input.result ?? null,
    session: {
      id: typeof input.sessionID === 'string' ? input.sessionID : null,
      source: 'unknown',
    },
    raw: input,
  };
}

module.exports = {
  normalizeOpenCodeToolEvent,
};
