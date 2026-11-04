#!/usr/bin/env bash
# role-kit.sh - sourced helper for `--role-kit <dir>` on the Claude dispatch rails (dispatch-hetero,
# dispatch-review, dispatch-author; claude-native only). Validation lives in role-kit.js; this wrapper turns a
# valid kit into argv pieces. Layout and refusal list: references/hetero-dispatch.md "Role kit".
#
#   role_kit_refuse_unless_claude_native <runner>   die_precondition unless the runner is claude-native
#   role_kit_load <kit-dir>                         validate (die_precondition with a one-line reason on any
#                                                   failure, before any spawn) and set:
#     ROLE_KIT_ACTIVE=1
#     ROLE_KIT_TOOLS    the --tools argument ("" for a `none` kit)
#     ROLE_KIT_EXTRA    array: --system-prompt <role.md bytes> [--plugin-dir <kit>/plugin]
#     ROLE_KIT_ARGV     array: ROLE_KIT_EXTRA followed by --tools <list>
#     ROLE_KIT_JSON     dispatch record object: path + sha256 of role.md and of tools
#
# Needs die_precondition from the caller. A rail that was not given a kit never calls these, so its argv is
# the one it always built.
ROLE_KIT_ACTIVE=0
ROLE_KIT_TOOLS=""
ROLE_KIT_EXTRA=()
ROLE_KIT_ARGV=()
ROLE_KIT_JSON=""

role_kit_refuse_unless_claude_native() {
  [ "${1:-}" = "claude-native" ] || die_precondition "role-kit unsupported for runner ${1:-unknown}"
}

role_kit_load() {
  local _dir="$1" _js _out _text _have
  local -a _f
  _js="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/role-kit.js"
  _out="$(node "$_js" check "$_dir" 2>&1 < /dev/null)" || die_precondition "role-kit refused: ${_out}"
  mapfile -t _f <<<"$_out"
  [ "${#_f[@]}" -eq 6 ] || die_precondition "role-kit refused: validator output not recognised"
  # Exact bytes of role.md: the trailing x keeps $(...) from eating a final newline.
  _text="$(cat "${_f[0]}/role.md"; printf x)" || die_precondition "role-kit refused: role.md unreadable"
  _text="${_text%x}"
  _have="$(printf '%s' "$_text" | sha256sum | cut -d' ' -f1)"
  [ "$_have" = "${_f[1]}" ] || die_precondition "role-kit refused: role.md changed while it was being read"
  ROLE_KIT_ACTIVE=1
  ROLE_KIT_TOOLS="${_f[3]}"
  ROLE_KIT_EXTRA=(--system-prompt "$_text")
  [ -z "${_f[4]}" ] || ROLE_KIT_EXTRA+=(--plugin-dir "${_f[4]}")
  ROLE_KIT_ARGV=("${ROLE_KIT_EXTRA[@]}" --tools "$ROLE_KIT_TOOLS")
  ROLE_KIT_JSON="${_f[5]}"
}
