#!/usr/bin/env bash
# BL-0271: SessionStart points at docs/token-discipline.md exactly once.
# Empty temp HOME (lib.sh). The rest of the output equals the base context,
# obtained by running the base handler from git, not a pinned hash.
# RED at 329e516a0d1ed62020c81292f81128c3e19805b8: the old BASE_SHA was never derived from that handler (the rest sha differed), so the rest-equals-base check exited 1.
. "$(dirname "$0")/lib.sh"

BASE_REV="329e516a0d1ed62020c81292f81128c3e19805b8"
DOC="$REPO_ROOT/docs/token-discipline.md"
LINE="Cross-harness token discipline (advisory only): read ${DOC}."
BASE_JS="$REPO_ROOT/src/hooks/handlers/.session-start-base-$$.js"
PRELOAD="$TEST_TMP/session-start-base-preload.js"

cleanup_base() { rm -f "$BASE_JS" "$PRELOAD"; }
trap cleanup_base EXIT

git -C "$REPO_ROOT" show "${BASE_REV}:src/hooks/handlers/session-start.js" > "$BASE_JS"

# The preload swaps only the handler require. The copy sits beside the real handler so its relative requires resolve, and cleanup_base removes it on success or failure.
cat > "$PRELOAD" << EOF
const Module = require('module');
const orig = Module.prototype.require;
const base = ${BASE_JS@Q};
Module.prototype.require = function (id) {
  if (id === '../src/hooks/handlers/session-start') return orig.call(this, base);
  return orig.apply(this, arguments);
};
EOF

run_hook session-start.js
assert_exit_code "$__RUN_EXIT" 0 "session-start exits 0"
printf '%s' "$__RUN_STDOUT" > "$TEST_TMP/current-session-start.json"

HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
  node -r "$PRELOAD" "$HOOKS_DIR/session-start.js" >"$TEST_TMP/base-session-start.json" 2>"$TEST_TMP/base-session-start.err" </dev/null
assert_exit_code "$?" 0 "base session-start exits 0"

node -e '
const fs = require("fs");
const line = process.argv[1];
function ctx(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return j.hookSpecificOutput.additionalContext;
}
function onlyPointerAdded(baseText, curText) {
  if (curText.split(line).length - 1 !== 1) return false;
  const stripped = curText.split("\n").filter((l) => l !== line).join("\n");
  return stripped === baseText;
}
const baseText = ctx(process.argv[2]);
const curText = ctx(process.argv[3]);
if (!onlyPointerAdded(baseText, curText)) {
  console.error("current output is not the base output plus the pointer line");
  process.exit(1);
}
const doubled = curText.replace(line, line + "\n" + line);
if (onlyPointerAdded(baseText, doubled)) {
  console.error("negative control accepted a doubled pointer");
  process.exit(1);
}
const extra = curText.replace(line, line + "x");
if (onlyPointerAdded(baseText, extra)) {
  console.error("negative control accepted an extra character");
  process.exit(1);
}
' "$LINE" "$TEST_TMP/base-session-start.json" "$TEST_TMP/current-session-start.json"
assert_exit_code "$?" 0 "pointer once and the rest matches the base context"

finalize_test
