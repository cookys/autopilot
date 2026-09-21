#!/usr/bin/env bash
# Diagnostic wrapper: the broker discards adapter stderr (it keeps only a hash, by
# design, so prompt bodies never leak into a receipt). This tees it to a file so an
# intermittent provider_process_failed can be read. Exit code is passed through
# untouched so broker behaviour is unchanged.
LOG=/tmp/claude-1000/qrp-stderr.log
node /home/cookys/projects/autopilot/scripts/qualification-review-provider.js 2> >(tee -a "$LOG" >&2)
rc=$?
echo "=== adapter exit $rc at $(date -Is) ===" >> "$LOG"
exit $rc
