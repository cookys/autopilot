#!/usr/bin/env bash
# account-state.sh - sourced helper: the ONE reading of `claude-account.js env-check` for every bash caller
# (dispatch-review, dispatch-author, dispatch-hetero, probe-engine-capability). G37 plan 5.5 item 6.
#
#   account_layer_state <path-to-claude-account.js> <purpose>   -> prints exactly one word
#
#     rc != 0                                           -> invalid   (registry present but broken, or env-check itself failed)
#     stdout line 1, first token unconfigured|mode_off  -> legacy    (no registry / mode off: caller keeps its current path)
#     stdout line 1, first token ok                     -> active    (caller must spawn ONLY through claude-account.js run)
#     anything else (empty, garbage, unknown word)      -> invalid   (fail closed, caller spawns nothing)
#
# Always asks with `--any` (plan 5.5 item 6: every enabled alias must pass). Only stdout is read; stderr is
# discarded so a stray stderr line can never turn into a verdict. The token never enters this shell.
# Callers must treat any word other than legacy/active as invalid (a missing function prints nothing).
account_layer_state() {
  local _js="$1" _purpose="$2" _out _rc _first
  _out="$(node "$_js" env-check --any --purpose "$_purpose" 2>/dev/null < /dev/null)" && _rc=0 || _rc=$?
  if [ "$_rc" -ne 0 ]; then echo invalid; return 0; fi
  _first="${_out%%$'\n'*}"
  _first="${_first%%[[:space:]]*}"
  case "$_first" in
    unconfigured|mode_off) echo legacy ;;
    ok) echo active ;;
    *) echo invalid ;;
  esac
}
