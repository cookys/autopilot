#!/usr/bin/env bash
# dispatch-review.sh records verdict + reviewed head + repo root in its run manifest, so
# scripts/check-unmerged-ship.js can find a single-seat SHIP-AS-IS review without a second store.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
chmod 700 "$AUTOPILOT_DISPATCH_RUNS_DIR"
REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
printf 'x\n' > "$REPO/a.txt"; git -C "$REPO" add -A; git -C "$REPO" commit -qm one
HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
REAL_REPO="$(cd "$REPO" && pwd -P)"

run_review() { # <mode> <run-id>
  (cd "$REPO" && STUB_MODE="$1" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 AUTOPILOT_FLEET_TASK=01HZZZZZZZZZZZZZZZZZZZZZZZ \
    "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" --run-id "$2" 2>&1)
}
field() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=m[process.argv[2]]; process.stdout.write(v===null?"null":String(v))' "$AUTOPILOT_DISPATCH_RUNS_DIR/$1.manifest.json" "$2"; }

OUT="$(run_review ship rv-ship)"; EXIT=$?
assert_eq "0" "$EXIT" "reviewed exit 0"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "result is SHIP-AS-IS"
assert_eq "SHIP-AS-IS" "$(field rv-ship verdict)" "manifest records the verdict"
assert_eq "$HEAD_SHA" "$(field rv-ship head)" "manifest records the repo HEAD at dispatch"
assert_eq "$REAL_REPO" "$(field rv-ship repo_root)" "manifest records the repo root"
assert_eq "01HZZZZZZZZZZZZZZZZZZZZZZZ" "$(field rv-ship fleet_task)" "manifest already records fleet_task"

run_review pass rv-fix >/dev/null
assert_eq "FIX-THEN-SHIP" "$(field rv-fix verdict)" "manifest records FIX-THEN-SHIP too"

(cd "$REPO" && STUB_MODE=ship AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_EMPTY" --run-id rv-none >/dev/null 2>&1)
assert_eq "null" "$(field rv-none verdict)" "no_verdict run records a null verdict"

finalize_test
