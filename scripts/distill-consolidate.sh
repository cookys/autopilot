#!/usr/bin/env bash
# distill-consolidate.sh — cross-machine consolidation plumbing for the distill pack.
#
# The distill pack (~/.claude/skills/autopilot-distill-skills/) is a private git repo
# synced across a fleet. When two machines distil the SAME recurring procedure they can
# write the same skill on divergent paths/content. This script provides the DETERMINISTIC
# (no-LLM) plumbing the `distill` skill drives the human-gated LLM merge on top of:
#
#   normalize-slug <raw>   canonical, machine-stable slug so two machines naming the same
#                          procedure converge on ONE path (the precondition for any merge).
#                          lowercase + drop stopwords + PRESERVE token order (no sort).
#   migrate [pack-dir]     one-time backfill: git mv existing skills/<slug>/ dirs to their
#                          normalized slug. Two existing dirs → same normalized slug = a real
#                          consolidation case → STOP (never auto-merge in migrate).
#   compare <slug> [pack]  PROACTIVE divergence check (no merge-conflict state): fetch, then
#                          diff working-tree skills/<slug>/SKILL.md against the pack's upstream
#                          @{u} blob. JSON: identical | divergent | absent-theirs | absent-mine.
#
# The LLM merge + human gate + commit live in the `distill` SKILL.md (Step 5), not here —
# this script never invokes an LLM and never writes a SKILL.md body (mirrors distill-scan.js's
# "no LLM in the count path"). Executable companion to skills/distill/references/sync-setup.md.
#
# Usage:
#   scripts/distill-consolidate.sh normalize-slug <raw-slug>
#   scripts/distill-consolidate.sh migrate [pack-dir]        # default: the pack
#   scripts/distill-consolidate.sh compare <slug> [pack-dir]  # JSON to stdout
#   scripts/distill-consolidate.sh --help
#
# Exit codes: 0 ok / 2 usage error / 1 action failed (e.g. migrate collision, no upstream).
set -euo pipefail

PACK_DIR_DEFAULT="${AUTOPILOT_DISTILL_PACK_DIR:-$HOME/.claude/skills/autopilot-distill-skills}"
# Stopwords: conservative procedure-verb noise with NO common antonym (so we never collapse
# `add-user` vs `remove-user`). Override by placing one-per-line tokens in this file (REPLACES
# the default set). Kept tiny on purpose — the human gate is the backstop for over-collapse.
STOPWORD_FILE="${AUTOPILOT_DISTILL_STOPWORDS:-$HOME/.autopilot/distill/slug-stopwords}"
DEFAULT_STOPWORDS="fix ensure setup configure update the a an"

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

stopwords() {
  if [ -f "$STOPWORD_FILE" ]; then
    tr '[:upper:]' '[:lower:]' < "$STOPWORD_FILE" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//'
  else
    printf '%s' "$DEFAULT_STOPWORDS"
  fi
}

# normalize-slug: lowercase → split on -/_/space → drop stopwords → PRESERVE order → join with -.
# Never emits an empty slug (if every token is a stopword, fall back to the lowercased original).
normalize_slug() {
  local raw="${1:-}"
  [ -n "$raw" ] || { echo "normalize-slug: empty slug" >&2; return 2; }
  local lc; lc="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  # build a lookup of stopwords
  local sw; sw=" $(stopwords) "
  local out="" tok
  # split on - _ and whitespace
  local cleaned; cleaned="$(printf '%s' "$lc" | tr '_/ ' '---' | tr -s '-')"
  local IFS='-'
  for tok in $cleaned; do
    [ -n "$tok" ] || continue
    case "$sw" in *" $tok "*) continue ;; esac   # drop stopword token
    out="${out:+$out-}$tok"
  done
  if [ -z "$out" ]; then
    # all-stopword slug: keep the lowercased, hyphen-collapsed original rather than emit ""
    out="$(printf '%s' "$cleaned" | sed 's/^-//; s/-$//')"
  fi
  printf '%s\n' "$out"
}

# resolve the pack dir argument (default to the pack), require it be a git work-tree
require_pack() {
  local dir="${1:-$PACK_DIR_DEFAULT}"
  [ -d "$dir" ] || { echo "consolidate: pack dir not found: $dir" >&2; return 1; }
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { echo "consolidate: not a git work-tree: $dir" >&2; return 1; }
  printf '%s' "$dir"
}

