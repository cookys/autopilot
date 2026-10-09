# shellcheck shell=bash
# json-emit.sh — sourceable JSON string/array helpers (no side effects at source).
#
# Provides:
#   json_escape <string>              → RFC 8259-correct escaped content (no surrounding quotes)
#   json_array_from_lines <text>      → ["a","b",...] from newline-separated input (blank → skip; empty → [])
#
# Pure bash (no subprocess) for json_escape so sandboxed/agy hosts stay safe.
# Double-source is a no-op (worktree-reap.sh and dispatch-hetero.sh both may source this).
#
# INTENDED divergence from the pre-consolidation flatten-class emitters
# (2026-07-16 P2 QC note): the old `sed|tr '\n' ' '` idiom passed raw
# TAB/CR/control bytes THROUGH (technically-invalid JSON); this lib escapes
# them (\t/\r/\uXXXX). Newline-free control-char-bearing inputs therefore
# differ from the old bytes — deliberately, in the valid-JSON direction.
# Do not mistake that for a migration regression.

[ -n "${_AUTOPILOT_JSON_EMIT_SH:-}" ] && return 0
_AUTOPILOT_JSON_EMIT_SH=1

# json_escape <string>
# Escapes for a JSON string value (without surrounding quotes):
#   \ → \\, " → \", U+0008 → \b, U+0009 → \t, U+000A → \n,
#   U+000C → \f, U+000D → \r, other U+0000..U+001F → \uXXXX (lowercase, 4-digit).
# All other bytes pass through. % is safe (never used as a printf format).
json_escape() {
  local input="${1:-}" out="" ch esc code i
  local LC_ALL=C
  for ((i = 0; i < ${#input}; i++)); do
    ch="${input:i:1}"
    case "$ch" in
      '"') out+='\"' ;;
      '\') out+='\\' ;;
      $'\b') out+='\b' ;;
      $'\f') out+='\f' ;;
      $'\n') out+='\n' ;;
      $'\r') out+='\r' ;;
      $'\t') out+='\t' ;;
      *)
        printf -v code '%d' "'$ch"
        if [ "$code" -lt 32 ]; then
          printf -v esc '\\u%04x' "$code"
          out+="$esc"
        else
          out+="$ch"
        fi
        ;;
    esac
  done
  printf '%s' "$out"
}

# json_array_from_lines <newline-separated> → ["a","b",...] (empty/blank-only → [])
# Skips blank lines; joins with ", "; each element is "…json_escape…".
# Elements are newline-free by construction (split on newline).
json_array_from_lines() {
  local items="$1" out="" first=1 line
  [ -z "$items" ] && { printf '[]'; return; }
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$first" = 1 ]; then first=0; else out="$out, "; fi
    out="$out\"$(json_escape "$line")\""
  done <<< "$items"
  printf '[%s]' "$out"
}
