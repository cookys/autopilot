#!/usr/bin/env bash
# lib/dc-markers.sh — marker helpers for the dev-flow card campaign (BL-0044 instrument repair, row "dc").
# Sourced by tasks/dc-*/markers.sh. Contract (set by run-skill-onoff-eval.sh): cwd = fixture repo after the cell,
# TRANSCRIPT, FROZEN_BASE_SHA, QUERY (transcript-query.js). All checks are mechanical (no LLM judging); every marker is
# ANDed with the task's own work_done by the caller, so a no-op cell is false everywhere.
#
# Why anchored on "first Edit/Write OR first git commit" (pilot 2026-10-17): headless sonnet edits files through Bash
# (python/sed/heredoc) as often as through Edit/Write, so "before the first Edit" alone never sees a Bash edit. A commit is
# always a Bash `git commit`.
DC_ANCHOR='(Edit|Write)\t|Bash\t.*\bgit\b.*\bcommit\b'
# A source-file mutation seen in a Bash command (sed -i / heredoc / redirect / python / tee into lib/) or an Edit/Write on lib/.
DC_LIB_MUTATION='(Edit|Write)\t.*lib/|Bash\t(?=.*\b(sed -i|perl -i|tee|python3?)\b|.*cat *>>? *\S*lib/|.*>>? *\S*lib/)(?=.*lib/)'
# A real test run (not a `cat run-tests.sh` read).
DC_TEST_RUN='Bash\t.*\b(bash|sh) +(\./)?run-tests\.sh'

dc_sized() { # $1 = size alternation, e.g. 'XS|S' ; $2 = optional --bug : session-mode.js set recorded before the anchor
  local pat='Bash\t.*session-mode\.js +set\b(?=.*--size +('"$1"')\b)'
  [ "${2:-}" != "--bug" ] || pat="$pat"'(?=.*--bug\b)'
  node "$QUERY" "$TRANSCRIPT" order "$pat" "$DC_ANCHOR"
}
dc_staged() { # stage-advance.js entered at least one node before the anchor
  node "$QUERY" "$TRANSCRIPT" order 'Bash\t.*stage-advance\.js .*--to ' "$DC_ANCHOR"
}
dc_red_first() { # a test run precedes the first lib/ mutation and that mutation is a different event than the run
  node "$QUERY" "$TRANSCRIPT" order "$DC_TEST_RUN" "$DC_LIB_MUTATION"
}
dc_no_tracking() { # no project tracking tree (other than the ongoing-maintenance fixture) and no plan doc
  local d
  for d in docs/projects/*/; do
    [ -d "$d" ] || continue
    case "$(basename "$d")" in ongoing-maintenance) ;; *) return 1 ;; esac
  done
  ! ls docs/plans/*.md >/dev/null 2>&1
}
dc_ledger_rows() { # ledger rows (date | hash | fix...) across docs/projects/ongoing-maintenance/*.md
  cat docs/projects/ongoing-maintenance/*.md 2>/dev/null | grep -cE '^\| *[0-9]{2}-[0-9]{2} *\| *[0-9a-f]{7,40} *\| *fix' || true
}
dc_root_cause_commit() { # a commit made since the frozen base (any branch) states the root cause in its message
  git log --all --not "$FROZEN_BASE_SHA" --format=%B 2>/dev/null | grep -qi 'root cause'
}
