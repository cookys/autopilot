#!/usr/bin/env bash
# Independent depth-0 adversarial harness for the v2 strike STORE in
# scripts/engine-capability-state.js (plan 2026-08-22-no-confidence-decay, P0).
#
# Covers: seat identity / seat_hash (§2.7.1), the v2 strikes.jsonl row schema and
# closed-key discipline (§2.7.2), the closed registries (§2.7.3), dedup-idempotent
# append, mechanically-proven strike_invalidated, v1/v2 coexistence with monotonic
# event_id, and non-leakage of v2 rows into brainSeatStatus's v1-only fold.

set -uo pipefail
# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/scripts/engine-capability-state.js"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
export ENGINE_CAPABILITY_DIR="$TESTDIR"
trap 'rm -rf "$TESTDIR"' EXIT

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
jq_get() { node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of '$1'.split('.'))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(String(v))"; }
reset_strikes() { rm -f "$TESTDIR/strikes.jsonl" "$TESTDIR/.lock"; }
sha_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# Snapshot the operator's REAL store BEFORE this suite touches anything, so the
# isolation assertions below are a real before/after comparison, not a tautology
# that only passes because the file happens not to exist on this host
# (evidence-discipline §5 / §9 — mirrors hooks/tests/calendar-teeth-negative.test.sh
# and hooks/tests/strike-writer-wiring.test.sh).
REAL_STRIKES="$HOME/.autopilot/engine-capability/strikes.jsonl"
REAL_STRIKES_SIZE_BEFORE=$( [ -f "$REAL_STRIKES" ] && stat -c%s "$REAL_STRIKES" 2>/dev/null || echo 0 )

SHA_A="$(sha_of a)"
SHA_B="$(sha_of b)"
SHA_C="$(sha_of c)"

strike_seat() {
  # engine runner role class predicate-id-or-empty cause-class writer dedup-key detector-id detector-version artifact-sha256 receipt-ref [now]
  local engine="$1" runner="$2" role="$3" klass="$4" pred="$5" cause="$6" writer="$7" dedup="$8" detid="$9" detver="${10}" art="${11}" receipt="${12}" now="${13:-}"
  local args=(strike-seat --engine "$engine" --runner "$runner" --role "$role" --class "$klass" --cause-class "$cause" --writer "$writer" --dedup-key "$dedup" --detector-id "$detid" --detector-version "$detver" --artifact-sha256 "$art" --receipt-ref "$receipt")
  if [ -n "$pred" ]; then args+=(--predicate-id "$pred"); fi
  if [ -n "$now" ]; then args+=(--now "$now"); fi
  node "$CLI" "${args[@]}"
}

invalidate_strike() {
  # engine runner role invalidates-event-id proof-artifact-sha256 proof-detector-id writer dedup-key detector-id detector-version artifact-sha256 receipt-ref [now]
  local engine="$1" runner="$2" role="$3" invid="$4" proofart="$5" proofdet="$6" writer="$7" dedup="$8" detid="$9" detver="${10}" art="${11}" receipt="${12}" now="${13:-}"
  local args=(invalidate-strike --engine "$engine" --runner "$runner" --role "$role" --invalidates-event-id "$invid" --proof-artifact-sha256 "$proofart" --proof-detector-id "$proofdet" --writer "$writer" --dedup-key "$dedup" --detector-id "$detid" --detector-version "$detver" --artifact-sha256 "$art" --receipt-ref "$receipt")
  if [ -n "$now" ]; then args+=(--now "$now"); fi
  node "$CLI" "${args[@]}"
}

# ── 0: the two mirrored seat_hash implementations agree, at every effort ──────
# engine-scorecard.js's seatIdentityHash and engine-capability-state.js's
# normalizeSeatIdentity/seatHashOf are deliberate duplicates of one two-line algorithm (the
# scripts must not shell out to each other). A divergence silently orphans every strike from the
# seat it was recorded against, and each script's own tests would stay green. This is the only
# assertion that sees both sides.
SCORECARD_CLI="$ROOT/scripts/engine-scorecard.js"
for EFFORT_CASE in "" low high none; do
  if [ -z "$EFFORT_CASE" ]; then
    STATE_H="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer | jq_get seat_hash)"
    CARD_H="$(node "$SCORECARD_CLI" seat-status --engine gpt-5 --runner codex --role implementer | jq_get seat_hash)"
    LABEL="legacy (no effort)"
  else
    STATE_H="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer --effort "$EFFORT_CASE" | jq_get seat_hash)"
    CARD_H="$(node "$SCORECARD_CLI" seat-status --engine gpt-5 --runner codex --role implementer --effort "$EFFORT_CASE" | jq_get seat_hash)"
    LABEL="effort=$EFFORT_CASE"
  fi
  if [ "$STATE_H" = "$CARD_H" ] && [ -n "$STATE_H" ]; then
    ok "0: seat_hash parity across both scripts — $LABEL"
  else
    bad "0: seat_hash parity across both scripts — $LABEL (state=$STATE_H card=$CARD_H)"
  fi
done

# Every named effort must be its OWN seat, and none of them may collide with the legacy
# partition — that collision is exactly the grok-4.6 high/low incident this partitioning fixes.
LEGACY_H="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer | jq_get seat_hash)"
LOW_H="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer --effort low | jq_get seat_hash)"
HIGH_H="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer --effort high | jq_get seat_hash)"
NONE_H="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer --effort none | jq_get seat_hash)"
if [ "$LEGACY_H" != "$LOW_H" ] && [ "$LOW_H" != "$HIGH_H" ] && [ "$LEGACY_H" != "$NONE_H" ]; then
  ok "0: legacy, low, high and none are four distinct seats"
