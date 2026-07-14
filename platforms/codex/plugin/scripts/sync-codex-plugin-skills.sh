#!/usr/bin/env bash
# sync-codex-plugin-skills.sh — materialize or verify the Codex plugin payload.
#
# Codex plugin installation does not copy through symlinked skill directories, so
# platforms/codex/plugin/skills must be a real directory. The copied skills also
# reference repo-level support files through relative paths, so this script copies
# the supporting references/scripts/templates/docs needed by the skill text while
# still keeping the Codex manifest itself skills-only.
#
# Usage:
#   scripts/sync-codex-plugin-skills.sh          # rebuild committed mirror
#   scripts/sync-codex-plugin-skills.sh --check  # read-only drift check

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/skills"
PLUGIN="$REPO/platforms/codex/plugin"
MODE="sync"

case "${1:-}" in
  "")
    ;;
  --check)
    MODE="check"
    ;;
  -h|--help)
    sed -n '2,11p' "$0"
    exit 0
    ;;
  *)
    echo "error: unknown argument: $1" >&2
    exit 2
    ;;
esac

DIRS=(
  "skills"
  "bin"
  "src"
  "schemas"
  "hooks/_shared"
  "references"
  "scripts"
  "project-config-template"
)

SCRIPT_EXCLUDES=(
  "install-opencode.sh"
  "sync-opencode-plugin.sh"
)

DOC_FILES=(
  "docs/plans/2026-06-04-distill-consolidate.md"
  "docs/plans/2026-06-22-ceo-fleet-autonomy.md"
  "docs/plans/2026-06-26-trust-tiered-review-policy.md"
  "docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md"
)

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
    local args=(-aL --delete)
    if [ "$rel" = "scripts" ]; then
      local excluded
      for excluded in "${SCRIPT_EXCLUDES[@]}"; do
        args+=(--exclude "$excluded")
      done
    fi
    rsync "${args[@]}" "$src/" "$dst/"
  else
    local tar_args=(-chf -)
    if [ "$rel" = "scripts" ]; then
      local excluded
      for excluded in "${SCRIPT_EXCLUDES[@]}"; do
        tar_args+=(--exclude="./$excluded")
      done
    fi
    (cd "$src" && tar "${tar_args[@]}" .) | (cd "$dst" && tar -xf -)
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

check_dir() {
  local rel="$1"
  local src="$REPO/$rel"
  local dst="$PLUGIN/$rel"

  if [ ! -d "$src" ]; then
    echo "error: source directory missing: $src" >&2
    exit 1
  fi
  if [ ! -d "$dst" ]; then
    echo "drift: missing directory platforms/codex/plugin/$rel"
    return 1
  fi

  if [ "$rel" = "scripts" ]; then
    local args=(-qr)
    local excluded
    for excluded in "${SCRIPT_EXCLUDES[@]}"; do
      args+=(--exclude="$excluded")
    done
    diff "${args[@]}" "$src" "$dst"
    for excluded in "${SCRIPT_EXCLUDES[@]}"; do
      if [ -e "$dst/$excluded" ]; then
        echo "drift: excluded OpenCode installer leaked into platforms/codex/plugin/scripts/$excluded"
        return 1
      fi
    done
    return 0
  fi

  diff -qr "$src" "$dst"
}

check_file() {
  local rel="$1"
  local src="$REPO/$rel"
  local dst="$PLUGIN/$rel"

  if [ ! -f "$src" ]; then
    echo "error: source file missing: $src" >&2
    exit 1
  fi
  if [ ! -f "$dst" ]; then
    echo "drift: missing file platforms/codex/plugin/$rel"
    return 1
  fi
  if ! cmp -s "$src" "$dst"; then
    echo "drift: content differs platforms/codex/plugin/$rel"
    return 1
  fi
}

is_expected_doc_file() {
  local rel="$1"
  local expected
  for expected in "${DOC_FILES[@]}"; do
    [ "$rel" = "$expected" ] && return 0
  done
  return 1
}

check_doc_extras() {
  local docs_dir="$PLUGIN/docs"
  local rel
  local status=0

  [ -d "$docs_dir" ] || return 0

  while IFS= read -r rel; do
    if ! is_expected_doc_file "$rel"; then
      echo "drift: extra file platforms/codex/plugin/$rel"
      status=1
    fi
  done < <(cd "$PLUGIN" && find docs -type f | sort)

  return "$status"
}

if [ "$MODE" = "check" ]; then
  STATUS=0
  for rel in "${DIRS[@]}"; do
    check_dir "$rel" || STATUS=1
  done
  for rel in "${DOC_FILES[@]}"; do
    check_file "$rel" || STATUS=1
  done
  check_doc_extras || STATUS=1

  if [ "$STATUS" -eq 0 ]; then
    echo "Codex plugin payload in sync: platforms/codex/plugin"
  else
    echo "Codex plugin payload drift detected. To fix: scripts/sync-codex-plugin-skills.sh" >&2
  fi
  exit "$STATUS"
fi

for rel in "${DIRS[@]}"; do
  sync_dir "$rel"
done

rm -rf "$PLUGIN/docs"
for rel in "${DOC_FILES[@]}"; do
  copy_file "$rel"
done

echo "synced Codex plugin payload: platforms/codex/plugin"
