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
  # AUTOPILOT_ENDPOINT_<NAME>_URL / _TOKEN / _TRANSPORT — NAME is [A-Za-z0-9_]+
  # (_TRANSPORT is the non-secret plaintext-private opt-in read by resolve-endpoint.sh)
  case "$1" in
    AUTOPILOT_ENDPOINT_*_URL|AUTOPILOT_ENDPOINT_*_TOKEN|AUTOPILOT_ENDPOINT_*_TRANSPORT)
      local base="${1#AUTOPILOT_ENDPOINT_}"
      base="${base%_URL}"; base="${base%_TOKEN}"; base="${base%_TRANSPORT}"
      [[ "$base" =~ ^[A-Za-z0-9_]+$ ]] && return 0 ;;
  esac
  return 1
}

# _autopilot_repo_key — a stable per-repo key for the opt-in overlay (normalized git remote
# origin URL; fallback: a hash of the repo toplevel path). Prints the key, or nothing + returns
# 1 when the cwd is not a git repo. MUST stay byte-identical to the JS twin's repoKey().
_autopilot_repo_key() {
  local url top
  url="$(git config --get remote.origin.url 2>/dev/null)" || url=""
  if [ -n "$url" ]; then
    url="${url%.git}"      # strip trailing .git
    url="${url#*://}"      # strip scheme://
    url="${url#*@}"        # strip user@ (scp-style git@host:path)
    url="${url//[!A-Za-z0-9]/_}"
    printf '%s' "$url"; return 0
  fi
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || top=""
  if [ -n "$top" ]; then
    printf 'path_%s' "$(printf '%s' "$top" | cksum | cut -d' ' -f1)"; return 0
  fi
  return 1
}

# _autopilot_endpoints_gate_ok <file> — the perms safety gate for ONE credential file, WITHOUT
# parsing. Returns 0 if safe to load, 1 if rejected (warns to stderr). Split from the parse so
# the base file can be gated BEFORE any overlay is loaded (fail-closed ordering).
_autopilot_endpoints_gate_ok() {
  local envfile="$1"
  # Never follow a symlink — the target could be an attacker-controlled file.
  if [ -L "$envfile" ]; then
    printf 'load-endpoints-env: refusing symlink credential file: %s\n' "$envfile" >&2; return 1
  fi
  if [ ! -f "$envfile" ]; then
    printf 'load-endpoints-env: not a regular file, skipping: %s\n' "$envfile" >&2; return 1
  fi
  # Ownership — bash -O is TRUE iff the file is owned by the effective uid (portable, no stat).
  if [ ! -O "$envfile" ]; then
    printf 'load-endpoints-env: refusing credential file not owned by you: %s\n' "$envfile" >&2; return 1
  fi
  # Permission bits — GNU then BSD stat; empty ⇒ can't verify ⇒ fail closed.
  local mode
  mode="$(stat -c '%a' "$envfile" 2>/dev/null || stat -f '%Lp' "$envfile" 2>/dev/null || printf '')"
  if [ -z "$mode" ]; then
    printf 'load-endpoints-env: cannot determine permissions, refusing: %s\n' "$envfile" >&2; return 1
  fi
  # Force octal interpretation (leading 0). Group/other WRITE ⇒ injection vector ⇒ reject.
  if (( 0"$mode" & 022 )); then
    printf 'load-endpoints-env: refusing group/other-writable credential file (chmod 600 %s)\n' "$envfile" >&2; return 1
  fi
  # Group/other READ ⇒ confidentiality only ⇒ warn but proceed.
  if (( 0"$mode" & 044 )); then
    printf 'load-endpoints-env: WARNING credential file is group/other-readable (chmod 600 %s recommended)\n' "$envfile" >&2
  fi
  return 0
}

# _autopilot_endpoints_parse_into_env <file> — line-parse ONE ALREADY-GATED credential file into
# the env (existing non-empty env wins). Appends loaded KEY names to _AUTOPILOT_LOADED_ACC.
_autopilot_endpoints_parse_into_env() {
  local envfile="$1"
  local line key val
  # `|| [ -n "$line" ]` so a final line without a trailing newline is still processed.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"          # strip leading whitespace
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac            # comment
    case "$line" in export\ *) line="${line#export }"; line="${line#"${line%%[![:space:]]*}"}" ;; esac
    case "$line" in *=*) ;; *) continue ;; esac      # must be NAME=VALUE
    key="${line%%=*}"
    val="${line#*=}"
    case "$key" in *[![:alnum:]_]*) continue ;; esac # no trailing space / stray chars in key
    _autopilot_endpoints_key_allowed "$key" || continue
    # Strip ONE layer of matching surrounding quotes (literal — no escape processing).
    if [ "${#val}" -ge 2 ] && [ "${val:0:1}" = '"' ] && [ "${val: -1}" = '"' ]; then
      val="${val:1:${#val}-2}"
    elif [ "${#val}" -ge 2 ] && [ "${val:0:1}" = "'" ] && [ "${val: -1}" = "'" ]; then
      val="${val:1:${#val}-2}"
    fi
    # Existing non-empty env WINS — a file only fills gaps (so a base can't clobber an overlay
    # value loaded earlier, and a shell export beats both).
    if [ -z "${!key:-}" ]; then
      export "$key=$val"
      _AUTOPILOT_LOADED_ACC="${_AUTOPILOT_LOADED_ACC:+$_AUTOPILOT_LOADED_ACC }$key"
    fi
  done < "$envfile"
  return 0
}

# _autopilot_endpoints_load_file <file> — gate THEN parse (convenience for the overlay). Returns
# 1 on a gate rejection.
_autopilot_endpoints_load_file() {
  _autopilot_endpoints_gate_ok "$1" || return 1
  _autopilot_endpoints_parse_into_env "$1"
}

