#!/usr/bin/env bash
# check-node-report.sh — Node report contract validator.
#
# Schema-validates a node report JSON file against the contract defined in
# references/tree-contracts.md §4, then resolves every evidence_pointer and
# verifies artifact sha256 values.
#
# Usage:
#   scripts/check-node-report.sh <report.json> [--repo <path>]
#
# Arguments:
#   <report.json>   Path to the node report JSON file to validate.
#   --repo <path>   Optional path to the git repository root. Used to resolve
#                   file:line-range pointers that carry a commit SHA anchor
#                   (via `git show`). If absent, falls back to the working tree
#                   for path lookups with a pointer_stale warning.
#
# Evidence pointer types (references/tree-contracts.md §5):
#   file:line-range  <path>:<start>-<end>[@<commit-sha>]
#                    File must exist; line range must be within file length.
#                    If @sha present and --repo given, resolves via `git show`.
#                    If path missing from working tree, searches git ls-files
#                    by content hash; emits pointer_stale warning if found,
#                    fails if not found (never silently passes).
#   sha256:<hex>     64 lowercase hex chars after prefix. Format check only.
#
# Output (stdout): one JSON object
#   { "valid": true|false, "errors": [...], "warnings": [...] }
#
# Exit codes:
#   0   valid (warnings may be present)
#   1   invalid (one or more errors)
#   2   usage / precondition error
#
# Dependencies: bash, jq, git, sha256sum (coreutils). No network.

set -uo pipefail

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

usage_error() {
  echo "usage: check-node-report.sh <report.json> [--repo <path>]" >&2
  echo "       check-node-report.sh --help" >&2
  exit 2
}

show_help() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

REPORT_FILE=""
REPO_PATH=""

if [ $# -eq 0 ]; then
  usage_error
fi

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  show_help; exit 0
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      show_help; exit 0
      ;;
    --repo)
      [ $# -ge 2 ] || { echo "check-node-report.sh: --repo requires a path argument" >&2; exit 2; }
      REPO_PATH="$2"
      shift 2
      ;;
    -*)
      echo "check-node-report.sh: unknown option: $1" >&2
      usage_error
      ;;
    *)
      if [ -n "$REPORT_FILE" ]; then
        echo "check-node-report.sh: unexpected argument: $1" >&2
        usage_error
      fi
      REPORT_FILE="$1"
      shift
      ;;
  esac
done

if [ -z "$REPORT_FILE" ]; then
  echo "check-node-report.sh: <report.json> is required" >&2
  usage_error
fi

if [ ! -f "$REPORT_FILE" ]; then
  echo "check-node-report.sh: report file not found: $REPORT_FILE" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# load and parse report
# ---------------------------------------------------------------------------

if ! REPORT_JSON="$(jq -e . "$REPORT_FILE" 2>/dev/null)"; then
  # Invalid JSON — emit output immediately and exit
  printf '%s\n' "$(jq -n '{valid: false, errors: ["report file is not valid JSON"], warnings: []}')"
  exit 1
fi

# ---------------------------------------------------------------------------
# collector arrays (built as JSON arrays via jq)
# ---------------------------------------------------------------------------

ERRORS="[]"
WARNINGS="[]"

add_error() {
  ERRORS="$(printf '%s' "$ERRORS" | jq --arg e "$1" '. + [$e]')"
}

add_warning() {
  WARNINGS="$(printf '%s' "$WARNINGS" | jq --arg w "$1" '. + [$w]')"
}

# ---------------------------------------------------------------------------
# §1 — schema validation (required fields + types)
# ---------------------------------------------------------------------------

# Required string fields
for field in node verdict; do
  val="$(printf '%s' "$REPORT_JSON" | jq -r --arg f "$field" 'if has($f) then .[$f] else "__MISSING__" end')"
  if [ "$val" = "__MISSING__" ]; then
    add_error "missing required field: $field"
  elif [ "$val" = "null" ] || [ -z "$val" ]; then
    add_error "field '$field' must be a non-empty string"
  fi
done

# Required number field: confidence (0.0 – 1.0)
if ! printf '%s' "$REPORT_JSON" | jq -e 'has("confidence")' >/dev/null 2>&1; then
  add_error "missing required field: confidence"
