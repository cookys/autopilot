#!/usr/bin/env bash
# load-endpoints-env.sh — populate the Anthropic-compatible endpoint credential env
# vars from a single canonical machine-local file, so GLM / MiniMax / any compatible
# endpoint has ONE documented credential home instead of scattered shell exports.
#
# Canonical file: ${AUTOPILOT_ENDPOINTS_ENV:-$HOME/.autopilot/endpoints.env}  (mode 600).
# It is a persistence layer ONLY — the resolution contract stays the env-var convention
# AUTOPILOT_ENDPOINT_<NAME>_{URL,TOKEN} consumed by resolve-endpoint.sh. This file merely
# populates those vars into the process env before dispatch.
#
# SECRET HYGIENE (mirrors resolve-endpoint.sh):
#   - `set +x` at entry so an inherited `bash -x` / SHELLOPTS=xtrace cannot leak a token
#     value via an assignment trace.
#   - NEVER echoes a token VALUE — only KEY NAMES appear in any diagnostic.
#   - LINE-PARSER, never `source` — the file's contents are never executed; only lines of
#     the exact form `[export ]NAME=VALUE` where NAME is on a fixed allowlist are honored.
#     Arbitrary vars, command substitution, and multi-line values are ignored.
#
# SAFETY GATE (fail-closed — a rejected file loads NOTHING, warns, and the caller's own
# precondition (e.g. "cc-shim requires ANTHROPIC_BASE_URL") fires normally):
#   - reject a SYMLINK (never follow — swap-attack surface)
#   - reject if NOT owned by the effective user
#   - reject if GROUP- or OTHER-WRITABLE (mode & 022 — a token-injection vector)
#   - WARN (but still load) if GROUP- or OTHER-READABLE (mode & 044 — confidentiality only)
#   - reject if perms can't be determined (stat unavailable) — can't verify ⇒ don't load
#
# Precedence: an env var already SET (non-empty) in the process WINS — the file only fills
# gaps, so a one-off `AUTOPILOT_ENDPOINT_X_TOKEN=… <cmd>` overrides the file.
#
# Usage:
#   source scripts/load-endpoints-env.sh && autopilot_load_endpoints_env
#   scripts/load-endpoints-env.sh            # executed: load default file, print a
#                                            #   NON-SECRET summary (names only) to stderr
#   scripts/load-endpoints-env.sh --init     # scaffold a mode-600 commented STUB if absent
#                                            #   (idempotent — never overwrites)
#   scripts/load-endpoints-env.sh --help
#
# Exit / return: 0 = loaded (or no file — a no-op is success) · 1 = file present but
#   rejected by the safety gate.

# Defence-in-depth: disable xtrace before any value is touched (see resolve-endpoint.sh).
set +x

# Allowlisted credential var NAMES. Anything not matching is silently ignored by the parser.
# (Kept in sync with resolve-endpoint.sh's resolution contract + the two base-url overrides.)
_autopilot_endpoints_key_allowed() {
  case "$1" in
    ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN) return 0 ;;
    ANTHROPIC_COMPATIBLE_BASE_URL|ANTHROPIC_COMPATIBLE_AUTH_TOKEN) return 0 ;;
    MINIMAX_API_KEY|AUTOPILOT_MINIMAX_BASE_URL) return 0 ;;
  esac
  # AUTOPILOT_ENDPOINT_<NAME>_URL / _TOKEN — NAME is [A-Za-z0-9_]+
  case "$1" in
    AUTOPILOT_ENDPOINT_*_URL|AUTOPILOT_ENDPOINT_*_TOKEN)
      local base="${1#AUTOPILOT_ENDPOINT_}"
      base="${base%_URL}"; base="${base%_TOKEN}"
      [[ "$base" =~ ^[A-Za-z0-9_]+$ ]] && return 0 ;;
  esac
  return 1
}

