#!/usr/bin/env bash
# diff-scope-report.sh — v2 scope-creep candidate filter.
# Consumed by autopilot:reviewer's Scope discipline scan (Surgical Changes).
# Replaces the per-hunk LLM "which sentence implements this hunk?" pass for
# the mechanically-detectable subset.
#
# v2 signals (this version):
#   - whitespace_only_file: a file whose diff vs `git diff -w` is empty
#   - unrelated_to_message: a file path not mentioned in the commit message
#   - comment_only_hunk:    a hunk whose changed lines are all comments
#                           (per file extension's comment syntax)
#   - quote_style_swap:     a hunk whose -/+ lines differ only in quote
#                           style after normalizing ' and " to the same char
#
# Not yet covered (need symbol-aware tooling — v3):
#   - rename_outside_task_surface (identifier renames across modules)
#
# The reviewer still judges residual hunks. This script is a FILTER, not a
# verdict. Output JSON is consumed by autopilot:reviewer.
#
# Usage:
#   scripts/diff-scope-report.sh                            # staged diff
#   scripts/diff-scope-report.sh --range A..B               # commit range
#   scripts/diff-scope-report.sh --message-file path/to/msg # check file-vs-message
#
# Exit 0 always (this is a report, not a gate).

set -euo pipefail

MSG_FILE=""
RANGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message-file) MSG_FILE="$2"; shift 2 ;;
    --range)        RANGE="$2";   shift 2 ;;
    -h|--help)      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$RANGE" ]]; then
  DIFF_ARGS=(--diff-filter=ACMR "$RANGE")
else
  DIFF_ARGS=(--cached --diff-filter=ACMR)
fi

# ---------- v1 signal: whitespace_only_file ----------
mapfile -t files_normal < <(git diff "${DIFF_ARGS[@]}" --name-only 2>/dev/null | sort -u)
mapfile -t files_nows   < <(git diff -w "${DIFF_ARGS[@]}" --name-only 2>/dev/null | sort -u)

ws_only=()
for f in "${files_normal[@]:-}"; do
  found=0
  for g in "${files_nows[@]:-}"; do
    [[ "$f" == "$g" ]] && { found=1; break; }
  done
  [[ $found -eq 0 ]] && ws_only+=("$f")
done

# ---------- v1 signal: unrelated_to_message ----------
unrelated=()
if [[ -n "$MSG_FILE" && -f "$MSG_FILE" ]]; then
  msg="$(cat "$MSG_FILE")"
  for f in "${files_normal[@]:-}"; do
    base="$(basename "$f")"
    if ! grep -qF "$base" <<< "$msg" && ! grep -qF "$f" <<< "$msg"; then
      unrelated+=("$f")
    fi
  done
fi

# ---------- v2 signals: comment_only_hunk + quote_style_swap ----------
# Use `git diff -U0` so we only see + / - lines (no context noise).
# Parse with awk: track current file + hunk, classify on hunk boundary.
hunk_findings="$(git diff -U0 "${DIFF_ARGS[@]}" 2>/dev/null | awk '
BEGIN {
  # Comment-syntax regex per extension. Matches lines whose first non-space
  # char is a comment marker. Pure-blank lines are also accepted (count as
  # comment-like for the "all changed lines are comments" check).
  cre["js"]   = "^[[:space:]]*(\\/\\/|\\/\\*|\\*|\\*\\/)"
  cre["jsx"]  = cre["js"]
  cre["ts"]   = cre["js"]
  cre["tsx"]  = cre["js"]
  cre["c"]    = cre["js"]
  cre["cc"]   = cre["js"]
  cre["cpp"]  = cre["js"]
  cre["cxx"]  = cre["js"]
  cre["h"]    = cre["js"]
  cre["hpp"]  = cre["js"]
  cre["java"] = cre["js"]
  cre["go"]   = cre["js"]
  cre["rs"]   = cre["js"]
  cre["kt"]   = cre["js"]
  cre["swift"]= cre["js"]
  cre["cs"]   = cre["js"]
  cre["scala"]= cre["js"]
  cre["scss"] = cre["js"]
  cre["sass"] = cre["js"]

  cre["py"]   = "^[[:space:]]*#"
  cre["rb"]   = cre["py"]
  cre["sh"]   = cre["py"]
  cre["bash"] = cre["py"]
  cre["zsh"]  = cre["py"]
  cre["pl"]   = cre["py"]
  cre["yml"]  = cre["py"]
  cre["yaml"] = cre["py"]
  cre["toml"] = cre["py"]
  cre["ini"]  = cre["py"]
  cre["conf"] = cre["py"]
  cre["nix"]  = cre["py"]

  cre["sql"]  = "^[[:space:]]*--"
  cre["lua"]  = cre["sql"]
  cre["hs"]   = cre["sql"]

  cre["html"] = "^[[:space:]]*<!--"
  cre["xml"]  = cre["html"]
  cre["vue"]  = cre["html"]
  cre["svg"]  = cre["html"]
  cre["md"]   = cre["html"]

  in_hunk = 0
  current_file = ""
  cur_re = ""
}

