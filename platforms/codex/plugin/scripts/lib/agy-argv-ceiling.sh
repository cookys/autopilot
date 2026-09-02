#!/usr/bin/env bash
# agy argv-payload ceiling — shared by every rail that hands agy a prompt.
#
# WHY THIS EXISTS: agy has no --prompt-file (verified against `agy --help`, agy 1.1.x,
# 2026-09-02: only -p/--print/--prompt taking the prompt as ONE argv string, plus
# `--input-format stream-json` on stdin which requires stream-json output and a different
# parser). Every other reviewer/implementer runner in this repo feeds the prompt through
# --prompt-file or stdin and is therefore unaffected.
#
# Linux caps a SINGLE argv string at MAX_ARG_STRLEN = 32 * PAGE_SIZE (131072 bytes,
# including the terminating NUL) — a per-string limit, entirely separate from the much
# larger total ARG_MAX (2097152 here). Exceeding it makes execve() fail with E2BIG BEFORE
# agy is ever started, so the caller sees only a bare shell status (126/127 have both been
# observed) with no vendor error text and no verdict. That is the "fails silently" the
# reviewer/roster docs now warn about.
#
# Measured on this class of host (Linux 7.0.0, PAGE_SIZE 4096) 2026-09-02:
#   131071 bytes → exec ok      131072 bytes → exec fails      131073 bytes → exec fails
#
# The ceiling is derived from the live PAGE_SIZE rather than hardcoded, because
# MAX_ARG_STRLEN is defined in terms of it and a 64K-page host has a 2MB limit.
# AGY_ARGV_CEILING_BYTES overrides it (test seam only — a larger value does not make the
# kernel accept more).

agy_argv_ceiling_bytes() {
  if [ -n "${AGY_ARGV_CEILING_BYTES:-}" ]; then
    printf '%s' "$AGY_ARGV_CEILING_BYTES"
    return 0
  fi
  local page
  page="$(getconf PAGESIZE 2>/dev/null || true)"
  case "$page" in ''|*[!0-9]*) page=4096 ;; esac
  # -1 for the NUL execve appends: 131071 is the largest string that actually execs.
  printf '%s' "$(( 32 * page - 1 ))"
}

# agy_argv_ceiling_assert <byte-count> <what> <remedy-hint>
# Prints a single-line reason on stdout and returns 1 when the payload cannot be exec'd.
# Returns 0 (silently) when it fits. Callers turn the reason into their own typed refusal
# (die_precondition / emit_no_verdict) so each rail keeps its own contract.
agy_argv_ceiling_assert() {
  local bytes="$1" what="${2:-agy prompt}" hint="${3:-}" ceiling
  ceiling="$(agy_argv_ceiling_bytes)"
  if [ "$bytes" -le "$ceiling" ]; then
    return 0
  fi
  printf '%s is %s bytes, over the %s-byte single-argv ceiling agy can be exec'"'"'d with (Linux MAX_ARG_STRLEN); agy has no --prompt-file, so this cannot be streamed%s' \
    "$what" "$bytes" "$ceiling" "${hint:+ — $hint}"
  return 1
}
