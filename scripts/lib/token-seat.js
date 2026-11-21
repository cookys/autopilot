'use strict';
/**
 * token-seat.js — declared token seats (AUTOPILOT_TOKEN_SEAT=1, exported by the external seat launcher).
 *
 * tokenSeatError(env) returns a refusal string when the seat is declared and neither
 * CLAUDE_CODE_OAUTH_TOKEN nor an explicit endpoint (ANTHROPIC_BASE_URL plus
 * ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY) is present; otherwise null. Ordinary seats
 * (the flag unset) are unchanged. The string never contains a token value.
 *
 * Node >= 20.10, built-ins only.
 */
const REFUSAL = 'token seat refused: AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login); inside a Claude Code session, use the Agent tool with model: fable (or the needed model) instead of a claude-native runner';

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}

function tokenSeatError(env) {
  const e = env || {};
  if (e.AUTOPILOT_TOKEN_SEAT !== '1') return null;
  if (nonEmpty(e.CLAUDE_CODE_OAUTH_TOKEN)) return null;
  if (nonEmpty(e.ANTHROPIC_BASE_URL) && (nonEmpty(e.ANTHROPIC_AUTH_TOKEN) || nonEmpty(e.ANTHROPIC_API_KEY))) {
    return null;
  }
  return REFUSAL;
}

module.exports = { REFUSAL, tokenSeatError };
