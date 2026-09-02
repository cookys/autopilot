#!/usr/bin/env bash
# Tests for scripts/watch-foreman.js — depth-0 live sensing for a dispatched
# foreman (S3-lite): ledger stage events, quiet detection, leaf manifest
# start/end/stall, --once snapshot. Sensing only — the tool must have no
# kill/steer surface (report-only lines).
. "$(dirname "$0")/lib.sh"

WF="$REPO_ROOT/scripts/watch-foreman.js"
RL="$REPO_ROOT/scripts/run-ledger.sh"
W="$TEST_TMP/watch"
mkdir -p "$W/runs"
LEDGER="$W/ledger.jsonl"

# --- 1. usage: --ledger required; unknown arg exits 2 ---------------------------
node "$WF" >/dev/null 2>&1; assert_eq "2" "$?" "--ledger required exit 2"
node "$WF" --ledger x --bogus >/dev/null 2>&1; assert_eq "2" "$?" "unknown arg exit 2"

# --- 2. real ledger records (produced by run-ledger.sh, never hand-forged) -----
bash "$RL" stage-acquire --ledger "$LEDGER" --run-id wfrun --stage implement --pid "$$" >/dev/null 2>&1
bash "$RL" stage-acquire --ledger "$LEDGER" --run-id wfrun2 --stage implement --pid "$$" >/dev/null 2>&1
bash "$RL" stage-transition --ledger "$LEDGER" --run-id wfrun --stage implement --to committed >/dev/null 2>&1 || true
bash "$RL" stage-event --ledger "$LEDGER" --run-id wfrun --stage implement --condition waiting --reason child-boundary >/dev/null 2>&1

# leaf manifests: one live (fresh log), one ended, one live with an OLD quiet log
mk_manifest() { # id role ended log
  local id="$1" role="$2" ended="$3" log="$4"
  printf '{"schema":1,"run_id":"%s","role":"%s","runner":"codex","model":"m","log_path":"%s","started_epoch":%s,"ended_at":%s,"final_status":%s}\n' \
    "$id" "$role" "$log" "$(date +%s)" "$ended" "${5:-null}" > "$W/runs/$id.manifest.json"
}
: > "$W/live.log"
mk_manifest leaf-live implementer null "$W/live.log"
mk_manifest leaf-done reviewer '"2026-07-14T00:00:00Z"' "$W/live.log" '"reviewed"'
: > "$W/quiet.log"; touch -d "30 minutes ago" "$W/quiet.log"
mk_manifest leaf-quiet implementer null "$W/quiet.log"

# --- 3. --once snapshot sees stages + live leaves --------------------------------
OUT="$(node "$WF" --ledger "$LEDGER" --runs-dir "$W/runs" --quiet-secs 600 --once 2>&1)"
assert_contains "$OUT" "STAGE run=wfrun implement" "snapshot emits stage event"
assert_contains "$OUT" "STAGE run=wfrun2 implement" "stage tracking is keyed by run_id plus stage"
assert_contains "$OUT" "CONDITION run=wfrun implement waiting" "snapshot emits typed waiting condition"
assert_contains "$OUT" "LEAF_START leaf-live" "snapshot emits live leaf"
assert_contains "$OUT" "LEAF_END leaf-done reviewed" "snapshot emits ended leaf with status"
assert_contains "$OUT" "LEAF_STALL leaf-quiet" "snapshot flags quiet live leaf (report-only)"
assert_contains "$OUT" "report-only" "stall line carries report-only discipline"
assert_contains "$OUT" "SNAPSHOT" "snapshot summary line present"
assert_not_contains "$OUT" "QUIET " "fresh ledger not flagged quiet"

# --- 4. quiet ledger detection: empty ledger whose mtime is old (a ledger with
# fresh records must NOT be quiet — record ts is the primary liveness signal) ----
QLEDGER="$W/quiet-ledger.jsonl"
: > "$QLEDGER"; touch -d "20 minutes ago" "$QLEDGER"
OUT="$(node "$WF" --ledger "$QLEDGER" --runs-dir "$W/runs" --quiet-secs 60 --once 2>&1)"
assert_contains "$OUT" "QUIET" "aged ledger flagged quiet"
assert_contains "$OUT" "never grab a leased stage" "quiet line embeds the R6 rule"

# --- 5. missing ledger → WAIT (foreman not started), exit 0 ----------------------
OUT="$(node "$WF" --ledger "$W/absent.jsonl" --runs-dir "$W/runs" --once 2>&1)"; EC=$?
assert_eq "0" "$EC" "absent ledger exits 0"
assert_contains "$OUT" "WAIT ledger not created yet" "absent ledger emits WAIT"

# --- 6. live mode: events stream, exits at --max-secs ----------------------------
touch "$LEDGER"
OUT="$(node "$WF" --ledger "$LEDGER" --runs-dir "$W/runs" --interval-secs 1 --quiet-secs 600 --max-secs 2 2>&1)"; EC=$?
assert_eq "0" "$EC" "live mode exits 0 at max-secs"
assert_contains "$OUT" "STAGE run=wfrun implement" "live mode emits stage events"

# --- 7. no kill/steer surface (sensing-only guarantee, greppable) ----------------
assert_not_contains "$(cat "$WF")" "child_process" "watcher spawns nothing (pure observation)"

