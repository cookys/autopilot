#!/usr/bin/env bash
# session-mode-phase.test.sh — `session-mode.js set --phase` (mods P1W PHASE, plan §4 W2b-m write side).
# Marker gains `phase` (1-64 chars, trimmed, no control chars) + `phase_set_at` (ISO-8601).
# Contracts under test: update-in-place leaves every other field byte-identical; `--phase ''` clears
# both fields; invalid names exit 2 with the marker untouched; an expired/absent marker is never
# resurrected or created level-less (dispatch-hetero.sh check_session_mode_gate classifies a marker
# without a valid `level` as "marker is invalid" and refuses EVERY dispatch in the repo — pinned below);
# concurrent writers serialise on <marker>.lock; the real ~/.autopilot stores are untouched.
# RED (before implementation, 2026-10-05): 36 passed / 21 failed (the 36 are negative and untouched-marker checks that hold vacuously while `--phase` is ignored).
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/scripts/session-mode.js"
REAL_HOME="$HOME"
real_snapshot() {
  { find "$REAL_HOME/.autopilot/session-mode" -type f -printf '%p %s %T@\n' 2>/dev/null
    stat -c '%n %s %Y' "$REAL_HOME/.autopilot/live-pointer.json" 2>/dev/null
    stat -c '%n %s %Y' "$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)/autopilot/ledger/decisions.jsonl" 2>/dev/null
  } | sort | sha256sum
}
REAL_BEFORE="$(real_snapshot)"

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export AUTOPILOT_SESSION_ID="phase-test-aaa"
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID
MARKER="$AUTOPILOT_SESSION_MODE_DIR/phase-test-aaa.json"

REPO="$TEST_TMP/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q -b develop
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

jget() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=m[process.argv[2]];process.stdout.write(v===undefined?"<absent>":String(v))' "$MARKER" "$1"; }
# marker JSON without the two phase fields (key order preserved) — equality of this proves "other fields unchanged".
rest() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));delete m.phase;delete m.phase_set_at;process.stdout.write(JSON.stringify(m))' "$MARKER"; }

# 1. set --level … --phase sets both fields
node "$CLI" set --level l3 --phase "實作 W1" --repo-root "$REPO" >/dev/null 2>&1
assert_exit_code "$?" "0" "set --level l3 --phase exits 0"
assert_eq "實作 W1" "$(jget phase)" "set --phase stores the name"
ISO='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
[[ "$(jget phase_set_at)" =~ $ISO ]] && assert_eq ok ok "phase_set_at is ISO-8601" || assert_eq "iso" "$(jget phase_set_at)" "phase_set_at is ISO-8601"
assert_contains "$(node "$CLI" status)" '"phase": "實作 W1"' "status prints the phase"

# 2. set --level without --phase carries no phase (set overwrites, as today)
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1
assert_eq "<absent>" "$(jget phase)" "set without --phase writes no phase"
assert_eq "<absent>" "$(jget phase_set_at)" "set without --phase writes no phase_set_at"
node "$CLI" set --level l3 --phase '' --repo-root "$REPO" >/dev/null 2>&1
assert_eq "<absent>" "$(jget phase)" "set --level --phase '' writes no phase"

# 3. update in place: only phase/phase_set_at change; trimmed
node "$CLI" set --level l3 --phase first --repo-root "$REPO" >/dev/null 2>&1
REST0="$(rest)"; AT0="$(jget phase_set_at)"
sleep 0.05
node "$CLI" set --phase "  review  " >/dev/null 2>"$TEST_TMP/err"
assert_exit_code "$?" "0" "set --phase (no --level) updates an active marker"
assert_eq "review" "$(jget phase)" "update-in-place stores the trimmed phase"
assert_eq "$REST0" "$(rest)" "update-in-place leaves every other field identical"
assert_neq "$AT0" "$(jget phase_set_at)" "update-in-place refreshes phase_set_at"
assert_eq "l3" "$(jget level)" "update-in-place keeps the level"
ls "$AUTOPILOT_SESSION_MODE_DIR" | grep -q 'tmp\|pending\|stale' && assert_eq "none" "leftovers" "no tmp/lock leftovers after update" || assert_eq ok ok "no tmp/lock leftovers after update"

# 4. clear with --phase '' removes both fields, nothing else
node "$CLI" set --phase '' >/dev/null 2>&1
assert_exit_code "$?" "0" "set --phase '' clears"
assert_eq "<absent>" "$(jget phase)" "clear removes phase"
assert_eq "<absent>" "$(jget phase_set_at)" "clear removes phase_set_at"
assert_eq "$REST0" "$(rest)" "clear leaves every other field identical"

# 5. invalid names: exit 2, marker bytes untouched
node "$CLI" set --phase keep >/dev/null 2>&1
cp "$MARKER" "$TEST_TMP/before.json"
LONG="$(printf 'x%.0s' $(seq 1 65))"
for case_name in "too-long:$LONG" "newline:$(printf 'a\nb')" "tab:$(printf 'a\tb')" "del:$(printf 'a\177b')" "spaces-only:   "; do
  label="${case_name%%:*}"; val="${case_name#*:}"
  node "$CLI" set --phase "$val" >/dev/null 2>"$TEST_TMP/err"; RC=$?
  assert_exit_code "$RC" "2" "invalid phase ($label) exits 2"
  assert_contains "$(cat "$TEST_TMP/err")" "phase" "invalid phase ($label) names the problem"
  cmp -s "$MARKER" "$TEST_TMP/before.json" && assert_eq ok ok "invalid phase ($label) leaves marker bytes untouched" || assert_eq same changed "invalid phase ($label) leaves marker bytes untouched"
