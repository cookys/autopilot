'use strict';
/**
 * token-seat.js — declared token seats (AUTOPILOT_TOKEN_SEAT=1, set by lane-token-resume).
 *
 * tokenSeatError(env) returns a refusal string when the seat is declared and
 * CLAUDE_CODE_OAUTH_TOKEN is missing or empty, otherwise null. Ordinary seats
 * (the flag unset) are unchanged. The string never contains a token value.
 *
 * Node >= 20.10, built-ins only.
 */
const REFUSAL = 'token seat refused: AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login)';

function tokenSeatError(env) {
  const e = env || {};
  if (e.AUTOPILOT_TOKEN_SEAT !== '1') return null;
  if (typeof e.CLAUDE_CODE_OAUTH_TOKEN === 'string' && e.CLAUDE_CODE_OAUTH_TOKEN.length > 0) return null;
  return REFUSAL;
}

module.exports = { REFUSAL, tokenSeatError };
