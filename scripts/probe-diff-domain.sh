#!/usr/bin/env bash
# probe-diff-domain.sh — infer dominant work domain from git diff numstat.
#
# Usage:
#   scripts/probe-diff-domain.sh
#   scripts/probe-diff-domain.sh changed
#   scripts/probe-diff-domain.sh staged
#   scripts/probe-diff-domain.sh range A..B
#   scripts/probe-diff-domain.sh A..B
#   scripts/probe-diff-domain.sh --domain <rust|backend-cli|frontend|docs|mixed>
#   scripts/probe-diff-domain.sh --help
#
# Notes:
#   - Range default = changed (same base logic as scripts/diff-file-list.sh):
#       develop|main|HEAD~1 => BASE...HEAD.
#   - Parse `git diff --numstat -z -M -C` as NUL-delimited records:
#       added<tab>deleted<tab><NUL>[old_path<0>new_path]
#   - For renames/copies, classify with the new path.
#   - Binary rows are '-' '-' and are counted with zero weight.
#   - Combined/merge diffs are out of scope (documented here, not handled).

set -euo pipefail
# Exported so child tools (awk in share()) also format numbers locale-independently
# — a non-C locale would render dominant_share with a comma decimal (round-2 reviewer 🟠).
export LC_ALL=C

usage() {
  sed -n '2,80p' "$0" | sed 's/^# \{0,1\}//'
}

err_usage() {
  local msg="$1"
  echo "$msg" >&2
  echo "usage: $0 [changed|staged|A..B|range A..B] [--domain <rust|backend-cli|frontend|docs|mixed>]" >&2
  exit 2
}

is_valid_domain() {
  case "$1" in
    rust|backend-cli|frontend|docs|mixed) return 0 ;;
    *) return 1 ;;
  esac
}

