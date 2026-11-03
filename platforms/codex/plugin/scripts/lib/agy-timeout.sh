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
