#!/usr/bin/env bash
# sync-codex-plugin-skills.sh — materialize or verify the Codex plugin payload.
#
# Codex plugin installation does not copy through symlinked skill directories, so
# platforms/codex/plugin/skills must be a real directory. The copied skills also
# reference repo-level support files through relative paths, so this script copies
# the supporting references/scripts/templates/docs needed by the skill text while
# keeping the Codex manifest and production PostCompact hook payload generated. The retained
# pre-effect.js source/mirror is an unregistered, non-production probe helper only.
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
  "bin"
  "src"
  "profiles"
  "schemas"
  "evals/clean"
  "evals/known-bad"
  "hooks/_shared"
  "references"
  "scripts"
  "project-config-template"
)

PROJECTED_SKILLS=(
  "dev-flow"
  "ceo-agent"
  "l3"
  "l4"
  "l5"
  "l6"
  "finish-flow"
)

LIFECYCLE_ADAPTER="$REPO/platforms/codex/skill-adapters/lifecycle.md"
LIFECYCLE_ADAPTER_MARKER="AUTOPILOT_CODEX_LIFECYCLE_ADAPTER_V1"
LIFECYCLE_ADAPTER_DEST="skill-adapters/lifecycle.md"

SCRIPT_EXCLUDES=(
  "install-opencode.sh"
  "sync-opencode-plugin.sh"
)

DOC_FILES=(
  "docs/plans/2026-06-04-distill-consolidate.md"
  "docs/plans/2026-06-22-ceo-fleet-autonomy.md"
  "docs/plans/2026-06-26-trust-tiered-review-policy.md"
  "docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json"
  "docs/projects/_archive/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json"
  "docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md"
)

SUPPORT_FILES=(
  "evals/capability-evidence-corpus.json"
  "evals/owner-capability-evidence-corpus.json"
  "evals/owner-eval-generator.js"
  "evals/brain-eval-generator.js"
  "evals/brain-eval-grader.js"
  "evals/brain-capability-evidence-corpus.json"
  "evals/va-eval-generator.js"
  "evals/va-eval-grader.js"
  "evals/va-capability-evidence-corpus.json"
  "evals/reviewer-eval-generator.js"
)

HOOK_BASELINE_SOURCE="hooks/hooks.json"
HOOK_BASELINE_DEST="profiles/baselines/claude-hooks.json"
CODEX_HOOK_MANIFEST_SOURCE="platforms/codex/hooks/hooks.json"
CODEX_HOOK_MANIFEST_DEST="hooks/hooks.json"
CODEX_PREEFFECT_SOURCE="platforms/codex/hooks/pre-effect.js"
CODEX_PREEFFECT_DEST="hooks/pre-effect.js"
CODEX_POSTCOMPACT_SOURCE="platforms/codex/hooks/post-compact.js"
CODEX_POSTCOMPACT_DEST="hooks/post-compact.js"
CODEX_EDIT_GATE_LIB_SOURCE="hooks/orchestrator-edit-gate-lib.js"
CODEX_EDIT_GATE_LIB_DEST="hooks/orchestrator-edit-gate-lib.js"
PLUGIN_MANIFEST="$PLUGIN/.codex-plugin/plugin.json"

if [ ! -d "$SRC" ]; then
  echo "error: source skills directory missing: $SRC" >&2
  exit 1
fi

if ! find "$SRC" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo "error: source skills directory is empty: $SRC" >&2
  exit 1
fi

validate_projection_inputs() {
  [ -f "$LIFECYCLE_ADAPTER" ] || {
    echo "error: Codex lifecycle adapter missing: $LIFECYCLE_ADAPTER" >&2
    exit 1
  }
  local marker_count
  marker_count="$(grep -c "$LIFECYCLE_ADAPTER_MARKER" "$LIFECYCLE_ADAPTER" || true)"
  [ "$marker_count" -eq 1 ] || {
    echo "error: Codex lifecycle adapter marker must occur exactly once" >&2
    exit 1
  }
  local skill source
  for skill in "${PROJECTED_SKILLS[@]}"; do
    source="$SRC/$skill/SKILL.md"
    [ -f "$source" ] || {
      echo "error: projected source skill missing: skills/$skill/SKILL.md" >&2
      exit 1
    }
    if grep -q "$LIFECYCLE_ADAPTER_MARKER" "$source"; then
      echo "error: projected source skill contains Codex adapter marker: skills/$skill/SKILL.md" >&2
      exit 1
    fi
  done
}