else
  bad "0: effort partitions collided (legacy=$LEGACY_H low=$LOW_H high=$HIGH_H none=$NONE_H)"
fi

# ── 0d: strike-seat --effort → invalidate-strike --effort is a closed loop ────
# Raised by an adversarial reviewer: adding --effort to invalidate-strike's ACCEPTED options is
# not the same as wiring it into the seat identity it builds. If it were not wired, an
# invalidation would compute the LEGACY hash and target a seat no projection reads — the strike
# would be "invalidated" and keep counting. Only an end-to-end run can tell those apart.
reset_strikes
EFF_ENG=efforteng; EFF_RUN=effortrun; EFF_ROLE=implementer
node "$CLI" strike-seat --engine "$EFF_ENG" --runner "$EFF_RUN" --role "$EFF_ROLE" --effort high \
  --class ordinary_strike --cause-class engine_output --writer conformance_audit \
  --dedup-key eff-loop-1 --detector-id t --detector-version 1 \
  --artifact-sha256 "$(sha_of eff-loop-1)" --receipt-ref r-eff-1 >/dev/null 2>&1
EFF_SEAT_HASH="$(node "$CLI" seat-hash --engine "$EFF_ENG" --runner "$EFF_RUN" --role "$EFF_ROLE" --effort high | jq_get seat_hash)"
EFF_ROWS="$(grep -c "$EFF_SEAT_HASH" "$TESTDIR/strikes.jsonl" 2>/dev/null || echo 0)"
if [ "$EFF_ROWS" -ge 1 ]; then
  ok "0d: a strike written with --effort lands on the EFFORT seat hash"
else
  bad "0d: strike-seat --effort did not write to the effort seat hash ($EFF_SEAT_HASH)"
fi
# And it must NOT have landed on the legacy seat, which is what an unwired --effort would do.
LEGACY_SEAT_HASH="$(node "$CLI" seat-hash --engine "$EFF_ENG" --runner "$EFF_RUN" --role "$EFF_ROLE" | jq_get seat_hash)"
if grep -q "$LEGACY_SEAT_HASH" "$TESTDIR/strikes.jsonl" 2>/dev/null; then
  bad "0d: the strike also landed on the LEGACY seat hash — --effort is not reaching the identity"
else
  ok "0d: and NOT on the legacy seat hash"
fi
EFF_EVENT_ID="$(node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
const row = rows.filter((r) => r.seat_hash === process.argv[2] && r.kind === "strike").pop();
process.stdout.write(row ? String(row.event_id) : "");
' "$TESTDIR/strikes.jsonl" "$EFF_SEAT_HASH")"
node "$CLI" invalidate-strike --engine "$EFF_ENG" --runner "$EFF_RUN" --role "$EFF_ROLE" --effort high \
  --invalidates-event-id "$EFF_EVENT_ID" --proof-artifact-sha256 "$(sha_of eff-proof)" \
  --proof-detector-id t --writer conformance_audit --dedup-key eff-loop-inv \
  --detector-id t --detector-version 1 --artifact-sha256 "$(sha_of eff-loop-inv)" \
  --receipt-ref r-eff-inv >/dev/null 2>&1
INV_RC=$?
if [ "$INV_RC" -eq 0 ]; then
  ok "0d: invalidate-strike --effort accepts the effort-partitioned strike"
else
  bad "0d: invalidate-strike --effort failed (rc=$INV_RC) — the loop cannot close"
fi
INV_ON_EFFORT="$(node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
const inv = rows.filter((r) => r.kind === "strike_invalidated");
process.stdout.write(String(inv.filter((r) => r.seat_hash === process.argv[2]).length));
' "$TESTDIR/strikes.jsonl" "$EFF_SEAT_HASH")"
if [ "$INV_ON_EFFORT" = "1" ]; then
  ok "0d: the invalidation is recorded against the SAME seat hash as the strike"
else
  bad "0d: the invalidation landed on a different seat than the strike ($INV_ON_EFFORT on the effort seat)"
fi
reset_strikes

# ── 1: seat-hash is stable and order-independent ─────────────────────────────
H1="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer | jq_get seat_hash)"
H2="$(node "$CLI" seat-hash --role implementer --engine gpt-5 --runner codex | jq_get seat_hash)"
H3="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer | jq_get seat_hash)"
if [ -n "$H1" ] && [ "$H1" = "$H2" ] && [ "$H1" = "$H3" ] && [ "${#H1}" = "64" ]; then
  ok "1: seat-hash is stable and order-independent"
else
  bad "1: seat-hash H1=$H1 H2=$H2 H3=$H3"
fi

