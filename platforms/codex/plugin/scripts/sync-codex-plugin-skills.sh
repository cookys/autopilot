#!/usr/bin/env bash
# sync-codex-plugin-skills.sh — materialize the Codex plugin payload.
#
# Codex plugin installation does not copy through symlinked skill directories, so
# platforms/codex/plugin/skills must be a real directory. The copied skills also
# reference repo-level support files through relative paths, so this script copies
# the supporting references/scripts/templates/docs needed by the skill text while
# still keeping the Codex manifest itself skills-only.

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/skills"
PLUGIN="$REPO/platforms/codex/plugin"

if [ ! -d "$SRC" ]; then
  echo "error: source skills directory missing: $SRC" >&2
  exit 1
fi

if ! find "$SRC" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo "error: source skills directory is empty: $SRC" >&2
  exit 1
fi

sync_dir() {
  local rel="$1"
  local src="$REPO/$rel"
  local dst="$PLUGIN/$rel"

  if [ ! -d "$src" ]; then
    echo "error: source directory missing: $src" >&2
    exit 1
  fi

  rm -rf "$dst"
  mkdir -p "$dst"

  if command -v rsync >/dev/null 2>&1; then
    rsync -aL --delete "$src/" "$dst/"
  else
    (cd "$src" && tar -chf - .) | (cd "$dst" && tar -xf -)
  fi
}

copy_file() {
  local rel="$1"
  local src="$REPO/$rel"
  local dst="$PLUGIN/$rel"

  if [ ! -f "$src" ]; then
    echo "error: source file missing: $src" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

sync_dir "skills"
sync_dir "bin"
sync_dir "src"
sync_dir "hooks/_shared"
sync_dir "references"
sync_dir "scripts"
sync_dir "project-config-template"

rm -rf "$PLUGIN/docs"
copy_file "docs/plans/2026-06-04-distill-consolidate.md"
copy_file "docs/plans/2026-06-22-ceo-fleet-autonomy.md"
copy_file "docs/plans/2026-06-26-trust-tiered-review-policy.md"
copy_file "docs/projects/2026-06-26-test-integrity-l1/design-spec.md"

echo "synced Codex plugin payload: platforms/codex/plugin"
