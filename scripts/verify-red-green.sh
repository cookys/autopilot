#!/usr/bin/env bash
# verify-red-green.sh — prove that a change's tests actually exercise the change.
# Red-green sibling of verify-preexisting.sh. Uses detached git worktrees (never
# mutates the live working tree).
#
# Usage:
#   scripts/verify-red-green.sh --range <base>..<head> --verify-cmd <script-path> \
#       [--test-glob <git-pathspec-glob>]... [--repo <dir>]
#   scripts/verify-red-green.sh --base <ref> --head <ref> --verify-cmd <script-path> \
#       [--test-glob <glob>]... [--repo <dir>]
#
# Output: JSON on stdout:
#   { verdict, red_green_validated, base_sha, head_sha, head_result, base_result,
#     red_tests, reason }
#   verdict = VALIDATED | NOT_RED_ON_BASE | NOT_GREEN_ON_HEAD | INCONCLUSIVE
#
# Exit codes:
#   0   VALIDATED (head green AND base red)
#   1   NOT_RED_ON_BASE or NOT_GREEN_ON_HEAD
#   2   usage / bad ref / not a git repo
#   3   INCONCLUSIVE (fail-closed — not validated)

set -euo pipefail

# git :(glob) magic: a single '*' does NOT cross '/', so a bare '*test*' only
# matches basenames at the repo root. Lead every pattern with '**/' so test files
# at ANY depth (e.g. tests/unit_test.sh, src/foo.spec.ts) are matched.
DEFAULT_TEST_GLOBS=(
  '**/*test*'
  '**/*spec*'
  '**/*_test.*'
  '**/test_*'
  '**/tests/**'
  '**/__tests__/**'
  '**/*.test.*'
  '**/*.spec.*'
)

RANGE=""
BASE_REF=""
HEAD_REF=""
VERIFY_CMD=""
REPO=""
declare -a TEST_GLOBS=()

