#!/usr/bin/env bash
# Non-PM team sessions do not open an owner card from AskUserQuestion.
# PM and solo keep today's silent write. HOME is the suite sandbox.
. "$(dirname "$0")/lib.sh"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
export AUTOPILOT_COURIER=1

payload() {
  node -e 'process.stdout.write(JSON.stringify({tool_name:"AskUserQuestion",session_id:"s1",cwd:process.argv[1],tool_input:{questions:[{question:"要刪嗎？",options:[{label:"刪",description:"刪掉"},{label:"留",description:"留下"}]}]}}))' "$REPO"
}

entry_count() {
  node -e '
    const fs = require("fs"); const path = require("path");
    const dir = path.join(process.argv[1], ".git", "autopilot", "decisions");
    let n = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const body = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        n += Array.isArray(body.decisions) ? body.decisions.length : 0;
      }
    } catch (e) { if (e.code !== "ENOENT") throw e; }
    process.stdout.write(String(n));
  ' "$REPO"
}

set_role() {
  mkdir -p "$HOOK_HOME/.autopilot"
  if [ "$1" = "missing" ]; then rm -f "$HOOK_HOME/.autopilot/team.json";
  else printf '%s\n' "{\"role\":\"$1\"}" > "$HOOK_HOME/.autopilot/team.json"; fi
}

expect_deny() {
  local before after
  before="$(entry_count)"
  run_hook ask-decision.js "$(payload)"
  after="$(entry_count)"
  assert_eq 0 "$__RUN_EXIT" "$1: exit 0"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "$1: denies"
  assert_contains "$__RUN_STDOUT" "request-decision.js" "$1: points at request-decision.js"
  assert_eq "$before" "$after" "$1: writes no decision entry"
}

expect_write() {
  local before after
  before="$(entry_count)"
  run_hook ask-decision.js "$(payload)"
  after="$(entry_count)"
  assert_eq 0 "$__RUN_EXIT" "$1: exit 0"
  assert_eq "" "$__RUN_STDOUT" "$1: silent"
  assert_eq "$((before + 1))" "$after" "$1: writes one entry"
}

set_role lane
expect_deny "lane"
set_role lead
expect_deny "lead"
set_role missing
expect_deny "missing file with courier"
set_role pm
expect_write "pm"
set_role solo
expect_write "solo"
set_role missing
AUTOPILOT_COURIER=0 expect_write "missing file without courier"

finalize_test