done
node "$CLI" set --phase >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "--phase without a value exits 2"
node "$CLI" set --level l3 --phase "$LONG" --repo-root "$REPO" >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "set --level with an invalid phase exits 2"
cmp -s "$MARKER" "$TEST_TMP/before.json" && assert_eq ok ok "set --level with invalid phase leaves marker untouched" || assert_eq same changed "set --level with invalid phase leaves marker untouched"
node "$CLI" set --phase "$(printf 'x%.0s' $(seq 1 64))" >/dev/null 2>&1
assert_exit_code "$?" "0" "64-char phase is accepted"

# 6. no active marker: never created level-less (STOP finding), exit 2, nothing written
rm -f "$MARKER"
node "$CLI" set --phase orphan >/dev/null 2>"$TEST_TMP/err"; RC=$?
assert_exit_code "$RC" "2" "set --phase with no marker exits 2"
assert_contains "$(cat "$TEST_TMP/err")" "level" "no-marker refusal says --level is needed"
assert_file_absent "$MARKER" "no level-less marker is created"
# expired marker: not resurrected, bytes untouched
node "$CLI" set --level l5 --ttl-hours 0 --repo-root "$REPO" >/dev/null 2>&1
sleep 1
cp "$MARKER" "$TEST_TMP/expired.json"
node "$CLI" set --phase late >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "set --phase on an expired marker exits 2"
cmp -s "$MARKER" "$TEST_TMP/expired.json" && assert_eq ok ok "expired marker bytes untouched" || assert_eq same changed "expired marker bytes untouched"
# corrupt marker likewise
printf 'not-json' > "$MARKER"
node "$CLI" set --phase late >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "set --phase on a corrupt marker exits 2"
assert_eq "not-json" "$(cat "$MARKER")" "corrupt marker bytes untouched"
# another session's marker is not touched
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1
cp "$MARKER" "$TEST_TMP/a.json"
AUTOPILOT_SESSION_ID=phase-test-bbb node "$CLI" set --phase other >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "another session without a marker exits 2"
cmp -s "$MARKER" "$TEST_TMP/a.json" && assert_eq ok ok "other session's marker untouched" || assert_eq same changed "other session's marker untouched"

# 7. concurrency: 8 parallel writers all succeed, marker stays valid, other fields identical, no leftovers
REST1="$(rest)"
PIDS=()
for i in 1 2 3 4 5 6 7 8; do node "$CLI" set --phase "p$i" >/dev/null 2>&1 & PIDS+=($!); done
FAILN=0; for p in "${PIDS[@]}"; do wait "$p" || FAILN=$((FAILN+1)); done
assert_eq "0" "$FAILN" "8 concurrent set --phase all exit 0"
[[ "$(jget phase)" =~ ^p[1-8]$ ]] && assert_eq ok ok "concurrent writers leave one of the written phases" || assert_eq "p1..p8" "$(jget phase)" "concurrent writers leave one of the written phases"
assert_eq "$REST1" "$(rest)" "concurrent writers leave every other field identical"
LEFT="$(ls -A "$AUTOPILOT_SESSION_MODE_DIR" | grep -vc '^phase-test-aaa.json$\|^phase-test-bbb' || true)"
assert_eq "0" "$LEFT" "no tmp/pending/lock files left after concurrent writers"

# 7b. lock: a live holder blocks the writer (timeout, marker untouched); a dead holder is stolen
cp "$MARKER" "$TEST_TMP/lock-before.json"
sleep 30 & HOLDER=$!
printf '%s' "$HOLDER" > "$MARKER.lock"
AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS=400 node "$CLI" set --phase blocked >/dev/null 2>"$TEST_TMP/err"; RC=$?
assert_exit_code "$RC" "1" "live lock holder -> writer times out (exit 1)"
assert_contains "$(cat "$TEST_TMP/err")" "lock" "timeout message names the lock"
cmp -s "$MARKER" "$TEST_TMP/lock-before.json" && assert_eq ok ok "timed-out writer leaves marker untouched" || assert_eq same changed "timed-out writer leaves marker untouched"
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
node "$CLI" set --phase afterdead >/dev/null 2>&1
assert_exit_code "$?" "0" "dead lock holder is stolen"
assert_eq "afterdead" "$(jget phase)" "write lands after stealing a dead holder's lock"

# 8. level-less marker would break dispatch: pin WHY set --phase refuses to create one
LL="$TEST_TMP/levelless"; mkdir -p "$LL"
node -e 'const now=Date.now();require("fs").writeFileSync(process.argv[1],JSON.stringify({session_id:"ll",repo_root:process.argv[2],started_at:new Date(now).toISOString(),expires_at:new Date(now+36e5).toISOString(),phase:"x"}))' "$LL/ll.json" "$REPO"
echo "p" > "$TEST_TMP/prompt.txt"
OUT="$(cd "$REPO" && AUTOPILOT_SESSION_MODE_DIR="$LL" "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch feat/levelless --prompt-file "$TEST_TMP/prompt.txt" --agy-bin /bin/true 2>&1)"; RC=$?
assert_exit_code "$RC" "2" "a level-less marker makes dispatch-hetero fail closed (why PHASE refuses to create one)"
assert_contains "$OUT" "authoritative session-mode marker is invalid" "dispatch-hetero names the level-less marker as invalid"

# 9. negative control: the real stores were never touched
assert_eq "$REAL_BEFORE" "$(HOME="$REAL_HOME" real_snapshot)" "real ~/.autopilot markers, live pointer and repo ledger untouched"

finalize_test
