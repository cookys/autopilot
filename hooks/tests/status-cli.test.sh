#!/usr/bin/env bash
# Tests for `autopilot status` (src/status/cli.js) — read-only state overview
# composing engine-capability-state (quota), dispatch-status (runs), and
# resolve-review-loop (roster). All substrates sandboxed via their env seams.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/bin/autopilot.js"
SB="$TEST_TMP/status"
mkdir -p "$SB/cap" "$SB/runs"
CFG="$SB/rl.md"; : > "$CFG"

run_status() { # subcmd/flags...
  __RUN_STDOUT=$(ENGINE_CAPABILITY_DIR="$SB/cap" AUTOPILOT_DISPATCH_RUNS_DIR="$SB/runs" \
    REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" ENGINE_SCORECARD_DIR="$SB/sc" \
    node "$CLI" status "$@" 2>"$SB/err")
  __RUN_EXIT=$?
  __RUN_STDERR=$(cat "$SB/err")
}

# --- 1. usage guards ------------------------------------------------------------
run_status bogus; assert_eq "2" "$__RUN_EXIT" "unknown subcommand exit 2"
run_status quota --bogus; assert_eq "2" "$__RUN_EXIT" "unknown flag exit 2"

# --- 2. quota: empty store → empty JSON; recorded rows carry stale semantics -----
run_status quota --json
assert_eq "0" "$__RUN_EXIT" "quota --json exit 0"
assert_eq "[]" "$(printf '%s' "$__RUN_STDOUT" | tr -d ' \n')" "empty store → []"

NOW_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"schema_version":1,"observed_at":"%s","runner":"codex","model":"m-fresh","role":"reviewer","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":86400,"reset_at":null,"evidence":null}}}\n' "$NOW_TS" > "$SB/ev.json"
ENGINE_CAPABILITY_DIR="$SB/cap" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$SB/ev.json" >/dev/null
# fresh exhausted row WITH reset_at (in-TTL) + a TTL-EXPIRED row: the store
# report DROPS expired observations entirely — status must surface the fresh
# one and the expired one must be ABSENT (absent = unknown, per the note).
printf '{"schema_version":1,"observed_at":"%s","runner":"codex","model":"m-reset","role":"reviewer","capability":{"quota":{"status":"exhausted","confidence":"high","ttl_seconds":86400,"reset_at":"2026-08-01T00:00:00Z","evidence":null}}}\n' "$NOW_TS" > "$SB/ev.json"
ENGINE_CAPABILITY_DIR="$SB/cap" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$SB/ev.json" >/dev/null
printf '{"schema_version":1,"observed_at":"2026-01-01T00:00:00Z","runner":"codex","model":"m-old","role":"reviewer","capability":{"quota":{"status":"exhausted","confidence":"high","ttl_seconds":3600,"reset_at":"2026-01-02T00:00:00Z","evidence":null}}}\n' > "$SB/ev.json"
ENGINE_CAPABILITY_DIR="$SB/cap" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$SB/ev.json" >/dev/null

run_status quota --json
assert_contains "$__RUN_STDOUT" '"model": "m-fresh"' "fresh row present"
assert_contains "$__RUN_STDOUT" '"status": "available"' "fresh status carried"
assert_contains "$__RUN_STDOUT" '"reset_at": "2026-08-01T00:00:00Z"' "reset_at carried on fresh exhausted row"
assert_not_contains "$__RUN_STDOUT" '"model": "m-old"' "TTL-expired observation is ABSENT (= unknown), never shown as live truth"

# a metered-endpoint-class row: wallet identity = named endpoint (store records
# endpoint on exact tuples; status surface remains non-authorizing telemetry).
printf '{"schema_version":1,"observed_at":"%s","runner":"cc-shim","model":"MiniMax-M3","role":"reviewer","capability":{"quota":{"status":"available","confidence":"low","ttl_seconds":86400,"reset_at":null,"evidence":null}}}\n' "$NOW_TS" > "$SB/ev.json"
ENGINE_CAPABILITY_DIR="$SB/cap" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$SB/ev.json" >/dev/null

run_status quota
assert_contains "$__RUN_STDOUT" "[subscription]" "subscription class grouped"
assert_contains "$__RUN_STDOUT" "PER-MODEL" "subscription caption states per-model pool rule"
assert_contains "$__RUN_STDOUT" "no remaining-%" "subscription caption states the honesty ceiling"
assert_contains "$__RUN_STDOUT" "[metered-endpoint]" "metered class grouped"
assert_contains "$__RUN_STDOUT" "DIFFERENT wallet" "metered caption states per-endpoint wallet identity"
assert_contains "$__RUN_STDOUT" "non-authorizing" "metered caption states status is non-authorizing telemetry"
assert_contains "$__RUN_STDOUT" "ABSENT" "human output explains absent-model semantics"
run_status quota --json
assert_contains "$__RUN_STDOUT" '"source_class": "metered-endpoint"' "json rows carry source_class"

# --- 3. runs: empty dir → []; ended + live manifests reported --------------------
run_status runs --json
assert_eq "[]" "$(printf '%s' "$__RUN_STDOUT" | tr -d ' \n')" "empty runs dir → []"

printf '{"schema":1,"run_id":"st-done","role":"reviewer","runner":"codex","model":"m","started_at":"2026-07-14T00:00:00Z","ended_at":"2026-07-14T00:01:00Z","final_status":"reviewed","log_path":"/nonexistent"}\n' > "$SB/runs/st-done.manifest.json"
: > "$SB/live.log"
printf '{"schema":1,"run_id":"st-live","role":"implementer","runner":"codex","model":"m","started_at":"2026-07-14T00:00:00Z","started_epoch":%s,"ended_at":null,"final_status":null,"log_path":"%s","lock_path":null,"pid":null,"scope_unit":null,"log_format":"plain"}\n' "$(date +%s)" "$SB/live.log" > "$SB/runs/st-live.manifest.json"
run_status runs --json
assert_contains "$__RUN_STDOUT" '"run_id": "st-done"' "ended run listed"
assert_contains "$__RUN_STDOUT" '"run_id": "st-live"' "live run listed"
assert_contains "$__RUN_STDOUT" '"phase"' "live run enriched with phase"
run_status runs
assert_contains "$__RUN_STDOUT" "LIVE st-live" "human output marks live run"

# --- 4. roster: template config resolves to seats ---------------------------------
run_status roster --json
assert_contains "$__RUN_STDOUT" '"reviewer_high_risk"' "roster seats present"
assert_contains "$__RUN_STDOUT" '"on_family_conflict"' "family-conflict policy present"

# --- 5. overview (default) shows all three sections -------------------------------
run_status
assert_eq "0" "$__RUN_EXIT" "overview exit 0"
assert_contains "$__RUN_STDOUT" "QUOTA" "overview quota section"
assert_contains "$__RUN_STDOUT" "RUNS" "overview runs section"
assert_contains "$__RUN_STDOUT" "ROSTER" "overview roster section"

finalize_test
