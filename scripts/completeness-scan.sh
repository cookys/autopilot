#!/usr/bin/env bash
# completeness-scan.sh — anti-stub regex scan for quality-pipeline's
# completeness gate. Emits JSON matching the schema in
# skills/quality-pipeline/references/completeness-gate.md.
#
# Usage:
#   scripts/completeness-scan.sh                 # scan staged diff (default)
#   scripts/completeness-scan.sh --all           # scan all tracked files
#   scripts/completeness-scan.sh --range A..B    # scan files changed in commit range
#   scripts/completeness-scan.sh --files f1 f2   # explicit file list
#
# Exit codes:
#   0  clean (no new findings; pre-existing findings still allowed)
#   1  has new (uncommitted-side) findings — gate fails
#   2  usage / internal error
#
# Output: JSON to stdout. Use `jq` to consume.

set -euo pipefail

MODE="staged"
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)    MODE="all"; shift ;;
    --range)  MODE="range"; RANGE="$2"; shift 2 ;;
    --files)  MODE="files"; shift; while [[ $# -gt 0 && "$1" != --* ]]; do FILES+=("$1"); shift; done ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$MODE" in
  staged)
    mapfile -t FILES < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true) ;;
  range)
    mapfile -t FILES < <(git diff --name-only --diff-filter=ACMR "$RANGE" 2>/dev/null || true) ;;
  all)
    mapfile -t FILES < <(git ls-files) ;;
  files) : ;;
esac

# Filter: skip binaries, lockfiles, build artefacts, the scan itself, doc-only paths
is_scannable() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  # binary check via git attributes / file(1) where available
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.ico|*.pdf|*.zip|*.tar*|*.gz|*.so|*.dylib|*.dll|*.exe|*.bin|*.wasm) return 1 ;;
    *.lock|*lockb|package-lock.json|yarn.lock|Cargo.lock|go.sum|Pipfile.lock|poetry.lock) return 1 ;;
    */node_modules/*|*/dist/*|*/build/*|*/.git/*|*/vendor/*|*/target/*) return 1 ;;
  esac
  # heuristic: if file(1) says binary, skip
  if command -v file >/dev/null 2>&1; then
    case "$(file -b --mime-encoding "$f" 2>/dev/null)" in
      binary) return 1 ;;
    esac
  fi
  return 0
}

# Pattern definitions (POSIX ERE)
PAT_MARKER='(TODO|FIXME|HACK|XXX|TEMP)\b'
PAT_EMPTY_IMPL='^[[:space:]]*return[[:space:]]+(\{\}|0)[[:space:]]*;[[:space:]]*$'
PAT_DISABLED_TEST='(\bDISABLED_[A-Za-z0-9_]+|GTEST_SKIP\(\)|^[[:space:]]*//[[:space:]]*TEST[[:space:]]*\()'
PAT_PLACEHOLDER_ASSERT='EXPECT_TRUE\([[:space:]]*true[[:space:]]*\)|assert\([[:space:]]*True[[:space:]]*\)'
PAT_PROTO_TODO='message[[:space:]]+[A-Za-z0-9_]+[[:space:]]*\{[[:space:]]*\}'

# classify_new(file, line) → "true" | "false"
# A finding is "new" if HEAD's git blame for that line doesn't exist OR points
# at a not-yet-committed change (uncommitted = blame returns the "0000…" sha
# OR the line is outside HEAD's file extent).
classify_new() {
  local file="$1" line="$2"
  # If the file isn't tracked at HEAD, every line is new.
  if ! git cat-file -e "HEAD:$file" 2>/dev/null; then
    echo "true"; return
  fi
  # Use git blame with --porcelain on the working-tree file (no -- HEAD) so
  # uncommitted lines come back as "0000000000000000000000000000000000000000".
  local sha
  sha="$(git blame --porcelain -L "${line},${line}" -- "$file" 2>/dev/null | head -1 | awk '{print $1}' || true)"
  if [[ -z "$sha" || "$sha" =~ ^0+$ ]]; then echo "true"; else echo "false"; fi
}