else
  CONF_OK="$(printf '%s' "$REPORT_JSON" | jq -r '
    if .confidence == null then "null"
    elif (.confidence | type) != "number" then "not_number"
    elif .confidence < 0.0 or .confidence > 1.0 then "out_of_range"
    else "ok"
    end
  ')"
  case "$CONF_OK" in
    null)        add_error "field 'confidence' must not be null" ;;
    not_number)  add_error "field 'confidence' must be a number (got non-number)" ;;
    out_of_range) add_error "field 'confidence' must be in range 0.0 – 1.0" ;;
  esac
fi

# Required array fields
for field in evidence_pointers artifact_paths doa_log escalations; do
  arr_type="$(printf '%s' "$REPORT_JSON" | jq -r --arg f "$field" '
    if has($f) | not then "missing"
    elif (.[$f] | type) != "array" then "not_array"
    else "ok"
    end
  ')"
  case "$arr_type" in
    missing)   add_error "missing required field: $field" ;;
    not_array) add_error "field '$field' must be an array" ;;
  esac
done

# Unknown schema_version: only version 1 is known
if printf '%s' "$REPORT_JSON" | jq -e 'has("schema_version")' >/dev/null 2>&1; then
  SV="$(printf '%s' "$REPORT_JSON" | jq -r '.schema_version')"
  if [ "$SV" != "1" ]; then
    add_error "unknown schema_version: $SV (only version 1 is supported)"
  fi
fi

# Verdict-bearing rule: non-null verdict requires non-empty evidence_pointers
VERDICT_VAL="$(printf '%s' "$REPORT_JSON" | jq -r '.verdict // "null"')"
EP_LEN="$(printf '%s' "$REPORT_JSON" | jq -r 'if (.evidence_pointers | type) == "array" then (.evidence_pointers | length) else -1 end')"
if [ "$VERDICT_VAL" != "null" ] && [ "$EP_LEN" = "0" ]; then
  add_error "verdict-bearing report must have at least one evidence_pointer (evidence_pointers is empty)"
fi

# artifact_paths: each element must be {path: string, sha256: string}
AP_LEN="$(printf '%s' "$REPORT_JSON" | jq -r 'if (.artifact_paths | type) == "array" then (.artifact_paths | length) else 0 end')"
if [ "$AP_LEN" -gt 0 ]; then
  BAD_AP="$(printf '%s' "$REPORT_JSON" | jq -r '
    .artifact_paths | to_entries[] |
    select(
      (.value | type) != "object" or
      (.value.path | type) != "string" or
      (.value.sha256 | type) != "string"
    ) | .key
  ' | tr '\n' ',' | sed 's/,$//')"
  if [ -n "$BAD_AP" ]; then
    add_error "artifact_paths elements at indices [$BAD_AP] must be {path: string, sha256: string} objects"
  fi
fi

# ---------------------------------------------------------------------------
# Early exit if structural errors make pointer resolution unsafe
# ---------------------------------------------------------------------------

# If evidence_pointers is not an array, skip pointer resolution
EP_IS_ARRAY="$(printf '%s' "$REPORT_JSON" | jq -r '(.evidence_pointers | type) == "array"')"
AP_IS_ARRAY="$(printf '%s' "$REPORT_JSON" | jq -r '(.artifact_paths | type) == "array"')"

# ---------------------------------------------------------------------------
# §2 — evidence_pointer resolution
# ---------------------------------------------------------------------------

# Helper: count lines in a string (passed on stdin to jq for portability)
file_line_count() {
  local path="$1"
  wc -l < "$path" | tr -d ' '
}

# Helper: sha256 of a file
file_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