# --- 8. no directive-SEND/ACK surface (Phase 2: the watcher senses, never nudges) -
# The directive channel is advisory and written only by depth-0 / the delivering
# supervisor — the read-only watcher must never gain a directive write surface.
assert_not_contains "$(cat "$WF")" "directive-send" "watcher has no directive-send surface"
assert_not_contains "$(cat "$WF")" "directive-ack" "watcher has no directive-ack surface"

# --- 9. dead-PID CONDITION carries the CC-native false-positive caveat inline --
# (docs/BACKLOG.md "`/l4` watcher reports `owner_absent` for every healthy
# CC-native foreman"): a stage lease whose recorded PID has already exited
# reads as `dead reason=owner_absent` — true for a genuinely dead foreman,
# but also the EXPECTED shape for a healthy CC-native foreman seconds after
# every stage-acquire (the acquiring shell exits immediately; the foreman
# itself keeps running as a separate agent turn, not that shell's child).
# The emitted line must carry the caveat itself, not only in a reference doc.
sh -c 'exit 0' & DEADPID=$!
wait "$DEADPID" 2>/dev/null
DEADLEDGER="$W/dead-ledger.jsonl"
# --start-time is explicit: get_process_start_time on an already-dead pid
# returns "0" (non-empty), which short-circuits stage-acquire's own
# now_ts fallback (`[ -n "$start_time" ] ||` only fires on an EMPTY string)
# and would otherwise produce an invalid (0) start_time -> malformed_lease_evidence
# instead of the dead/owner_absent condition this case means to exercise.
bash "$RL" stage-acquire --ledger "$DEADLEDGER" --run-id deadrun --stage implement \
  --pid "$DEADPID" --start-time "$(date +%s)" >/dev/null 2>&1
OUT="$(node "$WF" --ledger "$DEADLEDGER" --runs-dir "$W/runs" --quiet-secs 600 --once 2>&1)"
assert_contains "$OUT" "CONDITION run=deadrun implement dead gen=1 reason=owner_absent" \
  "dead PID still emits the plain dead/owner_absent condition"
assert_contains "$OUT" "note=pid_liveness_unreliable_for_cc_native" \
  "dead/owner_absent CONDITION line carries the CC-native false-positive note"

# --- 10. on-disk worktree facts override the uninformative PID (v2.35.7) -------
# The PID is a known false-positive for a CC-native foreman, so when a lease records a
# WORKTREE the condition is decided by what is on disk there. These three cases pin all
# three outcomes; without them the new branch could be deleted and case 9 would stay green.

# 10a. worktree with a FRESH write -> `dead` downgrades to `unknown`, never to `working`
FRESH_WT="$W/wt-fresh"
mkdir -p "$FRESH_WT" && : > "$FRESH_WT/touched-now"
FRESHLEDGER="$W/fresh-wt-ledger.jsonl"
bash "$RL" stage-acquire --ledger "$FRESHLEDGER" --run-id freshwt --stage implement \
  --pid "$DEADPID" --start-time "$(date +%s)" --worktree "$FRESH_WT" >/dev/null 2>&1
OUT="$(node "$WF" --ledger "$FRESHLEDGER" --runs-dir "$W/runs" --quiet-secs 600 --once 2>&1)"
assert_contains "$OUT" "CONDITION run=freshwt implement unknown gen=1 reason=owner_absent_worktree_active" \
  "an active worktree downgrades dead/owner_absent to unknown"
assert_not_contains "$OUT" "run=freshwt implement working" \
  "on-disk activity never claims working (files cannot prove a live process)"

# 10b. worktree GONE -> stays `dead`, with the stronger reason. Absence is the one on-disk
# fact that genuinely evidences death, so this must NOT be softened to unknown.
GONE_WT="$W/wt-gone"
mkdir -p "$GONE_WT"
GONELEDGER="$W/gone-wt-ledger.jsonl"
bash "$RL" stage-acquire --ledger "$GONELEDGER" --run-id gonewt --stage implement \
  --pid "$DEADPID" --start-time "$(date +%s)" --worktree "$GONE_WT" >/dev/null 2>&1
rm -rf "$GONE_WT"
OUT="$(node "$WF" --ledger "$GONELEDGER" --runs-dir "$W/runs" --quiet-secs 600 --once 2>&1)"
assert_contains "$OUT" "CONDITION run=gonewt implement dead gen=1 reason=owner_absent_worktree_absent" \
  "a vanished worktree keeps the dead verdict with the stronger reason"

# 10c. worktree present but IDLE past the quiet window -> the pre-existing dead/owner_absent
# line, caveat note intact. Nothing recent on disk is not evidence of life.
IDLE_WT="$W/wt-idle"
mkdir -p "$IDLE_WT" && : > "$IDLE_WT/old-file"
touch -d "1 hour ago" "$IDLE_WT/old-file" "$IDLE_WT"
IDLELEDGER="$W/idle-wt-ledger.jsonl"
bash "$RL" stage-acquire --ledger "$IDLELEDGER" --run-id idlewt --stage implement \
  --pid "$DEADPID" --start-time "$(date +%s)" --worktree "$IDLE_WT" >/dev/null 2>&1
OUT="$(node "$WF" --ledger "$IDLELEDGER" --runs-dir "$W/runs" --quiet-secs 60 --once 2>&1)"
assert_contains "$OUT" "CONDITION run=idlewt implement dead gen=1 reason=owner_absent" \
  "an idle worktree falls back to the plain dead/owner_absent condition"
assert_contains "$OUT" "note=pid_liveness_unreliable_for_cc_native" \
  "the idle-worktree fallback still carries the CC-native caveat"

finalize_test
