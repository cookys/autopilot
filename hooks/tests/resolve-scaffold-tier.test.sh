#!/usr/bin/env bash
# Fixture coverage for scripts/resolve-scaffold-tier.js (four-layer D4 / KR3).
#
# BLOCKER 2 fix (2026-08-22 review repair): freshness is now the seat's strike-decay
# admission PROJECTION (scripts/engine-scorecard.js computeSeatProjection), reused
# rather than a third hand-rolled calendar check — never a comparison of `now` against
# the row's own `expires`. A past-expires qualified row stays T0/T1-eligible and an
# expiry-less row is no longer punished for lacking a date (references/strike-decay.md,
# docs/plans/2026-08-22-no-confidence-decay.md). The T2 fail-closure cases covered here:
# missing store, unknown engine, no admissible baseline (no qualified row at all),
# requalify_required (mechanical no-confidence — a critical strike after the pass),
# conflicting (latest fresh row is itself a failure), and malformed-line tolerance —
# plus T0, T1, imported-priors, and supersession (latest admission-fresh row wins).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-scaffold-tier.js"
NOW="2026-08-16T00:00:00Z"
SC="$TEST_TMP/scorecard.jsonl"

# Isolate the strikes store too — computeSeatProjection folds it in, and without this
# a stray real ~/.autopilot/engine-capability/strikes.jsonl row could leak into a test.
export ENGINE_CAPABILITY_DIR="$TEST_TMP/capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"
STRIKES_FILE="$ENGINE_CAPABILITY_DIR/strikes.jsonl"

resolve() { node "$SCRIPT" --runner grok --model grok-4.5 --role implementer --now "$NOW" --scorecard "$SC"; }
tier()    { resolve | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tier));'; }

# row $1=qualified_at $2=expires(""=omit) $3=corpus_pass $4=false_pass_critical $5=score $6=extra-json
# status is derived from score (>=1 => qualified, matching real scorecard rows) — the
# admission PROJECTION (not this local `status` string) is what resolve-scaffold-tier.js
# now gates freshness on, but findSeatBaseline (engine-scorecard.js) still requires a
# `status: "qualified"` row to establish any baseline at all.
row() {
  local qat="$1" exp="$2" cp="$3" fpc="$4" score="$5" extra="${6:-}"
  local status="qualified"
  [ "$score" = "0" ] && status="failed"
  local expires_field=""
  [ -n "$exp" ] && expires_field="\"expires\":\"$exp\","
  printf '{"runner":"grok","model":"grok-4.5","engine":"grok-4.5","role":"implementer","qualified_at":"%s",%s"status":"%s","quality":{"corpus_pass":"%s","false_pass_critical":%s},"capability_score":%s%s}\n' \
    "$qat" "$expires_field" "$status" "$cp" "$fpc" "$score" "$extra"
}

# seat_hash engine runner role — independent re-derivation via the SAME primitives
# engine-scorecard.js uses (mirrors hooks/tests/calendar-teeth-negative.test.sh).
seat_hash() {
  node -e '
const { canonicalJson, sha256 } = require(process.argv[4]);
process.stdout.write(sha256(canonicalJson({ engine: process.argv[1], runner: process.argv[2], role: process.argv[3] })));
' "$1" "$2" "$3" "$REPO_ROOT/src/engine/owner-kernel/canonical.js"
}
HEX64=$(node -e "process.stdout.write('a'.repeat(64))")
# critical_strike_line seat_hash observed_at
critical_strike_line() {
  local sh="$1" observed="$2"
  cat <<JSON
{"schema_version":2,"event_id":1,"kind":"strike","seat_hash":"$sh","engine":"grok-4.5","runner":"grok","role":"implementer","class":"critical_reexam_trigger","predicate_id":"security_canary_disclosure","cause_class":"engine_output","writer":"fuse","dedup_key":"inc-1:det-1","detector_id":"det-1","detector_version":"v1","artifact_sha256":"$HEX64","receipt_ref":"rcpt-1","observed_at":"$observed","invalidates_event_id":null,"proof_artifact_sha256":null,"proof_detector_id":null}
JSON
}

# ── T2: missing store ──
rm -f "$SC"
rm -f "$STRIKES_FILE"
assert_eq "T2" "$(tier)" "missing scorecard store fails closed to T2"

