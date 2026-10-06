#!/usr/bin/env bash
# session-mode-phase.test.sh — stage-graph P2b (plan §0.7): `session-mode.js` has NO `--phase`, `phase` or `phase_set_at`.
# Contracts under test: every `--phase` form (on `set` with or without --level / init flags, with '' too) exits 2 with a
# usage message naming the replacement (`stage-advance.js --to <node>`) and leaves the marker untouched / uncreated;
# no write path (l3-l6, plain, init) emits `phase` / `phase_set_at`, and `status` prints neither; the §2.9 marker fields
# still land (init); a marker WITHOUT a `level` key stays invalid for dispatch-hetero.sh check_session_mode_gate;
# the real ~/.autopilot stores are untouched.
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

has_key() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(Object.prototype.hasOwnProperty.call(m,process.argv[2])?"yes":"no")' "$MARKER" "$1"; }

# 1. every --phase form is a usage error naming the replacement, with no marker created
for form in "set --phase review" "set --phase ''" "set --level l3 --phase review" "set --level none --phase x" "set --size S --phase x"; do
  rm -f "$MARKER"
  # shellcheck disable=SC2086
  eval "node \"$CLI\" $form --repo-root \"$REPO\"" >"$TEST_TMP/out" 2>"$TEST_TMP/err"; RC=$?
  assert_exit_code "$RC" "2" "'$form' exits 2"
  assert_contains "$(cat "$TEST_TMP/err")" "stage-advance.js --to <node>" "'$form' names the replacement"
  [ -e "$MARKER" ] && assert_eq "absent" "created" "'$form' creates no marker" || assert_eq ok ok "'$form' creates no marker"
done

# 2. --phase against a live marker leaves its bytes untouched
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1
cp "$MARKER" "$TEST_TMP/before.json"
node "$CLI" set --phase review >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "set --phase on a live marker exits 2"
cmp -s "$MARKER" "$TEST_TMP/before.json" && assert_eq ok ok "live marker byte-identical after a rejected --phase" || assert_eq same changed "live marker byte-identical after a rejected --phase"

# 3. no write path emits phase / phase_set_at
node "$CLI" set --level l3 --repo-root "$REPO" >/dev/null 2>&1
assert_eq "no" "$(has_key phase)" "l3 marker has no phase"
assert_eq "no" "$(has_key phase_set_at)" "l3 marker has no phase_set_at"
STATUS="$(node "$CLI" status)"
case "$STATUS" in *'"phase"'*|*phase_set_at*) assert_eq "no phase" "$STATUS" "status prints neither phase nor phase_set_at";; *) assert_eq ok ok "status prints neither phase nor phase_set_at";; esac
rm -f "$MARKER"
node "$CLI" set --level none --repo-root "$REPO" >/dev/null 2>&1
assert_eq "no" "$(has_key phase)" "plain marker has no phase"
rm -f "$MARKER"
OUT="$(node "$CLI" set --size M --urgent --repo-root "$REPO" 2>/dev/null)"
assert_eq "no" "$(has_key phase)" "init marker has no phase"
assert_eq "yes" "$(has_key size)" "init marker carries the §2.9 size field"
assert_eq "yes" "$(has_key urgent)" "init marker carries the §2.9 urgent field"
case "$OUT" in *'"phase"'*|*phase_set_at*) assert_eq "no phase" "$OUT" "init stdout prints no phase";; *) assert_eq ok ok "init stdout prints no phase";; esac

# 4. the usage text no longer advertises --phase on set
USAGE="$(node "$CLI" bogus-cmd 2>&1)"
case "$USAGE" in *"set --phase"*|*"[--phase"*) assert_eq "no --phase" "$USAGE" "usage text does not advertise --phase";; *) assert_eq ok ok "usage text does not advertise --phase";; esac

# 5. a marker with NO level key is still an invalid marker for dispatch (only an explicit null is a plain session)
LL="$TEST_TMP/levelless"; mkdir -p "$LL"
node -e 'const now=Date.now();require("fs").writeFileSync(process.argv[1],JSON.stringify({session_id:"ll",repo_root:process.argv[2],started_at:new Date(now).toISOString(),expires_at:new Date(now+36e5).toISOString(),size:"S"}))' "$LL/ll.json" "$REPO"
echo "p" > "$TEST_TMP/prompt.txt"
OUT="$(cd "$REPO" && AUTOPILOT_SESSION_MODE_DIR="$LL" "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch feat/levelless --prompt-file "$TEST_TMP/prompt.txt" --agy-bin /bin/true 2>&1)"; RC=$?
assert_exit_code "$RC" "2" "a marker with no level key still makes dispatch-hetero fail closed"
assert_contains "$OUT" "authoritative session-mode marker is invalid" "dispatch-hetero names the level-less marker as invalid"

# 6. negative control: the real stores were never touched
assert_eq "$REAL_BEFORE" "$(HOME="$REAL_HOME" real_snapshot)" "real ~/.autopilot markers, live pointer and repo ledger untouched"

finalize_test
