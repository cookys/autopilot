#!/usr/bin/env bash
# Red-case coverage for scripts/next-pick.js (autonomous-brain P5, KR6/R6).
# Proves: deterministic replay from the materialized record, ask-first rows are
# never auto-picked, user preference outranks system signals among eligible
# candidates, and BACKLOG parsing extracts machine-readable fields.
# REPAIR-2 addition (plain session root) RED at b8d83789: 53 passed, 2 failed (plain marker: no pick row).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/next-pick.js"

cat > "$TEST_TMP/candidates.json" <<'JSON'
[
 {"title":"Old small system-favored fix","effort":"S","tags":[],"class":"standard-impl","age_days":40,"source":"s1"},
 {"title":"User-preferred mechanical unit","effort":"M","tags":[],"class":"mechanical-impl","age_days":2,"source":"s2"},
 {"title":"Big refactor","effort":"L","tags":[],"class":"standard-impl","age_days":90,"source":"s3"},
 {"title":"Board-tagged thing","effort":"S","tags":["board"],"class":"standard-impl","age_days":90,"source":"s4"},
 {"title":"Deep perf mystery","effort":"M","tags":[],"class":"hard-problem","age_days":10,"source":"s5"}
]
JSON
cat > "$TEST_TMP/prefs.json" <<'JSON'
{"class_weights":{"mechanical-impl":10,"standard-impl":5,"hard-problem":8}}
JSON

# ── KR6: user preference outranks system signals (older+smaller loses to weight) ──
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json")"
assert_exit_code "$?" "0" "pick succeeds"
PICKED="$(printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).pick.title))")"
assert_eq "User-preferred mechanical unit" "$PICKED" "preference weight beats staleness+effort"

# ── ask-first rows never picked, each with a machine-readable reason ──
assert_contains "$OUT" '"Big refactor"' "L row is queued ask-first"
assert_contains "$OUT" '"effort L"' "L reason named"
assert_contains "$OUT" '"Board-tagged thing"' "board row queued ask-first"
assert_contains "$OUT" '"board tag"' "board reason named"
assert_contains "$OUT" '"Deep perf mystery"' "hard-problem row queued ask-first"
assert_contains "$OUT" "pinned to depth-0" "hard-problem reason named"

# ── deterministic replay: same materialized inputs → byte-identical result ──
OUT2="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json")"
assert_eq "$OUT" "$OUT2" "replay from the same record is byte-identical"

# ── ledger append carries the pick-record (replay never reads live state) ──
L="$TEST_TMP/ledger.jsonl"
node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" --ledger "$L" --decision-id d-pick-1 --round 2 >/dev/null
assert_exit_code "$?" "0" "pick with ledger append succeeds"
ROW="$(node "$REPO_ROOT/scripts/decision-ledger.js" query --ledger "$L" --kind pick --json)"
assert_contains "$ROW" "d-pick-1" "pick row landed in the ledger"
assert_contains "$ROW" "candidates_digest" "pick-record materialized in the ledger"

# ── zero eligible candidates → pick null, exit 0 (empty queue is not an error) ──
printf '[{"title":"Only big things","effort":"XL","tags":[],"class":"standard-impl","age_days":1,"source":"s"}]\n' > "$TEST_TMP/only-big.json"
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/only-big.json" --preferences "$TEST_TMP/prefs.json")"
assert_exit_code "$?" "0" "empty eligible set is not an error"
assert_contains "$OUT" '"pick": null' "pick is null"

# -- P6: size+urgency gate and XS > S > M tie-break --
printf '%s\n' '[{"title":"Urgent small","effort":"S!","tags":[],"class":"standard-impl","age_days":1,"source":"s"},{"title":"Urgent flag","effort":"S","urgent":true,"tags":[],"class":"standard-impl","age_days":1,"source":"s"},{"title":"Retired H","effort":"H","tags":[],"class":"standard-impl","age_days":1,"source":"s"}]' > "$TEST_TMP/urgent.json"
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/urgent.json" --preferences "$TEST_TMP/prefs.json")"
assert_contains "$OUT" "urgent (!)" "urgent suffix routes to ask-first"
assert_contains "$OUT" '"pick": null' "nothing auto-eligible when all urgent or unknown"
printf '%s\n' '[{"title":"B-m","effort":"M","tags":[],"class":"standard-impl","age_days":5,"source":"s"},{"title":"C-s","effort":"S","tags":[],"class":"standard-impl","age_days":5,"source":"s"},{"title":"D-xs","effort":"XS","tags":[],"class":"standard-impl","age_days":5,"source":"s"}]' > "$TEST_TMP/tie.json"
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/tie.json" --preferences "$TEST_TMP/prefs.json")"
assert_contains "$OUT" '"title": "D-xs"' "tie-break prefers XS over S over M"
printf '%s\n' '[{"title":"B-m","effort":"M","tags":[],"class":"standard-impl","age_days":5,"source":"s"},{"title":"C-s","effort":"S","tags":[],"class":"standard-impl","age_days":5,"source":"s"}]' > "$TEST_TMP/tie2.json"
OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/tie2.json" --preferences "$TEST_TMP/prefs.json")"
assert_contains "$OUT" '"title": "C-s"' "tie-break prefers S over M"
cat > "$TEST_TMP/sizes-bl.md" <<'EOB'
### Row xs
- **Effort**: XS
- **Source**: s

