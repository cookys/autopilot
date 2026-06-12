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
#                    Moved-file resolution (two modes — §5.3):
#                      Mode A (SHA anchor present): compute content hash of
#                        original file at commit via `git show <sha>:<path>`,
#                        compare against git ls-files candidates. Content-hash
#                        match → pointer_stale warning (exit 0). Same-basename
#                        candidate with different content → error (invalid).
#                      Mode B (no SHA anchor): basename heuristic only; emits
#                        pointer_degraded_basename_match warning (exit 0).
#                      Not found in either mode → validation FAILURE.
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
  sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'
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
# Guard variables: skip pointer/artifact resolution if fields are not arrays
# (structural errors from §1 make resolution unsafe or meaningless)
# ---------------------------------------------------------------------------

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
# Outputs one or more lines; each line is either:
#   warn:<message>        — a warning to surface (may appear 0 or more times)
#   ok                    — pointer resolved successfully
#   stale:<found-path>    — pointer resolved via content-hash after file moved (emit warning)
#   degraded:<found-path> — pointer resolved via basename heuristic; no SHA anchor (emit warning)
#   error:<message>       — validation failure
# IMPORTANT: add_warning / add_error cannot be called here because this function is
# invoked inside $(...) (command substitution), which runs in a subshell. All
# diagnostic signals must be conveyed via stdout lines (warn:/error:/stale:/degraded:).
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
      printf 'error:malformed file:line-range pointer (expected path:start-end[@sha]): %s\n' "$pointer"
      return
      ;;
  esac

  # Parse start / end
  local start end
  start="${line_range%%-*}"
  end="${line_range#*-}"

  # Validate start/end are positive integers
  case "$start" in ''|*[!0-9]*) printf 'error:line range start is not a positive integer: %s\n' "$pointer"; return ;; esac
  case "$end" in ''|*[!0-9]*) printf 'error:line range end is not a positive integer: %s\n' "$pointer"; return ;; esac
  if [ "$start" -lt 1 ]; then
    printf 'error:line range start must be >= 1: %s\n' "$pointer"
    return
  fi
  if [ "$end" -lt "$start" ]; then
    printf 'error:line range end (%s) must be >= start (%s): %s\n' "$end" "$start" "$pointer"
    return
  fi

  # Warn on @HEAD anchor: HEAD is not a stable reference; a concrete SHA is required
  # for reproducible validation. Still resolves (exit 0), but warns.
  if [ "$commit_sha" = "HEAD" ]; then
    printf 'warn:pointer uses @HEAD anchor which is not stable; use a concrete SHA for reproducible validation: %s\n' "$pointer"
  fi

  # Try to resolve the file
  local line_count=0

  if [ -n "$commit_sha" ] && [ -n "$REPO_PATH" ] && [ -d "$REPO_PATH/.git" ]; then
    # Attempt git show <sha>:<path> to get file at commit
    if line_count="$(git -C "$REPO_PATH" show "${commit_sha}:${file_path}" 2>/dev/null | wc -l | tr -d ' ')"; then
      if [ "$end" -gt "$line_count" ]; then
        printf 'error:line range %s-%s exceeds file length (%s lines) at commit %s: %s\n' \
          "$start" "$end" "$line_count" "$commit_sha" "$pointer"
        return
      fi
      # File resolved at the commit. Also check if it still exists at the SAME PATH
      # in the current working tree — if not, the file has moved and the pointer is stale.
      # Check in the repo working tree (REPO_PATH-relative), not CWD-relative.
      if [ ! -f "$REPO_PATH/$file_path" ]; then
        # File no longer at original path in working tree — search for it by content hash.
        local moved_hash basename_fp
        moved_hash="$(git -C "$REPO_PATH" show "${commit_sha}:${file_path}" 2>/dev/null | sha256sum | awk '{print $1}')"
        basename_fp="$(basename "$file_path")"
        local all_candidates_mv
        all_candidates_mv="$(git -C "$REPO_PATH" ls-files 2>/dev/null)"
        local moved_found="" basename_diff_found=""
        while IFS= read -r candidate; do
          [ -z "$candidate" ] && continue
          local full_cand="$REPO_PATH/$candidate"
          [ -f "$full_cand" ] || continue
          local c_hash; c_hash="$(sha256sum "$full_cand" | awk '{print $1}')"
          if [ "$c_hash" = "$moved_hash" ]; then
            moved_found="$full_cand"
            break
          fi
          # Track same-basename candidates with different content for false-positive detection
          if [ "$(basename "$candidate")" = "$basename_fp" ] && [ -z "$basename_diff_found" ]; then
            basename_diff_found="$full_cand"
          fi
        done <<< "$all_candidates_mv"
        if [ -n "$moved_found" ]; then
          printf 'stale:%s\n' "$moved_found"
        elif [ -n "$basename_diff_found" ]; then
          # Same-basename file exists but content differs — this would be a false positive
          # if basename-only matching were used. Report as error.
          printf 'error:moved-file: basename match '"'"'%s'"'"' has different content than original at %s; pointer is invalid: %s\n' \
            "$basename_diff_found" "$commit_sha" "$pointer"
        else
          # Resolved at commit but the file is gone from the working tree and
          # no content-hash successor exists anywhere — contract §5.3: "not
          # found anywhere → validation FAILURE". A deleted citation is not
          # spot-checkable.
          printf 'error:deleted-file: file resolved at commit %s but no longer exists in working tree and no successor found: %s\n' \
            "$commit_sha" "$pointer"
        fi
      else
        printf 'ok\n'
      fi
      return
    else
      # SHA-based lookup failed — fall through to working tree with warning
      printf 'warn:commit SHA '"'"'%s'"'"' not found in repo; falling back to working tree for pointer: %s\n' \
        "$commit_sha" "$pointer"
    fi
  elif [ -n "$commit_sha" ] && { [ -z "$REPO_PATH" ] || [ ! -d "${REPO_PATH}/.git" ]; }; then
    # Have a SHA but no usable repo — fall back to working tree with warning
    printf 'warn:pointer has commit SHA anchor but no --repo provided; falling back to working tree: %s\n' "$pointer"
  fi

  # Working-tree resolution
  if [ -f "$file_path" ]; then
    line_count="$(file_line_count "$file_path")"
    if [ "$end" -gt "$line_count" ]; then
      printf 'error:line range %s-%s exceeds file length (%s lines) in working tree: %s\n' \
        "$start" "$end" "$line_count" "$pointer"
      return
    fi
    printf 'ok\n'
    return
  fi

  # File not found in working tree — attempt moved-file resolution.
  #
  # Two modes:
  #   With SHA anchor: compute the original content hash via `git show <sha>:<path>`,
  #     then search git ls-files candidates comparing sha256; basename candidates
  #     are tried first (optimization), then the full tracked-file list.
  #     - Content-hash match → stale:<found-path> (caller emits pointer_stale warning).
  #     - Same-basename candidate with DIFFERENT content and no content match
  #       anywhere → error (the false-positive case: basename match would be wrong).
  #   Without SHA anchor: content-hash search is impossible; fall back to basename
  #     heuristic → degraded:<found-path> (caller emits pointer_degraded_basename_match).
  if [ -n "$REPO_PATH" ] && [ -d "$REPO_PATH/.git" ]; then
    local basename_file; basename_file="$(basename "$file_path")"

    if [ -n "$commit_sha" ]; then
      # Compute the content hash of the file at the anchor commit.
      # IMPORTANT: pipe directly through sha256sum — do NOT capture to a variable
      # first, as command substitution strips trailing newlines, corrupting the hash.
      local orig_hash=""
      if git -C "$REPO_PATH" show "${commit_sha}:${file_path}" >/dev/null 2>&1; then
        orig_hash="$(git -C "$REPO_PATH" show "${commit_sha}:${file_path}" 2>/dev/null | sha256sum | awk '{print $1}')"
      fi

      if [ -n "$orig_hash" ]; then
        # orig_hash available — do real content-hash search.
        # Collect all tracked files. Basename candidates come first (optimization)
        # so the hot path avoids scanning unrelated files.
        local basename_match_path=""
        local content_match_path=""
        local all_candidates
        all_candidates="$(git -C "$REPO_PATH" ls-files 2>/dev/null)"

        # Phase 1: basename candidates first
        while IFS= read -r candidate; do
          [ -z "$candidate" ] && continue
          [ "$(basename "$candidate")" = "$basename_file" ] || continue
          local full_candidate="$REPO_PATH/$candidate"
          [ -f "$full_candidate" ] || continue
          if [ -z "$basename_match_path" ]; then
            basename_match_path="$full_candidate"
          fi
          local cand_hash; cand_hash="$(sha256sum "$full_candidate" | awk '{print $1}')"
          if [ "$cand_hash" = "$orig_hash" ]; then
            content_match_path="$full_candidate"
            break
          fi
        done <<< "$all_candidates"

        # Phase 2: full scan if no content match yet (non-basename-matching files)
        if [ -z "$content_match_path" ]; then
          while IFS= read -r candidate; do
            [ -z "$candidate" ] && continue
            [ "$(basename "$candidate")" = "$basename_file" ] && continue  # already checked
            local full_candidate="$REPO_PATH/$candidate"
            [ -f "$full_candidate" ] || continue
            local cand_hash; cand_hash="$(sha256sum "$full_candidate" | awk '{print $1}')"
            if [ "$cand_hash" = "$orig_hash" ]; then
              content_match_path="$full_candidate"
              break
            fi
          done <<< "$all_candidates"
        fi

        if [ -n "$content_match_path" ]; then
          printf 'stale:%s\n' "$content_match_path"
          return
        fi

        # No content-hash match found anywhere.
        if [ -n "$basename_match_path" ]; then
          # Same-basename candidate exists but content differs → false-positive guard: error.
          printf 'error:moved-file: basename match '"'"'%s'"'"' has different content than original at %s; pointer is invalid: %s\n' \
            "$basename_match_path" "$commit_sha" "$pointer"
          return
        fi
      fi
      # orig_hash unavailable (commit did not contain this path) — fall through to not-found.
    else
      # No SHA anchor — content-hash impossible; use basename heuristic with degraded result.
      while IFS= read -r candidate; do
        [ -z "$candidate" ] && continue
        if [ "$(basename "$candidate")" = "$basename_file" ]; then
          local full_candidate="$REPO_PATH/$candidate"
          if [ -f "$full_candidate" ]; then
            printf 'degraded:%s\n' "$full_candidate"
            return
          fi
        fi
      done < <(git -C "$REPO_PATH" ls-files 2>/dev/null)
    fi
  fi

  # Not found anywhere
  printf 'error:file not found: %s (pointer: %s)\n' "$file_path" "$pointer"
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
        # resolve_file_pointer may return multiple lines:
        #   warn:<msg>        — warning to surface
        #   ok                — resolved successfully
        #   stale:<path>      — resolved via content-hash after file moved
        #   degraded:<path>   — resolved via basename heuristic (no SHA anchor)
        #   error:<msg>       — validation failure
        # Process all lines; the last non-warn line is the resolution result.
        resolve_result=""
        while IFS= read -r rline; do
          case "$rline" in
            warn:*)  add_warning "${rline#warn:}" ;;
            ok|stale:*|degraded:*|error:*) resolve_result="$rline" ;;
          esac
        done < <(resolve_file_pointer "$ptr")
        case "$resolve_result" in
          ok) ;;
          stale:*)
            found="${resolve_result#stale:}"
            add_warning "pointer_stale: file has moved; found at '$found' (content-hash verified) — pointer should be updated: $ptr"
            ;;
          degraded:*)
            found="${resolve_result#degraded:}"
            add_warning "pointer_degraded_basename_match: no commit-SHA anchor; basename heuristic matched '$found' — pointer may be stale, content unverified: $ptr"
            ;;
          error:*) add_error "${resolve_result#error:}" ;;
          "")       add_error "pointer resolution returned no result (internal error): $ptr" ;;
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
