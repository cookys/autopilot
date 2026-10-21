#!/usr/bin/env bash
# BL-0271: SessionStart points at docs/token-discipline.md exactly once.
# Empty temp HOME (lib.sh). The rest of the output equals the base context.
# RED at 329e516a0d1ed62020c81292f81128c3e19805b8: pointer count 0, so the rest-equals-base check exited 1.
. "$(dirname "$0")/lib.sh"

BASE_SHA="155a09f65a2f5905ed7e001d3f09c73ce15794940cdba36da9a0c271e901f0fd"
DOC="$REPO_ROOT/docs/token-discipline.md"
LINE="Cross-harness token discipline (advisory only): read ${DOC}."

run_hook session-start.js
assert_exit_code "$__RUN_EXIT" 0 "session-start exits 0"

node -e '
const fs = require("fs");
const crypto = require("crypto");
const raw = fs.readFileSync(0, "utf8");
const j = JSON.parse(raw);
const ctx = j.hookSpecificOutput.additionalContext;
const line = process.argv[1];
const n = ctx.split(line).length - 1;
if (n !== 1) { console.error("pointer count " + n); process.exit(1); }
const rest = ctx.split("\n").filter((l) => l !== line).join("\n");
const sha = crypto.createHash("sha256").update(rest).digest("hex");
if (sha !== process.argv[2]) { console.error("rest sha " + sha); process.exit(1); }
' "$LINE" "$BASE_SHA" <<<"$__RUN_STDOUT"
assert_exit_code "$?" 0 "pointer once and the rest matches the base context"

finalize_test
