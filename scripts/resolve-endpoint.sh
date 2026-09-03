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
# <name> is [A-Za-z0-9_] (case-insensitive; uppercased into the env-var suffix, e.g. `glm`
# and `GLM` both map to AUTOPILOT_ENDPOINT_GLM_{URL,TOKEN}). Hyphens are NOT allowed — env
# var names can't contain them; use `_` (e.g. `local_llama`, not `local-llama`).
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
# TRANSPORT POLICY (url_safe). https:// is always acceptable. http:// is acceptable for
# loopback hosts (localhost / 127.0.0.1 / [::1]) — and, ONLY when the endpoint opts in with
#   AUTOPILOT_ENDPOINT_<NAME>_TRANSPORT=plaintext-private
# for an IP LITERAL in a private range: RFC1918 (10/8, 172.16/12, 192.168/16), link-local
# 169.254/16, IPv6 ULA fc00::/7 and link-local fe80::/10. Hostnames are never accepted over
# plaintext (DNS can resolve anywhere), nor are public addresses. The opt-in is per endpoint,
# namespace-candidate only, and is DISCLOSED: the JSON carries transport_security and a
# plaintext_private resolution prints one warning line on stderr. A plaintext LAN endpoint
# sends the bearer AND every prompt (repository contents) in the clear — the flag is for a
# single-operator LAN with a local model, not a substitute for TLS on a shared network.
# Any other _TRANSPORT value => url_unsafe + missing marker transport_value_invalid.
#
# Single-<name> JSON (full object): {name, base_url, base_url_source, token_env,
#        token_present, url_safe, transport_security, ready, missing[], source}.
#        ready = base_url non-empty AND token_present AND url_safe.
#        transport_security: "tls" | "loopback" | "plaintext_private" | "" (unsafe/none).
#        missing[] markers beyond var names: url_unsafe, transport_optin_required (private
#        http without the opt-in), transport_private_range_required (opt-in set but the host
#        is not a private-range IP literal), transport_value_invalid.
# `--list` JSON (deliberately SLIMMER — a discovery summary, NOT the full object): an
#        ARRAY of only-ready endpoints, each {name, base_url, transport_security, source}.
#        Never token values.
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

usage() { sed -n '2,52p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'; }

# shellcheck source=lib/json-emit.sh
. "$(dirname "$0")/lib/json-emit.sh"

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
RESULT_SOURCE=""; RESULT_MISSING=(); RESULT_TRANSPORT=""

# _ipv4_octets_ok <a.b.c.d> -> 0 iff every octet is 0..255 (the regexes below only bound
# digit COUNT; 999.168.1.1 must not pass as private).
_ipv4_octets_ok() {
  local IFS=. o
  for o in $1; do
    [[ "$o" =~ ^[0-9]{1,3}$ ]] || return 1
    [ "$((10#$o))" -le 255 ] || return 1
  done
  return 0
}

# _host_is_private_literal <host> -> 0 iff <host> is an IP LITERAL in a private range.
# IPv4: 10/8, 172.16/12, 192.168/16, 169.254/16. IPv6 (bracketed): fc00::/7 (fc.. / fd..),
# fe80::/10. Hostnames — including *.local / *.lan — are NOT accepted: only a literal is
# guaranteed to stay where the operator pointed it.
_host_is_private_literal() {
  local host="${1,,}"
  case "$host" in
    \[*\])
      host="${host#[}"; host="${host%]}"
      [[ "$host" =~ ^f[cd][0-9a-f]{2}:[0-9a-f:]*$ ]] && return 0
      [[ "$host" =~ ^fe[89ab][0-9a-f]:[0-9a-f:%]*$ ]] && return 0
      return 1 ;;
  esac
  [[ "$host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  _ipv4_octets_ok "$host" || return 1
  case "$host" in
    10.*) return 0 ;;
    192.168.*) return 0 ;;
    169.254.*) return 0 ;;
    172.*)
      local second="${host#172.}"; second="${second%%.*}"
      [ "$((10#$second))" -ge 16 ] && [ "$((10#$second))" -le 31 ] && return 0 ;;
  esac
  return 1
}

