# token-seat.sh — source this. A declared token seat (AUTOPILOT_TOKEN_SEAT=1) with no
# CLAUDE_CODE_OAUTH_TOKEN must not spawn claude (that would fall back to the host login),
# unless pointed at an explicit endpoint (ANTHROPIC_BASE_URL plus ANTHROPIC_AUTH_TOKEN or
# ANTHROPIC_API_KEY). token_seat_guard prints the refusal on stdout and returns 78.
# Otherwise it prints nothing and returns 0. Ordinary seats are a no-op. Never prints the token.
token_seat_guard() {
  if [ "${AUTOPILOT_TOKEN_SEAT:-}" != "1" ]; then
    return 0
  fi
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    return 0
  fi
  if [ -n "${ANTHROPIC_BASE_URL:-}" ] && { [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; }; then
    return 0
  fi
  printf '%s\n' 'token seat refused: AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login)'
  return 78
}
