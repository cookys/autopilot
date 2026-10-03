#!/usr/bin/env bash
# Tests for `autopilot status runs` new fields, selectors and bounded-rotation enrich
# (mods plan P1a R3, docs/plans/2026-10-03-mods-visible-dispatch.md §4 P1a).
# Fixture manifest dir + .exit files only; liveness probes run the real
# dispatch-status.js against fixture lock files. Nothing reads the real
# ~/.autopilot, ~/.claude, XDG runtime dir or dispatch manifest dir.
. "$(dirname "$0")/lib.sh"

# RED at 532930ed: 44 FAIL, 10 pass (base has none of the new fields or selectors) —
#   field elapsed_s present: expected 'true', got 'false' (same for rc, final_status, project,
#   stall, source, fact_at, observed_at, probe_age_s); rc read from <ledger>.results/<run>.<stage>.exit:
#   expected '7', got ''; --project exit 0: expected '0', got '2'; --root keeps only that root tree:
#   expected 'other-root', got ''; rotation call 1 probes exactly cap rows: expected '4', got '';
#   cursor persisted under the resolved live dir: .../runs-enrich-cursor.json does not exist;
#   rotation call 3: every live run probed within ceil(9/4) calls: expected '9', got ''.
#   (the human-output byte-identity literal passes on base: it was captured from base.)

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
CLI="$REPO_ROOT/bin/autopilot.js"
SB="$TEST_TMP/runsf"
RUNS="$SB/runs"; LEDGER_DIR="$SB/ledger"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"
mkdir -p "$RUNS" "$LEDGER_DIR" "$FAKE_HOME" "$FAKE_CLAUDE" "$FAKE_XDG" "$SB/cap"
# Live dir must be tmpfs for resolveLiveDir to accept the override; /dev/shm is.
LIVE="$(mktemp -d -p /dev/shm autopilot-test-runsf-XXXXXX)"
chmod 700 "$LIVE"
HOLD_PIDS=""
cleanup_runsf() {
  local p
  for p in $HOLD_PIDS; do kill "$p" 2>/dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_runsf; cleanup_test_tmp' EXIT

run_runs() { # args...
  __RUN_STDOUT=$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
    ENGINE_CAPABILITY_DIR="$SB/cap" \
    node "$CLI" status runs "$@" 2>"$SB/err" < /dev/null)
  __RUN_EXIT=$?
  __RUN_STDERR=$(cat "$SB/err")
}
# jget '<js expression over j>' — evaluates against the last stdout JSON.
jget() { printf '%s' "$__RUN_STDOUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=eval(process.argv[1]);process.stdout.write(typeof r==="string"?r:JSON.stringify(r));})' "$1"; }

EPOCH_NOW=$(date +%s)
mk_manifest() { # id started_epoch ended_epoch(or null) ledger(or null) stage(or null) repo_identity(or null) root lock(or null) final(or null)
  local id="$1" se="$2" ee="$3" ledger="$4" stage="$5" ident="$6" root="$7" lock="$8" final="$9"
  local q_ledger="null" q_stage="null" q_ident="null" q_lock="null" q_final="null" ended_at="null" q_root="null"
  [ "$ledger" != null ] && q_ledger="\"$ledger\""
  [ "$stage" != null ] && q_stage="\"$stage\""
  [ "$ident" != null ] && q_ident="\"$ident\""
  [ "$lock" != null ] && q_lock="\"$lock\""
  [ "$final" != null ] && q_final="\"$final\""
  [ "$root" != null ] && q_root="\"$root\""
  [ "$ee" != null ] && ended_at="\"$(date -u -d "@$ee" +%Y-%m-%dT%H:%M:%SZ)\""
  printf '{"schema":1,"run_id":"%s","role":"implementer","runner":"codex","model":"m","started_at":"%s","started_epoch":%s,"ended_at":%s,"ended_epoch":%s,"final_status":%s,"log_path":"/nonexistent","lock_path":%s,"pid":null,"scope_unit":null,"log_format":"plain","ledger":%s,"stage":%s,"repo_identity":%s,"root_run_id":%s,"parent_run_id":null,"depth":0}\n' \
    "$id" "$(date -u -d "@$se" +%Y-%m-%dT%H:%M:%SZ)" "$se" "$ended_at" "$ee" "$q_final" "$q_lock" "$q_ledger" "$q_stage" "$q_ident" "$q_root" \
    > "$RUNS/$id.manifest.json"
}

IDENT_A="git-common-dir:/fixture/repo-a/.git"
IDENT_B="git-common-dir:/fixture/repo-b/.git"
KEY_A="$(printf '%s' "$IDENT_A" | sha256sum | cut -c1-16)"

# --- 1. every new field on a finished run; rc is an integer from the .exit file ---
S0=$((EPOCH_NOW - 3600))
mk_manifest done-a "$S0" "$((S0 + 90))" "$LEDGER_DIR/led.json" implement "$IDENT_A" root-1 null reviewed
mkdir -p "$LEDGER_DIR/led.json.results"
printf '7' > "$LEDGER_DIR/led.json.results/done-a.implement.exit"
run_runs --json
eq "0" "$__RUN_EXIT" "runs --json exit 0"
eq "array" "$(jget 'Array.isArray(j)?"array":"object"')" "runs --json stays an array"
for f in elapsed_s rc final_status project stall source fact_at observed_at probe_age_s; do
  eq "true" "$(jget "Object.prototype.hasOwnProperty.call(j.find(r=>r.run_id==='done-a'),'$f')")" "field $f present"
done
eq "7" "$(jget "j.find(r=>r.run_id==='done-a').rc")" "rc read from <ledger>.results/<run>.<stage>.exit"
eq "number" "$(jget "typeof j.find(r=>r.run_id==='done-a').rc")" "rc is an integer, not a string"
eq "90" "$(jget "j.find(r=>r.run_id==='done-a').elapsed_s")" "elapsed_s = ended_epoch - started_epoch"
eq "reviewed" "$(jget "j.find(r=>r.run_id==='done-a').final_status")" "final_status from manifest"
eq "$IDENT_A" "$(jget "j.find(r=>r.run_id==='done-a').project")" "project = manifest repo_identity"
eq "$(date -u -d "@$((S0 + 90))" +%Y-%m-%dT%H:%M:%SZ)" "$(jget "j.find(r=>r.run_id==='done-a').fact_at")" "fact_at = ended_at for a finished run"
eq "$LEDGER_DIR/led.json.results/done-a.implement.exit" "$(jget "j.find(r=>r.run_id==='done-a').source.exit_file")" "source.exit_file path"
eq "$RUNS/done-a.manifest.json" "$(jget "j.find(r=>r.run_id==='done-a').source.manifest")" "source.manifest path"
eq "null" "$(jget "j.find(r=>r.run_id==='done-a').probe_age_s")" "never probed: probe_age_s null"
eq "null" "$(jget "j.find(r=>r.run_id==='done-a').alive")" "never probed: alive null"
eq "null" "$(jget "j.find(r=>r.run_id==='done-a').stall")" "unprobed: stall null"
eq "null" "$(jget "j.find(r=>r.run_id==='done-a').source.status_probe")" "unprobed: source.status_probe null"

# --- 2. live run with a held lock: probed, fresh, running ----------------------------
HELD_LOCK="$SB/held.lock"; : > "$HELD_LOCK"
flock "$HELD_LOCK" sleep 120 < /dev/null > /dev/null 2>&1 &
HOLD_PIDS="$HOLD_PIDS $!"
sleep 0.5
mk_manifest live-held "$((EPOCH_NOW - 30))" null null null "$IDENT_A" root-1 "$HELD_LOCK" null
run_runs --json
eq "running" "$(jget "j.find(r=>r.run_id==='live-held').phase")" "held lock probed as running"
eq "true" "$(jget "j.find(r=>r.run_id==='live-held').alive")" "held lock alive true"
eq "number" "$(jget "typeof j.find(r=>r.run_id==='live-held').probe_age_s")" "probed row carries probe_age_s"
eq "true" "$(jget "j.find(r=>r.run_id==='live-held').elapsed_s>=30")" "live elapsed_s counts from started_epoch"
eq "null" "$(jget "j.find(r=>r.run_id==='live-held').rc")" "no ledger: rc null"
eq "true" "$(jget "j.find(r=>r.run_id==='live-held').source.status_probe!==null")" "probed row names its probe source"

# --- 3. NEGATIVE: no terminal state but --run says exited → rc null, phase exited ----
FREE_LOCK="$SB/free.lock"; : > "$FREE_LOCK"
mk_manifest live-gone "$((EPOCH_NOW - 40))" null "$LEDGER_DIR/led.json" implement "$IDENT_A" root-1 "$FREE_LOCK" null
run_runs --json
eq "exited" "$(jget "j.find(r=>r.run_id==='live-gone').phase")" "free lock → phase exited"
eq "null" "$(jget "j.find(r=>r.run_id==='live-gone').rc")" "no .exit file → rc null (not guessed)"
eq "null" "$(jget "j.find(r=>r.run_id==='live-gone').final_status")" "no terminal state → final_status null"

# --- 3b. NEGATIVE: terminal state but no end time → elapsed_s null (never 0) ----------
mk_manifest no-end "$((EPOCH_NOW - 80))" null null null "$IDENT_A" root-1 null reviewed
run_runs --json
eq "null" "$(jget "j.find(r=>r.run_id==='no-end').elapsed_s")" "finished run without end time: elapsed_s null, not 0"
rm -f "$RUNS/no-end.manifest.json"

# --- 4. --root keeps only that tree --------------------------------------------------
mk_manifest other-root "$((EPOCH_NOW - 50))" "$((EPOCH_NOW - 10))" null null "$IDENT_A" root-2 null reviewed
run_runs --json --root root-2
eq "other-root" "$(jget "j.map(r=>r.run_id).join(',')")" "--root keeps only that root tree"
run_runs --json --root root-1
eq "true" "$(jget "j.length===3 && j.every(r=>r.root_run_id==='root-1')")" "--root root-1 keeps its three runs"

# --- 5. --project: two repos in one dir; unscoped rows belong to no project ----------
mk_manifest repo-b-run "$((EPOCH_NOW - 60))" "$((EPOCH_NOW - 20))" null null "$IDENT_B" root-3 null reviewed
mk_manifest legacy-run "$((EPOCH_NOW - 70))" "$((EPOCH_NOW - 30))" null null null null null reviewed
run_runs --json --project "$IDENT_A"
eq "0" "$__RUN_EXIT" "--project exit 0"
eq "true" "$(jget "j.runs.every(r=>r.project==='$IDENT_A') && j.runs.length===4")" "--project <repo_identity> keeps only that repo"
eq "legacy-run" "$(jget "j.unscoped.map(r=>r.run_id).join(',')")" "rows without repo_identity land in unscoped"
eq "false" "$(jget "j.runs.some(r=>r.run_id==='repo-b-run'||r.run_id==='legacy-run')")" "other repo and unscoped rows are not in the project's runs"
run_runs --json --project "$KEY_A"
eq "true" "$(jget "j.runs.length===4 && j.runs.every(r=>r.project==='$IDENT_A')")" "--project <16-hex key> matches by sha256-16"
eq "$KEY_A" "$(jget "j.project_key")" "--project <16-hex key> header carries project_key"
run_runs --json --project "$IDENT_A"
eq "$KEY_A" "$(jget "j.project_key")" "--project <repo_identity> header carries the normalised project_key"
# RED at 367affdd (R6): header project_key: expected '<key>', got ''.
run_runs --json --project "0000000000000000"
eq "0" "$(jget "j.runs.length")" "unknown key matches nothing"

# --- 6. --since is a labelled display filter ----------------------------------------
SINCE="$(date -u -d "@$((EPOCH_NOW - 100))" +%Y-%m-%dT%H:%M:%SZ)"
run_runs --json --since "$SINCE"
eq "$SINCE" "$(jget "j.filter.since")" "--since reports top-level filter {since}"
eq "false" "$(jget "j.runs.some(r=>r.run_id==='done-a')")" "--since hides the old finished run"
eq "true" "$(jget "j.runs.some(r=>r.run_id==='live-held')")" "--since keeps recent runs"

# --- 7. human output is unchanged (literal captured from base 532930ed) --------------
HRUNS="$SB/hruns"; mkdir -p "$HRUNS"
RUNS_SAVE="$RUNS"; RUNS="$HRUNS"
mk_manifest h-done "$((EPOCH_NOW - 100))" "$((EPOCH_NOW - 50))" null null "$IDENT_A" null null reviewed
mk_manifest h-live "$((EPOCH_NOW - 20))" null null null "$IDENT_A" null "$HELD_LOCK" null
run_runs
eq "RUNS (1 live, 1 finished manifests)
  LIVE h-live role=implementer codex/m phase=running alive=true" "$__RUN_STDOUT" "human output byte-identical to base"
RUNS="$RUNS_SAVE"

# --- 8. bounded rotation: 9 live fixtures, cap 4 → all probed within 3 calls ---------
ROT="$SB/rot"; mkdir -p "$ROT"; RUNS_SAVE="$RUNS"; RUNS="$ROT"
for i in 1 2 3 4 5 6 7 8 9; do
  mk_manifest "rot-$i" "$((EPOCH_NOW - 500 + i))" null null null "$IDENT_A" null null null
done
probed_count() { jget "j.filter(r=>r.probe_age_s!==null).length"; }
run_runs --json --enrich-cap 4
eq "4" "$(probed_count)" "rotation call 1 probes exactly cap rows"
eq "true" "$(jget "j.filter(r=>r.probe_age_s===null).every(r=>r.alive===null && r.alive!==true)")" "unprobed rows are never shown as confirmed (alive null)"
assert_file_exists "$LIVE/runs-enrich-cursor.json" "cursor persisted under the resolved live dir"
run_runs --json --enrich-cap 4
eq "8" "$(probed_count)" "rotation call 2 resumes where call 1 stopped (cumulative 8)"
run_runs --json --enrich-cap 4
eq "9" "$(probed_count)" "rotation call 3: every live run probed within ceil(9/4) calls"
eq "true" "$(jget "j.every(r=>r.observed_at)")" "every row carries observed_at"
run_runs --json --enrich-cap 0
eq "2" "$__RUN_EXIT" "--enrich-cap 0 rejected"
run_runs --json --enrich-cap abc
eq "2" "$__RUN_EXIT" "--enrich-cap abc rejected"
RUNS="$RUNS_SAVE"

# --- 9. selectors are only valid for runs ---------------------------------------------
__RUN_STDOUT=$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" node "$CLI" status quota --project x 2>&1 < /dev/null); __RUN_EXIT=$?
eq "2" "$__RUN_EXIT" "--project on a non-runs subcommand exits 2"

# --- 10. isolation: nothing leaked into the fake XDG dir or fake HOME ------------------
eq "0" "$(find "$FAKE_XDG" "$FAKE_HOME" "$FAKE_CLAUDE" -type f | wc -l | tr -d ' ')" "no files written under fake HOME/XDG/CLAUDE_CONFIG_DIR"

finalize_test