# is_url_safe <url> <transport-value> -> 0 iff the URL is acceptable under the transport
# policy (header). Sets URL_TRANSPORT_CLASS (tls|loopback|plaintext_private|"") and
# URL_UNSAFE_REASON ("" | transport_optin_required | transport_private_range_required |
# transport_value_invalid) for the caller's missing[] disclosure.
URL_TRANSPORT_CLASS=""; URL_UNSAFE_REASON=""
is_url_safe() {
  local url="$1" transport="${2:-}"
  URL_TRANSPORT_CLASS=""; URL_UNSAFE_REASON=""
  [ -n "$url" ] || return 1
  # A real endpoint URL has no whitespace, control chars, double-quotes, or backslashes.
  # Reject them so a crafted value can neither be marked ready nor break the callers'
  # sed/JSON extraction (a `"` would let a ready URL cut the shell-side parse short — R6/R7).
  case "$url" in
    *[[:space:][:cntrl:]]*) return 1 ;;
    *'"'*|*'\'*) return 1 ;;
  esac
  case "$transport" in
    ""|tls|plaintext-private) ;;
    *) URL_UNSAFE_REASON="transport_value_invalid"; return 1 ;;
  esac
  case "$url" in
    https://*) URL_TRANSPORT_CLASS="tls"; return 0 ;;
  esac
  # http:// loopback is always acceptable
  if [[ "$url" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$) ]]; then
    URL_TRANSPORT_CLASS="loopback"; return 0
  fi
  # http:// non-loopback: private-range IP literal, and ONLY with the explicit opt-in
  if [[ "$url" =~ ^http://(\[[^]/]+\]|[^/:\[]+)(:[0-9]+)?(/|$) ]]; then
    local host="${BASH_REMATCH[1]}"
    if _host_is_private_literal "$host"; then
      if [ "$transport" = "plaintext-private" ]; then
        URL_TRANSPORT_CLASS="plaintext_private"; return 0
      fi
      URL_UNSAFE_REASON="transport_optin_required"; return 1
    fi
    if [ "$transport" = "plaintext-private" ]; then
      URL_UNSAFE_REASON="transport_private_range_required"; return 1
    fi
  fi
  return 1
}

resolve_single() {
  local raw="$1"
  local name_lc="${raw,,}"
  local name_uc="${raw^^}"
  local ns_url_var="AUTOPILOT_ENDPOINT_${name_uc}_URL"
  local ns_token_var="AUTOPILOT_ENDPOINT_${name_uc}_TOKEN"
  local ns_transport_var="AUTOPILOT_ENDPOINT_${name_uc}_TRANSPORT"
  local transport=""

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
    # transport opt-in is a namespace-candidate property (there is no provider-native or
    # generic-compatible plaintext story — those are always public https).
    transport="${!ns_transport_var-}"
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

  local transport_security=""
  if is_url_safe "$base_url" "$transport"; then
    url_safe="true"; transport_security="$URL_TRANSPORT_CLASS"
  else
    missing+=("url_unsafe")
    [ -n "$URL_UNSAFE_REASON" ] && missing+=("$URL_UNSAFE_REASON")
  fi

  if [ "$token_present" = "true" ] && [ -n "$base_url" ] && [ "$url_safe" = "true" ]; then
    ready="true"
  fi

  RESULT_NAME="$name_lc"; RESULT_BASE_URL="$base_url"; RESULT_BASE_URL_SOURCE="$base_url_source"
  RESULT_TOKEN_ENV="$token_env"; RESULT_TOKEN_PRESENT="$token_present"; RESULT_URL_SAFE="$url_safe"
  RESULT_READY="$ready"; RESULT_SOURCE="$source"; RESULT_MISSING=("${missing[@]}")
  RESULT_TRANSPORT="$transport_security"
  if [ "$ready" = "true" ] && [ "$transport_security" = "plaintext_private" ]; then
    printf 'resolve-endpoint: WARNING endpoint %s is PLAINTEXT to a private-range address (%s): bearer and prompts travel unencrypted on this LAN (AUTOPILOT_ENDPOINT_%s_TRANSPORT=plaintext-private)\n' \
      "$name_lc" "$base_url" "$name_uc" >&2
  fi

  [ "$ready" = "true" ]
}

emit_result_json() {
  printf '{"name":"%s","base_url":"%s","base_url_source":"%s","token_env":"%s","token_present":%s,"url_safe":%s,"transport_security":"%s","ready":%s,"missing":%s,"source":"%s"}\n' \
    "$(json_escape "$RESULT_NAME")" "$(json_escape "$RESULT_BASE_URL")" "$(json_escape "$RESULT_BASE_URL_SOURCE")" \
    "$(json_escape "$RESULT_TOKEN_ENV")" "$RESULT_TOKEN_PRESENT" "$RESULT_URL_SAFE" "$(json_escape "$RESULT_TRANSPORT")" "$RESULT_READY" \
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
    ready_json+=("{\"name\":\"$(json_escape "$RESULT_NAME")\",\"base_url\":\"$(json_escape "$RESULT_BASE_URL")\",\"transport_security\":\"$(json_escape "$RESULT_TRANSPORT")\",\"source\":\"$(json_escape "$RESULT_SOURCE")\"}")
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