render_projected_skill() {
  local source="$1"
  local destination="$2"
  node - "$source" "$LIFECYCLE_ADAPTER" "$destination" <<'NODE'
const fs = require('fs');
const path = require('path');
const [sourcePath, adapterPath, destinationPath] = process.argv.slice(2);
const source = fs.readFileSync(sourcePath, 'utf8');
const adapter = fs.readFileSync(adapterPath, 'utf8');
if (!source.startsWith('---\n')) throw new Error(`source frontmatter missing: ${sourcePath}`);
const close = source.indexOf('\n---\n', 4);
if (close === -1) throw new Error(`source frontmatter unterminated: ${sourcePath}`);
const split = close + '\n---\n'.length;
const output = `${source.slice(0, split)}\n${adapter}${source.slice(split)}`;
fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
fs.writeFileSync(destinationPath, output);
NODE
}

is_projected_skill() {
  local candidate="$1"
  local skill
  for skill in "${PROJECTED_SKILLS[@]}"; do
    [ "$candidate" = "$skill" ] && return 0
  done
  return 1
}

sync_skills() {
  local destination="$PLUGIN/skills"
  rm -rf "$destination"
  mkdir -p "$destination"
  if command -v rsync >/dev/null 2>&1; then
    rsync -aL --delete "$SRC/" "$destination/"
  else
    (cd "$SRC" && tar -chf - .) | (cd "$destination" && tar -xf -)
  fi
  local skill
  for skill in "${PROJECTED_SKILLS[@]}"; do
    render_projected_skill "$SRC/$skill/SKILL.md" "$destination/$skill/SKILL.md"
  done
}

