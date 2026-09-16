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

# --- 6. readiness: loud fallback when strict bootstrap throws (v2.36.55) ---
# RED at base fe225ff5: zero stderr lines on a bootstrap that throws
# strict_l5_provider_roster_unavailable (silent provider-less fallback).
BOOTSTRAP_THROW="$TEST_TMP/strict-bootstrap-throw.cjs"
cat > "$BOOTSTRAP_THROW" <<'NODE'
'use strict';
const path = require('path');
const root = process.env.STATUS_TEST_REPO_ROOT;
const mod = require(path.join(root, 'src', 'readiness', 'provider-bootstrap.js'));
mod.createStrictL5ProviderBootstrap = () => {
  const err = new Error('strict /l5 review roster is unavailable');
  err.code = 'strict_l5_provider_roster_unavailable';
  throw err;
};
NODE
run_status_throw() {
  __RUN_STDOUT=$(STATUS_TEST_REPO_ROOT="$REPO_ROOT" \
    ENGINE_CAPABILITY_DIR="$SB/cap" AUTOPILOT_DISPATCH_RUNS_DIR="$SB/runs" \
    REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" ENGINE_SCORECARD_DIR="$SB/sc" \
    node --require="$BOOTSTRAP_THROW" "$CLI" status "$@" 2>"$SB/err")
  __RUN_EXIT=$?
  __RUN_STDERR=$(cat "$SB/err")
}
run_status_throw readiness --json
assert_eq "0" "$__RUN_EXIT" "readiness bootstrap-unavailable still exits 0"
assert_eq "1" "$(printf '%s\n' "$__RUN_STDERR" | grep -c '^readiness: strict bootstrap unavailable' || true)" \
  "exactly one readiness fallback stderr line"
printf '%s\n' "$__RUN_STDERR" | grep -E '^readiness: strict bootstrap unavailable \(strict_l5_provider_roster_unavailable' >/dev/null \
  || fail "stderr must include thrown code strict_l5_provider_roster_unavailable"
node - "$SB/err" <<'NODE'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\n/).filter((l) => l.length > 0);
if (lines.length !== 1) process.exit(2);
NODE
assert_eq "0" "$?" "readiness fallback is exactly one stderr line"
EXPECTED_READY="$TEST_TMP/providerless-expected.json"
ACTUAL_READY="$TEST_TMP/providerless-actual.json"
printf '%s\n' "$__RUN_STDOUT" > "$ACTUAL_READY"
# Frozen literal: the provider-less receipt the BASE (fe225ff5) CLI emits for this empty
# config fixture, with issued_at/expires_at/observed_at and every *_digest / brain_seat
# stripped. Not derived from the implementation under test (codex r1 MUST-FIX, 2026-09-16).
cat > "$EXPECTED_READY" <<'JSON'
{"schema_version":1,"artifact_type":"provider_readiness_receipt","overall_status":"probe-needed","seats":[{"seat_id":"implementer","required":true,"family":"openai","decision":{"schema_version":1,"artifact_type":"provider_readiness_decision","tuple":{"role":"implementer","runner":"codex","model":"gpt-5.3-codex-spark","effort":"high","endpoint":null},"tuple_digest":"9e1c837b1293be0eba619fc606ab086170999b6279f0bd62ab7dc5815e7e2e35","axes":{"transport":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_transport_observation"},"live":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_live_observation"},"qualification":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_qualification_observation"}},"usable_now":false,"probe_required":true,"blocking_reasons":[],"fallbacks":[]},"fallbacks":[],"selected":null,"status":"probe-needed","failing_axes":[{"axis":"transport","status":"unknown","reason":"missing_transport_observation"},{"axis":"live","status":"unknown","reason":"missing_live_observation"},{"axis":"qualification","status":"unknown","reason":"missing_qualification_observation"}]},{"seat_id":"reviewer","required":true,"family":"openai","decision":{"schema_version":1,"artifact_type":"provider_readiness_decision","tuple":{"role":"reviewer","runner":"codex","model":"gpt-5.5","effort":"xhigh","endpoint":null},"tuple_digest":"472485ff907bbc702aab5d955423679121f8e180d768f43634b37972d6ff48ef","axes":{"transport":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_transport_observation"},"live":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_live_observation"},"qualification":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_qualification_observation"}},"usable_now":false,"probe_required":true,"blocking_reasons":[],"fallbacks":[]},"fallbacks":[],"selected":null,"status":"probe-needed","failing_axes":[{"axis":"transport","status":"unknown","reason":"missing_transport_observation"},{"axis":"live","status":"unknown","reason":"missing_live_observation"},{"axis":"qualification","status":"unknown","reason":"missing_qualification_observation"}]},{"seat_id":"qc:1","required":true,"family":"openai","decision":{"schema_version":1,"artifact_type":"provider_readiness_decision","tuple":{"role":"qc","runner":"codex","model":"gpt-5.5","effort":"xhigh","endpoint":null},"tuple_digest":"fd1a7712e62af57ec0b480e73e8839e47c1a5b1e41d58fd0fa743098396fc886","axes":{"transport":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_transport_observation"},"live":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_live_observation"},"qualification":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_qualification_observation"}},"usable_now":false,"probe_required":true,"blocking_reasons":[],"fallbacks":[]},"fallbacks":[],"selected":null,"status":"probe-needed","failing_axes":[{"axis":"transport","status":"unknown","reason":"missing_transport_observation"},{"axis":"live","status":"unknown","reason":"missing_live_observation"},{"axis":"qualification","status":"unknown","reason":"missing_qualification_observation"}]},{"seat_id":"qc:2","required":true,"family":"anthropic","decision":{"schema_version":1,"artifact_type":"provider_readiness_decision","tuple":{"role":"qc","runner":"claude-native","model":"claude-opus","effort":"high","endpoint":null},"tuple_digest":"9016bc23f76b0b2b018539aa76cf5a82c57e7a609fdeb0a4f03ebee2ddbbca16","axes":{"transport":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_transport_observation"},"live":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_live_observation"},"qualification":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_qualification_observation"}},"usable_now":false,"probe_required":true,"blocking_reasons":[],"fallbacks":[]},"fallbacks":[],"selected":null,"status":"probe-needed","failing_axes":[{"axis":"transport","status":"unknown","reason":"missing_transport_observation"},{"axis":"live","status":"unknown","reason":"missing_live_observation"},{"axis":"qualification","status":"unknown","reason":"missing_qualification_observation"}]},{"seat_id":"qc:3","required":true,"family":"google","decision":{"schema_version":1,"artifact_type":"provider_readiness_decision","tuple":{"role":"qc","runner":"agy","model":"gemini-3.6-flash-high","effort":"high","endpoint":null},"tuple_digest":"c30f6be79439ebf88f1cf9e14a1e6b18f9f70fe35a3b6566987b731a83e6deec","axes":{"transport":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_transport_observation"},"live":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_live_observation"},"qualification":{"status":"unknown","observed_status":null,"ttl_seconds":0,"evidence_class":"none","freshness":"missing","reason":"missing_qualification_observation"}},"usable_now":false,"probe_required":true,"blocking_reasons":[],"fallbacks":[]},"fallbacks":[],"selected":null,"status":"probe-needed","failing_axes":[{"axis":"transport","status":"unknown","reason":"missing_transport_observation"},{"axis":"live","status":"unknown","reason":"missing_live_observation"},{"axis":"qualification","status":"unknown","reason":"missing_qualification_observation"}]}]}
JSON
node - "$EXPECTED_READY" "$ACTUAL_READY" <<'NODE'
const fs = require('fs');
const assert = require('assert');
const expected = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const actual = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const scrub = (value) => {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'issued_at' || k === 'expires_at' || k === 'observed_at'
        || k === 'roster_digest' || k === 'policy_digest'
        || k === 'observation_digest' || k === 'receipt_digest'
        || k === 'decision_digest' || k === 'brain_seat') continue;
    copy[k] = scrub(v);
  }
  return copy;
};
assert.deepStrictEqual(scrub(actual), expected);
NODE
assert_eq "0" "$?" "stdout JSON deep-equals provider-less receipt (digest/timestamp normalized)"

# (preservation, green at base) successful bootstrap writes no such stderr line
run_status_ok() {
  __RUN_STDOUT=$(ENGINE_CAPABILITY_DIR="$SB/cap" AUTOPILOT_DISPATCH_RUNS_DIR="$SB/runs" \
    REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" ENGINE_SCORECARD_DIR="$SB/sc" \
    AUTOPILOT_LEVEL=l4 \
    node "$CLI" status "$@" 2>"$SB/err-ok")
  __RUN_EXIT=$?
  __RUN_STDERR=$(cat "$SB/err-ok")
}
run_status_ok readiness --json
assert_eq "0" "$__RUN_EXIT" "successful readiness bootstrap exit 0"
assert_not_contains "$__RUN_STDERR" "readiness: strict bootstrap unavailable" \
  "successful bootstrap prints no fallback stderr line"

finalize_test