# ── T2: unknown engine (store exists, no matching row) ──
printf '{"runner":"codex","model":"gpt-5.5","engine":"gpt-5.5","role":"reviewer","qualified_at":"2026-08-10","expires":"2026-09-10","status":"qualified","quality":{"corpus_pass":"5/5","false_pass_critical":0},"capability_score":1}\n' > "$SC"
assert_eq "T2" "$(tier)" "unknown engine (no matching row) fails closed to T2"

# ── BLOCKER 2 planted negative: a PAST-EXPIRES qualified row still resolves T0.
#     This is the exact tooth pulled — before the fix, isFresh() compared `now` against
#     `row.expires` and this fixture resolved T2 ("expired record fails closed").
rm -f "$STRIKES_FILE"
row "2026-06-01" "2026-06-15" "40/40" 0 1 > "$SC"
assert_eq "T0" "$(tier)" "BLOCKER 2: a past-expires qualified+complete row still resolves T0 (calendar is advisory, never authority)"

# ── expiry-less record is no longer punished for lacking a date (T0, not stale) ──
rm -f "$STRIKES_FILE"
row "2026-08-10" "" "40/40" 0 1 > "$SC"
assert_eq "T0" "$(tier)" "expiry-less qualified+complete row resolves T0 (no longer treated as stale)"

# ── T2: no admissible baseline at all — a FAILED administration is the only row for
#     this seat (no qualified row anywhere in history => admission_status no_record).
rm -f "$STRIKES_FILE"
row "2026-08-10" "2026-09-10" "10/40" 3 0 > "$SC"
assert_eq "T2" "$(tier)" "no qualified row anywhere in the seat's history fails closed to T2 (admission_status=no_record)"

# ── T2: requalify_required — a critical strike stamped AFTER the pass flips the seat's
#     admission regardless of `expires` (the actual wiring blocker 2 requires: resolve-
#     scaffold-tier.js must consume the SAME projection engine-scorecard.js computes).
rm -f "$STRIKES_FILE"
row "2026-08-10" "2099-01-01" "40/40" 0 1 > "$SC"
SH=$(seat_hash grok-4.5 grok implementer)
critical_strike_line "$SH" "2026-08-11T00:00:00Z" > "$STRIKES_FILE"
assert_eq "T2" "$(tier)" "a critical strike after the pass flips admission to requalify_required => T2, even with a far-future expires"
rm -f "$STRIKES_FILE"

# ── T2: latest fresh record is a failure (an older pass does not rescue the TIER, even
#     though the seat's admission stays qualified because SOME row in its history
#     passed — supersession picks the latest row for the QUALITY verdict). ──
{ row "2026-08-10" "2026-09-10" "40/40" 0 1; row "2026-08-12" "2026-09-12" "10/40" 3 0; } > "$SC"
OUT="$(resolve)"
assert_eq "T2" "$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tier));')" \
  "latest fresh failure fails closed to T2 despite an older fresh pass"
assert_contains "$OUT" '"line": 2' "failure verdict cites the latest (authoritative) ref"

# ── Supersession: latest fresh row wins over an older fresh failure ──
{ row "2026-08-01" "2026-09-01" "10/40" 3 0; row "2026-08-12" "2026-09-12" "40/40" 0 1; } > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T0"' "latest fresh row supersedes an older fresh failure"
assert_contains "$OUT" '"line": 2' "supersession verdict cites the latest ref"

# ── T2: imported priors never lift ──
row "2026-08-10" "2026-09-10" "40/40" 0 1 ',"version_source":"imported"' > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T2"' "imported priors alone stay T2"
assert_contains "$OUT" "priors never lift" "prior rationale named"

# ── T0: fresh + complete ──
row "2026-08-10" "2026-09-10" "40/40" 0 1 > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T0"' "fresh complete qualification resolves T0"
assert_contains "$OUT" '"evidence_refs"' "T0 verdict carries evidence refs"

# ── T1: fresh + partial ──
row "2026-08-10" "2026-09-10" "30/40" 0 1 > "$SC"
assert_eq "T1" "$(tier)" "fresh partial qualification resolves T1"

# ── Malformed lines tolerated, push only toward T2 ──
{ printf 'not json at all\n'; row "2026-08-10" "2026-09-10" "40/40" 0 1; } > "$SC"
assert_eq "T0" "$(tier)" "malformed line skipped; valid fresh row still resolves"
printf 'not json at all\n' > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T2"' "only-malformed store fails closed to T2"
assert_contains "$OUT" "malformed line" "malformed count surfaces in rationale"

finalize_test
