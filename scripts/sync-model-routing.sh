#!/usr/bin/env bash
# sync-model-routing.sh — regenerate the in-skill model-routing.md copies from the
# canonical references/model-routing.md (surface-area-reduction B3, 2026-07-04).
#
# WHY copies at all: four skills link `references/model-routing.md` relative to their
# own directory; keeping real files at those paths means ZERO link breakage across
# every consumer (Claude Code, codex payload rsync, OpenCode, agy export — symlinks
# were ruled out because rsync -L / archive exports divorce them). The copies are
# GENERATED ARTIFACTS: the single maintenance truth is the canonical. Hand-edits to a
# copy are rejected by the pre-commit gate (check-canonical-invariants.sh mirror mode).
#
# USAGE:
#   scripts/sync-model-routing.sh           # overwrite the 4 copies from canonical
#   scripts/sync-model-routing.sh --check   # read-only byte-parity check (exit 1 on drift)
#
# Ritual: edit references/model-routing.md → run this script → commit canonical + copies
# together. The relative-link lint runs before any write: a canonical with relative
# links is refused (each copy resolves them at a different depth — repo-root-stable
# paths only).
#
# EXIT: 0 = in sync (or synced); 1 = drift found (--check) / lint refused; 2 = usage/env.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

CANONICAL="references/model-routing.md"
COPIES=(
  "skills/dev-flow/references/model-routing.md"
  "skills/quality-pipeline/references/model-routing.md"
  "skills/survey/references/model-routing.md"
  "skills/think-tank/references/model-routing.md"
)

MODE="sync"
case "${1:-}" in
  --check) MODE="check" ;;
  --help|-h) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

[ -f "$CANONICAL" ] || { echo "✗ canonical missing: $CANONICAL" >&2; exit 2; }

# Lint: no relative markdown links in the canonical (copies live at other depths).
REL_HITS=$(grep -nE '\]\((\.\./|\./)' -- "$CANONICAL" || true)
if [ -n "$REL_HITS" ]; then
  echo "✗ $CANONICAL contains relative markdown links — refuse to propagate:" >&2
  echo "$REL_HITS" | sed 's/^/    /' >&2
  echo "  Use repo-root-stable paths or absolute URLs in the canonical." >&2
  exit 1
fi

DRIFT=0
for copy in "${COPIES[@]}"; do
  if [ "$MODE" = "check" ]; then
    if [ -L "$copy" ]; then
      echo "✗ $copy is a symlink (must be a real generated file)" >&2; DRIFT=1
    elif ! cmp -s -- "$CANONICAL" "$copy"; then
      echo "✗ out of sync: $copy" >&2; DRIFT=1
    else
      echo "  ✓ $copy"
    fi
  else
    if [ -L "$copy" ]; then rm -- "$copy"; fi
    mkdir -p "$(dirname "$copy")"
    cp -- "$CANONICAL" "$copy"
    echo "  synced $copy"
  fi
done

if [ "$MODE" = "check" ]; then
  if [ "$DRIFT" = "1" ]; then
    echo "✗ model-routing copies drifted — run scripts/sync-model-routing.sh" >&2
    exit 1
  fi
  echo "✓ all ${#COPIES[@]} copies byte-equal to $CANONICAL"
else
  echo "✓ ${#COPIES[@]} copies regenerated from $CANONICAL"
fi