# ── 2: v2 append round-trips every field ──────────────────────────────────────
reset_strikes
OUT="$(strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse inc-2 det1 v1 "$SHA_A" receipt-2 2026-08-22T00:00:00Z)"
RC=$?
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
ROW_KIND="$(echo "$OUT" | jq_get kind)"
ROW_SCHEMA="$(echo "$OUT" | jq_get schema_version)"
ROW_SEATHASH="$(echo "$OUT" | jq_get seat_hash)"
ROW_ENGINE="$(echo "$OUT" | jq_get engine)"
ROW_CLASS="$(echo "$OUT" | jq_get class)"
ROW_PREDICATE="$(echo "$OUT" | jq_get predicate_id)"
ROW_CAUSE="$(echo "$OUT" | jq_get cause_class)"
ROW_WRITER="$(echo "$OUT" | jq_get writer)"
ROW_DEDUP="$(echo "$OUT" | jq_get dedup_key)"
ROW_DETID="$(echo "$OUT" | jq_get detector_id)"
ROW_DETVER="$(echo "$OUT" | jq_get detector_version)"
ROW_ART="$(echo "$OUT" | jq_get artifact_sha256)"
ROW_RECEIPT="$(echo "$OUT" | jq_get receipt_ref)"
ROW_OBS="$(echo "$OUT" | jq_get observed_at)"
ROW_INV="$(echo "$OUT" | jq_get invalidates_event_id)"
ROW_PROOFART="$(echo "$OUT" | jq_get proof_artifact_sha256)"
ROW_PROOFDET="$(echo "$OUT" | jq_get proof_detector_id)"
EXPECT_SEATHASH="$(node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer | jq_get seat_hash)"
if [ "$RC" = "0" ] && [ "$LINES" = "1" ] && [ "$ROW_KIND" = "strike" ] && [ "$ROW_SCHEMA" = "2" ] \
  && [ "$ROW_SEATHASH" = "$EXPECT_SEATHASH" ] && [ "$ROW_ENGINE" = "gpt-5" ] \
  && [ "$ROW_CLASS" = "ordinary_strike" ] && [ "$ROW_PREDICATE" = "null" ] \
  && [ "$ROW_CAUSE" = "engine_output" ] && [ "$ROW_WRITER" = "fuse" ] \
  && [ "$ROW_DEDUP" = "inc-2" ] && [ "$ROW_DETID" = "det1" ] && [ "$ROW_DETVER" = "v1" ] \
  && [ "$ROW_ART" = "$SHA_A" ] && [ "$ROW_RECEIPT" = "receipt-2" ] \
  && [ "$ROW_OBS" = "2026-08-22T00:00:00Z" ] && [ "$ROW_INV" = "null" ] \
  && [ "$ROW_PROOFART" = "null" ] && [ "$ROW_PROOFDET" = "null" ] \
  && [ -f "$TESTDIR/strikes.jsonl" ]; then
  ok "2: v2 append round-trips every field and lands in \$TESTDIR/strikes.jsonl"
else
  bad "2: rc=$RC lines=$LINES kind=$ROW_KIND schema=$ROW_SCHEMA seat=$ROW_SEATHASH class=$ROW_CLASS pred=$ROW_PREDICATE cause=$ROW_CAUSE writer=$ROW_WRITER dedup=$ROW_DEDUP det=$ROW_DETID/$ROW_DETVER art=$ROW_ART receipt=$ROW_RECEIPT obs=$ROW_OBS inv=$ROW_INV proofart=$ROW_PROOFART proofdet=$ROW_PROOFDET"
fi
REAL_STRIKES_SIZE_2B=$( [ -f "$REAL_STRIKES" ] && stat -c%s "$REAL_STRIKES" 2>/dev/null || echo 0 )
[ "$REAL_STRIKES_SIZE_2B" = "$REAL_STRIKES_SIZE_BEFORE" ] \
  && ok "2b: real ~/.autopilot/engine-capability store was NOT written (size unchanged: $REAL_STRIKES_SIZE_BEFORE)" \
  || bad "2b: real store size changed ($REAL_STRIKES_SIZE_BEFORE -> $REAL_STRIKES_SIZE_2B) — isolation leaked"

# ── 3: closed-key rejection (extra key hand-appended, then read back) ────────
reset_strikes
node -e '
const fs = require("fs");
const row = {
  schema_version: 2, event_id: 1, kind: "strike",
  seat_hash: "'"$H1"'", engine: "gpt-5", runner: "codex", role: "implementer",
  class: "ordinary_strike", predicate_id: null, cause_class: "engine_output",
  writer: "fuse", dedup_key: "k1", detector_id: "det1", detector_version: "v1",
  artifact_sha256: "'"$SHA_A"'", receipt_ref: "r1", observed_at: "2026-08-22T00:00:00Z",
  invalidates_event_id: null, proof_artifact_sha256: null, proof_detector_id: null,
  extra_unexpected_field: true,
};
fs.writeFileSync(process.argv[1], JSON.stringify(row) + "\n");
' "$TESTDIR/strikes.jsonl"
node "$CLI" seat-hash --engine gpt-5 --runner codex --role implementer >/dev/null
node -e '
const state = require("'"$ROOT"'/scripts/engine-capability-state");
try {
  state.readStrikeRows("'"$TESTDIR"'/strikes.jsonl");
  process.exit(1);
} catch (e) {
  process.exit(/unexpected key/.test(e.message) ? 0 : 2);
}
'
RC=$?
[ "$RC" = "0" ] && ok "3: closed-key rejection — extra key on a v2 row throws at read" \
  || bad "3: expected throw naming unexpected key, rc=$RC"

# ── 4: predicate_id iff-critical rule, both directions ────────────────────────
reset_strikes
strike_seat gpt-5 codex implementer critical_reexam_trigger '' engine_output fuse crit-missing-pred det1 v1 "$SHA_A" r-crit >/dev/null 2>&1
RC_MISSING=$?
strike_seat gpt-5 codex implementer ordinary_strike security_canary_disclosure engine_output fuse ord-with-pred det1 v1 "$SHA_A" r-ord >/dev/null 2>&1
RC_EXTRA=$?
strike_seat gpt-5 codex implementer critical_reexam_trigger security_canary_disclosure engine_output fuse crit-ok det1 v1 "$SHA_A" r-crit-ok >/dev/null 2>&1
RC_OK=$?
LINES="$(wc -l < "$TESTDIR/strikes.jsonl" 2>/dev/null || echo 0)"
[ "$RC_MISSING" != "0" ] && [ "$RC_EXTRA" != "0" ] && [ "$RC_OK" = "0" ] && [ "$LINES" = "1" ] \
  && ok "4: predicate_id required iff class=critical_reexam_trigger, both directions" \
  || bad "4: rc_missing=$RC_MISSING rc_extra=$RC_EXTRA rc_ok=$RC_OK lines=$LINES"