usage() {
  sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

json_array_from_lines() {
  local items="$1" out="" first=1 line
  if [ -z "$items" ]; then
    printf '[]'
    return
  fi
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$first" = 1 ]; then first=0; else out="$out, "; fi
    out="$out\"$(json_escape "$line")\""
  done <<< "$items"
  printf '[%s]' "$out"
}

err_usage() {
  echo "$1" >&2
  exit 2
}

emit_json() {
  local verdict="$1" validated="$2" base_sha="$3" head_sha="$4"
  local head_result="$5" base_result="$6" red_tests_json="$7" reason="$8"
  printf '{\n'
  printf '  "verdict": "%s",\n' "$verdict"
  printf '  "red_green_validated": %s,\n' "$validated"
  printf '  "base_sha": "%s",\n' "$(json_escape "$base_sha")"
  printf '  "head_sha": "%s",\n' "$(json_escape "$head_sha")"
  printf '  "head_result": "%s",\n' "$head_result"
  printf '  "base_result": "%s",\n' "$base_result"
  printf '  "red_tests": %s,\n' "$red_tests_json"
  printf '  "reason": "%s"\n' "$(json_escape "$reason")"
  printf '}\n'
}

# Parse CLI
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --range)
      [[ $# -ge 2 ]] || err_usage "missing value for --range"
      RANGE="$2"
      shift 2
      ;;
    --base)
      [[ $# -ge 2 ]] || err_usage "missing value for --base"
      BASE_REF="$2"
      shift 2
      ;;
    --head)
      [[ $# -ge 2 ]] || err_usage "missing value for --head"
      HEAD_REF="$2"
      shift 2
      ;;
    --verify-cmd)
      [[ $# -ge 2 ]] || err_usage "missing value for --verify-cmd"
      VERIFY_CMD="$2"
      shift 2
      ;;
    --test-glob)
      [[ $# -ge 2 ]] || err_usage "missing value for --test-glob"
      TEST_GLOBS+=("$2")
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || err_usage "missing value for --repo"
      REPO="$2"
      shift 2
      ;;
    *)
      err_usage "unknown argument: $1"
      ;;
  esac
done

[[ -n "$VERIFY_CMD" ]] || err_usage "missing required --verify-cmd"

if [[ -z "$RANGE" && ( -z "$BASE_REF" || -z "$HEAD_REF" ) ]]; then
  err_usage "missing required --range <base>..<head> or --base and --head"
fi

if [[ -z "$REPO" ]]; then
  REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || err_usage "not a git repository"
fi

if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  err_usage "not a git repository: $REPO"
fi

if [[ -n "$RANGE" ]]; then
  if [[ "$RANGE" != *".."* ]]; then
    err_usage "invalid --range (expected <base>..<head>): $RANGE"
  fi
  BASE_REF="${RANGE%%..*}"
  HEAD_REF="${RANGE#*..}"
fi

BASE_SHA="$(git -C "$REPO" rev-parse --verify "$BASE_REF" 2>/dev/null)" || err_usage "base ref not found: $BASE_REF"
HEAD_SHA="$(git -C "$REPO" rev-parse --verify "$HEAD_REF" 2>/dev/null)" || err_usage "head ref not found: $HEAD_REF"

if [[ ! -x "$VERIFY_CMD" ]]; then
  err_usage "verify-cmd not found or not executable: $VERIFY_CMD"
fi

if [[ ${#TEST_GLOBS[@]} -eq 0 ]]; then
  TEST_GLOBS=("${DEFAULT_TEST_GLOBS[@]}")
fi

# Collect changed test files (deduplicated) via git pathspec globs.
collect_test_files() {
  local -A seen=()
  local g ps f
  for g in "${TEST_GLOBS[@]}"; do
    ps=":(glob)${g}"
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if [[ -z "${seen[$f]:-}" ]]; then
        seen[$f]=1
        printf '%s\n' "$f"
      fi
    done < <(git -C "$REPO" diff --name-only "${BASE_SHA}..${HEAD_SHA}" -- "$ps" 2>/dev/null || true)
  done
}

TEST_FILES="$(collect_test_files)"
if [[ -z "$TEST_FILES" ]]; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "skipped" "skipped" "[]" "no-test-files-in-diff"
  exit 3
fi

mapfile -t TEST_FILE_ARRAY <<< "$TEST_FILES"

WT_TMP="$(mktemp -d -t verify-red-green-XXXXXX)"
WT_HEAD="$WT_TMP/head"
WT_BASE="$WT_TMP/base"
PATCH_FILE="$WT_TMP/test.patch"

cleanup() {
  git -C "$REPO" worktree remove --force "$WT_HEAD" 2>/dev/null || true
  git -C "$REPO" worktree remove --force "$WT_BASE" 2>/dev/null || true
  git -C "$REPO" worktree prune 2>/dev/null || true
  rm -rf "$WT_TMP"
}
trap cleanup EXIT

run_verify_cmd() {
  local wt="$1"
  local ec=0
  set +e
  (
    cd "$wt" || exit 1
    "$VERIFY_CMD" "$wt"
  )
  ec=$?
  set -e
  return "$ec"
}

HEAD_RESULT="skipped"
BASE_RESULT="skipped"
RED_TESTS_JSON="[]"
REASON=""

# HEAD check: green at head with full change present.
if ! git -C "$REPO" worktree add --detach "$WT_HEAD" "$HEAD_SHA" >/dev/null 2>&1; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "skipped" "skipped" "[]" "head-worktree-add-failed"
  exit 3
fi

if run_verify_cmd "$WT_HEAD"; then
  HEAD_RESULT="green"
else
  HEAD_RESULT="red"
  emit_json "NOT_GREEN_ON_HEAD" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" ""
  exit 1
fi

# RED check: apply only test-file edits onto base, expect failure.
if ! git -C "$REPO" worktree add --detach "$WT_BASE" "$BASE_SHA" >/dev/null 2>&1; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" "base-worktree-add-failed"
  exit 3
fi

if ! git -C "$REPO" diff "${BASE_SHA}..${HEAD_SHA}" -- "${TEST_FILE_ARRAY[@]}" >"$PATCH_FILE" 2>/dev/null; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" "test-patch-build-failed"
  exit 3
fi

if ! git -C "$WT_BASE" apply "$PATCH_FILE" 2>/dev/null; then
  emit_json "INCONCLUSIVE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "skipped" "[]" "test-patch-apply-failed"
  exit 3
fi

RED_TESTS_JSON="$(json_array_from_lines "$TEST_FILES")"

if run_verify_cmd "$WT_BASE"; then
  BASE_RESULT="green"
  emit_json "NOT_RED_ON_BASE" "false" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "$BASE_RESULT" "$RED_TESTS_JSON" ""
  exit 1
fi

BASE_RESULT="red"
emit_json "VALIDATED" "true" "$BASE_SHA" "$HEAD_SHA" "$HEAD_RESULT" "$BASE_RESULT" "$RED_TESTS_JSON" ""
exit 0
