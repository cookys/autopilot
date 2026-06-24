#!/usr/bin/env bash
# risk-counter.sh — persistent WTF-Likelihood Cap counter.
# Removes the cross-round LLM tracking burden documented at
# skills/quality-pipeline/SKILL.md:89-103.
#
# Usage:
#   scripts/risk-counter.sh status                        # JSON state
#   scripts/risk-counter.sh increment --event <kind>      # add risk delta
#   scripts/risk-counter.sh threshold-hit                 # exit 1 if risk > 20
#   scripts/risk-counter.sh reset                         # zero out
#
# Events and increments (from SKILL.md):
#   reverted          +15  (fix didn't work)
#   multi-file         +5  (fix touches 3+ files)
#   late-fix           +1  (10th+ fix in same run)
#   unrelated-files   +20  (fix touches files unrelated to original change)
#   fix                 0  (just counts toward fixes total)
#
# State lives at: $AUTOPILOT_STATE_DIR/risk-<repo>-<branch>.json
#   Default: $HOME/.autopilot/state/

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/risk-counter.js" "$@"
