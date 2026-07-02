#!/usr/bin/env bash
# resolve-endpoint.sh — resolve a named Anthropic-compatible endpoint's credentials
# to NON-SECRET metadata, for the env-token hetero-dispatch families (MiniMax / GLM /
# any Anthropic-compatible endpoint). Sibling of resolve-doa.sh / resolve-qc-gate.sh.
#
# SECRET HYGIENE — this script NEVER writes a token VALUE to stdout, stderr, or any
# log. It emits only metadata: the base URL (non-secret), the NAME of the env var
# holding the token (token_env), and booleans. Callers read "$token_env" themselves,
# so the secret value never transits this script's captured stdout. As defence in
# depth it also DISABLES xtrace at entry (see below) so an inherited `bash -x` /
# SHELLOPTS=xtrace cannot leak a token value via a traced command substitution.
#
# Usage:
#   scripts/resolve-endpoint.sh <name>      # -> one JSON object
#   scripts/resolve-endpoint.sh --list      # -> JSON array of ready endpoints
#   scripts/resolve-endpoint.sh --help
#
# ATOMIC candidate resolution (a candidate = a url+token PAIR; bind BOTH from the
# SAME candidate, never cross-combine a url from one with a token from another):
#   1) autopilot-namespace — trigger: EITHER AUTOPILOT_ENDPOINT_<NAME>_URL OR _TOKEN
#      set. Binds both from the namespace; NO fallthrough (partial => ready:false).
#   2) provider-native — trigger: name=="minimax" ONLY. url AUTOPILOT_MINIMAX_BASE_URL
#      else default https://api.minimax.io/anthropic; token MINIMAX_API_KEY.
#   3) generic-compatible — any other name: url ANTHROPIC_COMPATIBLE_BASE_URL,
#      token ANTHROPIC_COMPATIBLE_AUTH_TOKEN.
#
# JSON: {name, base_url, base_url_source, token_env, token_present, url_safe, ready,
#        missing[], source}. ready = base_url non-empty AND token_present AND url_safe.
# Exit: 0 ready · 1 not-ready · 2 usage error. Fail-closed.

set -uo pipefail

# --- secret-hygiene: refuse to run traced (a token value would leak via an assignment
# trace even though we read it through indirect expansion). `set +x` disables xtrace
# AND (bash auto-maintains SHELLOPTS) removes it from SHELLOPTS, so subshells / command
# substitutions inherit the untraced state too — verified to defeat an inherited
# `bash -x` and `SHELLOPTS=xtrace`. Done first, before any env is touched. (Do NOT try to
# assign SHELLOPTS directly — it is readonly and would print a `readonly variable` error.) ---
set +x

ENV_NAME_RE='^[A-Za-z_][A-Za-z0-9_]*$'
NAME_RE='^[A-Za-z0-9_]+$'

usage() {
  sed -n '2,31p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# json_array <element>... -> a valid JSON array of the (escaped) string elements.
json_array() {
  local out='[' first=1 item
  for item in "$@"; do
    if [ "$first" -eq 1 ]; then first=0; else out+=','; fi
    out+="\"$(json_escape "$item")\""
  done
  out+=']'
  printf '%s' "$out"
}

# token_is_present <ENV_VAR_NAME> -> exit 0 if the named var is set and non-empty.
# Reads via indirect expansion; NEVER echoes the value. xtrace already disabled.
token_is_present() {
  local name="$1"
  [[ "$name" =~ $ENV_NAME_RE ]] || return 1
  [ -n "${!name-}" ]
}

# resolve_single <name> -> sets RESULT_* globals; returns 0 iff ready.
RESULT_NAME=""; RESULT_BASE_URL=""; RESULT_BASE_URL_SOURCE=""; RESULT_TOKEN_ENV=""
RESULT_TOKEN_PRESENT="false"; RESULT_URL_SAFE="false"; RESULT_READY="false"
RESULT_SOURCE=""; RESULT_MISSING=()

is_url_safe() {
  local url="$1"
  [ -n "$url" ] || return 1
  case "$url" in
    https://*) return 0 ;;
  esac
  # http:// is only acceptable for loopback hosts
  if [[ "$url" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$) ]]; then
    return 0
  fi
  return 1
}

