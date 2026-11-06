#!/usr/bin/env bash
# agy --print-timeout normalisation — the single owner of "what string goes after --print-timeout".
#
# WHY: agy parses --print-timeout as a Go duration and refuses a bare number:
#   invalid value "900" for flag -print-timeout: time: missing unit in duration
# Every rail that forwards its own --timeout to agy (dispatch-author/-hetero/-review/-explore,
# lib/cleanroom-launch.sh) used to pass the caller's value verbatim, so `--timeout 900` killed the
# dispatch before a single turn ran.
#
# CONTRACT: agy_print_timeout <value>
#   - all digits            -> seconds, printed as "<n>s"   (900 -> 900s)
#   - Go duration with unit -> printed unchanged             (9m, 900s, 1h30m, 1.5h, .5s, 1.s, 250µs)
#   - anything else (empty, "abc", "-5", "1.5" (no unit), ".", "10 m", "1d") -> returns 1, prints a one-line reason on
#     stdout, so the rail can refuse BEFORE it launches agy.
# It never exits or dies itself (callers run it inside `$( )`):
#
#   AGY_TIMEOUT="$(agy_print_timeout "$TIMEOUT")" || die_precondition "$AGY_TIMEOUT"
agy_print_timeout() {
  local v="${1-}"
  if [[ "$v" =~ ^[0-9]+$ ]]; then
    printf '%ss' "$v"
    return 0
  fi
  # Go time.ParseDuration grammar (unsigned): one or more <decimal><unit>; the decimal may omit the
  # digits before or after the point (".5s", "1.s") but needs at least one digit. Units: ns us µs μs ms s m h.
  local num='([0-9]+(\.[0-9]*)?|\.[0-9]+)' unit='(ns|us|µs|μs|ms|s|m|h)'
  if [[ "$v" =~ ^(${num}${unit})+$ ]]; then
    printf '%s' "$v"
    return 0
  fi
  printf 'invalid --timeout value for agy: "%s" (use plain seconds such as 900, or a duration with a unit such as 900s, 9m, 1h30m)' "$v"
  return 1
}

# agy bwrap mount-target resolution (shares this lib because every agy rail already sources it).
# WHY: agy 1.5.2 migrates ~/.gemini/antigravity-cli/agents into a symlink to ~/.gemini/config/agents.
# bwrap cannot --bind (or --tmpfs) onto a symlink destination ("Can't bind mount ... No such file or
# directory"), so agy never started and the review ended rc=1 / no_verdict.
# CONTRACT: agy_bind_target <path>
#   prints the symlink-free absolute path (readlink -m, so a dangling link resolves to where it points);
#   returns 1 with a one-line reason on stdout when the resolved path is not under the resolved
#   "$HOME/.gemini" (fail closed: never mount scratch over anything outside agy's own state dir).
#   Callers mkdir -p the printed path before bwrap.
agy_bind_target() {
  local want="${1-}" real root
  real="$(readlink -m -- "$want")" && root="$(readlink -m -- "${HOME:-}/.gemini")" \
    && [ -n "$real" ] && [ -n "${HOME:-}" ] || { printf 'cannot resolve agy mount target: %s' "$want"; return 1; }
  case "$real" in
    "$root"/*) printf '%s' "$real" ;;
    *) printf 'agy mount target %s resolves to %s, outside %s: refusing to bind over it' "$want" "$real" "$root"; return 1 ;;
  esac
}

# Test-mode guard: an agy launch must never run with the operator's real HOME under a test suite
# (agy migrates and writes ~/.gemini/antigravity-cli on every start; 2026-11 a suite did exactly that).
# Armed ONLY when hooks/tests/lib.sh exports AUTOPILOT_TEST_REAL_HOME (the passwd home of the uid,
# captured before HOME was redirected); a production dispatch never sets it, so this is a no-op there.
# CONTRACT: agy_assert_disposable_home  -> 0 (ok / unarmed), 1 + one-line reason on stdout.
agy_assert_disposable_home() {
  [ -n "${AUTOPILOT_TEST_REAL_HOME:-}" ] || return 0
  local h real
  h="$(readlink -m -- "${HOME:-}")"; real="$(readlink -m -- "$AUTOPILOT_TEST_REAL_HOME")"
  if [ -z "$h" ] || [ "$h" = "$real" ]; then
    printf 'test guard: agy would start with the real HOME (%s); tests must use a disposable HOME' "$real"
    return 1
  fi
}