# Helper: resolve a file:line-range pointer.
# Outputs "ok", "stale:<found-path>", or "error:<message>"
resolve_file_pointer() {
  local pointer="$1"

  # Strip the "file:" prefix if present (pointer may be bare path:range@sha)
  local rest="${pointer#file:}"

  # Extract optional @commit suffix
  local commit_sha=""
  case "$rest" in
    *@*)
      commit_sha="${rest##*@}"
      rest="${rest%@*}"
      ;;
  esac

  # Extract line range: last colon-delimited segment matching N-M
  # We walk from the right: everything before the last colon is the path,
  # the last colon-delimited segment is the range.
  local file_path=""
  local line_range=""

  # Use parameter expansion to split on last colon
  # rest = "path/to/file:start-end"
  case "$rest" in
    *:*-*)
      line_range="${rest##*:}"
      file_path="${rest%:*}"
      ;;
    *)
      printf '%s' "error:malformed file:line-range pointer (expected path:start-end[@sha]): $pointer"
      return
      ;;
  esac

  # Parse start / end
  local start end
  start="${line_range%%-*}"
  end="${line_range#*-}"

  # Validate start/end are positive integers
  case "$start" in ''|*[!0-9]*) printf '%s' "error:line range start is not a positive integer: $pointer"; return ;; esac
  case "$end" in ''|*[!0-9]*) printf '%s' "error:line range end is not a positive integer: $pointer"; return ;; esac
  if [ "$start" -lt 1 ]; then
    printf '%s' "error:line range start must be >= 1: $pointer"
    return
  fi
  if [ "$end" -lt "$start" ]; then
    printf '%s' "error:line range end ($end) must be >= start ($start): $pointer"
    return
  fi

  # Try to resolve the file
  local resolved_content=""
  local line_count=0

  if [ -n "$commit_sha" ] && [ -n "$REPO_PATH" ] && [ -d "$REPO_PATH/.git" ]; then
    # Attempt git show <sha>:<path> to get file at commit
    if resolved_content="$(git -C "$REPO_PATH" show "${commit_sha}:${file_path}" 2>/dev/null)"; then
      line_count="$(printf '%s\n' "$resolved_content" | wc -l | tr -d ' ')"
      if [ "$end" -gt "$line_count" ]; then
        printf '%s' "error:line range $start-$end exceeds file length ($line_count lines) at commit $commit_sha: $pointer"
        return
      fi
      printf '%s' "ok"
      return
    else
      # SHA-based lookup failed — fall through to working tree with warning
      add_warning "commit SHA '$commit_sha' not found in repo; falling back to working tree for pointer: $pointer"
    fi
  elif [ -n "$commit_sha" ] && { [ -z "$REPO_PATH" ] || [ ! -d "${REPO_PATH}/.git" ]; }; then
    # Have a SHA but no usable repo — fall back to working tree with warning
    add_warning "pointer has commit SHA anchor but no --repo provided; falling back to working tree: $pointer"
  fi

  # Working-tree resolution
  if [ -f "$file_path" ]; then
    line_count="$(file_line_count "$file_path")"
    if [ "$end" -gt "$line_count" ]; then
      printf '%s' "error:line range $start-$end exceeds file length ($line_count lines) in working tree: $pointer"
      return
    fi
    printf '%s' "ok"
    return
  fi

  # File not found in working tree — try content-hash search via git ls-files
  if [ -n "$REPO_PATH" ] && [ -d "$REPO_PATH/.git" ]; then
    # Bounded search: iterate tracked files looking for a content match.
    # We can't know the exact content of the missing file without it, so we
    # search by filename basename as a heuristic first, then full scan.
    local basename_file; basename_file="$(basename "$file_path")"
    local found_path=""

    # Search by basename match first (fast path)
    while IFS= read -r candidate; do
      [ -z "$candidate" ] && continue
      if [ "$(basename "$candidate")" = "$basename_file" ]; then
        found_path="$candidate"
        break
      fi
    done < <(git -C "$REPO_PATH" ls-files 2>/dev/null)

    if [ -n "$found_path" ]; then
      local full_found="$REPO_PATH/$found_path"
      if [ -f "$full_found" ]; then
        printf '%s' "stale:$full_found"
        return
      fi
    fi

    # Full scan: check every tracked file's path stem
    while IFS= read -r candidate; do
      [ -z "$candidate" ] && continue
      local full_candidate="$REPO_PATH/$candidate"
      if [ -f "$full_candidate" ]; then
        found_path="$candidate"
        # Only accept if the basename matches (content-hash heuristic)
        if [ "$(basename "$candidate")" = "$basename_file" ]; then
          printf '%s' "stale:$full_candidate"
          return
        fi
      fi
    done < <(git -C "$REPO_PATH" ls-files 2>/dev/null)
  fi

  # Not found anywhere
  printf '%s' "error:file not found: $file_path (pointer: $pointer)"
}

