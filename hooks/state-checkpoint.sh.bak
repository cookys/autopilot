#!/usr/bin/env bash
# state-checkpoint — PreCompact/*
# Dumps machine-readable runtime state and instructs Claude to append context.
# The machine-written section is guaranteed; the LLM-written section is best-effort.
#
# Output: stdout text injection (command-type hook).
#
# Inspired by tanweai/pua session-restore.sh (MIT License)

set -euo pipefail

STATE_DIR="${HOME}/.autopilot"
STATE_FILE="${STATE_DIR}/compaction-state.md"

mkdir -p -m 700 "$STATE_DIR"

# Collect machine-readable state
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Read failure counter (find most recent session's counter)
FAILURE_COUNT=0
LATEST_COUNTER=$(ls -t "${STATE_DIR}"/.failure_count_* 2>/dev/null | head -1 || true)
if [ -n "$LATEST_COUNTER" ] && [ -f "$LATEST_COUNTER" ]; then
  FAILURE_COUNT=$(cat "$LATEST_COUNTER" 2>/dev/null || echo "0")
fi

# Write machine section to state file
cat > "$STATE_FILE" << EOF
# Autopilot Compaction Checkpoint
## Machine State (guaranteed accurate)
- Timestamp: ${TIMESTAMP}
- Failure counter: ${FAILURE_COUNT}
- Compaction trigger: automatic

## LLM Context (appended by Claude — best-effort)
<!-- Claude: append your working context below this line -->
EOF

chmod 600 "$STATE_FILE"

# Output instruction for Claude to append context-dependent state
cat << 'INJECTION'
[Autopilot State Checkpoint — PreCompact]

Context compaction is about to happen. Runtime state has been partially saved.

You MUST append your working context to ~/.autopilot/compaction-state.md NOW using the Edit tool (append to the end of the file):

- Current phase/task: what you were working on
- Approaches tried and their outcomes
- Excluded possibilities
- Next planned action
- Critical file paths or error messages that would be lost

This is NOT optional. State lost to compaction cannot be recovered.
INJECTION

exit 0
