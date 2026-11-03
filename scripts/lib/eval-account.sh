#!/usr/bin/env bash
# eval-account.sh -- G37 W5: the account-layer front for shell eval runners (plan 4.1 A9/A10/A12, 8 W5, N9, N20).
# SOURCE it; it defines functions only.
#   eval_account_probe <purpose>   -> asks `claude-account.js env-check` once, BEFORE any claude spawn.
#       sets and exports EVAL_ACCOUNT_ACTIVE=1 (registry usable) or 0 (unconfigured / mode_off = legacy path unchanged),
#       plus EVAL_ACCOUNT_JS / EVAL_ACCOUNT_SH / EVAL_ACCOUNT_NODE / EVAL_ACCOUNT_PURPOSE.
#       returns 0, or 2 when the registry exists but is unusable (or env-check printed something unrecognised):
#       the caller must stop at once (fail closed, nothing spawned, nothing read from an ambient credential).
#   eval_account_wrap_claude       -> inside a PATH `claude` wrapper that has set REAL_CLAUDE and EXTRA_ARGS:
#       when active, REAL_CLAUDE becomes node and EXTRA_ARGS becomes `claude-account.js exec --pick -- <claude> <args>`
#       (the token goes from claude-account.js straight into the child env: never into bash, argv or a log).
#   eval_account_install_wrapper <dir> [<claude>] -> writes a pass-through PATH `claude` wrapper that applies the wrap above.
#       With <claude> (an absolute path the caller already resolved, e.g. the operator-pinned CC_BIN) the wrapper runs exactly that binary
#       and does not search PATH again (a relative PATH entry or a changed cwd could pick another one, or none).
#   eval_account_use_path_wrapper <dir> -> when active: install the wrapper in <dir> and put <dir> first on PATH (no-op otherwise).
#   No marker-only exemption: an exported AUTOPILOT_ACCOUNT (or any other env value) never skips the wrap. A claude started from a process that is
#   already inside an account env is simply picked again by claude-account.js, which builds a fresh env from the registry.
# `exec` (not `run`) because these callers feed claude through stdin redirects and stream its output.
_EVAL_ACCOUNT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_ACCOUNT_JS="$_EVAL_ACCOUNT_LIB_DIR/../claude-account.js"
EVAL_ACCOUNT_SH="$_EVAL_ACCOUNT_LIB_DIR/eval-account.sh"
EVAL_ACCOUNT_ACTIVE="${EVAL_ACCOUNT_ACTIVE:-0}"

eval_account_probe() {
  local purpose="${1:?eval_account_probe <purpose>}" state=""
  EVAL_ACCOUNT_ACTIVE=0
  # Fail closed when the layer itself is missing (L9): no spawn, no credentials copy.
  if [ ! -r "$EVAL_ACCOUNT_JS" ] || [ ! -r "$_EVAL_ACCOUNT_LIB_DIR/account-state.sh" ]; then
    echo "eval-account: the account layer ($EVAL_ACCOUNT_JS or account-state.sh) is missing; refusing to start, nothing was spawned" >&2
    return 2
  fi
  # The ONE reading of env-check (account-state.sh, always --any, anything unrecognised is invalid): the same rule every
  # rail uses. legacy = unconfigured / mode_off; invalid = the registry exists but is unusable -> fail closed (2).
  # shellcheck source=account-state.sh
  . "$_EVAL_ACCOUNT_LIB_DIR/account-state.sh"
  state="$(account_layer_state "$EVAL_ACCOUNT_JS" eval-probe)"
  case "$state" in
    active) EVAL_ACCOUNT_ACTIVE=1 ;;
    legacy) ;;
    *)
      echo "eval-account: the account registry is unusable or env-check printed something unrecognised; refusing to start, nothing was spawned" >&2
      return 2
      ;;
  esac
  EVAL_ACCOUNT_NODE="$(command -v node)"
  EVAL_ACCOUNT_PURPOSE="$purpose"
  export EVAL_ACCOUNT_ACTIVE EVAL_ACCOUNT_JS EVAL_ACCOUNT_SH EVAL_ACCOUNT_NODE EVAL_ACCOUNT_PURPOSE
  return 0
}

eval_account_wrap_claude() {
  if [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ]; then
    EXTRA_ARGS=("$EVAL_ACCOUNT_JS" exec --pick --purpose "$EVAL_ACCOUNT_PURPOSE" -- "$REAL_CLAUDE" "${EXTRA_ARGS[@]}")
    REAL_CLAUDE="$EVAL_ACCOUNT_NODE"
  fi
}

eval_account_install_wrapper() {
  local dir="${1:?eval_account_install_wrapper <dir>}" pinned="${2:-}"
  mkdir -p "$dir"
  case "$pinned" in ""|/*) ;; *) echo "eval-account: the pinned claude must be an absolute path: $pinned" >&2; return 2 ;; esac
  cat > "$dir/claude" <<'WRAP'
#!/usr/bin/env bash
WRAPPER_DIR=$(cd "$(dirname "$0")" && pwd -P)
REAL_CLAUDE=""
#PINNED#
if [[ -z "$REAL_CLAUDE" ]]; then
IFS=':' read -ra _ADDR <<< "$PATH"
for _d in "${_ADDR[@]}"; do
  if [[ ! "$_d" -ef "$WRAPPER_DIR" && -x "$_d/claude" ]]; then REAL_CLAUDE="$_d/claude"; break; fi
done
fi
if [[ -z "$REAL_CLAUDE" ]]; then echo "[wrapper] claude not found on PATH (excluding wrapper)" >&2; exit 127; fi
EXTRA_ARGS=("$@")
if [[ -z "${EVAL_ACCOUNT_SH:-}" || ! -r "$EVAL_ACCOUNT_SH" ]]; then echo "[wrapper] eval-account helper path is empty or unreadable; refusing to start claude" >&2; exit 2; fi
. "$EVAL_ACCOUNT_SH"
eval_account_wrap_claude
exec "$REAL_CLAUDE" "${EXTRA_ARGS[@]}"
WRAP
  if [ -n "$pinned" ]; then
    local q; q="$(printf 'REAL_CLAUDE=%q' "$pinned")"
    local tmp="$dir/claude.tmp"
    while IFS= read -r line || [ -n "$line" ]; do
      if [ "$line" = "#PINNED#" ]; then printf '%s\n' "$q"; else printf '%s\n' "$line"; fi
    done < "$dir/claude" > "$tmp" && mv "$tmp" "$dir/claude"
  fi
  chmod +x "$dir/claude"
}

eval_account_use_path_wrapper() {
  [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ] || return 0
  eval_account_install_wrapper "${1:?eval_account_use_path_wrapper <dir>}"
  export PATH="$1:$PATH"
}