### Row urgent
- **Effort**: M急
- **Source**: s

### Row xl
- **Effort**: XL!
- **Source**: s

### Row s bang
- **Effort**: S!
- **Source**: s
EOB
P="$(node "$SCRIPT" parse --backlog "$TEST_TMP/sizes-bl.md")"
assert_contains "$P" '"effort": "XS"' "parse reads XS (not S)"
assert_contains "$P" '"effort": "XL"' "parse reads XL (not L)"
assert_eq "$(printf '%s' "$P" | grep -c '"urgent": true')" "3" "parse flags urgent for M急, XL!, S!"

# ── parse: BACKLOG fixture → machine fields ──
cat > "$TEST_TMP/backlog.md" <<'EOF'
## Active entries

### Small cleanup thing
- **Trigger**: whenever.
- **Context**: c.
- **Effort**: S.
- **Source**: here.

### Giant migration
- **Trigger**: someday.
- **Context**: c.
- **Effort**: L (research-to-ship 全程)
- **Source**: there.

### Needs the Board
- **Trigger**: t.
- **Context**: c.
- **Effort**: Board decision (then S per slice)。
- **Source**: board thread.
EOF
P="$(node "$SCRIPT" parse --backlog "$TEST_TMP/backlog.md")"
assert_contains "$P" '"Small cleanup thing"' "row parsed"
assert_contains "$P" '"effort": "S"' "S token extracted"
assert_contains "$P" '"effort": "L"' "L token extracted"
assert_contains "$P" '"board"' "board tag detected from Effort text"

# ── Brain-seat gating on the auto-pick path (P7/KR4, brain-seat-exam-suite P4) ──
cat > "$TEST_TMP/brain-status-norec.json" <<'JSON'
{"schema_version":1,"artifact_type":"brain_seat_status","status":"no_record","strikes_since_pass":0}
JSON
cat > "$TEST_TMP/brain-status-requal.json" <<'JSON'
{"schema_version":1,"artifact_type":"brain_seat_status","status":"requalification_required","strikes_since_pass":3}
JSON
cat > "$TEST_TMP/brain-status-ok.json" <<'JSON'
{"schema_version":1,"artifact_type":"brain_seat_status","status":"qualified","strikes_since_pass":0}
JSON
cat > "$TEST_TMP/brain-override.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"any","runner":"any","role":"owner","reason":"test","expires":"2999-01-01"}]}
JSON

# candidate + no standing → refusal naming both legal paths, exit 1
BS_OUT="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-norec.json" --seat-class candidate 2>/dev/null)"; BS_RC=$?
assert_eq "1" "$BS_RC" "candidate seat without standing refuses the auto-pick"
assert_contains "$BS_OUT" "brain_seat_refused" "refusal artifact is machine-readable"
assert_contains "$BS_OUT" "engine-qualify.sh brain" "refusal names the standing-exam path"
assert_contains "$BS_OUT" "qualification-override" "refusal names the override path"

# requalification_required behaves exactly like absence for a candidate
node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-requal.json" --seat-class candidate >/dev/null 2>&1
assert_eq "1" "$?" "requalification_required refuses a candidate (no silent third path)"

# the override still admits (two-path rule), loudly — and binds to the EXACT engine
BS_OVR_ERR="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-requal.json" --seat-class candidate --seat-engine any \
  --qualification-override "$TEST_TMP/brain-override.json" 2>&1 >/dev/null)"; BS_OVR_RC=$?
assert_eq "0" "$BS_OVR_RC" "override admits a candidate with no standing"
assert_contains "$BS_OVR_ERR" "EVIDENCE-FREE" "override admission is loudly labelled"
# an override written for one engine never admits another (identity binding)
node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-requal.json" --seat-class candidate --seat-engine other-engine \
  --qualification-override "$TEST_TMP/brain-override.json" >/dev/null 2>&1
assert_eq "1" "$?" "an override for a different engine never admits (cross-path parity)"
# override without the binding flag is a usage error, not a silent skip
node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-requal.json" --seat-class candidate \
  --qualification-override "$TEST_TMP/brain-override.json" >/dev/null 2>&1