# ── 5: unregistered predicate rejected ────────────────────────────────────────
reset_strikes
strike_seat gpt-5 codex implementer critical_reexam_trigger totally_made_up_predicate engine_output fuse bad-pred det1 v1 "$SHA_A" r-bad >/dev/null 2>&1
RC=$?
LINES="$([ -f "$TESTDIR/strikes.jsonl" ] && wc -l < "$TESTDIR/strikes.jsonl" || echo 0)"
[ "$RC" != "0" ] && [ "$LINES" = "0" ] \
  && ok "5: unregistered predicate_id rejected at write" \
  || bad "5: rc=$RC lines=$LINES"

# ── 6: un-allowlisted writer rejected at write ────────────────────────────────
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output operator bad-writer det1 v1 "$SHA_A" r-bw >/dev/null 2>&1
RC=$?
LINES="$([ -f "$TESTDIR/strikes.jsonl" ] && wc -l < "$TESTDIR/strikes.jsonl" || echo 0)"
[ "$RC" != "0" ] && [ "$LINES" = "0" ] \
  && ok "6: un-allowlisted writer rejected at write" \
  || bad "6: rc=$RC lines=$LINES"

# ── 7: dedup idempotency — two identical appends, exactly ONE line, second exits 0 ─
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse dedup-inc det1 v1 "$SHA_A" r-d1 >/dev/null
FIRST_RC=$?
OUT2="$(strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse dedup-inc det1 v1 "$SHA_A" r-d1)"
SECOND_RC=$?
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
DEDUP_FLAG="$(echo "$OUT2" | jq_get deduplicated)"
[ "$FIRST_RC" = "0" ] && [ "$SECOND_RC" = "0" ] && [ "$LINES" = "1" ] && [ "$DEDUP_FLAG" = "true" ] \
  && ! grep -q '"deduplicated"' "$TESTDIR/strikes.jsonl" \
  && ok "7: dedup idempotency — one line on disk, second append exits 0 with deduplicated:true (stdout only)" \
  || bad "7: first_rc=$FIRST_RC second_rc=$SECOND_RC lines=$LINES dedup_flag=$DEDUP_FLAG"

# ── 8: strike_invalidated accepted with full proof ────────────────────────────
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse inv-base det1 v1 "$SHA_A" r-base >/dev/null
INV_OUT="$(invalidate_strike gpt-5 codex implementer 1 "$SHA_B" proofdet1 qualification_admin inv-key1 det2 v2 "$SHA_C" r-inv1)"
INV_RC=$?
INV_KIND="$(echo "$INV_OUT" | jq_get kind)"
INV_INVID="$(echo "$INV_OUT" | jq_get invalidates_event_id)"
INV_PROOFART="$(echo "$INV_OUT" | jq_get proof_artifact_sha256)"
INV_PROOFDET="$(echo "$INV_OUT" | jq_get proof_detector_id)"
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
[ "$INV_RC" = "0" ] && [ "$INV_KIND" = "strike_invalidated" ] && [ "$INV_INVID" = "1" ] \
  && [ "$INV_PROOFART" = "$SHA_B" ] && [ "$INV_PROOFDET" = "proofdet1" ] && [ "$LINES" = "2" ] \
  && ok "8: strike_invalidated accepted with full proof and lands as event_id 2" \
  || bad "8: rc=$INV_RC kind=$INV_KIND invid=$INV_INVID proofart=$INV_PROOFART proofdet=$INV_PROOFDET lines=$LINES"

# ── 9: strike_invalidated rejected without each of the three proof fields ─────
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse inv-base2 det1 v1 "$SHA_A" r-base2 >/dev/null
# missing --invalidates-event-id (CLI usage error, not a store-level one, but still must not append)
node "$CLI" invalidate-strike --engine gpt-5 --runner codex --role implementer \
  --proof-artifact-sha256 "$SHA_B" --proof-detector-id proofdet1 \
  --writer qualification_admin --dedup-key inv-missing-a --detector-id det2 --detector-version v2 \
  --artifact-sha256 "$SHA_C" --receipt-ref r-missing-a >/dev/null 2>&1
RC_A=$?
node "$CLI" invalidate-strike --engine gpt-5 --runner codex --role implementer \
  --invalidates-event-id 1 --proof-detector-id proofdet1 \
  --writer qualification_admin --dedup-key inv-missing-b --detector-id det2 --detector-version v2 \
  --artifact-sha256 "$SHA_C" --receipt-ref r-missing-b >/dev/null 2>&1
RC_B=$?
node "$CLI" invalidate-strike --engine gpt-5 --runner codex --role implementer \
  --invalidates-event-id 1 --proof-artifact-sha256 "$SHA_B" \
  --writer qualification_admin --dedup-key inv-missing-c --detector-id det2 --detector-version v2 \
  --artifact-sha256 "$SHA_C" --receipt-ref r-missing-c >/dev/null 2>&1
RC_C=$?
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
[ "$RC_A" != "0" ] && [ "$RC_B" != "0" ] && [ "$RC_C" != "0" ] && [ "$LINES" = "1" ] \
  && ok "9: strike_invalidated rejected when any of the three proof fields is missing" \
  || bad "9: rc_a=$RC_A rc_b=$RC_B rc_c=$RC_C lines=$LINES"

