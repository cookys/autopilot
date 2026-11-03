#!/usr/bin/env bash
# eval-account.sh -- G37 W5: the account-layer front for shell eval runners (plan 4.1 A9/A10/A12, 8 W5, N9, N20).
# SOURCE it; it defines functions only.
#   eval_account_probe <purpose>   -> asks `claude-account.js env-check` once, BEFORE any claude spawn.
#       sets and exports EVAL_ACCOUNT_ACTIVE=1 (registry usable) or 0 (unconfigured / mode_off = legacy path unchanged),
#       plus EVAL_ACCOUNT_JS / EVAL_ACCOUNT_SH / EVAL_ACCOUNT_NODE / EVAL_ACCOUNT_PURPOSE.
#       returns 0, or the env-check exit code (2 invalid / 3 none) when the registry exists but is unusable:
#       the caller must stop at once (fail closed, nothing spawned, nothing read from an ambient credential).
#   eval_account_wrap_claude       -> inside a PATH `claude` wrapper that has set REAL_CLAUDE and EXTRA_ARGS:
#       when active, REAL_CLAUDE becomes node and EXTRA_ARGS becomes `claude-account.js exec --pick -- <claude> <args>`
#       (the token goes from claude-account.js straight into the child env: never into bash, argv or a log).
#   eval_account_install_wrapper <dir>  -> writes a pass-through PATH `claude` wrapper that applies the wrap above.
#   eval_account_use_path_wrapper <dir> -> when active: install the wrapper in <dir> and put <dir> first on PATH (no-op otherwise).
#   A process already inside an account env (AUTOPILOT_ACCOUNT set by claude-account.js) is never wrapped a second time.
# `exec` (not `run`) because these callers feed claude through stdin redirects and stream its output.
_EVAL_ACCOUNT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_ACCOUNT_JS="$_EVAL_ACCOUNT_LIB_DIR/../claude-account.js"
EVAL_ACCOUNT_SH="$_EVAL_ACCOUNT_LIB_DIR/eval-account.sh"
EVAL_ACCOUNT_ACTIVE="${EVAL_ACCOUNT_ACTIVE:-0}"

eval_account_probe() {
  local purpose="${1:?eval_account_probe <purpose>}" out="" rc=0 first=""
  EVAL_ACCOUNT_ACTIVE=0
  if [ -r "$EVAL_ACCOUNT_JS" ]; then
    out="$(node "$EVAL_ACCOUNT_JS" env-check --purpose eval-probe < /dev/null)" || rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "eval-account: the account registry is unusable (env-check exit $rc); refusing to start, nothing was spawned" >&2
      return "$rc"
    fi
    first="${out%%$'\n'*}"
    case "$first" in
      ok\ *) EVAL_ACCOUNT_ACTIVE=1 ;;
    esac
  fi
  EVAL_ACCOUNT_NODE="$(command -v node)"
  EVAL_ACCOUNT_PURPOSE="$purpose"
  export EVAL_ACCOUNT_ACTIVE EVAL_ACCOUNT_JS EVAL_ACCOUNT_SH EVAL_ACCOUNT_NODE EVAL_ACCOUNT_PURPOSE
  return 0
}

eval_account_wrap_claude() {
  if [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ] && [ -z "${AUTOPILOT_ACCOUNT:-}" ]; then
    EXTRA_ARGS=("$EVAL_ACCOUNT_JS" exec --pick --purpose "$EVAL_ACCOUNT_PURPOSE" -- "$REAL_CLAUDE" "${EXTRA_ARGS[@]}")
    REAL_CLAUDE="$EVAL_ACCOUNT_NODE"
  fi
}

eval_account_install_wrapper() {
  local dir="${1:?eval_account_install_wrapper <dir>}"
  mkdir -p "$dir"
  cat > "$dir/claude" <<'WRAP'
#!/usr/bin/env bash
WRAPPER_DIR=$(cd "$(dirname "$0")" && pwd -P)
REAL_CLAUDE=""
IFS=':' read -ra _ADDR <<< "$PATH"
for _d in "${_ADDR[@]}"; do
  if [[ ! "$_d" -ef "$WRAPPER_DIR" && -x "$_d/claude" ]]; then REAL_CLAUDE="$_d/claude"; break; fi
done
if [[ -z "$REAL_CLAUDE" ]]; then echo "[wrapper] claude not found on PATH (excluding wrapper)" >&2; exit 127; fi
EXTRA_ARGS=("$@")
. "$EVAL_ACCOUNT_SH"
eval_account_wrap_claude
exec "$REAL_CLAUDE" "${EXTRA_ARGS[@]}"
WRAP
  chmod +x "$dir/claude"
}

eval_account_use_path_wrapper() {
  [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ] || return 0
  eval_account_install_wrapper "${1:?eval_account_use_path_wrapper <dir>}"
  export PATH="$1:$PATH"
}