function close_hunk(   i, mn, pl, swap_ok) {
  if (!in_hunk) return
  changes = m_count + p_count
  if (changes == 0) { in_hunk = 0; return }

  # comment_only_hunk: every changed line is comment-shaped (and we have a
  # comment regex for this extension)
  if (cur_re != "" && all_comment == 1) {
    print "comment_only_hunk\t" current_file "\t" hunk_header
  } else if (m_count == p_count && m_count > 0) {
    # quote_style_swap: pairwise lines identical after collapsing quotes
    swap_ok = 1
    for (i = 1; i <= m_count; i++) {
      mn = minus[i]; pl = plus[i]
      gsub(/['\''"]/, "Q", mn)
      gsub(/['\''"]/, "Q", pl)
      if (mn != pl) { swap_ok = 0; break }
    }
    if (swap_ok) print "quote_style_swap\t" current_file "\t" hunk_header
  }
  in_hunk = 0
}

/^diff --git/ {
  close_hunk()
  # extract b-path
  current_file = $0
  sub(/^.* b\//, "", current_file)
  n = split(current_file, parts, ".")
  ext = (n > 1) ? tolower(parts[n]) : ""
  cur_re = (ext in cre) ? cre[ext] : ""
  next
}

/^@@ / {
  close_hunk()
  hunk_header = $0
  in_hunk = 1
  m_count = 0; p_count = 0
  delete minus; delete plus
  all_comment = (cur_re != "") ? 1 : 0
  next
}

# only count diff body lines while in a hunk
in_hunk && /^-/ && !/^---/ {
  m_count++
  line = substr($0, 2)
  minus[m_count] = line
  if (cur_re != "") {
    if (line !~ cur_re && line !~ /^[[:space:]]*$/) all_comment = 0
  } else {
    all_comment = 0
  }
  next
}

in_hunk && /^\+/ && !/^\+\+\+/ {
  p_count++
  line = substr($0, 2)
  plus[p_count] = line
  if (cur_re != "") {
    if (line !~ cur_re && line !~ /^[[:space:]]*$/) all_comment = 0
  } else {
    all_comment = 0
  }
  next
}

END { close_hunk() }
')"

# ---------- Emit JSON ----------
printf '{\n'
printf '  "version": "v2",\n'
printf '  "covered_signals": ["whitespace_only_file", "unrelated_to_message", "comment_only_hunk", "quote_style_swap"],\n'
printf '  "not_yet_covered": ["rename_outside_task_surface"],\n'
printf '  "findings": [\n'

first=1
emit() {
  local file="$1" signal="$2" detail="${3:-}"
  [[ $first -eq 0 ]] && printf '    ,\n'
  first=0
  if [[ -n "$detail" ]]; then
    # JSON-escape detail
    local esc
    esc="$(printf '%s' "$detail" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
    printf '    {"file":"%s","signal":"%s","detail":"%s"}\n' "$file" "$signal" "$esc"
  else
    printf '    {"file":"%s","signal":"%s"}\n' "$file" "$signal"
  fi
}

for f in "${ws_only[@]:-}";   do [[ -n "$f" ]] && emit "$f" "whitespace_only_file"; done
for f in "${unrelated[@]:-}"; do [[ -n "$f" ]] && emit "$f" "unrelated_to_message"; done

# v2 per-hunk findings (tab-separated: signal\tfile\thunk_header)
if [[ -n "$hunk_findings" ]]; then
  while IFS=$'\t' read -r signal file hunk_header; do
    [[ -z "$signal" ]] && continue
    emit "$file" "$signal" "$hunk_header"
  done <<< "$hunk_findings"
fi

printf '  ],\n'
printf '  "scanned_files": %d\n' "${#files_normal[@]}"
printf '}\n'
