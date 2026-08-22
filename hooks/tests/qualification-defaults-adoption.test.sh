#!/usr/bin/env bash
# Official qualification defaults — CONSUMER ADOPTION round-trip.
#
# What this proves (and what it deliberately does not):
#   - an adopted official-default row is an ORDINARY scorecard row: admissible
#     through the unchanged dispatch-contract admission path,
#   - it accrues strikes on the SAME seat_hash a self-qualified row would,
#   - a requalify_required verdict on an adopted default names the self-qualify
#     remedy (and a self-qualified seat gets no such remedy — the branch is not
#     unconditional),
#   - a local row on the same seat is never silently shadowed by a default.
#
# Everything runs against an ISOLATED store. hooks/tests/lib.sh already exports
# ENGINE_SCORECARD_DIR / ENGINE_CAPABILITY_DIR into $TEST_TMP, and the first
# assertion below re-checks that — a green test that writes into the real store
# manufactures tomorrow's false evidence (references/evidence-discipline.md §9).
. "$(dirname "$0")/lib.sh"

ARTIFACT="$REPO_ROOT/references/official-qualification-defaults.json"
ADOPT="$REPO_ROOT/scripts/adopt-qualification-defaults.js"
SCORECARD="$REPO_ROOT/scripts/engine-scorecard.js"
CAPSTATE="$REPO_ROOT/scripts/engine-capability-state.js"

