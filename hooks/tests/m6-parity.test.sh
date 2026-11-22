#!/usr/bin/env bash
# M6 P3 manual handoff parity. Exclude origin:* and key:* from parity only:
# hippo contract/autopilot-2/README.md lines 54-59 and 74-75 define them for new writes.
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip m6-parity
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup

H() { "$HIPPO_BIN" --json -C "$1" "${@:2}"; }
field() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(eval(process.argv[1]))' "$1"; }
IMPORT_REPO="$(hs_mkrepo import store)"
WRITE_REPO="$(hs_mkrepo write store)"
mkdir -p "$IMPORT_REPO/docs/projects/handoff"
BODY="$IMPORT_REPO/docs/projects/handoff/HANDOFF.md"
cat > "$BODY" <<'BODY_EOF'

## 目標
Deliver parity.

## 現況
In progress.

## 下一步
Verify the records.

## 驗證方式
Run the test.

## Read-order
Read this note.
BODY_EOF
git -C "$IMPORT_REPO" add docs/projects/handoff/HANDOFF.md
git -C "$IMPORT_REPO" commit -q -m fixture || { fail 'fixture commit'; finalize_test; }
H "$IMPORT_REPO" import --from handoff "$IMPORT_REPO/docs" > "$TEST_TMP/import.json" || { fail 'legacy import'; finalize_test; }
assert_eq "$(field 'd.data.report.created' < "$TEST_TMP/import.json")" 1 'import creates one handoff'
node "$REPO_ROOT/scripts/project-record.js" --target "$WRITE_REPO" --key 0123456789abcdef --json handoff new --title '目標' --area handoff --body-file "$BODY" --origin manual > "$TEST_TMP/write.json" 2> "$TEST_TMP/write.err" || { fail "manual handoff write: $(cat "$TEST_TMP/write.err")"; finalize_test; }
IMPORT_ID="$(H "$IMPORT_REPO" list --kind handoff-note --columns title | field 'd.data.records[0].id')"
WRITE_ID="$(field 'd.id' < "$TEST_TMP/write.json")"
H "$IMPORT_REPO" show "$IMPORT_ID" > "$TEST_TMP/import-show.json" || { fail 'show imported record'; finalize_test; }
H "$WRITE_REPO" show "$WRITE_ID" > "$TEST_TMP/write-show.json" || { fail 'show written record'; finalize_test; }

parity() {
  node - "$1" <<'NODE'
const r = require(process.argv[2]).data.record;
const {kind, title, body, status, area} = r;
console.log(JSON.stringify({kind, title, body, status, area, tags: r.tags.filter(t => !t.startsWith('origin:') && !t.startsWith('key:')).sort()}));
NODE
}
tags_with_prefix() {
  node - "$1" "$2" <<'NODE'
const r = require(process.argv[2]).data.record;
console.log(JSON.stringify(r.tags.filter(t => t.startsWith(process.argv[3])).sort()));
NODE
}
assert_eq "$(parity "$TEST_TMP/write-show.json")" "$(parity "$TEST_TMP/import-show.json")" 'handoff parity: kind, title, body, status, area and non-contract tags'
assert_eq "$(tags_with_prefix "$TEST_TMP/write-show.json" origin:)" '["origin:manual"]' 'new handoff has exactly the requested origin tag'
assert_eq "$(tags_with_prefix "$TEST_TMP/write-show.json" key:)" '["key:handoff:0123456789abcdef"]' 'new handoff has exactly the requested key tag'
assert_eq "$(tags_with_prefix "$TEST_TMP/import-show.json" origin:)" '[]' 'import has no origin tags'
assert_eq "$(tags_with_prefix "$TEST_TMP/import-show.json" key:)" '[]' 'import has no key tags'
hs_exit_check
finalize_test
