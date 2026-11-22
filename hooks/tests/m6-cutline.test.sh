#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
R="$(hs_mkrepo cutline)"
mkdir -p "$R/plans" "$R/projects"
printf old > "$R/plans/old.md"
printf old > "$R/projects/old.md"
git -C "$R" add plans projects
GIT_AUTHOR_DATE=2020-01-01T12:00:00Z GIT_COMMITTER_DATE=2020-01-01T12:00:00Z git -C "$R" commit -qm old
printf updated > "$R/plans/old.md"
printf updated > "$R/projects/old.md"
printf new > "$R/plans/new.md"
git -C "$R" add plans projects
GIT_AUTHOR_DATE=2022-01-01T12:00:00Z GIT_COMMITTER_DATE=2022-01-01T12:00:00Z git -C "$R" commit -qm new
REGISTRY="$(git -C "$R" rev-parse --path-format=absolute --git-common-dir)/autopilot/m6-registry.json"
CALLS_FILE="$TEST_TMP/calls"
printf '0' > "$CALLS_FILE"

cutline_node() {
  node - "$REPO_ROOT/scripts/lib/m6-cutline.js" "$R" "$CALLS_FILE" "$@"
}

# 1. Without AUTOPILOT_M6_CUTLINE: CUTLINE is null and guardedStoreWrite writes + registers
unset AUTOPILOT_M6_CUTLINE
assert_eq "$(cutline_node -e 'console.log(JSON.stringify(require(process.argv[2]).CUTLINE))')" "null" "CUTLINE is null when env unset"

RES="$(cutline_node -e '
  const fs = require("fs");
  const m = require(process.argv[2]);
  const [repo, callsFile] = [process.argv[3], process.argv[4]];
  let calls = Number(fs.readFileSync(callsFile, "utf8"));
  const res = m.guardedStoreWrite(repo, "null.md", () => calls++);
  fs.writeFileSync(callsFile, String(calls));
  console.log(JSON.stringify(res));
')"
assert_eq "$RES" '{"skipped":false}' "guardedStoreWrite writes null.md when CUTLINE unset"
assert_eq "$(cat "$CALLS_FILE")" "1" "callback invoked once for null.md"
assert_eq "$(cutline_node -e 'console.log(String(require(process.argv[2]).isRegistered(process.argv[3], "null.md")))')" "true" "null.md is registered"

# 2. With AUTOPILOT_M6_CUTLINE=2021-01-01: pre-cutline files are skipped, post-cutline files are written
export AUTOPILOT_M6_CUTLINE="2021-01-01"
BEFORE_REG="$(cat "$REGISTRY")"

for p in plans/old.md projects/old.md; do
  assert_eq "$(cutline_node -e 'console.log(String(require(process.argv[2]).isBeforeCutline(process.argv[3], process.argv[5])))' "$p")" "true" "isBeforeCutline true for $p"
  RES="$(cutline_node -e '
    const fs = require("fs");
    const m = require(process.argv[2]);
    const [repo, callsFile, p] = [process.argv[3], process.argv[4], process.argv[5]];
    let calls = Number(fs.readFileSync(callsFile, "utf8"));
    const res = m.guardedStoreWrite(repo, p, () => calls++);
    fs.writeFileSync(callsFile, String(calls));
    console.log(JSON.stringify(res));
  ' "$p")"
  assert_eq "$RES" '{"skipped":true}' "guardedStoreWrite skips pre-cutline $p"
  assert_eq "$(cat "$CALLS_FILE")" "1" "callback not invoked for pre-cutline $p"
  REG_RES="$(cutline_node -e 'console.log(String(require(process.argv[2]).register(process.argv[3], process.argv[5])))' "$p")"
  assert_eq "$REG_RES" "false" "register returns false for pre-cutline $p"
  assert_eq "$(cat "$REGISTRY")" "$BEFORE_REG" "registry unchanged after $p"
done

RES_NEW="$(cutline_node -e '
  const fs = require("fs");
  const m = require(process.argv[2]);
  const [repo, callsFile] = [process.argv[3], process.argv[4]];
  let calls = Number(fs.readFileSync(callsFile, "utf8"));
  const res = m.guardedStoreWrite(repo, "plans/new.md", () => calls++);
  fs.writeFileSync(callsFile, String(calls));
  console.log(JSON.stringify(res));
')"
assert_eq "$RES_NEW" '{"skipped":false}' "guardedStoreWrite writes post-cutline plans/new.md"
assert_eq "$(cat "$CALLS_FILE")" "2" "callback invoked for plans/new.md"
assert_eq "$(cutline_node -e 'console.log(String(require(process.argv[2]).isRegistered(process.argv[3], "plans/new.md")))')" "true" "plans/new.md is registered"

AFTER_REG="$(cat "$REGISTRY")"
THROW_ERR="$(cutline_node -e '
  const m = require(process.argv[2]);
  try {
    m.guardedStoreWrite(process.argv[3], "throw.md", () => { throw Error("write failed"); });
    console.log("no-throw");
  } catch (e) {
    console.log(e.message);
  }
')"
assert_eq "$THROW_ERR" "write failed" "guardedStoreWrite propagates callback error"
assert_eq "$(cat "$REGISTRY")" "$AFTER_REG" "registry unchanged after thrown write"
assert_eq "$(cutline_node -e 'console.log(JSON.stringify(require(process.argv[2]).list(process.argv[3])))')" '["null.md","plans/new.md"]' "list returns only registered post-cutline entries"

finalize_test
