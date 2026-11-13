# token-seat.sh — source this. A declared token seat (AUTOPILOT_TOKEN_SEAT=1) with no
# CLAUDE_CODE_OAUTH_TOKEN must not spawn claude (that would fall back to the host login).
# token_seat_guard prints the refusal on stdout and returns 78. Otherwise it prints
# nothing and returns 0. Ordinary seats are a no-op. Never prints the token.
token_seat_guard() {
  if [ "${AUTOPILOT_TOKEN_SEAT:-}" = "1" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    printf '%s\n' 'token seat refused: AUTOPILOT_TOKEN_SEAT=1 but CLAUDE_CODE_OAUTH_TOKEN is missing; refusing to spawn claude (would fall back to the host login)'
    return 78
  fi
  return 0
}
