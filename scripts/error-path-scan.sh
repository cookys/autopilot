#!/usr/bin/env bash
# error-path-scan.sh — L0 attention-slip scanner for error paths.
# Detects swallowed errors and broadened catches in added lines.
# Also detects untested error paths (error handling added but no tests touched).
# Emits JSON: {findings: [{file, line, kind, snippet}], counts: {...}}
# Exit codes: 0 always (findings are ADVISORY — reviewer judges), 2 usage.
#
# Implemented patterns (added lines only, best-effort per-language regex):
#   swallowed_error : empty catch body `catch {}` / `catch (e) {}` (JS/TS/Java);
#                     `except:`/`except X:` followed by `pass` (Python);
#                     `|| true` on a non-trivial sh command (trivial rm/rmdir/mkdir/true exempt);
#                     `_ = err` and empty `err != nil { }` bodies incl. the two-line
#                     `if err != nil {` + bare `}` form (Go); `.unwrap_or_default()` (Rust)
#   broadened_catch : newly added bare `except:`, `except Exception`, `catch (Throwable`
#   error_path_untested : diff adds error-handling branches in product code while
#                     touching no test-path file (one summary finding, not per-line)

set -euo pipefail

MODE="staged"
FILES=()
RANGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staged) MODE="staged"; shift ;;
    --all)    MODE="all"; shift ;;
    --range)  MODE="range"; RANGE="${2:-}"; [[ -z "$RANGE" ]] && { echo "error-path-scan: --range requires an argument (A..B)" >&2; exit 2; }; shift 2 ;;
    --files)  MODE="files"; shift; while [[ $# -gt 0 && "$1" != --* ]]; do FILES+=("$1"); shift; done ;;
    -h|--help)
      sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$MODE" == "range" ]]; then
  DIFF_ARGS=(--diff-filter=ACMR "$RANGE")
elif [[ "$MODE" == "all" ]]; then
  DIFF_ARGS=(--diff-filter=ACMR 4b825dc642cb6eb9a060e54bf8d69288fbee4904 HEAD)
else
  DIFF_ARGS=(--cached --diff-filter=ACMR)
fi
if [[ ${#FILES[@]} -gt 0 ]]; then
  DIFF_ARGS+=("--" "${FILES[@]}")
fi

if ! diff_out="$(git diff -U0 "${DIFF_ARGS[@]}" 2>/dev/null)"; then
  exit 2
fi

hunk_findings="$(printf '%s\n' "$diff_out" | awk '
BEGIN {
  in_hunk = 0
  current_file = ""
}

/^diff --git/ {
  current_file = $0
  sub(/^.* b\//, "", current_file)
  next
}

/^@@ / {
  match($0, /\+[0-9]+/)
  if (RSTART > 0) {
    line_num = substr($0, RSTART+1, RLENGTH-1) + 0
  }
  in_hunk = 1
  next
}

in_hunk && /^\+/ && !/^\+\+\+/ {
  line = substr($0, 2)
  ln = line_num++
  
  swallowed = 0
  if (line ~ /catch[[:space:]]*(\([^\)]+\))?[[:space:]]*\{[[:space:]]*\}/) swallowed = 1
  if (line ~ /except([[:space:]]+[A-Za-z0-9_]+)?:[[:space:]]*pass/) swallowed = 1
  if (line ~ /\|\|[[:space:]]*true/) {
    if (line !~ /(rm|mkdir|cp|mv|echo|cd)[[:space:]]+.*\|\|[[:space:]]*true/) {
      swallowed = 1
    }
  }
  if (line ~ /_[[:space:]]*=[[:space:]]*err/) swallowed = 1
  if (line ~ /err[[:space:]]*!=[[:space:]]*nil[[:space:]]*\{[[:space:]]*\}/) swallowed = 1
  if (line ~ /\.unwrap_or_default\(\)/) swallowed = 1
  # Go two-line empty body: previous added line ended `if err != nil {` and this
  # added line is a bare closing brace (round-3 review finding).
  if (prev_go_errnil && line ~ /^[[:space:]]*\}[[:space:]]*$/) swallowed = 1
  prev_go_errnil = (line ~ /err[[:space:]]*!=[[:space:]]*nil[[:space:]]*\{[[:space:]]*$/) ? 1 : 0

  if (swallowed) {
    print "swallowed_error\t" current_file "\t" ln "\t" line
  }
  
  broadened = 0
  if (line ~ /except[[:space:]]+Exception:/) broadened = 1
  if (line ~ /except:/) broadened = 1
  if (line ~ /catch[[:space:]]*\([[:space:]]*Throwable/) broadened = 1
  
  if (broadened) {
    print "broadened_catch\t" current_file "\t" ln "\t" line
  }

  # NOTE: \b is not portable awk — use explicit boundary classes.
  if (line ~ /(^|[^A-Za-z0-9_])(raise|throw)([^A-Za-z0-9_]|$)/ || line ~ /return[[:space:]]+.*err/) {
    print "error_handling_added\t" current_file "\t" ln "\t" line
  }
}
')"

touches_test=0
git diff --name-only "${DIFF_ARGS[@]}" 2>/dev/null | grep -E 'test|spec|__tests__' >/dev/null && touches_test=1 || true

printf '{\n  "findings": [\n'
first=1
counts_swallowed=0
counts_broadened=0
has_err_handling=0

if [[ -n "$hunk_findings" ]]; then
  while IFS=$'\t' read -r kind file ln snippet; do
    if [[ "$kind" == "error_handling_added" ]]; then
      if [[ ! "$file" =~ test|spec|__tests__ ]]; then
        has_err_handling=1
      fi
      continue
    fi
    
    if [[ "$kind" == "swallowed_error" ]]; then ((counts_swallowed++)) || true; fi
    if [[ "$kind" == "broadened_catch" ]]; then ((counts_broadened++)) || true; fi

    [[ $first -eq 0 ]] && printf ',\n'
    first=0
    esc_file="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$file")"
    esc_snippet="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$snippet")"
    printf '    {"file":%s,"line":%s,"kind":"%s","snippet":%s}' "$esc_file" "$ln" "$kind" "$esc_snippet"
  done <<< "$hunk_findings"
fi

if [[ $has_err_handling -eq 1 && $touches_test -eq 0 ]]; then
  [[ $first -eq 0 ]] && printf ',\n'
  printf '    {"file":"summary","line":0,"kind":"error_path_untested","snippet":"Error-handling branches added but no test files modified"}'
  first=0
fi

printf '\n  ],\n'
printf '  "counts": {"swallowed_error":%d,"broadened_catch":%d,"error_path_untested":%d}\n' \
  "$counts_swallowed" "$counts_broadened" "$(( has_err_handling && ! touches_test ? 1 : 0 ))"
printf '}\n'

exit 0
