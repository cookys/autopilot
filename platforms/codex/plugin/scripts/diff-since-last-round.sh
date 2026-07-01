#!/usr/bin/env bash
# diff-since-last-round.sh — checkpoint/delta helper for re-review short-circuit.
#
# Purpose: in quality-pipeline's Re-review Loop, after a fix round, the
# dispatcher needs to know whether re-review is worth running again (vs. a
# trivial doc-only round). This script provides that signal.
#
# CRITICAL: the delta output is for the DISPATCHER ONLY. Never pass to the
# reviewer agent — it leaks round-cycle meta-signal per
# references/blind-dispatch.md (forbidden "this is a re-review" cue).
#
# Subcommands:
#   mark              snapshot current HEAD SHA as the round-N marker
#   since             emit (a) full diff for reviewer + (b) delta-since-marker
#                     for dispatcher; sections are clearly labelled
#   stat              emit just the delta stat (one-liner for dispatch logic)
#   clear             remove the checkpoint
#
# Checkpoint file: <git-dir>/autopilot-rereview-checkpoint

set -euo pipefail

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)" || { echo "not a git repo" >&2; exit 2; }
CHECKPOINT_FILE="$GIT_DIR/autopilot-rereview-checkpoint"

CMD="${1:-}"
shift || true

require_checkpoint() {
  [[ -f "$CHECKPOINT_FILE" ]] || { echo "no checkpoint set; run: $0 mark" >&2; exit 2; }
}

case "$CMD" in
  mark)
    git rev-parse HEAD > "$CHECKPOINT_FILE"
    echo "marked checkpoint: $(cat "$CHECKPOINT_FILE")"
    ;;
  since)
    require_checkpoint
    sha="$(cat "$CHECKPOINT_FILE")"
    BASE="${BASE:-$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "$sha")}"

    echo "===== SECTION A: FULL DIFF (give to reviewer) ====="
    git diff "$BASE"...HEAD
    echo ""
    echo "===== SECTION B: DELTA SINCE LAST ROUND (DISPATCHER ONLY — NOT for reviewer) ====="
    git diff --stat "$sha"...HEAD
    echo ""
    echo "Changed since last round:"
    git diff --name-only "$sha"...HEAD
    ;;
  stat)
    require_checkpoint
    sha="$(cat "$CHECKPOINT_FILE")"
    changed_files=$(git diff --name-only "$sha"...HEAD | wc -l | tr -d ' ')
    insertions=$(git diff --shortstat "$sha"...HEAD 2>/dev/null | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)
    deletions=$(git diff --shortstat "$sha"...HEAD 2>/dev/null | grep -oE '[0-9]+ deletion'  | grep -oE '[0-9]+' || echo 0)
    # Doc-only? all changed files match doc patterns
    doc_only="false"
    if [[ "$changed_files" -gt 0 ]]; then
      non_doc=$(git diff --name-only "$sha"...HEAD | grep -vE '\.(md|txt|rst)$' | wc -l | tr -d ' ')
      [[ "$non_doc" -eq 0 ]] && doc_only="true"
    fi
    printf '{"checkpoint":"%s","changed_files":%d,"insertions":%d,"deletions":%d,"doc_only":%s}\n' \
      "$sha" "$changed_files" "$insertions" "$deletions" "$doc_only"
    ;;
  clear)
    rm -f "$CHECKPOINT_FILE"
    echo "checkpoint cleared"
    ;;
  *)
    echo "usage: $0 {mark|since|stat|clear}" >&2
    exit 2
    ;;
esac