# --- 0. isolation self-check -------------------------------------------------
case "$ENGINE_SCORECARD_DIR" in
  "$TEST_TMP"/*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "isolation: ENGINE_SCORECARD_DIR ($ENGINE_SCORECARD_DIR) is not inside TEST_TMP" ;;
esac
case "$ENGINE_CAPABILITY_DIR" in
  "$TEST_TMP"/*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "isolation: ENGINE_CAPABILITY_DIR ($ENGINE_CAPABILITY_DIR) is not inside TEST_TMP" ;;
esac

assert_file_exists "$ARTIFACT" "the shipped defaults artifact is committed"

# The seat used for the strike/remedy assertions. Chosen because its
# administration date is old enough that the evidence receipt is unambiguously
# in force; --now is pinned everywhere anyway so this test never depends on the
# wall clock.
SEAT_ENGINE="grok-4.5"
SEAT_RUNNER="grok"
SEAT_ROLE="implementer"
NOW="2026-09-01"

STORE="$TEST_TMP/consumer-store"
mkdir -p "$STORE"

# Fingerprint the REAL user-local stores up front. lib.sh sandboxes $HOME only
# inside run_hook, so $HOME here is the operator's real home — the honest
# isolation check is "these bytes did not change", not "this file is absent".
REAL_SCORECARD="$HOME/.autopilot/engine-scorecard/scorecard.jsonl"
REAL_CAPABILITY="$HOME/.autopilot/engine-capability/qualification-evidence.jsonl"
fingerprint() { if [ -f "$1" ]; then wc -c <"$1" | tr -d " "; else echo absent; fi; }
REAL_SCORECARD_BEFORE=$(fingerprint "$REAL_SCORECARD")
REAL_CAPABILITY_BEFORE=$(fingerprint "$REAL_CAPABILITY")

# --- 1. list prints the verdict AND the environment it was measured in -------
LIST_OUT=$(node "$ADOPT" list --role implementer --artifact "$ARTIFACT" 2>&1)
assert_exit_code "$?" "0" "list exits 0"
assert_contains "$LIST_OUT" "DISCLOSURE, NOT ATTESTATION" "list states the ADR-0001 posture"
assert_contains "$LIST_OUT" "$SEAT_ENGINE" "list names the seat"
assert_contains "$LIST_OUT" "runner version" "list discloses the runner CLI version"
assert_contains "$LIST_OUT" "prompt config" "list discloses the prompt config hash"
assert_contains "$LIST_OUT" "corpus" "list discloses the corpus version"
assert_contains "$LIST_OUT" "ADVISORY ONLY" "list marks expires as advisory, never a gate"
assert_contains "$LIST_OUT" "self-qualify" "list always offers the self-qualify alternative"
# FAILED rows are routing information and must be visible, not filtered away.
assert_contains "$LIST_OUT" "FAILED" "list ships honest FAILED administrations too"

# --- 2. dry-run writes nothing ----------------------------------------------
node "$ADOPT" adopt --seat "$SEAT_ENGINE:$SEAT_RUNNER" --role "$SEAT_ROLE" \
  --artifact "$ARTIFACT" --store "$STORE" --dry-run >/dev/null 2>&1
assert_exit_code "$?" "0" "dry-run exits 0"
assert_file_absent "$STORE/scorecard.jsonl" "dry-run wrote no row"

# --- 3. adopt copies the row in through engine-scorecard's own validation ----
ADOPT_OUT=$(node "$ADOPT" adopt --seat "$SEAT_ENGINE:$SEAT_RUNNER" --role "$SEAT_ROLE" \
  --artifact "$ARTIFACT" --store "$STORE" 2>&1)
ADOPT_RC=$?
assert_exit_code "$ADOPT_RC" "0" "adopt exits 0 (record accepted the row: $ADOPT_OUT)"
assert_file_exists "$STORE/scorecard.jsonl" "adopt wrote the row"
assert_contains "$ADOPT_OUT" '"status": "adopted"' "adopt reports adopted"

ADOPTED_ROW=$(node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
  process.stdout.write(JSON.stringify(rows[rows.length - 1]));
' "$STORE/scorecard.jsonl")
assert_contains "$ADOPTED_ROW" '"kind":"official-default"' "the adopted row carries provenance.kind"
assert_contains "$ADOPTED_ROW" '"official_event_id":143' "provenance points back at the official event"
assert_contains "$ADOPTED_ROW" '"self_qualify_command"' "provenance names the self-qualify remedy"
# version_source is a closed enum in engine-scorecard.js; the provenance marker
# must never have been smuggled into it.
VS=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).version_source)' "$ADOPTED_ROW")
assert_neq "$VS" "official-default" "provenance did NOT overwrite the closed version_source enum"

# --- 4. the adopted row is admissible through the UNCHANGED admission path ---
CUR=$(ENGINE_SCORECARD_DIR="$STORE" node "$SCORECARD" current --role implementer --now "$NOW" 2>&1)
assert_contains "$CUR" "\"engine\":\"$SEAT_ENGINE\"" "current returns the adopted seat"
ADMISSIBLE=$(node -e '
  const rows = JSON.parse(process.argv[1]);
  const row = rows.find((r) => r.engine === process.argv[2] && r.runner === process.argv[3]);
  // Mirrors dispatch-contract.js isAdmissibleScorecardRow for the implementer role.
  const ok = !!row
    && row.admission_status !== "requalify_required"
    && (row.status === "qualified" || (row.status === "provisional" && row.observed_status === "qualified"));
  process.stdout.write(ok ? "GO" : "NO-GO");
' "$CUR" "$SEAT_ENGINE" "$SEAT_RUNNER")
assert_eq "$ADMISSIBLE" "GO" "adopted default is admissible with no change to the admission predicate"

# --- 5. seat identity parity: adopted seat_hash == the artifact's ------------
SEAT_STATUS=$(ENGINE_SCORECARD_DIR="$STORE" node "$SCORECARD" seat-status \
  --engine "$SEAT_ENGINE" --runner "$SEAT_RUNNER" --role "$SEAT_ROLE" --now "$NOW")
LIVE_HASH=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).seat_hash)' "$SEAT_STATUS")
ARTIFACT_HASH=$(node -e '
  const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const e = a.defaults.find((d) => d.seat.engine === process.argv[2]
    && d.seat.runner === process.argv[3] && d.seat.role === process.argv[4]);
  process.stdout.write(e ? e.seat_hash : "MISSING");
' "$ARTIFACT" "$SEAT_ENGINE" "$SEAT_RUNNER" "$SEAT_ROLE")
assert_eq "$LIVE_HASH" "$ARTIFACT_HASH" "artifact seat_hash equals engine-scorecard's live derivation"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).admission_status)' "$SEAT_STATUS")" \
  "qualified" "adopted seat has a qualified baseline"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).baseline_event_id))' "$SEAT_STATUS")" \
  "1" "the adopted row (local event 1) IS the baseline"

# --- 6. an adopted default is strike-able exactly like a self-qualified row --
strike_seat() {
  node "$CAPSTATE" strike-seat \
    --engine "$SEAT_ENGINE" --runner "$SEAT_RUNNER" --role "$SEAT_ROLE" \
    --class ordinary_strike --cause-class engine_output \
    --writer dispatch_hetero_failclosed \
    --dedup-key "$1" --detector-id adoption-test --detector-version 1 \
    --artifact-sha256 "$(printf '%064d' "$2")" \
    --receipt-ref "adoption-test-$1" --now "$NOW" >/dev/null 2>&1
}
strike_seat incident-a 1
strike_seat incident-b 2
strike_seat incident-c 3

STRUCK=$(ENGINE_SCORECARD_DIR="$STORE" node "$SCORECARD" seat-status \
  --engine "$SEAT_ENGINE" --runner "$SEAT_RUNNER" --role "$SEAT_ROLE" --now "$NOW")
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).strikes_since_pass))' "$STRUCK")" \
  "3" "three strikes accrued against the ADOPTED seat's seat_hash"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).would_requalify))' "$STRUCK")" \
  "true" "the fold projects would_requalify on an adopted default"

# --- 7. under enforcement, requalify_required carries the self-qualify remedy -
ENFORCED=$(ENGINE_SCORECARD_DIR="$STORE" AUTOPILOT_STRIKE_ENFORCEMENT=enforce node "$SCORECARD" seat-status \
  --engine "$SEAT_ENGINE" --runner "$SEAT_RUNNER" --role "$SEAT_ROLE" --now "$NOW")
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).admission_status)' "$ENFORCED")" \
  "requalify_required" "enforcement mode blocks the struck adopted seat"
assert_contains "$ENFORCED" "ADOPTED OFFICIAL DEFAULT" "the verdict says the seat routes on an adopted default"
assert_contains "$ENFORCED" "Re-adopting the same default cannot clear it" \
  "the verdict rules out re-adoption as a remedy"
assert_contains "$ENFORCED" "engine-qualify.sh" "the verdict names the self-qualify command"
# The remedy must ride the `current` projection too, not only seat-status —
# that is the view consumers actually read.
ENFORCED_CUR=$(ENGINE_SCORECARD_DIR="$STORE" AUTOPILOT_STRIKE_ENFORCEMENT=enforce node "$SCORECARD" current \
  --role implementer --now "$NOW")
assert_contains "$ENFORCED_CUR" "ADOPTED OFFICIAL DEFAULT" "the remedy also rides the current projection"

# --- 8. the remedy branch is CONDITIONAL, not unconditional ------------------
# A self-qualified seat that reaches requalify_required must get NO remedy line,
# otherwise the branch above would be proving nothing.
SELF_STORE="$TEST_TMP/self-store"
mkdir -p "$SELF_STORE"
node -e '
  const fs = require("fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const e = a.defaults.find((d) => d.seat.engine === process.argv[3] && d.seat.runner === process.argv[4]);
  const row = { ...e.row };            // the SAME administration, adopted-free
  delete row.provenance;               // i.e. as if locally self-qualified
  row.event_id = 1;
  fs.writeFileSync(process.argv[2], JSON.stringify(row) + "\n");
' "$ARTIFACT" "$SELF_STORE/scorecard.jsonl" "$SEAT_ENGINE" "$SEAT_RUNNER"
SELF_ENFORCED=$(ENGINE_SCORECARD_DIR="$SELF_STORE" AUTOPILOT_STRIKE_ENFORCEMENT=enforce node "$SCORECARD" seat-status \
  --engine "$SEAT_ENGINE" --runner "$SEAT_RUNNER" --role "$SEAT_ROLE" --now "$NOW")
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).admission_status)' "$SELF_ENFORCED")" \
  "requalify_required" "the same strikes block the self-qualified seat identically (same seat_hash)"
assert_not_contains "$SELF_ENFORCED" "ADOPTED OFFICIAL DEFAULT" \
  "a self-qualified seat gets NO adoption remedy — the branch is conditional"

# --- 8b. the `kind` discriminator itself is load-bearing ---------------------
# §8 above only proves the branch is off when provenance is ABSENT. That leaves
# `kind === 'official-default'` unpinned: replacing it with `true` survives §8.
# A row carrying some OTHER provenance kind must also get no adoption remedy —
# otherwise a future provenance shape inherits a message asserting it routes on
# an official default it has never heard of.
OTHER_STORE="$TEST_TMP/other-provenance-store"
mkdir -p "$OTHER_STORE"
node -e '
  const fs = require("fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const e = a.defaults.find((d) => d.seat.engine === process.argv[3] && d.seat.runner === process.argv[4]);
  const row = { ...e.row };
  row.provenance = { kind: "some-future-provenance-shape", note: "not an official default" };
  row.event_id = 1;
  fs.writeFileSync(process.argv[2], JSON.stringify(row) + "\n");
' "$ARTIFACT" "$OTHER_STORE/scorecard.jsonl" "$SEAT_ENGINE" "$SEAT_RUNNER"
OTHER_ENFORCED=$(ENGINE_SCORECARD_DIR="$OTHER_STORE" AUTOPILOT_STRIKE_ENFORCEMENT=enforce node "$SCORECARD" seat-status \
  --engine "$SEAT_ENGINE" --runner "$SEAT_RUNNER" --role "$SEAT_ROLE" --now "$NOW")
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).admission_status)' "$OTHER_ENFORCED")" \
  "requalify_required" "a non-official-default provenance seat is blocked identically"
assert_not_contains "$OTHER_ENFORCED" "ADOPTED OFFICIAL DEFAULT" \
  "the kind discriminator is load-bearing — a different provenance kind gets NO adoption remedy"

# --- 9. a local row on the same seat is never silently shadowed --------------
COLLIDE=$(node "$ADOPT" adopt --seat "$SEAT_ENGINE:$SEAT_RUNNER" --role "$SEAT_ROLE" \
  --artifact "$ARTIFACT" --store "$STORE" 2>&1)
assert_exit_code "$?" "1" "re-adopting over an existing row is refused"
assert_contains "$COLLIDE" "refused_seat_collision" "the refusal is explicit"
assert_contains "$COLLIDE" "never the other way round" "the refusal states the override direction"

# --- 10. usage teeth ---------------------------------------------------------
node "$ADOPT" adopt --artifact "$ARTIFACT" --store "$TEST_TMP/nowhere" >/dev/null 2>&1
assert_exit_code "$?" "2" "adopt without a selector is a usage error"
node "$ADOPT" --bogus-flag >/dev/null 2>&1
assert_exit_code "$?" "2" "an unknown flag is a usage error"

# --- 11. the real user-local stores were never touched ----------------------
assert_eq "$(fingerprint "$REAL_SCORECARD")" "$REAL_SCORECARD_BEFORE" \
  "isolation: the real scorecard store is byte-unchanged"
assert_eq "$(fingerprint "$REAL_CAPABILITY")" "$REAL_CAPABILITY_BEFORE" \
  "isolation: the real capability evidence store is byte-unchanged"

finalize_test
