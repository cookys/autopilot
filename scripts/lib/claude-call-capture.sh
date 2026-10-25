#!/usr/bin/env bash
# claude-call-capture.sh -- shell side of the claude-call evidence capture (BL-0294); see claude-call-capture.js for the design.
#   source it, then:  claude_capture_begin <record-dir>   (exports EVAL_CALL_RECORD_DIR, CLAUDE_CAPTURE_JS, CLAUDE_CAPTURE_TAIL)
#   the PATH `claude` wrapper sources "$CLAUDE_CAPTURE_TAIL" after setting REAL_CLAUDE and EXTRA_ARGS;
#   claude_capture_judge <id-prefix> [--final]   -> 0 = no call died on authentication, 6 = one did (STOP_AUTH line on stderr)
_CCC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CLAUDE_CAPTURE_JS="$_CCC_DIR/claude-call-capture.js"
export CLAUDE_CAPTURE_TAIL="$_CCC_DIR/claude-call-capture-exec.sh"
claude_capture_begin() { mkdir -p "$1" && export EVAL_CALL_RECORD_DIR="$1"; }
claude_capture_judge() { local p="$1"; shift; node "$CLAUDE_CAPTURE_JS" judge --dir "$EVAL_CALL_RECORD_DIR" --id-prefix "$p" "$@" < /dev/null; }
