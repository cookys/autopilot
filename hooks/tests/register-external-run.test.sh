#!/usr/bin/env bash
# Tests for scripts/register-external-run.js (start | end | wrap) and the untruncated `status runs --json`
# pipe output. Everything runs against a temp runs dir / temp HOME / temp session-mode dir; the real
# /tmp/autopilot-dispatch-runs and ~/.autopilot are never touched.
. "$(dirname "$0")/lib.sh"

REG="$REPO_ROOT/scripts/register-external-run.js"
CLI="$REPO_ROOT/bin/autopilot.js"
SB="$TEST_TMP/ext"
mkdir -p "$SB/runs" "$SB/home" "$SB/sm"
LIVE_FIX="$(mktemp -d -p /dev/shm autopilot-test-extrun-XXXXXX)"
chmod 700 "$LIVE_FIX"
trap 'rm -rf "$LIVE_FIX"; kill $SLEEP_PID 2>/dev/null; cleanup_test_tmp' EXIT
export AUTOPILOT_DISPATCH_RUNS_DIR="$SB/runs" HOME="$SB/home" AUTOPILOT_SESSION_MODE_DIR="$SB/sm" AUTOPILOT_LIVE_DIR="$LIVE_FIX"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
# Hygiene: nothing the code under test could write may point at the real runs dir.
case "$AUTOPILOT_DISPATCH_RUNS_DIR" in /tmp/autopilot-dispatch-runs*) fail "runs dir override missing" ;; esac

IDENT="git-common-dir:$(cd "$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)" && pwd -P)"
ROOT="job-1700000000-testroot"
SID="extrun-sess"
NOW_MS=$(node -e 'process.stdout.write(String(Date.now()))')
node -e '
const [dir, sid, ident, root, now] = process.argv.slice(1);
require("fs").writeFileSync(dir + "/" + sid + ".json", JSON.stringify({ session_id: sid, level: null, repo_root: process.cwd(),
  started_at: new Date(+now).toISOString(), expires_at: new Date(+now + 3600e3).toISOString(),
  repo_identity: ident, project_key: "0123456789abcdef", root_run_id: root }));
' "$SB/sm" "$SID" "$IDENT" "$ROOT" "$NOW_MS"

sleep 120 & SLEEP_PID=$!

manifest_field() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=m[process.argv[2]];process.stdout.write(v===null||v===undefined?"null":String(v))' "$1" "$2"; }

# --- 1. start -------------------------------------------------------------------
OUT=$(CLAUDE_CODE_SESSION_ID="$SID" node "$REG" start --role verifier --label "acceptance run" --model codex --pid "$SLEEP_PID" --json 2>"$SB/err")
RC=$?
assert_eq "0" "$RC" "start rc 0"
RUN_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).run_id)' "$OUT")
MF=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).manifest)' "$OUT")
assert_file_exists "$MF" "manifest written"
assert_eq "$SB/runs/$RUN_ID.manifest.json" "$MF" "manifest lives in the overridden runs dir"
assert_contains "$RUN_ID" "external-" "run_id prefix external-"
assert_eq "external" "$(manifest_field "$MF" runner)" "runner external"
assert_eq "$ROOT" "$(manifest_field "$MF" root_run_id)" "root_run_id read from the session marker"
assert_eq "$IDENT" "$(manifest_field "$MF" repo_identity)" "repo_identity matches the JS twin"
assert_eq "$SLEEP_PID" "$(manifest_field "$MF" pid)" "pid recorded"
assert_eq "plain" "$(manifest_field "$MF" log_format)" "log_format plain"
assert_eq "$SID" "$(manifest_field "$MF" session_id)" "session_id recorded"

# --- 2. dispatch-status --list sees it, probe says alive ---------------------------
LIST=$(node "$REPO_ROOT/scripts/dispatch-status.js" --list)
assert_contains "$LIST" "$RUN_ID" "dispatch-status --list lists the run"
PROBE=$(node "$REPO_ROOT/scripts/dispatch-status.js" --run "$RUN_ID" --stall-secs 180)
assert_eq "true" "$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(String(j.alive!==undefined?j.alive:(j.liveness&&j.liveness.alive)))' "$PROBE")" "probe alive true"

# --- 3. status rows: confirmed_live, inside the marker root's group ---------------
COUNTS=$(node "$CLI" status runs --json --root "$ROOT" --project "$IDENT" | node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const rows = Array.isArray(j) ? j : j.runs;
const { computeCounts } = require(process.argv[1] + "/src/status/runs-watch.js");
const c = computeCounts(rows, 5, 10);
process.stdout.write(`${rows.length} ${c.confirmed_live} ${c.exited}`);
' "$REPO_ROOT")
assert_eq "1 1 0" "$COUNTS" "root group holds 1 run, confirmed_live 1"
OTHER=$(node "$CLI" status runs --json --root "some-other-root" --project "$IDENT" | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).runs.length))')
assert_eq "0" "$OTHER" "run is not in another root's group"