# autopilot_load_endpoints_env — parse the canonical file into the process env.
# Sets AUTOPILOT_ENDPOINTS_LOADED to a space-separated list of KEY names actually loaded
# (never values), for a non-secret diagnostic. Returns 0 on success/no-op, 1 on rejection.
autopilot_load_endpoints_env() {
  set +x
  # ${HOME:-} — a caller under `set -u` with HOME unset (e.g. `env -i`) must not crash here.
  local envfile="${AUTOPILOT_ENDPOINTS_ENV:-${HOME:-}/.autopilot/endpoints.env}"
  AUTOPILOT_ENDPOINTS_LOADED=""

  # No file at all ⇒ nothing to do; this is the common case and a success no-op.
  [ -e "$envfile" ] || return 0

  # Never follow a symlink — the target could be an attacker-controlled file.
  if [ -L "$envfile" ]; then
    printf 'load-endpoints-env: refusing symlink credential file: %s\n' "$envfile" >&2
    return 1
  fi
  if [ ! -f "$envfile" ]; then
    printf 'load-endpoints-env: not a regular file, skipping: %s\n' "$envfile" >&2
    return 1
  fi
  # Ownership — bash -O is TRUE iff the file is owned by the effective uid (portable, no stat).
  if [ ! -O "$envfile" ]; then
    printf 'load-endpoints-env: refusing credential file not owned by you: %s\n' "$envfile" >&2
    return 1
  fi
  # Permission bits — GNU then BSD stat; empty ⇒ can't verify ⇒ fail closed.
  local mode
  mode="$(stat -c '%a' "$envfile" 2>/dev/null || stat -f '%Lp' "$envfile" 2>/dev/null || printf '')"
  if [ -z "$mode" ]; then
    printf 'load-endpoints-env: cannot determine permissions, refusing: %s\n' "$envfile" >&2
    return 1
  fi
  # Force octal interpretation (leading 0). Group/other WRITE ⇒ injection vector ⇒ reject.
  if (( 0"$mode" & 022 )); then
    printf 'load-endpoints-env: refusing group/other-writable credential file (chmod 600 %s)\n' "$envfile" >&2
    return 1
  fi
  # Group/other READ ⇒ confidentiality only ⇒ warn but proceed.
  if (( 0"$mode" & 044 )); then
    printf 'load-endpoints-env: WARNING credential file is group/other-readable (chmod 600 %s recommended)\n' "$envfile" >&2
  fi

  local line key val base loaded=""
  # `|| [ -n "$line" ]` so a final line without a trailing newline is still processed.
  while IFS= read -r line || [ -n "$line" ]; do
    # Strip leading whitespace.
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac        # comment
    case "$line" in export\ *) line="${line#export }"; line="${line#"${line%%[![:space:]]*}"}" ;; esac
    case "$line" in *=*) ;; *) continue ;; esac  # must be NAME=VALUE
    key="${line%%=*}"
    val="${line#*=}"
    # Reject any trailing space inside the key (`NAME =...`) — not a real assignment.
    case "$key" in *[![:alnum:]_]*) continue ;; esac
    _autopilot_endpoints_key_allowed "$key" || continue
    # Strip ONE layer of matching surrounding quotes (literal — no escape processing).
    if [ "${#val}" -ge 2 ] && [ "${val:0:1}" = '"' ] && [ "${val: -1}" = '"' ]; then
      val="${val:1:${#val}-2}"
    elif [ "${#val}" -ge 2 ] && [ "${val:0:1}" = "'" ] && [ "${val: -1}" = "'" ]; then
      val="${val:1:${#val}-2}"
    fi
    # Existing non-empty env WINS — file only fills gaps.
    if [ -z "${!key:-}" ]; then
      export "$key=$val"
      loaded+="${loaded:+ }$key"
    fi
  done < "$envfile"

  AUTOPILOT_ENDPOINTS_LOADED="$loaded"
  return 0
}

# autopilot_init_endpoints_env — idempotently scaffold a mode-600 commented STUB (no secrets)
# at the canonical path if absent. Never clobbers an existing file. Returns 0 (created OR
# already-present), 1 on a write failure.
autopilot_init_endpoints_env() {
  set +x
  local envfile="${AUTOPILOT_ENDPOINTS_ENV:-${HOME:-}/.autopilot/endpoints.env}"
  if [ -e "$envfile" ] || [ -L "$envfile" ]; then
    printf 'load-endpoints-env: already exists, not overwriting: %s\n' "$envfile" >&2
    return 0
  fi
  local dir; dir="$(dirname "$envfile")"
  mkdir -p "$dir" 2>/dev/null || { printf 'load-endpoints-env: cannot create %s\n' "$dir" >&2; return 1; }
  # umask 077 so the transient file is private from creation; chmod 600 belt-and-braces.
  ( umask 077; cat > "$envfile" <<'STUB'
# ~/.autopilot/endpoints.env — autopilot heterogeneous-engine credentials (mode 600).
# ONE canonical home for Anthropic-compatible endpoint tokens (GLM / MiniMax / any compatible).
# NEVER commit this file. Parsed SAFELY (not sourced): only `NAME=VALUE` lines with an
# allowlisted NAME are honored; a set env var always wins. Uncomment + fill what you use.
#
# Prefer a SUBSCRIPTION / coding-plan token over a metered API key. OAuth-login runners
# (codex / agy / grok) need NOTHING here — they use their own CLI login.
#
# Convention: AUTOPILOT_ENDPOINT_<NAME>_URL + _TOKEN  (<NAME> is [A-Za-z0-9_], your own label).
#
# --- GLM (Zhipu) coding plan ---
# AUTOPILOT_ENDPOINT_GLM_URL=https://api.z.ai/api/anthropic
# AUTOPILOT_ENDPOINT_GLM_TOKEN=
#
# --- MiniMax (intl) ---
# AUTOPILOT_ENDPOINT_MINIMAX_URL=https://api.minimax.io/anthropic
# AUTOPILOT_ENDPOINT_MINIMAX_TOKEN=
STUB
  ) || { printf 'load-endpoints-env: cannot write %s\n' "$envfile" >&2; return 1; }
  chmod 600 "$envfile" 2>/dev/null || true
  printf 'load-endpoints-env: created stub %s (chmod 600; edit to add tokens)\n' "$envfile" >&2
  return 0
}

# Executed directly (not sourced) ⇒ run against the default file + print a NON-SECRET summary.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  case "${1:-}" in
    --help|-h) sed -n '2,40p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0 ;;
    --init) autopilot_init_endpoints_env; exit $? ;;
    "") ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  autopilot_load_endpoints_env; _rc=$?
  if [ "$_rc" -eq 0 ]; then
    printf 'load-endpoints-env: loaded [%s]\n' "${AUTOPILOT_ENDPOINTS_LOADED:-}" >&2
  fi
  exit "$_rc"
fi
