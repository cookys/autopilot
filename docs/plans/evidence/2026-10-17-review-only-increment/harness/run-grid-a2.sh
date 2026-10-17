#!/usr/bin/env bash
# run-grid-a2.sh: the A2 condition (spec wording for the FINDINGS object), 3 cells at a time.
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$(dirname "$HERE")/cells/_grid-a2.log"
{ for rep in 1 2; do echo "s6 inc $rep locjson"; echo "s6 full $rep loc"; done; } \
  | xargs -P 3 -L 1 bash -c '"$0/launch-cell.sh" "$1" "$2" "$3" "$4"; echo "cell $1 $2 $3 $4 finished $(date +%T)" >> "'"$LOG"'"' "$HERE"
echo "GRID_DONE $(date +%T)" >> "$LOG"