check_skills() {
  node - "$SRC" "$PLUGIN/skills" "$LIFECYCLE_ADAPTER" \
    "$LIFECYCLE_ADAPTER_MARKER" "${PROJECTED_SKILLS[@]}" <<'NODE'
const fs = require('fs');
const path = require('path');
const [sourceRoot, copyRoot, adapterPath, marker, ...projected] = process.argv.slice(2);
const projectedSet = new Set(projected);
const failures = [];
const list = (root, relative = '') => fs.readdirSync(path.join(root, relative), { withFileTypes: true })
  .flatMap((entry) => {
    const rel = path.join(relative, entry.name);
    return entry.isDirectory() ? list(root, rel) : [rel];
  }).sort();
if (!fs.existsSync(copyRoot)) {
  console.log('drift: missing directory platforms/codex/plugin/skills');
  process.exit(1);
}
const sourceFiles = list(sourceRoot);
const copyFiles = list(copyRoot);
if (JSON.stringify(sourceFiles) !== JSON.stringify(copyFiles)) failures.push('skill file set differs');
const adapter = fs.readFileSync(adapterPath, 'utf8');
for (const relative of sourceFiles) {
  const source = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
  const destination = path.join(copyRoot, relative);
  if (!fs.existsSync(destination)) continue;
  const copy = fs.readFileSync(destination, 'utf8');
  const skill = relative.split(path.sep)[0];
  if (projectedSet.has(skill) && relative === path.join(skill, 'SKILL.md')) {
    const close = source.indexOf('\n---\n', 4);
    if (!source.startsWith('---\n') || close === -1) {
      failures.push(`invalid source frontmatter skills/${relative}`);
      continue;
    }
    const split = close + '\n---\n'.length;
    const expected = `${source.slice(0, split)}\n${adapter}${source.slice(split)}`;
    if (copy !== expected) failures.push(`projected content skills/${relative}`);
    if ((copy.match(new RegExp(marker, 'gu')) || []).length !== 1) {
      failures.push(`adapter marker count skills/${relative}`);
    }
    if (!copy.endsWith(source.slice(split))) failures.push(`canonical tail drift skills/${relative}`);
  } else if (copy !== source) {
    failures.push(`content skills/${relative}`);
  }
}
for (const failure of failures) console.log(`drift: ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
NODE
}

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
    local diff_status=0
    for excluded in "${SCRIPT_EXCLUDES[@]}"; do
      args+=(--exclude="$excluded")
    done
    diff "${args[@]}" "$src" "$dst" || diff_status=$?
    for excluded in "${SCRIPT_EXCLUDES[@]}"; do
      if [ -e "$dst/$excluded" ]; then
        echo "drift: excluded OpenCode installer leaked into platforms/codex/plugin/scripts/$excluded"
        return 1
      fi
    done
    return "$diff_status"
  fi

  if [ "$rel" = "profiles" ]; then
    diff -qr --exclude=baselines "$src" "$dst"
    return $?
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

copy_mapped_file() {
  local source_rel="$1"
  local destination_rel="$2"
  local src="$REPO/$source_rel"
  local dst="$PLUGIN/$destination_rel"
  if [ ! -f "$src" ]; then
    echo "error: source file missing: $src" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

check_mapped_file() {
  local source_rel="$1"
  local destination_rel="$2"
  local src="$REPO/$source_rel"
  local dst="$PLUGIN/$destination_rel"
  if [ ! -f "$src" ]; then
    echo "error: source file missing: $src" >&2
    exit 1
  fi
  if [ ! -f "$dst" ]; then
    echo "drift: missing file platforms/codex/plugin/$destination_rel"
    return 1
  fi
  if ! cmp -s "$src" "$dst"; then
    echo "drift: content differs platforms/codex/plugin/$destination_rel"
    return 1
  fi
}

check_exact_directory_entries() (
  local rel="$1"
  shift
  local directory="$PLUGIN/$rel"
  local status=0
  if [ ! -d "$directory" ]; then
    echo "drift: missing directory platforms/codex/plugin/$rel"
    return 1
  fi
  shopt -s nullglob dotglob
  local entry
  for entry in "$directory"/*; do
    local basename
    local expected
    local found=0
    basename="$(basename "$entry")"
    for expected in "$@"; do
      if [ "$basename" = "$expected" ]; then
        found=1
        break
      fi
    done
    if [ "$found" -ne 1 ]; then
      echo "drift: extra path platforms/codex/plugin/$rel/$(basename "$entry")"
      status=1
    fi
  done
  return "$status"
)

check_plugin_manifest() {
  node - "$PLUGIN_MANIFEST" <<'NODE'
const fs = require('fs');
const manifestPath = process.argv[2];
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.log(`drift: invalid platforms/codex/plugin/.codex-plugin/plugin.json: ${error.message}`);
  process.exit(1);
}
const failures = [];
if (manifest.hooks !== './hooks/hooks.json') failures.push('hooks must equal ./hooks/hooks.json');
if (!/one production PostCompact recovery hook/.test(manifest.description || '')
    || /production PreToolUse/.test(manifest.description || '')) {
  failures.push('description must declare only the one production PostCompact recovery hook');
}
if (!/one production PostCompact recovery hook/.test(manifest.interface?.longDescription || '')
    || /production PreToolUse/.test(manifest.interface?.longDescription || '')) {
  failures.push('interface.longDescription must declare only the one production PostCompact recovery hook');
}
if (failures.length > 0) {
  for (const failure of failures) console.log(`drift: plugin manifest ${failure}`);
  process.exit(1);
}
NODE
}

sync_plugin_manifest() {
  node - "$PLUGIN_MANIFEST" <<'NODE'
const fs = require('fs');
const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.description = 'Autopilot methodology skills for Codex with bundled support CLI/scripts and one production PostCompact recovery hook; no Codex-thread-bound direct-mutation enforcement is shipped (D4=NOT_READY/NO_SHIP).';
manifest.hooks = './hooks/hooks.json';
if (!manifest.interface || typeof manifest.interface !== 'object' || Array.isArray(manifest.interface)) {
  throw new Error('Codex plugin interface must be an object');
}
manifest.interface.longDescription = 'Autopilot brings its portable lifecycle, planning, verification, review, and cross-harness maintenance skills into Codex. The package payload bundles support CLI, scripts, references, templates, shared helpers, and one production PostCompact recovery hook. No Codex-thread-bound direct-mutation enforcement is shipped (D4=NOT_READY/NO_SHIP); the retained pre-effect.js file is an unregistered, non-production probe helper. PostCompact invokes the existing fail-closed reconciliation authority.';
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
}

clean_hooks_root() (
  local hooks_root="$PLUGIN/hooks"
  mkdir -p "$hooks_root"
  shopt -s nullglob dotglob
  local entry
  for entry in "$hooks_root"/*; do
    if [ "$(basename "$entry")" != "_shared" ]; then
      rm -rf "$entry"
    fi
  done
)

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
  validate_projection_inputs
  check_skills || STATUS=1
  for rel in "${DIRS[@]}"; do
    check_dir "$rel" || STATUS=1
  done
  for rel in "${DOC_FILES[@]}"; do
    check_file "$rel" || STATUS=1
  done
  for rel in "${SUPPORT_FILES[@]}"; do
    check_file "$rel" || STATUS=1
  done
  check_mapped_file "$HOOK_BASELINE_SOURCE" "$HOOK_BASELINE_DEST" || STATUS=1
  check_mapped_file "$CODEX_HOOK_MANIFEST_SOURCE" "$CODEX_HOOK_MANIFEST_DEST" || STATUS=1
  check_mapped_file "$CODEX_PREEFFECT_SOURCE" "$CODEX_PREEFFECT_DEST" || STATUS=1
  check_mapped_file "$CODEX_POSTCOMPACT_SOURCE" "$CODEX_POSTCOMPACT_DEST" || STATUS=1
  check_mapped_file "$CODEX_EDIT_GATE_LIB_SOURCE" "$CODEX_EDIT_GATE_LIB_DEST" || STATUS=1
  check_mapped_file "platforms/codex/skill-adapters/lifecycle.md" \
    "$LIFECYCLE_ADAPTER_DEST" || STATUS=1
  check_exact_directory_entries "profiles/baselines" "claude-hooks.json" || STATUS=1
  check_exact_directory_entries "hooks" "_shared" "hooks.json" "orchestrator-edit-gate-lib.js" \
    "post-compact.js" "pre-effect.js" || STATUS=1
  check_plugin_manifest || STATUS=1
  check_doc_extras || STATUS=1

  if [ "$STATUS" -eq 0 ]; then
    echo "Codex plugin payload in sync: platforms/codex/plugin"
  else
    echo "Codex plugin payload drift detected. To fix: scripts/sync-codex-plugin-skills.sh" >&2
  fi
  exit "$STATUS"
fi

validate_projection_inputs
sync_skills
for rel in "${DIRS[@]}"; do
  sync_dir "$rel"
done

rm -rf "$PLUGIN/docs"
for rel in "${DOC_FILES[@]}"; do
  copy_file "$rel"
done
for rel in "${SUPPORT_FILES[@]}"; do
  copy_file "$rel"
done
copy_mapped_file "$HOOK_BASELINE_SOURCE" "$HOOK_BASELINE_DEST"
clean_hooks_root
copy_mapped_file "$CODEX_HOOK_MANIFEST_SOURCE" "$CODEX_HOOK_MANIFEST_DEST"
copy_mapped_file "$CODEX_PREEFFECT_SOURCE" "$CODEX_PREEFFECT_DEST"
copy_mapped_file "$CODEX_POSTCOMPACT_SOURCE" "$CODEX_POSTCOMPACT_DEST"
copy_mapped_file "$CODEX_EDIT_GATE_LIB_SOURCE" "$CODEX_EDIT_GATE_LIB_DEST"
copy_mapped_file "platforms/codex/skill-adapters/lifecycle.md" "$LIFECYCLE_ADAPTER_DEST"
sync_plugin_manifest

echo "synced Codex plugin payload: platforms/codex/plugin"
