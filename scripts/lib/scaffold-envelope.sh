#!/usr/bin/env bash
# scaffold-envelope.sh — build the tiered prompt envelope (four-layer P1, D4).
#
# Sourced by dispatch-hetero.sh. Extracts the tier prompt skeletons from their single
# canonical home (references/scaffold-tiers.md — never restated here) and prepends the
# cumulative envelope for the effective tier: T0 ⊂ T1 ⊂ T2 (each tier adds a block).
#
# Functions:
#   scaffold_tier_rank <T0|T1|T2>          → 0|1|2 on stdout (scaffolding amount)
#   build_scaffold_envelope <tier> <tiers-doc> <prompt-file> <out-file>
#       Writes: skeleton blocks for T0..tier, placeholder-resolved, then the untouched
#       prompt body. Returns non-zero if the doc or its fences are missing (fail closed —
#       an envelope silently absent would defeat the mechanism).
set -uo pipefail

scaffold_tier_rank() {
  case "${1:-}" in
    T0) printf 0 ;;
    T1) printf 1 ;;
    T2) printf 2 ;;
    *) return 1 ;;
  esac
}

# Extract the fenced code block that follows the "### <tier> —" heading in the tiers doc.
_scaffold_block() { # $1 tier, $2 doc
  awk -v tier="$1" '
    $0 ~ "^### " tier " " { insection = 1; next }
    insection && /^```/ { if (infence) { exit } infence = 1; next }
    infence { print }
  ' "$2"
}

build_scaffold_envelope() { # $1 tier, $2 tiers-doc, $3 prompt-file, $4 out-file
  local tier="$1" doc="$2" prompt="$3" out="$4"
  [ -r "$doc" ] || { echo "scaffold-envelope: tiers doc not readable: $doc" >&2; return 1; }
  local rank; rank="$(scaffold_tier_rank "$tier")" || { echo "scaffold-envelope: bad tier: $tier" >&2; return 1; }
  {
    printf '%s\n' "=== SCAFFOLD ENVELOPE (tier $tier — references/scaffold-tiers.md) ==="
    local t
    for t in T0 T1 T2; do
      [ "$(scaffold_tier_rank "$t")" -le "$rank" ] || continue
      local block; block="$(_scaffold_block "$t" "$doc")"
      [ -n "$block" ] || { echo "scaffold-envelope: missing $t skeleton fence in $doc" >&2; return 1; }
      printf '%s\n\n' "$block"
    done
    printf '%s\n\n' '=== END SCAFFOLD ENVELOPE ==='
    cat "$prompt"
  } | sed 's/{project red lines, verbatim}/the red lines stated in the task prompt below and any campaign boundary above/' > "$out"
}
