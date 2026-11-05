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
# kimi arm of dispatch-author only (lib/role-kit-kimi.js; the kit becomes an --agent-file, not argv text):
#   role_kit_load_kimi <kit-dir>                     validate + plan (die_precondition before any spawn; a kit with plugin/ or a
#                                                    role.md over 4096 bytes is refused); sets ROLE_KIT_ACTIVE=1, ROLE_KIT_JSON (with
#                                                    agent_file_sha256) and ROLE_KIT_KIMI_SHA
#   role_kit_write_kimi_agent <kit-dir> <out-file>   write the agent file at spawn time and check it against the planned sha256
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
  # stdout carries the six result lines, or on refusal one `REASON: ...` line; stderr (node warnings) is dropped, never parsed.
  if ! _out="$(node "$_js" check "$_dir" 2>/dev/null < /dev/null)"; then
    _out="$(printf '%s\n' "$_out" | sed -n 's/^REASON: //p' | tail -n 1)"
    [ -n "$_out" ] || _out="validator failed without a reason"
    die_precondition "role-kit refused: ${_out}"
  fi
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

role_kit_load_kimi() {
  local _js _out _sha _json
  _js="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/role-kit-kimi.js"
  if ! _out="$(node "$_js" plan "$1" 2>/dev/null < /dev/null)"; then
    _out="$(printf '%s\n' "$_out" | sed -n 's/^REASON: //p' | tail -n 1)"
    [ -n "$_out" ] || _out="validator failed without a reason"
    die_precondition "role-kit refused: ${_out}"
  fi
  _sha="$(printf '%s\n' "$_out" | sed -n '1p')"; _json="$(printf '%s\n' "$_out" | sed -n '2p')"
  { [ -n "$_sha" ] && [ -n "$_json" ]; } || die_precondition "role-kit refused: validator output not recognised"
  ROLE_KIT_ACTIVE=1
  ROLE_KIT_KIMI_SHA="$_sha"
  ROLE_KIT_JSON="$_json"
}

role_kit_write_kimi_agent() {
  local _js _got
  _js="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/role-kit-kimi.js"
  _got="$(node "$_js" write "$1" "$2" 2>/dev/null < /dev/null)" || die_precondition "role-kit refused: could not write the kimi agent file"
  [ "$_got" = "$ROLE_KIT_KIMI_SHA" ] || die_precondition "role-kit refused: kit changed between validation and spawn"
}