# ── 10: invalidates_event_id pointing at a nonexistent / foreign-seat strike rejected ─
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse seat-a det1 v1 "$SHA_A" r-seat-a >/dev/null
strike_seat gpt-4 claude-code reviewer ordinary_strike '' engine_output fuse seat-b det1 v1 "$SHA_A" r-seat-b >/dev/null
# nonexistent event id
invalidate_strike gpt-5 codex implementer 999 "$SHA_B" proofdet1 qualification_admin inv-none det2 v2 "$SHA_C" r-none >/dev/null 2>&1
RC_NONE=$?
# event 2 exists but belongs to a DIFFERENT seat (gpt-4/claude-code/reviewer) — invalidating it from gpt-5/codex/implementer must fail
invalidate_strike gpt-5 codex implementer 2 "$SHA_B" proofdet1 qualification_admin inv-foreign det2 v2 "$SHA_C" r-foreign >/dev/null 2>&1
RC_FOREIGN=$?
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
[ "$RC_NONE" != "0" ] && [ "$RC_FOREIGN" != "0" ] && [ "$LINES" = "2" ] \
  && ok "10: invalidates_event_id pointing at nonexistent or foreign-seat strike rejected" \
  || bad "10: rc_none=$RC_NONE rc_foreign=$RC_FOREIGN lines=$LINES"

# ── 11: v1 and v2 rows coexist in one file with monotonic event_id ────────────
reset_strikes
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
}));
' "$TESTDIR/identity.json"
V1_OUT1="$(node "$CLI" strike --identity-file "$TESTDIR/identity.json" --source fuse --receipt-ref v1-r1 --now 2026-08-22T00:00:01Z)"
V2_OUT1="$(strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse mono-1 det1 v1 "$SHA_A" r-mono-1 2026-08-22T00:00:02Z)"
V1_OUT2="$(node "$CLI" strike --identity-file "$TESTDIR/identity.json" --source fuse --receipt-ref v1-r2 --now 2026-08-22T00:00:03Z)"
V2_OUT2="$(strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse mono-2 det1 v1 "$SHA_A" r-mono-2 2026-08-22T00:00:04Z)"
EID1="$(echo "$V1_OUT1" | jq_get event_id)"
EID2="$(echo "$V2_OUT1" | jq_get event_id)"
EID3="$(echo "$V1_OUT2" | jq_get event_id)"
EID4="$(echo "$V2_OUT2" | jq_get event_id)"
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
if [ "$EID1" = "1" ] && [ "$EID2" = "2" ] && [ "$EID3" = "3" ] && [ "$EID4" = "4" ] && [ "$LINES" = "4" ]; then
  ok "11: v1 and v2 rows coexist in one file with monotonic event_id"
else
  bad "11: eids=$EID1,$EID2,$EID3,$EID4 lines=$LINES"
fi

# ── 12: brainSeatStatus output IDENTICAL with and without v2 rows present ────
# A "no baseline" comparison would trivially pass even with a broken v1-only
# filter (strikes never count without a baseline) — build a REAL qualified
# owner_brain_seat baseline via appendEvidenceRecord so 3 v1 strikes actually
# flip admission_status, then prove v2 rows layered on top change nothing.
reset_strikes
rm -f "$TESTDIR/qualification-evidence.jsonl"
node -e '
const state = require("'"$ROOT"'/scripts/engine-capability-state");
const identity = {
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
};
const corpusHash = "d".repeat(64);
function trial(id, observedAt) {
  return {
    trial_id: id, observed_at: observedAt, stop_reason: "completed",
    construct_scope: "per-round-exam.long-horizon-production-audit",
    plants_total: 1, plants_caught: 1, clean_false_positives: 0,
    fairness_cases_total: 0, fairness_correctness_failures: 0,
    pair_delta_count: 0, hard_fail_count: 0, ask_floor_violations: 0,
    convergence_terminal: true, economy_ok: true, verification_actions: 0,
    findings_closed: 0, spend_tokens: 100,
    decision_trace_hash: "e".repeat(64), round_stream_hash: "f".repeat(64),
    corpus_manifest_hash: corpusHash,
  };
}
const evidence = {
  schema_version: 1, source: "internal_eval", source_ref: "test-baseline-run",
  state: "qualified", role: "owner",
  scope: { task_classes: ["brain-seat"], domains: ["general"], languages: ["en"], tool_surface: [] },
  identity,
  issued_at: "2026-08-22T00:00:00.000Z", observed_at: "2026-08-22T00:00:00.000Z",
  expires_at: "2027-08-22T00:00:00.000Z",
  methodology: {
    kind: "owner_brain_seat", name: "brain-seat-exam", version: "v1", corpus_version: "v1",
    corpus_manifest_hash: corpusHash,
    thresholds: {
      min_trials: 2, min_plants_per_trial: 1, max_clean_false_positives: 0,
      max_critical_misses: 0, max_pair_deltas: 0, max_asks_on_legal_controls: 0,
    },
    basis: null,
  },
  trials: [trial("t1", "2026-08-21T23:59:00.000Z"), trial("t2", "2026-08-21T23:59:30.000Z")],
  revocation: null, supersedes: null,
};
const config = state.resolveStoreConfig({ store: "'"$TESTDIR"'" });
state.appendEvidenceRecord(config, evidence, "engine-qualify-v2");
'
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
}));
' "$TESTDIR/identity.json"
STATUS_BASELINE_ONLY="$(node "$CLI" brain-status --identity-file "$TESTDIR/identity.json" --now 2026-08-22T00:01:00Z)"
node "$CLI" strike --identity-file "$TESTDIR/identity.json" --source conformance_audit --receipt-ref v1-only-1 --now 2026-08-22T00:00:01Z >/dev/null
node "$CLI" strike --identity-file "$TESTDIR/identity.json" --source conformance_audit --receipt-ref v1-only-2 --now 2026-08-22T00:00:02Z >/dev/null
node "$CLI" strike --identity-file "$TESTDIR/identity.json" --source conformance_audit --receipt-ref v1-only-3 --now 2026-08-22T00:00:03Z >/dev/null
STATUS_V1_ONLY="$(node "$CLI" brain-status --identity-file "$TESTDIR/identity.json" --now 2026-08-22T00:01:00Z)"
V1_ONLY_STATUS_FIELD="$(echo "$STATUS_V1_ONLY" | jq_get status)"
# Now layer v2 seat-strike rows (a different keyspace entirely — seat_hash, not
# identity_hash) on top — brainSeatStatus must not move even one field.
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse noleak-1 det1 v1 "$SHA_A" r-noleak-1 2026-08-22T00:00:04Z >/dev/null
strike_seat gpt-5 codex implementer critical_reexam_trigger security_canary_disclosure engine_output fuse noleak-2 det1 v1 "$SHA_A" r-noleak-2 2026-08-22T00:00:05Z >/dev/null
STATUS_WITH_V2="$(node "$CLI" brain-status --identity-file "$TESTDIR/identity.json" --now 2026-08-22T00:01:00Z)"
if [ "$V1_ONLY_STATUS_FIELD" = "requalification_required" ] \
  && [ "$STATUS_V1_ONLY" = "$STATUS_WITH_V2" ] \
  && [ "$STATUS_BASELINE_ONLY" != "$STATUS_V1_ONLY" ]; then
  ok "12: brainSeatStatus output is byte-identical with v2 rows present in the file (real baseline + 3 v1 strikes flips status; layering v2 rows changes nothing)"