emit_finding() {
  # $1 file, $2 line, $3 type, $4 text
  local file="$1" line="$2" type="$3" text="$4" is_new
  is_new="$(classify_new "$file" "$line")"
  # JSON-escape text (basic: backslash + double-quote + control chars)
  local esc
  esc="$(printf '%s' "$text" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' -e 's/\r//g' \
    | awk 'NR>1{printf "\\n"} {printf "%s", $0}')"
  printf '    {"file":"%s","line":%s,"type":"%s","text":"%s","isNew":%s}\n' \
    "$file" "$line" "$type" "$esc" "$is_new"
}

# Scan one file; print one JSON line per finding (the caller wraps them in an array).
scan_file() {
  local file="$1"
  # marker
  grep -nE "$PAT_MARKER" -- "$file" 2>/dev/null | while IFS=: read -r ln rest; do
    emit_finding "$file" "$ln" "marker" "${rest#"${rest%%[![:space:]]*}"}"
  done
  # empty_impl
  grep -nE "$PAT_EMPTY_IMPL" -- "$file" 2>/dev/null | while IFS=: read -r ln rest; do
    emit_finding "$file" "$ln" "empty_impl" "${rest#"${rest%%[![:space:]]*}"}"
  done
  # disabled_test
  grep -nE "$PAT_DISABLED_TEST" -- "$file" 2>/dev/null | while IFS=: read -r ln rest; do
    emit_finding "$file" "$ln" "disabled_test" "${rest#"${rest%%[![:space:]]*}"}"
  done
  # placeholder_assert
  grep -nE "$PAT_PLACEHOLDER_ASSERT" -- "$file" 2>/dev/null | while IFS=: read -r ln rest; do
    emit_finding "$file" "$ln" "placeholder_assert" "${rest#"${rest%%[![:space:]]*}"}"
  done
  # proto_empty_message (only .proto files)
  case "$file" in
    *.proto)
      grep -nE "$PAT_PROTO_TODO" -- "$file" 2>/dev/null | while IFS=: read -r ln rest; do
        emit_finding "$file" "$ln" "proto_empty" "${rest#"${rest%%[![:space:]]*}"}"
      done
      ;;
  esac
}

# Walk files, accumulate findings to a tmp file, then assemble JSON.
TMPF="$(mktemp)"
trap 'rm -f "$TMPF"' EXIT

scanned=0
for f in "${FILES[@]:-}"; do
  [[ -n "$f" ]] || continue
  if ! is_scannable "$f"; then continue; fi
  scanned=$((scanned + 1))
  scan_file "$f" >> "$TMPF" || true
done

# Build JSON
total="$(wc -l < "$TMPF" | tr -d ' ')"
total="${total:-0}"

new_count=0
pre_count=0
declare -A by_type

if [[ "$total" -gt 0 ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # crude key extraction
    is_new="$(echo "$line" | sed -n 's/.*"isNew":\(true\|false\).*/\1/p')"
    typ="$(echo "$line" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')"
    [[ "$is_new" == "true" ]] && new_count=$((new_count+1)) || pre_count=$((pre_count+1))
    by_type["$typ"]=$(( ${by_type["$typ"]:-0} + 1 ))
  done < "$TMPF"
fi

clean="true"
[[ "$new_count" -gt 0 ]] && clean="false"

# Assemble by_type JSON
by_type_json="{"
first=1
for k in "${!by_type[@]}"; do
  [[ $first -eq 1 ]] && first=0 || by_type_json+=","
  by_type_json+="\"$k\":${by_type[$k]}"
done
by_type_json+="}"

# Assemble findings array (strip trailing comma after last item)
findings_block=""
if [[ "$total" -gt 0 ]]; then
  findings_block="$(awk 'NR>1{print prev","} {prev=$0} END{if(NR>0)print prev}' "$TMPF")"
fi

printf '{\n'
printf '  "clean": %s,\n' "$clean"
printf '  "scannedFiles": %d,\n' "$scanned"
printf '  "findings": [\n'
[[ -n "$findings_block" ]] && printf '%s\n' "$findings_block"
printf '  ],\n'
printf '  "summary": { "total": %d, "new": %d, "preExisting": %d, "byType": %s }\n' \
  "$total" "$new_count" "$pre_count" "$by_type_json"
printf '}\n'

# Exit code reflects gate verdict
[[ "$new_count" -gt 0 ]] && exit 1 || exit 0