# Helper: validate a sha256-only pointer format
validate_sha256_pointer() {
  local pointer="$1"
  local hex="${pointer#sha256:}"
  # Must be exactly 64 lowercase hex characters
  case "$hex" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]\
[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      printf '%s' "ok"
      ;;
    *)
      printf '%s' "error:sha256 pointer must be 'sha256:' followed by exactly 64 lowercase hex characters: $pointer"
      ;;
  esac
}

# Resolve evidence_pointers
if [ "$EP_IS_ARRAY" = "true" ]; then
  EP_COUNT="$(printf '%s' "$REPORT_JSON" | jq -r '.evidence_pointers | length')"
  i=0
  while [ "$i" -lt "$EP_COUNT" ]; do
    ptr="$(printf '%s' "$REPORT_JSON" | jq -r --argjson i "$i" '.evidence_pointers[$i]')"
    i=$(( i + 1 ))

    if [ -z "$ptr" ] || [ "$ptr" = "null" ]; then
      add_error "evidence_pointer at index $((i-1)) is null or empty"
      continue
    fi

    case "$ptr" in
      sha256:*)
        result="$(validate_sha256_pointer "$ptr")"
        case "$result" in
          ok) ;;
          error:*) add_error "${result#error:}" ;;
        esac
        ;;
      file:*|*:*-*)
        result="$(resolve_file_pointer "$ptr")"
        case "$result" in
          ok) ;;
          stale:*)
            found="${result#stale:}"
            add_warning "pointer_stale: file '${ptr%%:*}' (or path component) has moved; found at '$found' — pointer should be updated: $ptr"
            ;;
          error:*) add_error "${result#error:}" ;;
        esac
        ;;
      *)
        add_error "evidence_pointer has unknown type (expected 'file:<path>:<start>-<end>[@sha]' or 'sha256:<hex>'): $ptr"
        ;;
    esac
  done
fi

# ---------------------------------------------------------------------------
# §3 — artifact_paths sha256 verification
# ---------------------------------------------------------------------------

if [ "$AP_IS_ARRAY" = "true" ] && [ "$AP_LEN" -gt 0 ]; then
  j=0
  while [ "$j" -lt "$AP_LEN" ]; do
    art_path="$(printf '%s' "$REPORT_JSON" | jq -r --argjson j "$j" '.artifact_paths[$j].path // ""')"
    art_sha="$(printf '%s' "$REPORT_JSON" | jq -r --argjson j "$j" '.artifact_paths[$j].sha256 // ""')"
    j=$(( j + 1 ))

    if [ -z "$art_path" ] || [ "$art_path" = "null" ]; then
      add_error "artifact_paths[$((j-1))].path is missing or null"
      continue
    fi
    if [ -z "$art_sha" ] || [ "$art_sha" = "null" ]; then
      add_error "artifact_paths[$((j-1))].sha256 is missing or null"
      continue
    fi

    if [ ! -f "$art_path" ]; then
      add_error "artifact not found at path: $art_path (artifact_paths[$((j-1))])"
      continue
    fi

    actual_sha="$(file_sha256 "$art_path")"
    if [ "$actual_sha" != "$art_sha" ]; then
      add_error "sha256 mismatch for $art_path: expected $art_sha, got $actual_sha (artifact_paths[$((j-1))])"
    fi
  done
fi

# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------

ERROR_COUNT="$(printf '%s' "$ERRORS" | jq 'length')"

if [ "$ERROR_COUNT" -gt 0 ]; then
  printf '%s\n' "$(jq -n \
    --argjson errors "$ERRORS" \
    --argjson warnings "$WARNINGS" \
    '{valid: false, errors: $errors, warnings: $warnings}')"
  exit 1
else
  printf '%s\n' "$(jq -n \
    --argjson errors "$ERRORS" \
    --argjson warnings "$WARNINGS" \
    '{valid: true, errors: $errors, warnings: $warnings}')"
  exit 0
fi