is_excluded() {
  case "$1" in
    *.lock|package-lock.json|*/package-lock.json|yarn.lock|*/yarn.lock|\
    pnpm-lock.yaml|*/pnpm-lock.yaml|Cargo.lock|*/Cargo.lock|go.sum|*/go.sum|\
    *.min.js|*.min.css|dist/*|*/dist/*|build/*|*/build/*|vendor/*|*/vendor/*|\
    node_modules/*|*/node_modules/*|*.generated.*|*.pb.go|*_pb2.py)
      return 0
      ;;
    *) return 1 ;;
  esac
}

classify_path() {
  case "$1" in
    *.rs) echo "rust" ;;
    *.sh|*.bash|*.py|*.go|*.c|*.h|*.cpp) echo "backend-cli" ;;
    *.js|*.ts|*.jsx|*.tsx|*.vue|*.css|*.scss|*.html) echo "frontend" ;;
    *.md|*.mdx|*.txt|*.rst) echo "docs" ;;
    *) echo "unclassified" ;;
  esac
}

share() {
  local top="$1" bottom="$2"
  if [[ "$bottom" -eq 0 ]]; then
    echo "0"
    return
  fi
  awk -v t="$top" -v b="$bottom" 'BEGIN { printf "%.6f", t / b }'
}

MODE="changed"
RANGE_ARG=""
DOMAIN_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --domain)
      if [[ -z "${2:-}" ]]; then
        err_usage "missing value for --domain"
      fi
      if ! is_valid_domain "$2"; then
        err_usage "invalid --domain: $2"
      fi
      DOMAIN_OVERRIDE="$2"
      shift 2
      ;;
    changed|staged)
      MODE="$1"
      shift
      ;;
    range)
      RANGE_ARG="${2:-}"
      [[ -z "$RANGE_ARG" ]] && err_usage "range requires A..B"
      MODE="range"
      shift 2
      ;;
    *...*|*..*)
      MODE="range"
      RANGE_ARG="$1"
      shift
      ;;
    --*)
      err_usage "unknown arg: $1"
      ;;
    *)
      err_usage "unknown arg: $1"
      ;;
  esac
done

case "$MODE" in
  changed)
    BASE="$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1)"
    DIFF_CMD=(git diff --numstat -z -M -C "${BASE}...HEAD")
    ;;
  staged)
    DIFF_CMD=(git diff --numstat -z -M -C --cached)
    ;;
  range)
    [[ -z "$RANGE_ARG" ]] && err_usage "range requires A..B"
    DIFF_CMD=(git diff --numstat -z -M -C "$RANGE_ARG")
    ;;
  *)
    err_usage "invalid mode: $MODE"
    ;;
esac

RST_RUST=0
RST_BACKEND=0
RST_FRONTEND=0
RST_DOCS=0
RST_UNCLASS=0
WEIGHT_CLASSIFIED=0
WEIGHT_EXCLUDED=0
WEIGHT_UNCLASS=0

# Deterministic parse of `git diff --numstat -z` (format verified empirically):
#   normal file : "added<tab>deleted<tab>path<NUL>"            (path MAY contain tabs)
#   rename/copy : "added<tab>deleted<tab><NUL>old<NUL>new<NUL>" (old/new each a NUL field)
# The counts token always carries exactly two leading tabs; whatever follows the
# 2nd tab is the path (empty ⇒ rename/copy, whose NEW path is the next-but-one NUL
# field). No heuristic boundary detection: a path that looks like "1<tab>2<tab>x"
# is a path, never reinterpreted as a counts record (round-2 reviewer 🔴). Each
# rename/copy is self-contained, so multi-destination copies parse independently
# (round-2 reviewer 🟠 — no shared old→new map to collide).
while IFS= read -r -d '' TOK; do
  case "$TOK" in
    *$'\t'*$'\t'*) : ;;   # well-formed counts token (≥2 tabs)
    *) continue ;;        # malformed / stray field — skip, never miscount
  esac

  ADDED="${TOK%%$'\t'*}"
  REST="${TOK#*$'\t'}"          # after 1st tab: "deleted<tab>path-or-empty"
  DELETED="${REST%%$'\t'*}"
  PATH_FIELD="${REST#*$'\t'}"   # everything after the 2nd tab = the path

  if [[ -z "$PATH_FIELD" ]]; then
    # rename/copy: next two NUL fields are old then new; classify by the NEW path.
    IFS= read -r -d '' _OLD_PATH || break
    IFS= read -r -d '' CLASSIFY_PATH || break
  else
    CLASSIFY_PATH="$PATH_FIELD"
  fi

  if [[ "$ADDED" == "-" ]]; then
    ADDED=0
  fi
  if [[ "$DELETED" == "-" ]]; then
    DELETED=0
  fi
  WEIGHT=$((ADDED + DELETED))

  if is_excluded "$CLASSIFY_PATH"; then
    WEIGHT_EXCLUDED=$((WEIGHT_EXCLUDED + WEIGHT))
    continue
  fi

  KIND="$(classify_path "$CLASSIFY_PATH")"
  case "$KIND" in
    rust)
      RST_RUST=$((RST_RUST + WEIGHT))
      WEIGHT_CLASSIFIED=$((WEIGHT_CLASSIFIED + WEIGHT))
      ;;
    backend-cli)
      RST_BACKEND=$((RST_BACKEND + WEIGHT))
      WEIGHT_CLASSIFIED=$((WEIGHT_CLASSIFIED + WEIGHT))
      ;;
    frontend)
      RST_FRONTEND=$((RST_FRONTEND + WEIGHT))
      WEIGHT_CLASSIFIED=$((WEIGHT_CLASSIFIED + WEIGHT))
      ;;
    docs)
      RST_DOCS=$((RST_DOCS + WEIGHT))
      WEIGHT_CLASSIFIED=$((WEIGHT_CLASSIFIED + WEIGHT))
      ;;
    *)
      RST_UNCLASS=$((RST_UNCLASS + WEIGHT))
      WEIGHT_UNCLASS=$((WEIGHT_UNCLASS + WEIGHT))
      ;;
  esac
done < <("${DIFF_CMD[@]}")

if (( WEIGHT_CLASSIFIED > 0 )); then
  MAX=0
  WORK_DOMAIN="mixed"
  DOMINANT_SHARE="0"
  TIES=0

  if (( RST_RUST > MAX )); then
    MAX=$RST_RUST
    WORK_DOMAIN="rust"
    TIES=0
  elif (( RST_RUST == MAX && MAX > 0 )); then
    TIES=1
  fi

  if (( RST_BACKEND > MAX )); then
    MAX=$RST_BACKEND
    WORK_DOMAIN="backend-cli"
    TIES=0
  elif (( RST_BACKEND == MAX && MAX > 0 )); then
    TIES=1
  fi

  if (( RST_FRONTEND > MAX )); then
    MAX=$RST_FRONTEND
    WORK_DOMAIN="frontend"
    TIES=0
  elif (( RST_FRONTEND == MAX && MAX > 0 )); then
    TIES=1
  fi

  if (( RST_DOCS > MAX )); then
    MAX=$RST_DOCS
    WORK_DOMAIN="docs"
    TIES=0
  elif (( RST_DOCS == MAX && MAX > 0 )); then
    TIES=1
  fi

  DOMINANT_SHARE="$(share "$MAX" "$WEIGHT_CLASSIFIED")"
  if (( MAX * 2 <= WEIGHT_CLASSIFIED )) || [[ "$TIES" -eq 1 ]]; then
    WORK_DOMAIN="mixed"
  fi
else
  WORK_DOMAIN="mixed"
  DOMINANT_SHARE="0"
fi

if (( WEIGHT_EXCLUDED + WEIGHT_UNCLASS > WEIGHT_CLASSIFIED )); then
  CONFIDENCE="low"
else
  CONFIDENCE="high"
fi

if [[ -n "$DOMAIN_OVERRIDE" ]]; then
  WORK_DOMAIN="$DOMAIN_OVERRIDE"
fi

printf '{ "work_domain": "%s", "language_mix": {"rust": %d, "backend-cli": %d, "frontend": %d, "docs": %d, "unclassified": %d}, "dominant_share": %s, "weight_classified": %d, "weight_excluded": %s, "weight_unclassified": %d, "confidence": "%s" }\n' \
  "$WORK_DOMAIN" "$RST_RUST" "$RST_BACKEND" "$RST_FRONTEND" "$RST_DOCS" "$RST_UNCLASS" "$DOMINANT_SHARE" "$WEIGHT_CLASSIFIED" "$WEIGHT_EXCLUDED" "$WEIGHT_UNCLASS" "$CONFIDENCE"
exit 0