else
  bad "12: v1_only_status=$V1_ONLY_STATUS_FIELD baseline_only=$STATUS_BASELINE_ONLY v1_only=$STATUS_V1_ONLY with_v2=$STATUS_WITH_V2"
fi

# ── 13: v1 callers (appendStrikeRecord) still work — module surface unchanged ─
reset_strikes
node -e '
const state = require("'"$ROOT"'/scripts/engine-capability-state");
const config = state.resolveStoreConfig({});
const identity = {
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
};
const row = state.appendStrikeRecord(config, { identity, source: "fuse", receiptRef: "module-r1" });
if (row.schema_version !== 1 || row.event_id !== 1) process.exit(1);
'
RC=$?
LINES="$(wc -l < "$TESTDIR/strikes.jsonl")"
[ "$RC" = "0" ] && [ "$LINES" = "1" ] \
  && ok "13: appendStrikeRecord (v1 module export, used by check-stall-fuse.js / check-blueprint-conformance.js) still works" \
  || bad "13: rc=$RC lines=$LINES"
REAL_STRIKES_SIZE_13B=$( [ -f "$REAL_STRIKES" ] && stat -c%s "$REAL_STRIKES" 2>/dev/null || echo 0 )
[ "$REAL_STRIKES_SIZE_13B" = "$REAL_STRIKES_SIZE_BEFORE" ] \
  && ok "13b: module-path append did NOT write the real ~/.autopilot/engine-capability store (size unchanged: $REAL_STRIKES_SIZE_BEFORE)" \
  || bad "13b: real store size changed ($REAL_STRIKES_SIZE_BEFORE -> $REAL_STRIKES_SIZE_13B) — isolation leaked"

# ── 14: production-shaped vendor engine ids round-trip (BLOCKER 1) ────────────
# Real vendor model ids contain spaces and parentheses ("Gemini 3.5 Flash (High)")
# or slashes ("kimi-code/k3-256k") — dispatch-hetero.sh's DEFAULT seat uses exactly
# the first shape. A fixture anchored only to the synthetic "gpt-5"/"strike-engine-1"
# token would never have caught SEAT_TOKEN_RE rejecting these (evidence-discipline §13).
reset_strikes
ENGINE_SPACE="Gemini 3.5 Flash (High)"
HASH_SPACE_1="$(node "$CLI" seat-hash --engine "$ENGINE_SPACE" --runner agy --role implementer | jq_get seat_hash)"
HASH_SPACE_2="$(node "$CLI" seat-hash --engine "$ENGINE_SPACE" --runner agy --role implementer | jq_get seat_hash)"
OUT_SPACE="$(node "$CLI" strike-seat --engine "$ENGINE_SPACE" --runner agy --role implementer \
  --class ordinary_strike --cause-class ambiguous --writer dispatch_hetero_failclosed \
  --dedup-key prod-space-1 --detector-id d --detector-version 1 --artifact-sha256 "$SHA_A" \
  --receipt-ref r-space --now 2026-08-22T00:00:00Z)"
RC_SPACE=$?
ENGINE_OUT_SPACE="$(echo "$OUT_SPACE" | jq_get engine)"
SEATHASH_OUT_SPACE="$(echo "$OUT_SPACE" | jq_get seat_hash)"

ENGINE_SLASH="kimi-code/k3-256k"
OUT_SLASH="$(node "$CLI" strike-seat --engine "$ENGINE_SLASH" --runner agy --role implementer \
  --class ordinary_strike --cause-class ambiguous --writer dispatch_hetero_failclosed \
  --dedup-key prod-slash-1 --detector-id d --detector-version 1 --artifact-sha256 "$SHA_A" \
  --receipt-ref r-slash --now 2026-08-22T00:00:01Z)"
RC_SLASH=$?
ENGINE_OUT_SLASH="$(echo "$OUT_SLASH" | jq_get engine)"

LINES_14="$(wc -l < "$TESTDIR/strikes.jsonl")"
if [ -n "$HASH_SPACE_1" ] && [ "$HASH_SPACE_1" = "$HASH_SPACE_2" ] && [ "${#HASH_SPACE_1}" = "64" ] \
  && [ "$RC_SPACE" = "0" ] && [ "$ENGINE_OUT_SPACE" = "$ENGINE_SPACE" ] && [ "$SEATHASH_OUT_SPACE" = "$HASH_SPACE_1" ] \
  && [ "$RC_SLASH" = "0" ] && [ "$ENGINE_OUT_SLASH" = "$ENGINE_SLASH" ] \
  && [ "$LINES_14" = "2" ]; then
  ok "14: production-shaped vendor engine ids (space+parens, slash) round-trip through seat-hash and strike-seat"