resolve_single() {
  local raw="$1"
  local name_lc="${raw,,}"
  local name_uc="${raw^^}"
  local ns_url_var="AUTOPILOT_ENDPOINT_${name_uc}_URL"
  local ns_token_var="AUTOPILOT_ENDPOINT_${name_uc}_TOKEN"

  local base_url="" base_url_source="none" token_env="" source=""
  local token_present="false" url_safe="false" ready="false"
  local -a missing=()

  # Trigger detection uses PRESENCE (var is SET, even if empty) via ${!name+x} — NOT
  # non-empty. A user who exports AUTOPILOT_ENDPOINT_<NAME>_URL= (set but empty) clearly
  # intends this endpoint; it must trigger candidate 1 and fail closed, NOT silently fall
  # through to a generic/provider token (gpt-5.5 R2 — set-but-empty fall-through was fail-open).
  local ns_url_set=0 ns_token_set=0
  [ -n "${!ns_url_var+x}" ] && ns_url_set=1
  [ -n "${!ns_token_var+x}" ] && ns_token_set=1

  if [ "$ns_url_set" -eq 1 ] || [ "$ns_token_set" -eq 1 ]; then
    # candidate 1: autopilot-namespace (atomic — no fallthrough)
    source="autopilot-namespace"
    token_env="$ns_token_var"
    base_url="${!ns_url_var-}"
    if [ -n "$base_url" ]; then base_url_source="env"; else missing+=("$ns_url_var"); fi
    if token_is_present "$token_env"; then token_present="true"; else missing+=("$ns_token_var"); fi
  elif [ "$name_lc" = "minimax" ]; then
    # candidate 2: provider-native (minimax ONLY)
    source="provider-native"
    token_env="MINIMAX_API_KEY"
    if [ -n "${AUTOPILOT_MINIMAX_BASE_URL:-}" ]; then
      base_url="$AUTOPILOT_MINIMAX_BASE_URL"; base_url_source="env"
    else
      base_url="https://api.minimax.io/anthropic"; base_url_source="default"
    fi
    if token_is_present "$token_env"; then token_present="true"; else missing+=("$token_env"); fi
  else
    # candidate 3: generic-compatible
    source="generic-compatible"
    token_env="ANTHROPIC_COMPATIBLE_AUTH_TOKEN"
    base_url="${ANTHROPIC_COMPATIBLE_BASE_URL:-}"
    if [ -n "$base_url" ]; then base_url_source="env"; else missing+=("ANTHROPIC_COMPATIBLE_BASE_URL"); fi
    if token_is_present "$token_env"; then token_present="true"; else missing+=("$token_env"); fi
  fi

  if is_url_safe "$base_url"; then url_safe="true"; else missing+=("url_unsafe"); fi

  if [ "$token_present" = "true" ] && [ -n "$base_url" ] && [ "$url_safe" = "true" ]; then
    ready="true"
  fi

  RESULT_NAME="$name_lc"; RESULT_BASE_URL="$base_url"; RESULT_BASE_URL_SOURCE="$base_url_source"
  RESULT_TOKEN_ENV="$token_env"; RESULT_TOKEN_PRESENT="$token_present"; RESULT_URL_SAFE="$url_safe"
  RESULT_READY="$ready"; RESULT_SOURCE="$source"; RESULT_MISSING=("${missing[@]}")

  [ "$ready" = "true" ]
}

emit_result_json() {
  printf '{"name":"%s","base_url":"%s","base_url_source":"%s","token_env":"%s","token_present":%s,"url_safe":%s,"ready":%s,"missing":%s,"source":"%s"}\n' \
    "$(json_escape "$RESULT_NAME")" "$(json_escape "$RESULT_BASE_URL")" "$(json_escape "$RESULT_BASE_URL_SOURCE")" \
    "$(json_escape "$RESULT_TOKEN_ENV")" "$RESULT_TOKEN_PRESENT" "$RESULT_URL_SAFE" "$RESULT_READY" \
    "$(json_array "${RESULT_MISSING[@]}")" "$(json_escape "$RESULT_SOURCE")"
}

# --- arg parse ---
NAME="" LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --list) LIST=1; shift ;;
    --*) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
    *)
      if [ -n "$NAME" ]; then printf 'unexpected extra argument: %s\n' "$1" >&2; exit 2; fi
      NAME="$1"; shift ;;
  esac
done

if [ "$LIST" -eq 1 ] && [ -n "$NAME" ]; then
  printf -- '--list cannot be combined with a name argument\n' >&2; exit 2
fi
if [ "$LIST" -eq 0 ] && [ -z "$NAME" ]; then
  printf 'usage: resolve-endpoint.sh <name> | --list | --help\n' >&2; exit 2
fi

if [ -n "$NAME" ]; then
  if ! [[ "$NAME" =~ $NAME_RE ]]; then
    printf 'invalid endpoint name (allowed: %s): %s\n' "$NAME_RE" "$NAME" >&2; exit 2
  fi
  resolve_single "$NAME"; rc=$?
  emit_result_json
  exit "$rc"
fi

# --- --list: enumerate namespaced endpoints (compgen — never parse env) + canonical minimax ---
declare -A SEEN=()
while IFS= read -r var; do
  case "$var" in
    AUTOPILOT_ENDPOINT_*_URL|AUTOPILOT_ENDPOINT_*_TOKEN)
      base="${var#AUTOPILOT_ENDPOINT_}"
      base="${base%_URL}"; base="${base%_TOKEN}"
      [[ "$base" =~ $NAME_RE ]] && SEEN["${base,,}"]=1 ;;
  esac
done < <(compgen -v AUTOPILOT_ENDPOINT_ 2>/dev/null || true)
SEEN["minimax"]=1

declare -a ready_json=()
while IFS= read -r nm; do
  [ -z "$nm" ] && continue
  if resolve_single "$nm"; then
    ready_json+=("{\"name\":\"$(json_escape "$RESULT_NAME")\",\"base_url\":\"$(json_escape "$RESULT_BASE_URL")\",\"source\":\"$(json_escape "$RESULT_SOURCE")\"}")
  fi
done < <(printf '%s\n' "${!SEEN[@]}" | sort)

out='['; first=1
for obj in "${ready_json[@]:-}"; do
  [ -z "$obj" ] && continue
  if [ "$first" -eq 1 ]; then first=0; else out+=','; fi
  out+="$obj"
done
out+=']'
printf '%s\n' "$out"
exit 0