# autopilot_load_endpoints_env — populate the endpoint credential env from the by-user BASE file
# and, if the user opted into per-repo overlays, the matching OVERLAY file (loaded FIRST so it
# wins). Precedence: process env > overlay > base. Sets AUTOPILOT_ENDPOINTS_LOADED to the loaded
# KEY names (never values). Returns 0 on success/no-op, 1 on a BASE-file rejection.
#
# FAIL-CLOSED ORDERING (panel finding, v2.31.8): the base file is GATED FIRST. If a base file is
# PRESENT but fails the safety gate (symlink / not-owned / group-writable / unverifiable perms),
# the credential store is in an unsafe state ⇒ load NOTHING (not even a valid overlay) and return
# 1, so a caller seeing the rejection can trust that no secret entered the env.
autopilot_load_endpoints_env() {
  set +x
  # ${HOME:-} — a caller under `set -u` with HOME unset (e.g. `env -i`) must not crash here.
  local base="${AUTOPILOT_ENDPOINTS_ENV:-${HOME:-}/.autopilot/endpoints.env}"
  AUTOPILOT_ENDPOINTS_LOADED=""; _AUTOPILOT_LOADED_ACC=""

  # Gate the base FIRST. Present-but-rejected ⇒ fail closed, load nothing.
  local base_present=0
  if [ -e "$base" ] || [ -L "$base" ]; then
    base_present=1
    _autopilot_endpoints_gate_ok "$base" || return 1
  fi

  # Opt-in per-repo overlay — ONLY if the user created the endpoints.d/ dir. When absent this is
  # a pure no-op (no git calls, byte-identical to base-only), so overlays cost nothing by default.
  local overlaydir; overlaydir="$(dirname "$base")/endpoints.d"
  if [ -d "$overlaydir" ]; then
    local key overlayfile
    key="$(_autopilot_repo_key 2>/dev/null)" || key=""
    if [ -n "$key" ]; then
      overlayfile="$overlaydir/$key.env"
      if [ -e "$overlayfile" ] || [ -L "$overlayfile" ]; then
        _autopilot_endpoints_load_file "$overlayfile" || true   # best-effort; warns inside
      fi
    fi
  fi

  # Base values (already gated above).
  if [ "$base_present" -eq 1 ]; then
    _autopilot_endpoints_parse_into_env "$base"
  fi

  AUTOPILOT_ENDPOINTS_LOADED="$_AUTOPILOT_LOADED_ACC"
  return 0
}

# autopilot_init_endpoints_env — idempotently scaffold a mode-600 commented STUB (no secrets)
# at the canonical path if absent, by COPYING the tracked canonical template
# `endpoints.env.example` shipped alongside this script (single source of truth). If the
# template is somehow absent (partial install) it falls back to a minimal inline stub + warns.
# Never clobbers an existing file. Returns 0 (created OR already-present), 1 on a write failure.
autopilot_init_endpoints_env() {
  set +x
  local envfile="${AUTOPILOT_ENDPOINTS_ENV:-${HOME:-}/.autopilot/endpoints.env}"
  if [ -e "$envfile" ] || [ -L "$envfile" ]; then
    printf 'load-endpoints-env: already exists, not overwriting: %s\n' "$envfile" >&2
    return 0
  fi
  local dir; dir="$(dirname "$envfile")"
  # -m 700 on the credential dir (matches the CLI's mkdir mode) so the endpoint filenames aren't
  # world/group-listable; the files themselves are 600.
  mkdir -p -m 700 "$dir" 2>/dev/null || mkdir -p "$dir" 2>/dev/null || { printf 'load-endpoints-env: cannot create %s\n' "$dir" >&2; return 1; }
  # Locate the tracked canonical template (ships in the same dir as this script).
  local selfdir template=""
  selfdir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || selfdir=""
  [ -n "$selfdir" ] && [ -f "$selfdir/endpoints.env.example" ] && template="$selfdir/endpoints.env.example"
  # umask 077 so the transient file is private from creation; chmod 600 belt-and-braces.
  local old_umask; old_umask="$(umask)"; umask 077
  if [ -n "$template" ]; then
    cp "$template" "$envfile" 2>/dev/null || { umask "$old_umask" 2>/dev/null; printf 'load-endpoints-env: cannot write %s\n' "$envfile" >&2; return 1; }
  else
    printf 'load-endpoints-env: WARNING canonical template endpoints.env.example not found; writing a minimal stub\n' >&2
    cat > "$envfile" <<'STUB' || { umask "$old_umask" 2>/dev/null; printf 'load-endpoints-env: cannot write %s\n' "$envfile" >&2; return 1; }
# ~/.autopilot/endpoints.env — mode 600. Fill AUTOPILOT_ENDPOINT_<NAME>_URL + _TOKEN (never commit).
# See docs/installation.md § Heterogeneous engine credentials.
STUB
  fi
  umask "$old_umask" 2>/dev/null || true
  chmod 600 "$envfile" 2>/dev/null || true
  printf 'load-endpoints-env: created %s (chmod 600; edit to add tokens)\n' "$envfile" >&2
  return 0
}

# Executed directly (not sourced) ⇒ run against the default file + print a NON-SECRET summary.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  case "${1:-}" in
    --help|-h) sed -n '2,40p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0 ;;
    --init) autopilot_init_endpoints_env; exit $? ;;
    --repo-key) _autopilot_repo_key && printf '\n' || exit 1; exit 0 ;;
    "") ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  autopilot_load_endpoints_env; _rc=$?
  if [ "$_rc" -eq 0 ]; then
    printf 'load-endpoints-env: loaded [%s]\n' "${AUTOPILOT_ENDPOINTS_LOADED:-}" >&2
  fi
  exit "$_rc"
fi