else
  bad "14: hash1=$HASH_SPACE_1 hash2=$HASH_SPACE_2 rc_space=$RC_SPACE engine_space=$ENGINE_OUT_SPACE seathash_space=$SEATHASH_OUT_SPACE rc_slash=$RC_SLASH engine_slash=$ENGINE_OUT_SLASH lines=$LINES_14"
fi

# ── 15: dedup is class-aware — a critical trigger is NOT swallowed by an ordinary
# strike sharing a dedup_key, and a true same-class repeat still dedups (BLOCKER 4) ─
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse cls-k1 det1 v1 "$SHA_A" r-cls-1 >/dev/null
CRIT_OUT="$(strike_seat gpt-5 codex implementer critical_reexam_trigger security_canary_disclosure engine_output fuse cls-k1 det1 v1 "$SHA_A" r-cls-2)"
CRIT_CLASS="$(echo "$CRIT_OUT" | jq_get class)"
CRIT_DEDUP_FLAG="$(echo "$CRIT_OUT" | jq_get deduplicated)"
CRIT_EVENT_ID="$(echo "$CRIT_OUT" | jq_get event_id)"
LINES_15A="$(wc -l < "$TESTDIR/strikes.jsonl")"
# A true repeat of the SAME class (ordinary_strike, same dedup_key) still dedups.
REPEAT_OUT="$(strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse cls-k1 det1 v1 "$SHA_A" r-cls-3)"
REPEAT_DEDUP_FLAG="$(echo "$REPEAT_OUT" | jq_get deduplicated)"
LINES_15B="$(wc -l < "$TESTDIR/strikes.jsonl")"
if [ "$CRIT_CLASS" = "critical_reexam_trigger" ] && [ "$CRIT_DEDUP_FLAG" != "true" ] && [ "$CRIT_EVENT_ID" = "2" ] \
  && [ "$LINES_15A" = "2" ] && [ "$REPEAT_DEDUP_FLAG" = "true" ] && [ "$LINES_15B" = "2" ]; then
  ok "15: dedup is (seat_hash, dedup_key, class) — critical trigger not swallowed by ordinary strike sharing a key; same-class repeat still dedups"
else
  bad "15: crit_class=$CRIT_CLASS crit_dedup=$CRIT_DEDUP_FLAG crit_eid=$CRIT_EVENT_ID lines_a=$LINES_15A repeat_dedup=$REPEAT_DEDUP_FLAG lines_b=$LINES_15B"
fi

# ── 16: one malformed line does not brick the writer, and event_id monotonicity
# survives it (BLOCKER 6) ──────────────────────────────────────────────────────
reset_strikes
strike_seat gpt-5 codex implementer ordinary_strike '' engine_output fuse corrupt-base det1 v1 "$SHA_A" r-corrupt-base >/dev/null
echo '{"schema_version":2,"event_id":99,"kind":"strike"}' >> "$TESTDIR/strikes.jsonl"
WARN_OUT="$(node "$CLI" strike-seat --engine gpt-5 --runner codex --role implementer \
  --class ordinary_strike --cause-class engine_output --writer fuse --dedup-key corrupt-after \
  --detector-id det1 --detector-version v1 --artifact-sha256 "$SHA_A" --receipt-ref r-corrupt-after 2>&1 1>/dev/null)"
AFTER_OUT="$(node "$CLI" strike-seat --engine gpt-5 --runner codex --role implementer \
  --class ordinary_strike --cause-class engine_output --writer fuse --dedup-key corrupt-after \
  --detector-id det1 --detector-version v1 --artifact-sha256 "$SHA_A" --receipt-ref r-corrupt-after 2>/dev/null)"
AFTER_RC=$?
AFTER_EVENT_ID="$(echo "$AFTER_OUT" | jq_get event_id)"
LINES_16="$(wc -l < "$TESTDIR/strikes.jsonl")"
if [ "$AFTER_RC" = "0" ] && [ "$AFTER_EVENT_ID" = "100" ] && [ "$LINES_16" = "3" ] \
  && echo "$WARN_OUT" | grep -q 'malformed strike line 2'; then
  ok "16: a malformed line is skipped-and-warned (not thrown), writer keeps working, and event_id stays monotonic (salvaged from the corrupt line's own event_id, 99+1=100)"
else
  bad "16: rc=$AFTER_RC event_id=$AFTER_EVENT_ID lines=$LINES_16 warn=$WARN_OUT"
fi

# ── 17: brainSeatStatus keeps working over a strikes.jsonl containing a corrupt
# line (BLOCKER 6) — must not throw, must still exit 0 ─────────────────────────
rm -f "$TESTDIR/qualification-evidence.jsonl"
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
}));
' "$TESTDIR/identity.json"
BRAIN_STATUS_OUT="$(node "$CLI" brain-status --identity-file "$TESTDIR/identity.json" 2>/dev/null)"
BRAIN_STATUS_RC=$?
BRAIN_STATUS_FIELD="$(echo "$BRAIN_STATUS_OUT" | jq_get status)"
[ "$BRAIN_STATUS_RC" = "0" ] && [ "$BRAIN_STATUS_FIELD" = "no_record" ] \
  && ok "17: brainSeatStatus tolerates a corrupt strike line in the same file and still exits 0" \
  || bad "17: rc=$BRAIN_STATUS_RC status=$BRAIN_STATUS_FIELD out=$BRAIN_STATUS_OUT"

