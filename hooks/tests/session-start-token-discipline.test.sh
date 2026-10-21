#!/usr/bin/env bash
# BL-0271: SessionStart additionalContext contains the docs/token-discipline.md
# pointer exactly once, on the line immediately after the show-tool sentence.
# No git history and no files inside the repository.
# RED at 7e5033278b0ad5cc08030d27db5ef9d5d1ee37ef (git rev-parse HEAD of this run): the live SessionStart output passed the check (exit 0). The same check against a copy of that output with the pointer line removed exited 1, reason "pointer count 0".
. "$(dirname "$0")/lib.sh"

DOC="$REPO_ROOT/docs/token-discipline.md"
LINE="Cross-harness token discipline (advisory only): read ${DOC}."
SHOW='To show the owner a file or a diff, use the show tool; do not paste the content.'
OPEN="Anything that needs the owner's decision or answer: open a card with node ${REPO_ROOT}/scripts/open-decision.js open --question ... and write the card id (d- + 8 hex) in the reply."
PENDING='When the owner answers in the live panel, a message starting with [待決回覆] arrives: act on the answers; the cards close automatically.'

run_hook session-start.js
assert_exit_code "$__RUN_EXIT" 0 "session-start exits 0"
printf '%s' "$__RUN_STDOUT" > "$TEST_TMP/current-session-start.json"

# check_pointer <json-file>
# Exit 0 only when additionalContext has the pointer line exactly once, directly
# under the show-tool sentence, and the text with that line removed still has
# the open-decision instruction, the [待決回覆] line, and the show-tool sentence.
check_pointer() {
  LINE="$LINE" SHOW="$SHOW" OPEN="$OPEN" PENDING="$PENDING" CTX_FILE="$1" node <<'JS'
const fs = require('fs');
const line = process.env.LINE;
const show = process.env.SHOW;
const open = process.env.OPEN;
const pending = process.env.PENDING;
const j = JSON.parse(fs.readFileSync(process.env.CTX_FILE, 'utf8'));
const text = (j.hookSpecificOutput && j.hookSpecificOutput.additionalContext) || '';
const lines = text.split('\n');
const count = lines.filter((l) => l === line).length;
if (count !== 1) {
  console.error('pointer count ' + count);
  process.exit(1);
}
const idx = lines.indexOf(line);
if (idx < 1 || lines[idx - 1] !== show) {
  console.error('pointer is not immediately after the show-tool sentence');
  process.exit(1);
}
const rest = lines.filter((l) => l !== line).join('\n');
if (!rest.includes(open) || !rest.includes(pending) || !rest.includes(show)) {
  console.error('removing the pointer line swallowed a base-context line');
  process.exit(1);
}
process.exit(0);
JS
}

check_pointer "$TEST_TMP/current-session-start.json"
assert_exit_code "$?" 0 "pointer once, right after the show-tool sentence, and the base lines remain"

mutate_context() {
  MODE="$1" LINE="$LINE" SHOW="$SHOW" SRC="$TEST_TMP/current-session-start.json" DEST="$2" node <<'JS'
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.env.SRC, 'utf8'));
const line = process.env.LINE;
const show = process.env.SHOW;
const lines = String(j.hookSpecificOutput.additionalContext).split('\n');
let next;
if (process.env.MODE === 'delete') {
  next = lines.filter((l) => l !== line);
} else if (process.env.MODE === 'duplicate') {
  const idx = lines.indexOf(line);
  next = lines.slice();
  next.splice(idx, 0, line);
} else if (process.env.MODE === 'drop-show') {
  next = lines.filter((l) => l !== show);
} else {
  console.error('unknown mode');
  process.exit(2);
}
j.hookSpecificOutput.additionalContext = next.join('\n');
fs.writeFileSync(process.env.DEST, JSON.stringify(j));
JS
}

mutate_context delete "$TEST_TMP/pointer-deleted.json"
check_pointer "$TEST_TMP/pointer-deleted.json"
assert_exit_code "$?" 1 "negative control: deleted pointer is rejected"

mutate_context duplicate "$TEST_TMP/pointer-duplicated.json"
check_pointer "$TEST_TMP/pointer-duplicated.json"
assert_exit_code "$?" 1 "negative control: duplicated pointer is rejected"

mutate_context drop-show "$TEST_TMP/show-removed.json"
check_pointer "$TEST_TMP/show-removed.json"
assert_exit_code "$?" 1 "negative control: missing show-tool sentence is rejected"

finalize_test