assert_eq "2" "$?" "--qualification-override requires --seat-engine"

# incumbent + no standing → advisory annotation, pick proceeds
BS_INC="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-norec.json" --seat-class incumbent 2>/dev/null)"; BS_INC_RC=$?
assert_eq "0" "$BS_INC_RC" "incumbent seat proceeds (Board 2026-08-16 advisory semantics)"
assert_contains "$BS_INC" '"admission": "advisory"' "incumbent admission is recorded as advisory"

# qualified standing → admitted, no annotation
BS_OK="$(node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" \
  --brain-status "$TEST_TMP/brain-status-ok.json" --seat-class incumbent 2>/dev/null)"
assert_contains "$BS_OK" '"admission": "admitted"' "standing pass admits cleanly"

# ── implicit default-ledger append (mods P1W PICK, plan R5.5 W2g (a)) ──
# With no --ledger, a pick is ledgered through decision-ledger.js's default per-repo ledger ONLY when an
# active session-mode marker of this session or AUTOPILOT_ROOT_RUN_ID exists; plain /next writes nothing.
# RED (before implementation, 2026-10-05): 9 assertions failed (marker / env picks never reached the default ledger).
IMP_REAL_HOME="$HOME"
IMP_REAL_COMMON="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
imp_real_snapshot() {
  { find "$IMP_REAL_HOME/.autopilot/session-mode" -type f -printf '%p %s %T@\n' 2>/dev/null
    stat -c '%n %s %Y' "$IMP_REAL_COMMON/autopilot/ledger/decisions.jsonl" 2>/dev/null
  } | sort | sha256sum
}
IMP_REAL_BEFORE="$(imp_real_snapshot)"
IMP_REPO="$TEST_TMP/imp-repo"; mkdir -p "$IMP_REPO"
git -C "$IMP_REPO" init -q -b develop
git -C "$IMP_REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
IMP_LEDGER="$IMP_REPO/.git/autopilot/ledger/decisions.jsonl"
IMP_MARKERS="$TEST_TMP/imp-markers"; mkdir -p "$IMP_MARKERS"
imp_pick() { # extra env via caller; cwd = imp repo
  ( cd "$IMP_REPO" && env -u AUTOPILOT_ROOT_RUN_ID -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      HOME="$TEST_TMP/imp-home" AUTOPILOT_SESSION_MODE_DIR="$IMP_MARKERS" "$@" \
      node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" ); }
imp_rows() { [ -f "$IMP_LEDGER" ] && grep -c '"kind":"pick"' "$IMP_LEDGER" || echo 0; }
write_marker() { # sid expires_offset_ms
  node -e 'const now=Date.now();require("fs").writeFileSync(process.argv[1],JSON.stringify({session_id:process.argv[2],level:"l3",repo_root:process.argv[3],started_at:new Date(now-1000).toISOString(),expires_at:new Date(now+Number(process.argv[4])).toISOString(),root_run_id:"job-marker-1"}))' "$IMP_MARKERS/$1.json" "$1" "$IMP_REPO" "$2"; }

# plain /next: no marker, no env -> nothing written
imp_pick >/dev/null 2>&1; assert_exit_code "$?" "0" "no marker/env: pick exits 0"
assert_file_absent "$IMP_LEDGER" "no marker/env: nothing is written to the default ledger"
# expired marker, no env -> nothing written
write_marker sess-expired -1000
imp_pick AUTOPILOT_SESSION_ID=sess-expired >/dev/null 2>&1
assert_file_absent "$IMP_LEDGER" "expired marker: nothing is written"
# another session's marker does not count
write_marker sess-live 3600000
imp_pick AUTOPILOT_SESSION_ID=sess-other >/dev/null 2>&1
assert_file_absent "$IMP_LEDGER" "marker of another session: nothing is written"
# active marker for this session -> one pick row, root/repo stamped, dedupe on replay
IMP_OUT="$(imp_pick AUTOPILOT_SESSION_ID=sess-live 2>"$TEST_TMP/imp-err")"; assert_eq "0" "$?" "marker: pick exits 0"
assert_eq "1" "$(imp_rows)" "marker: one kind:pick row lands in the default ledger"
IMP_ROW="$(grep '"kind":"pick"' "$IMP_LEDGER" | head -1)"
assert_contains "$IMP_ROW" '"root_run_id":"job-marker-1"' "marker: row carries the marker's root_run_id"
assert_contains "$IMP_ROW" "\"repo_identity\":\"git-common-dir:" "marker: row carries repo_identity"
assert_contains "$IMP_ROW" '"decision_id":"pick-' "marker: row has a deterministic pick- decision_id"
assert_contains "$IMP_ROW" '"candidates_digest"' "marker: row carries the materialized pick record"
assert_contains "$IMP_OUT" '"pick"' "marker: stdout result unchanged"
imp_pick AUTOPILOT_SESSION_ID=sess-live >/dev/null 2>&1
assert_eq "1" "$(imp_rows)" "marker: replaying the same pick is deduped (still one row)"
# REPAIR-2 (next-pick-plain-root): a plain session (level null, minted root) records its picks too
rm -f "$IMP_LEDGER"
node -e 'const now=Date.now();require("fs").writeFileSync(process.argv[1],JSON.stringify({session_id:"sess-plain",level:null,repo_root:process.argv[2],started_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600000).toISOString(),root_run_id:"plain-root-9"}))' "$IMP_MARKERS/sess-plain.json" "$IMP_REPO"
imp_pick AUTOPILOT_SESSION_ID=sess-plain >/dev/null 2>&1
assert_eq "1" "$(imp_rows)" "plain marker: one pick row lands in the default ledger"
assert_contains "$(cat "$IMP_LEDGER")" '"root_run_id":"plain-root-9"' "plain marker: row carries the plain session's root"
rm -f "$IMP_LEDGER" "$IMP_MARKERS/sess-plain.json"
imp_pick AUTOPILOT_SESSION_ID=sess-plain >/dev/null 2>&1
assert_file_absent "$IMP_LEDGER" "plain session id with no marker: nothing is written"
# AUTOPILOT_ROOT_RUN_ID alone (no marker)
rm -f "$IMP_LEDGER"
imp_pick AUTOPILOT_ROOT_RUN_ID=root-env-7 >/dev/null 2>&1
assert_eq "1" "$(imp_rows)" "env root: one pick row lands in the default ledger"
assert_contains "$(cat "$IMP_LEDGER")" '"root_run_id":"root-env-7"' "env root: row carries AUTOPILOT_ROOT_RUN_ID"
# explicit --ledger wins and the default ledger stays untouched
rm -f "$IMP_LEDGER"
( cd "$IMP_REPO" && AUTOPILOT_ROOT_RUN_ID=root-env-7 HOME="$TEST_TMP/imp-home" AUTOPILOT_SESSION_MODE_DIR="$IMP_MARKERS" \
  node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" --ledger "$TEST_TMP/explicit.jsonl" >/dev/null 2>&1 )
assert_file_exists "$TEST_TMP/explicit.jsonl" "explicit --ledger still receives the row"
assert_file_absent "$IMP_LEDGER" "explicit --ledger: the default ledger is not also written"
# no eligible candidate -> nothing written even with a marker
imp_pick_none() { ( cd "$IMP_REPO" && AUTOPILOT_ROOT_RUN_ID=root-env-7 HOME="$TEST_TMP/imp-home" AUTOPILOT_SESSION_MODE_DIR="$IMP_MARKERS" \
  node "$SCRIPT" pick --candidates "$TEST_TMP/only-big.json" --preferences "$TEST_TMP/prefs.json" ); }
imp_pick_none >/dev/null 2>&1
assert_file_absent "$IMP_LEDGER" "null pick: nothing is written"
# implicit failure never blocks a pick: outside any git repo there is no default ledger
NOGIT="$TEST_TMP/nogit"; mkdir -p "$NOGIT"
IMP_FAIL_OUT="$(cd "$NOGIT" && AUTOPILOT_ROOT_RUN_ID=root-env-7 HOME="$TEST_TMP/imp-home" AUTOPILOT_SESSION_MODE_DIR="$IMP_MARKERS" \
  node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" 2>"$TEST_TMP/imp-fail-err")"; IMP_FAIL_RC=$?
assert_exit_code "$IMP_FAIL_RC" "0" "implicit append failure: pick still exits 0"
assert_contains "$IMP_FAIL_OUT" '"pick"' "implicit append failure: stdout result still emitted"
assert_contains "$(cat "$TEST_TMP/imp-fail-err")" "next-pick: ledger append failed" "implicit append failure: warns on stderr"
# explicit --ledger failure keeps today's exit 1
( cd "$IMP_REPO" && node "$SCRIPT" pick --candidates "$TEST_TMP/candidates.json" --preferences "$TEST_TMP/prefs.json" --ledger "$TEST_TMP/candidates.json/ledger.jsonl" >/dev/null 2>&1 )
assert_exit_code "$?" "1" "explicit --ledger append failure keeps exit 1"
# negative control: the real ledger and real marker dir were never touched
assert_eq "$IMP_REAL_BEFORE" "$(HOME="$IMP_REAL_HOME" imp_real_snapshot)" "real repo ledger and ~/.autopilot/session-mode untouched"

finalize_test