# ── 18: FINDING 4 (dedup POISONING, 2026-08-22 review repair) — a hand-written,
# structurally-valid but NON-ALLOWLISTED row must not reserve a dedup key and
# suppress the legitimate strike. Mandatory planted negative named by the
# depth-0 panel. Also re-asserts the pre-existing true-dedup behavior still
# holds for a repeat from an allowlisted writer.
reset_strikes
SCORECARD_TESTDIR="$TESTDIR/scorecard-f4"
mkdir -p "$SCORECARD_TESTDIR"
ESC="$ROOT/scripts/engine-scorecard.js"
F4_ENGINE="gpt-5"; F4_RUNNER="codex"; F4_ROLE="implementer"
F4_SEAT_HASH="$(node "$CLI" seat-hash --engine "$F4_ENGINE" --runner "$F4_RUNNER" --role "$F4_ROLE" | jq_get seat_hash)"
# A structurally-valid v2 row (passes validateStrikeV2Shape) whose writer
# "operator" is NOT in STRIKE_WRITER_ALLOWLIST — never countable at read
# time, so it must never be able to reserve the dedup key either.
node -e '
const fs = require("fs");
const row = {
  schema_version: 2, event_id: 1, kind: "strike",
  seat_hash: process.argv[1], engine: process.argv[2], runner: process.argv[3], role: process.argv[4],
  class: "ordinary_strike", predicate_id: null, cause_class: "engine_output",
  writer: "operator", dedup_key: "f4-shared-key", detector_id: "det1", detector_version: "v1",
  artifact_sha256: "'"$SHA_A"'", receipt_ref: "r-poison", observed_at: "2026-08-01T00:00:00Z",
  invalidates_event_id: null, proof_artifact_sha256: null, proof_detector_id: null,
};
fs.writeFileSync(process.argv[5], JSON.stringify(row) + "\n");
' "$F4_SEAT_HASH" "$F4_ENGINE" "$F4_RUNNER" "$F4_ROLE" "$TESTDIR/strikes.jsonl"
# The REAL writer (allowlisted: fuse) strikes the same (seat_hash, dedup_key, class)
# triple. It must be APPENDED (not deduplicated away by the poisoned row).
REAL_OUT="$(strike_seat "$F4_ENGINE" "$F4_RUNNER" "$F4_ROLE" ordinary_strike '' engine_output fuse f4-shared-key det1 v1 "$SHA_A" r-real 2026-08-02T00:00:00Z)"
REAL_RC=$?
REAL_DEDUP_FLAG="$(echo "$REAL_OUT" | jq_get deduplicated)"
REAL_EVENT_ID="$(echo "$REAL_OUT" | jq_get event_id)"
LINES_18A="$(wc -l < "$TESTDIR/strikes.jsonl")"
# Pre-existing true-dedup behavior must still hold: a REPEAT from the SAME
# allowlisted writer with the same triple still collapses to one line.
REPEAT_OUT="$(strike_seat "$F4_ENGINE" "$F4_RUNNER" "$F4_ROLE" ordinary_strike '' engine_output fuse f4-shared-key det1 v1 "$SHA_A" r-real-again 2026-08-03T00:00:00Z)"
REPEAT_RC=$?
REPEAT_DEDUP_FLAG="$(echo "$REPEAT_OUT" | jq_get deduplicated)"
LINES_18B="$(wc -l < "$TESTDIR/strikes.jsonl")"
[ "$REAL_RC" = "0" ] && [ "$REAL_DEDUP_FLAG" != "true" ] && [ "$REAL_EVENT_ID" = "2" ] && [ "$LINES_18A" = "2" ] \
  && [ "$REPEAT_RC" = "0" ] && [ "$REPEAT_DEDUP_FLAG" = "true" ] && [ "$LINES_18B" = "2" ] \
  && ok "18a: a non-allowlisted hand-written row cannot reserve a dedup key — the legitimate strike is appended, not swallowed; a true repeat from the allowlisted writer still dedups to one line" \
  || bad "18a: real_rc=$REAL_RC real_dedup=$REAL_DEDUP_FLAG real_eid=$REAL_EVENT_ID lines_a=$LINES_18A repeat_rc=$REPEAT_RC repeat_dedup=$REPEAT_DEDUP_FLAG lines_b=$LINES_18B"

# 18b: the projection (engine-scorecard.js, independently-owned read-side)
# counts exactly ONE strike from this file for this seat — the poisoned row
# was excluded from admission all along (rejected_strikes), and the fix above
# just stopped it from blocking the real one at write time.
cat <<JSON | ENGINE_SCORECARD_DIR="$SCORECARD_TESTDIR" node "$ESC" record >/dev/null 2>&1
{"engine":"$F4_ENGINE","runner":"$F4_RUNNER","family":"f","role":"$F4_ROLE","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-07-01","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-07-01","expires":"2099-01-01"}
JSON
SS_18="$(ENGINE_SCORECARD_DIR="$SCORECARD_TESTDIR" ENGINE_CAPABILITY_DIR="$TESTDIR" node "$ESC" seat-status --engine "$F4_ENGINE" --runner "$F4_RUNNER" --role "$F4_ROLE" --now 2026-08-22)"
SS_18_SP="$(echo "$SS_18" | jq_get strikes_since_pass)"
SS_18_REJ="$(echo "$SS_18" | jq_get rejected_strikes)"
[ "$SS_18_SP" = "1" ] && [ "$SS_18_REJ" = "1" ] \
  && ok "18b: projection counts exactly ONE strike (the real one) and rejects the poisoned hand-written row" \
  || bad "18b: strikes_since_pass=$SS_18_SP rejected_strikes=$SS_18_REJ out=$SS_18"

echo "----"
echo "strike-decay unit tests: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
