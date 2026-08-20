#!/usr/bin/env bash
# probe-todo-tools-pin: offline via stub claude binaries (no live calls).
. "$(dirname "$0")/lib.sh"
PROBE="$REPO_ROOT/scripts/probe-todo-tools-pin.js"
STUBS="$TEST_TMP/stubs"; mkdir -p "$STUBS"

# stub: session where TaskCreate fires (tool present)
cat > "$STUBS/claude-present" <<'SH'
#!/usr/bin/env bash
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"pin-probe-task"}}]}}'
echo '{"type":"result","result":"Task created using TaskCreate."}'
SH
# stub: gated session (NO_TASK_TOOL)
cat > "$STUBS/claude-absent" <<'SH'
#!/usr/bin/env bash
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"NO_TASK_TOOL"}]}}'
echo '{"type":"result","result":"NO_TASK_TOOL"}'
SH
# stub: garbage (neither signal)
cat > "$STUBS/claude-mute" <<'SH'
#!/usr/bin/env bash
echo 'not json at all'
SH
chmod +x "$STUBS"/claude-*

run_probe() { node "$PROBE" --claude-bin "$1" ${2:-}; }

run_probe "$STUBS/claude-present"; assert_eq "$?" "0" "present + expect-present → 0"
run_probe "$STUBS/claude-present" --expect-absent >/dev/null; assert_eq "$?" "1" "present + expect-absent → 1 (planted red works both ways)"
run_probe "$STUBS/claude-absent" >/dev/null; assert_eq "$?" "1" "absent + expect-present → 1"
run_probe "$STUBS/claude-absent" --expect-absent >/dev/null; assert_eq "$?" "0" "absent + expect-absent → 0"
run_probe "$STUBS/claude-mute" >/dev/null 2>&1; assert_eq "$?" "2" "no signal → indeterminate 2"
OUT=$(node "$PROBE" --claude-bin "$STUBS/claude-present")
assert_contains "$OUT" '"observed":"present"' "JSON verdict names the observation"

finalize_test