# --- 4. end ------------------------------------------------------------------------
node "$REG" end --run-id "$RUN_ID" --rc 0; assert_eq "0" "$?" "end rc 0"
assert_eq "completed" "$(manifest_field "$MF" final_status)" "end rc=0 -> completed"
COUNTS=$(node "$CLI" status runs --json --root "$ROOT" --project "$IDENT" | node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8")); const rows = Array.isArray(j) ? j : j.runs;
const { computeCounts } = require(process.argv[1] + "/src/status/runs-watch.js");
const c = computeCounts(rows, 5, 10);
process.stdout.write(`${c.confirmed_live} ${c.exited}`);
' "$REPO_ROOT")
assert_eq "0 1" "$COUNTS" "after end: no longer live, counted exited"
node "$REG" end --run-id "$RUN_ID" --rc 7 --status stopped; node "$REG" end --run-id nope-nope >/dev/null 2>&1
assert_eq "2" "$?" "end on a missing run_id rc 2"
assert_eq "stopped" "$(manifest_field "$MF" final_status)" "explicit --status wins"
assert_eq "7" "$(manifest_field "$MF" rc)" "rc recorded"

# --- 5. start refusals ---------------------------------------------------------------
BEFORE=$(/bin/ls "$SB/runs" | wc -l)
node "$REG" start --role r --label l >/dev/null 2>&1; assert_eq "2" "$?" "no --pid/--lock -> rc 2"
assert_eq "$BEFORE" "$(/bin/ls "$SB/runs" | wc -l)" "refused start writes no file"
node "$REG" start --label l --pid 1 >/dev/null 2>&1; assert_eq "2" "$?" "missing --role -> rc 2"
# no session -> root empty with an explanation on stderr
OUT=$(node "$REG" start --role r --label l --pid "$SLEEP_PID" 2>"$SB/err")
assert_contains "$(cat "$SB/err")" "root_run_id left empty" "stderr explains the empty root"
assert_eq "null" "$(manifest_field "$SB/runs/$OUT.manifest.json" root_run_id)" "root_run_id null without a session"

# --- 6. wrap -------------------------------------------------------------------------
CLAUDE_CODE_SESSION_ID="$SID" node "$REG" wrap --role verifier --label w3 -- sh -c 'exit 3' 2>/dev/null
assert_eq "3" "$?" "wrap returns the child's rc"
WF=$(grep -l '"label": "w3"' "$SB/runs"/*.manifest.json)
assert_eq "failed" "$(manifest_field "$WF" final_status)" "wrap rc=3 -> failed"
assert_eq "3" "$(manifest_field "$WF" rc)" "wrap manifest rc 3"
assert_neq "null" "$(manifest_field "$WF" pid)" "wrap recorded the child pid"
CLAUDE_CODE_SESSION_ID="$SID" node "$REG" wrap --role verifier --label wok -- true 2>/dev/null
assert_eq "0" "$?" "wrap rc 0"
assert_eq "completed" "$(manifest_field "$(grep -l '"label": "wok"' "$SB/runs"/*.manifest.json)" final_status)" "wrap rc=0 -> completed"
CLAUDE_CODE_SESSION_ID="$SID" node "$REG" wrap --role verifier --label wkill -- sleep 60 2>/dev/null &
WPID=$!
for _ in $(seq 1 50); do grep -qs '"label": "wkill"' "$SB/runs"/*.manifest.json && break; sleep 0.1; done
KF=$(grep -l '"label": "wkill"' "$SB/runs"/*.manifest.json)
kill -TERM "$WPID"; wait "$WPID" 2>/dev/null
assert_eq "killed" "$(manifest_field "$KF" final_status)" "SIGTERM -> killed"
assert_neq "null" "$(manifest_field "$KF" ended_at)" "killed run is ended"

# --- 7. status runs --json is not truncated on a pipe ---------------------------------
BIG="$TEST_TMP/big"; mkdir -p "$BIG"
node -e '
const fs = require("fs");
for (let i = 0; i < 400; i += 1) {
  const id = "external-1700000000-" + i + "-aaaa";
  fs.writeFileSync(process.argv[1] + "/" + id + ".manifest.json", JSON.stringify({ schema: 1, run_id: id, role: "verifier", runner: "external",
    model: null, label: "x".repeat(300), pid: null, lock_path: null, started_at: "2026-01-01T00:00:00Z", started_epoch: 1767225600,
    ended_at: "2026-01-01T00:01:00Z", ended_epoch: 1767225660, final_status: "completed", rc: 0, root_run_id: null, depth: 0,
    repo_identity: process.argv[2], session_id: null }));
}' "$BIG" "$IDENT"
SIZE=$(AUTOPILOT_DISPATCH_RUNS_DIR="$BIG" node "$CLI" status runs --json | wc -c)
[ "$SIZE" -gt 131072 ] && pass_msg=ok || pass_msg=small
assert_eq "ok" "$pass_msg" "big output exceeds 128 KB (got $SIZE)"
PARSED=$(AUTOPILOT_DISPATCH_RUNS_DIR="$BIG" node "$CLI" status runs --json | cat | node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).length))}catch(e){process.stdout.write("PARSE_FAIL")}')
assert_eq "400" "$PARSED" "piped status runs --json parses completely"

finalize_test
