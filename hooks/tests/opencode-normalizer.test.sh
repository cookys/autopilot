#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const root = process.argv[2]
const { normalizeOpenCodeToolEvent } = require(`${root}/src/hooks/normalize/opencode`)
const value = normalizeOpenCodeToolEvent({
  tool: "shell",
  input: { command: "git status" },
  output: "clean",
  sessionID: "ses_test",
})
process.stdout.write(JSON.stringify(value))
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "normalizer exits 0"
assert_contains "$OUT" '"platform":"opencode"' "normalizer identifies OpenCode"
assert_contains "$OUT" '"event":"post_tool_use"' "normalizer maps tool completion"
assert_contains "$OUT" '"tool":"shell"' "normalizer preserves tool"
assert_contains "$OUT" '"session":{"id":"ses_test"' "normalizer preserves session ID"
assert_contains "$OUT" '"command":"git status"' "normalizer preserves tool input"

finalize_test
