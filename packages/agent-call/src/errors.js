'use strict';

class AgentCallError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AgentCallError';
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? null;
  }
}

function asAgentCallError(error, fallbackCode = 'agent_call_failed') {
  if (error instanceof AgentCallError) return error;
  return new AgentCallError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

module.exports = { AgentCallError, asAgentCallError };
