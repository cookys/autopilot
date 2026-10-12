#!/usr/bin/env bash
# state-checkpoint must read the PreCompact payload when stdin is a socket.
# Claude Code (and Node's own spawn with stdio 'pipe') hands hooks a UNIX
# socketpair, not a FIFO. Opening the '/dev/stdin' PATH on a socket throws
# ENXIO, so the hook logged no_payload_skip on every real auto-compact and never
# wrote compaction-state.md (observed live, CC 2.1.296, 2026-10-12). The bash
# here-string run_hook uses is a FIFO/file, which is why the other suites stayed
# green. This suite spawns the hook from Node to reproduce the socket.
. "$(dirname "$0")/lib.sh"

FIXTURE="$HOOK_HOME/transcript-socket.jsonl"
printf '%s\n' '{"type":"user","timestamp":"T1","message":{"content":"socket stdin marker"}}' > "$FIXTURE"
payload="{\"transcript_path\":\"$FIXTURE\",\"session_id\":\"socket-stdin\",\"trigger\":\"auto\"}"

out=$(HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" node -e '
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, [process.argv[1]], { input: process.argv[2], stdio: ["pipe", "pipe", "pipe"] });
  process.stdout.write(String(r.status));
' "$HOOKS_DIR/state-checkpoint.js" "$payload" </dev/null)
assert_eq "$out" "0" "fail-open exit 0 with socket stdin"

# Guard that the harness really produced a socket, so a pass is not a FIFO pass.
kind=$(node -e '
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(require(\"fs\").fstatSync(0).isSocket() ? \"socket\" : \"other\")"], { input: "x", stdio: ["pipe", "pipe", "pipe"] });
  process.stdout.write(String(r.stdout));
')
assert_eq "$kind" "socket" "Node spawn stdio pipe is a socket on this platform"

STATE_FILE="$HOOK_HOME/.autopilot/compaction-state.md"
assert_file_exists "$STATE_FILE" "compaction-state.md written from a socket payload"
state_content=$(cat "$STATE_FILE" 2>/dev/null || echo "")
assert_contains "$state_content" "socket stdin marker" "transcript tail captured"
assert_contains "$state_content" "Session: socket-stdin" "session id parsed from the payload"

log_content=$(cat "$HOOK_HOME/.autopilot/.state-checkpoint.log" 2>/dev/null || echo "")
assert_not_contains "$log_content" "no_payload_skip" "no ENXIO skip logged"

finalize_test