# migrate: rename each skills/<slug>/ to its normalized slug. Collision (two existing → same
# target) is a genuine consolidation case → STOP. Idempotent: already-normalized dirs are skipped.
cmd_migrate() {
  local pack; pack="$(require_pack "${1:-}")" || return 1
  [ -d "$pack/skills" ] || { echo '{"migrated":[],"collisions":[],"note":"no skills/ dir"}'; return 0; }
  local -A target_of=() src_of=()
  local moved=() collisions=() d slug norm
  # pass 1: detect collisions BEFORE moving anything (validate-all-then-act, like sync-version.js)
  for d in "$pack"/skills/*/; do
    [ -d "$d" ] || continue
    slug="$(basename "$d")"
    norm="$(normalize_slug "$slug")"
    if [ -n "${src_of[$norm]:-}" ] && [ "${src_of[$norm]}" != "$slug" ]; then
      collisions+=("$slug+${src_of[$norm]}=>$norm")
    fi
    src_of[$norm]="$slug"
    target_of[$slug]="$norm"
  done
  if [ "${#collisions[@]}" -gt 0 ]; then
    printf '{"migrated":[],"collisions":[%s],"note":"two skills normalize to one slug — real consolidation case; resolve by hand or via the consolidate flow, NOT migrate"}\n' \
      "$(printf '"%s",' "${collisions[@]}" | sed 's/,$//')" >&2
    return 1
  fi
  # pass 2: act
  for slug in "${!target_of[@]}"; do
    norm="${target_of[$slug]}"
    [ "$slug" != "$norm" ] || continue
    git -C "$pack" mv "skills/$slug" "skills/$norm"
    moved+=("$slug=>$norm")
  done
  if [ "${#moved[@]}" -gt 0 ]; then
    printf '{"migrated":[%s],"collisions":[],"note":"git mv staged — review and commit"}\n' \
      "$(printf '"%s",' "${moved[@]}" | sed 's/,$//')"
  else
    printf '{"migrated":[],"collisions":[],"note":"all slugs already normalized"}\n'
  fi
}

# compare: PROACTIVE — no merge-conflict state is ever entered. Fetch, then diff the working-tree
# SKILL.md against the upstream @{u} blob. This is the v3 design: detect divergence BEFORE committing
# so the LLM merge happens in the clean working tree, never inside a held rebase/merge transaction.
cmd_compare() {
  local slug="${1:-}"; [ -n "$slug" ] || { echo "compare: missing <slug>" >&2; return 2; }
  local pack; pack="$(require_pack "${2:-}")" || return 1
  local rel="skills/$slug/SKILL.md"
  # require a configured upstream (set by distill-sync-setup.sh `push -u`). Never guess origin/<branch>.
  local up
  if ! up="$(git -C "$pack" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    echo '{"status":"error","reason":"no upstream configured (@{u}); run distill-sync-setup.sh init-remote/enroll first"}' >&2
    return 1
  fi
  git -C "$pack" fetch --quiet origin 2>/dev/null || true
  local mine theirs have_mine=1 have_theirs=1
  mine="$(cat "$pack/$rel" 2>/dev/null)" || have_mine=0
  [ -f "$pack/$rel" ] || have_mine=0
  theirs="$(git -C "$pack" show "$up:$rel" 2>/dev/null)" || have_theirs=0
  local status
  if [ "$have_mine" = 0 ] && [ "$have_theirs" = 0 ]; then status="absent-both"
  elif [ "$have_mine" = 0 ]; then status="absent-mine"
  elif [ "$have_theirs" = 0 ]; then status="absent-theirs"
  elif [ "$mine" = "$theirs" ]; then status="identical"
  else status="divergent"
  fi
  printf '{"status":"%s","slug":"%s","upstream":"%s","path":"%s"}\n' "$status" "$slug" "$up" "$rel"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    normalize-slug) shift; normalize_slug "${1:-}" ;;
    migrate)        shift; cmd_migrate "${1:-}" ;;
    compare)        shift; cmd_compare "${1:-}" "${2:-}" ;;
    -h|--help|'')   usage ;;
    *)              echo "unknown command: $cmd" >&2; usage >&2; return 2 ;;
  esac
}
main "$@"
