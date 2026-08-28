#!/usr/bin/env bash
# Tests for resolve-review-loop.sh per-role heterogeneous seat routing:
#   * the consult / discuss seats (tuple discipline, enum, --field, emission)
#   * ROLE ADMISSION — an unqualified runner is refused unless an operator
#     override names that exact engine/runner/role
#   * DUAL-SEAT occupancy — default closed, opens on config, warns, and the fact
#     reaches the resolved JSON
#   * the reconciliation that keeps UNQUALIFIED_RUNNERS from silently going stale
#
# Board rulings 2026-08-27 (docs/plans/2026-08-26-cursor-cli-adaptor.md follow-up).
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
unset AUTOPILOT_QUALIFICATION_OVERRIDE

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
TEMPLATE="$REPO_ROOT/project-config-template/review-loop-config.md"

# A roster that names cursor (an UNQUALIFIED runner) in a reviewer-class seat.
CFG_REV="$TEST_TMP/cfg-cursor-reviewer.md"
cat > "$CFG_REV" <<'EOF'
- reviewer_engine: cursor-grok-4.6-high
- reviewer_effort: high
- reviewer_runner: cursor
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
EOF

# The same roster with cursor ALSO in the implementer seat (dual occupancy).
CFG_DUAL="$TEST_TMP/cfg-cursor-dual.md"
cat > "$CFG_DUAL" <<'EOF'
- reviewer_engine: cursor-grok-4.6-high
- reviewer_effort: high
- reviewer_runner: cursor
- implementer_engine: cursor-grok-4.6-high
- implementer_effort: high
- implementer_runner: cursor
EOF

CFG_DUAL_ON="$TEST_TMP/cfg-cursor-dual-on.md"
cp "$CFG_DUAL" "$CFG_DUAL_ON"
printf -- '- allow_same_runner_dual_seat: on\n' >> "$CFG_DUAL_ON"

mk_override() {
  # mk_override <file> <role>...   — an unexpired override per role, all for the
  # cursor-grok-4.6-high/cursor tuple.
  local out="$1"; shift
  local role first=1
  printf '{ "schema": 1, "overrides": [' > "$out"
  for role in "$@"; do
    [ "$first" -eq 1 ] || printf ',' >> "$out"
    first=0
    printf '{"engine":"cursor-grok-4.6-high","runner":"cursor","role":"%s","reason":"board ruling 2026-08-27","operator":"board","expires":"2099-12-31"}' "$role" >> "$out"
  done
  printf '] }\n' >> "$out"
}

# ── 1. the two new seats default empty and are emitted ──────────────────────
json="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$SCRIPT")"
assert_contains "$json" '"consult_engine": ""' "template consult_engine defaults empty"
assert_contains "$json" '"discuss_engine": ""' "template discuss_engine defaults empty"
assert_contains "$json" '"allow_same_runner_dual_seat": "off"' "dual-seat switch defaults OFF"
assert_contains "$json" '"same_runner_dual_seat": false' "no dual-seat on the shipped template"
assert_contains "$json" '"override_admitted_seats": []' "shipped template admits nothing by override"

# The shipped template must stay VALID. It is same-family (openai reviewer +
# openai implementer) and its `auto` implementer runner resolves to the
# reviewer's `codex` — a blanket same-runner/same-family gate would reject it,
# which is exactly why the dual-seat rule is scoped to override-admitted runners.
REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "shipped template still resolves (dual-seat scope must not reject it)"

# ── 2. consult/discuss tuple discipline ────────────────────────────────────
CFG_PARTIAL="$TEST_TMP/cfg-partial-consult.md"
printf -- '- consult_engine: cursor-grok-4.6-high\n' > "$CFG_PARTIAL"
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PARTIAL" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "partial consult tuple is rejected"
assert_contains "$out" "wholly empty" "partial consult tuple names the tuple rule"

CFG_BADRUN="$TEST_TMP/cfg-bad-runner.md"
cat > "$CFG_BADRUN" <<'EOF'
- consult_engine: whatever
- consult_effort: high
- consult_runner: not-a-runner
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_BADRUN" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "invalid consult_runner is rejected"
assert_contains "$out" "invalid consult_runner" "invalid consult_runner names the field"

# A QUALIFIED runner in the consult seat needs no override at all.
CFG_OKCONSULT="$TEST_TMP/cfg-ok-consult.md"
cat > "$CFG_OKCONSULT" <<'EOF'
- consult_engine: gpt-5.6-sol
- consult_effort: high
- consult_runner: codex
EOF
val="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_OKCONSULT" bash "$SCRIPT" --field consult_engine 2>/dev/null)"
assert_eq "gpt-5.6-sol" "$val" "--field consult_engine reads the configured seat"
json="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_OKCONSULT" bash "$SCRIPT" 2>/dev/null)"
assert_contains "$json" '"override_admitted_seats": []' "a qualified consult seat needs no override"

# ── 3. ROLE ADMISSION: refusal is exit 3, not a warning ────────────────────
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "unqualified runner in the reviewer seat is REFUSED (exit 3)"
assert_contains "$out" "NOT qualified for any role" "refusal says the engine is unqualified"
assert_contains "$out" "AUTOPILOT_QUALIFICATION_OVERRIDE" "refusal names the override mechanism"

# An override for a DIFFERENT role must not admit the reviewer seat. This is the
# assertion that proves admission is role-aware and not a global allowlist.
OVR_WRONG="$TEST_TMP/ovr-wrong-role.json"
mk_override "$OVR_WRONG" implementer
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_WRONG" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "an implementer-role override does NOT admit a reviewer seat"

# An EXPIRED override must not admit either.
OVR_EXPIRED="$TEST_TMP/ovr-expired.json"
printf '{ "schema": 1, "overrides": [{"engine":"cursor-grok-4.6-high","runner":"cursor","role":"reviewer","reason":"stale","operator":"board","expires":"2000-01-01"}] }\n' > "$OVR_EXPIRED"
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_EXPIRED" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "an EXPIRED override does not admit the seat"

# An override missing the operator/reason provenance must not admit.
OVR_BARE="$TEST_TMP/ovr-bare.json"
printf '{ "schema": 1, "overrides": [{"engine":"cursor-grok-4.6-high","runner":"cursor","role":"reviewer","expires":"2099-12-31"}] }\n' > "$OVR_BARE"
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_BARE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "an override without reason+operator does not admit the seat"

# ── 3b. --field mode is refused on the SAME terms as JSON mode ────────────
# First-pass qc 🔴 admission-field-bypass: the admission pass originally ran just
# before JSON emission, AFTER the --field dispatch had already returned. So
# `--field reviewer_runner` on an unqualified roster printed "cursor" with exit 0
# and no refusal at all — and the documented consult caller in
# references/hetero-dispatch.md reads the seat with exactly that flag, so the gate
# was bypassed by its own recipe. Field mode is a READ OF THE SAME RESOLVED ROSTER
# and must be refused identically.
for fld in reviewer_runner reviewer_engine consult_engine implementer_runner qc_panel; do
  out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" --field "$fld" 2>&1)"; rc=$?
  assert_eq "3" "$rc" "--field $fld is refused on an unqualified roster (no admission bypass)"
  case "$out" in
    *"NOT qualified for any role"*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
    *) fail "--field $fld leaked a value instead of refusing: $out" ;;
  esac
done

# ...and a MATCHING override lets field mode through, so the gate is not simply
# breaking every --field read.
OVR_FIELD="$TEST_TMP/ovr-field.json"
mk_override "$OVR_FIELD" reviewer
val="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_FIELD" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" --field reviewer_runner 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "--field with a matching override succeeds"
assert_eq "cursor" "$val" "--field returns the admitted runner"

# ── 4. a MATCHING override admits, loudly, and is recorded ─────────────────
OVR_OK="$TEST_TMP/ovr-reviewer.json"
mk_override "$OVR_OK" reviewer
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_OK" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>&1 >/dev/null)"
json="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_OK" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "a matching override admits the seat"
assert_contains "$out" "EVIDENCE-FREE operator override" "admission warns on stderr"
assert_contains "$out" "board ruling 2026-08-27" "the warning carries the recorded REASON"
assert_contains "$out" "2099-12-31" "the warning carries the EXPIRY"
assert_contains "$out" "not earned qualification" "the warning refuses to be read as qualification"
assert_contains "$json" '"override_admitted_seats": ["reviewer"]' "the admitted seat reaches the resolved JSON"
assert_contains "$json" '"reviewer_runner": "cursor"' "cursor is actually routed to the reviewer seat"

# ── 5. DUAL-SEAT occupancy: default closed ─────────────────────────────────
OVR_BOTH="$TEST_TMP/ovr-both.json"
mk_override "$OVR_BOTH" reviewer implementer
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_BOTH" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_DUAL" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "dual-seat occupancy is REFUSED by default even with both overrides"
assert_contains "$out" "is not decorrelation" "dual-seat refusal states the decorrelation rationale"
assert_contains "$out" "allow_same_runner_dual_seat" "dual-seat refusal names the key that opens it"

# ── 6. DUAL-SEAT occupancy: opened deliberately ────────────────────────────
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_BOTH" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_DUAL_ON" bash "$SCRIPT" 2>&1 >/dev/null)"
json="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_BOTH" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_DUAL_ON" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "allow_same_runner_dual_seat: on permits the roster"
assert_contains "$out" "allow_same_runner_dual_seat is ON" "opened dual-seat still WARNS on stderr"
assert_contains "$json" '"same_runner_dual_seat": true' "the dual-seat FACT reaches the run summary"

# ══ depth-0 QC panel round 2: four admission bypasses ══════════════════════
# Each block reproduces the reported bypass and pins the fix in BOTH directions.

# ── 6a. 🔴 #1 every SELECTABLE engine is gated, not just the primary tuple ──
# reviewer_engine_low_risk is a second selectable reviewer engine on the same
# runner. It was emitted for every low-risk round while never being gated, so an
# override for the PRIMARY engine covered a completely different, unqualified
# engine. Ruling 1 is per exact engine + runner + role.
CFG_LOW="$TEST_TMP/cfg-lowrisk.md"
cat > "$CFG_LOW" <<'EOF'
- reviewer_engine: cursor-grok-4.6-high-fast
- reviewer_effort: high
- reviewer_runner: cursor
- reviewer_engine_low_risk: cursor-grok-4.6-low
- reviewer_effort_low_risk: low
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
EOF

OVR_PRIMARY_ONLY="$TEST_TMP/ovr-primary-only.json"
printf '{ "schema": 1, "overrides": [{"engine":"cursor-grok-4.6-high-fast","runner":"cursor","role":"reviewer","reason":"primary tier only","operator":"board","expires":"2099-12-31"}] }\n' > "$OVR_PRIMARY_ONLY"
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_PRIMARY_ONLY" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_LOW" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "an override for the PRIMARY reviewer engine does NOT admit the low-risk engine"
assert_contains "$out" "reviewer_low_risk" "the refusal names the low-risk seat specifically"

# Field mode must refuse it too — the low-risk pair is readable via --field.
out="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_PRIMARY_ONLY" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_LOW" bash "$SCRIPT" --field reviewer_engine_low_risk 2>&1)"; rc=$?
assert_eq "3" "$rc" "--field reviewer_engine_low_risk is refused on an ungated low-risk engine"

# POSITIVE: list BOTH engines under role "reviewer" and both tiers admit.
OVR_BOTH_TIERS="$TEST_TMP/ovr-both-tiers.json"
printf '{ "schema": 1, "overrides": [{"engine":"cursor-grok-4.6-high-fast","runner":"cursor","role":"reviewer","reason":"primary tier","operator":"board","expires":"2099-12-31"},{"engine":"cursor-grok-4.6-low","runner":"cursor","role":"reviewer","reason":"low-risk tier","operator":"board","expires":"2099-12-31"}] }\n' > "$OVR_BOTH_TIERS"
json="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_BOTH_TIERS" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_LOW" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "both tiers overridden under role 'reviewer' resolves"
assert_contains "$json" '"override_admitted_seats": ["reviewer","reviewer_low_risk"]' "both tiers are recorded separately"

# ── 6b. 🔴 #2 a panel seat is gated independently of panel completeness ─────
# Panel seats used to be inspected only when QC_PANEL_SEATS_COMPLETE was true, so
# a cursor seat next to ONE ragged sibling was skipped entirely. An aggregate
# validity flag must never gate a per-seat security check.
CFG_RAGGED="$TEST_TMP/cfg-panel-ragged.md"
cat > "$CFG_RAGGED" <<'EOF'
- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: codex
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- qc_panel: cursor-grok-4.6-high, claude-opus, gemini-flash
- qc_panel_runners: cursor, claude-native
- qc_panel_efforts: high, high, high
- qc_panel_endpoints: @none, @none, @none
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_RAGGED" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "a cursor panel seat is refused even when the panel is INCOMPLETE"
assert_contains "$out" "qc_panel[0]" "the refusal names the specific panel index"

# The ragged panel must not become a hard error on its own — only the unqualified
# seat is fatal. Without this, the fix could be 'reject every incomplete panel'.
CFG_RAGGED_OK="$TEST_TMP/cfg-panel-ragged-ok.md"
cat > "$CFG_RAGGED_OK" <<'EOF'
- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: codex
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- qc_panel: claude-opus, gemini-flash, gpt-5.5
- qc_panel_runners: claude-native, agy
- qc_panel_efforts: high, high, high
- qc_panel_endpoints: @none, @none, @none
EOF
json="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_RAGGED_OK" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "an incomplete panel of QUALIFIED runners still resolves (0)"
assert_contains "$json" '"qc_panel_seats_complete": false' "...and is still reported incomplete"

# ── 6c. 🟠 #3 dual-seat sees QUALIFIED runners, on the CONFIGURED token ─────
# The gate used to accumulate only override-admitted runners, so a qualified
# runner in both halves of the loop sailed through. The Board's rationale has no
# qualified-engine exemption.
CFG_DUAL_Q="$TEST_TMP/cfg-dual-qualified.md"
cat > "$CFG_DUAL_Q" <<'EOF'
- reviewer_engine: gpt-5.6-sol
- reviewer_effort: high
- reviewer_runner: codex
- implementer_engine: gpt-5.6-sol
- implementer_effort: high
- implementer_runner: codex
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_DUAL_Q" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "a QUALIFIED runner in both implementer and reviewer seats is refused"
assert_contains "$out" "named explicitly in BOTH" "the refusal states the explicit-token rule"
assert_contains "$out" "both engines are qualified" "the refusal says qualification is not an exemption"

CFG_DUAL_Q_ON="$TEST_TMP/cfg-dual-qualified-on.md"
cp "$CFG_DUAL_Q" "$CFG_DUAL_Q_ON"
printf -- '- allow_same_runner_dual_seat: on\n' >> "$CFG_DUAL_Q_ON"
json="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_DUAL_Q_ON" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "the qualified dual-seat roster is accepted when deliberately opened"
assert_contains "$json" '"same_runner_dual_seat": true' "...and the fact reaches the run summary"

# THE TRAP, pinned. A comparison of RESOLVED runners would reject the shipped
# template (implementer `auto` resolves to the reviewer's `codex`) — the same
# failure mode that disqualified the model-family axis. Comparing CONFIGURED
# tokens keeps `auto` inert. These two assertions are the regression proof
# depth-0 asked for; without them the gate could tighten into a default-broken
# resolver and every test above would still pass.
REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "SHIPPED TEMPLATE still resolves (implementer 'auto' must not collide with reviewer 'codex')"
DOGFOOD="$REPO_ROOT/.claude/review-loop-config.md"
if [ -r "$DOGFOOD" ]; then
  REVIEW_LOOP_CONFIG_OVERRIDE="$DOGFOOD" bash "$SCRIPT" >/dev/null 2>&1
  assert_eq "0" "$?" "this repo's own dogfood roster still resolves"
else
  fail "dogfood roster $DOGFOOD is unreadable — the regression proof cannot run"
fi

# `auto` is inert as a token, not merely tolerated by accident: naming `auto` in
# the implementer seat next to a reviewer that is also somehow `auto` cannot trip.
CFG_AUTO="$TEST_TMP/cfg-auto-both.md"
cat > "$CFG_AUTO" <<'EOF'
- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: auto
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
EOF
REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_AUTO" bash "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "'auto' in both seats is not a rail collision (it is a delegation, not an identity)"

# ── 6c2. qc_panel is governed on the runner axis, PROPORTIONATELY ──────────
# Consult ruling (E): the panel is deliberately NOT subject to the binary loop
# gate. It is a multi-seat body (min_panel_size 3, union-on-verified-critical,
# majority forbidden), so one seat sharing the implementer's rail still leaves
# seats that each block alone. But it needs the RUNNER axis, because its
# pre-existing control is family-based and one rail serves several families.
# Partial overlap warns; only TOTAL overlap refuses.
CFG_PANEL_PARTIAL="$TEST_TMP/cfg-panel-partial-overlap.md"
cat > "$CFG_PANEL_PARTIAL" <<'EOF'
- reviewer_engine: claude-opus
- reviewer_effort: high
- reviewer_runner: claude-native
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: codex
- qc_panel: gpt-5.5, claude-opus, gemini-flash
- qc_panel_runners: codex, claude-native, agy
- qc_panel_efforts: xhigh, high, high
- qc_panel_endpoints: @none, @none, @none
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_PARTIAL" bash "$SCRIPT" 2>&1 >/dev/null)"
json="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_PARTIAL" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "ONE panel seat on the implementer's runner is PERMITTED (the others still decorrelate)"
# ...and it is SILENT. The shipped default panel is codex/claude-native/agy, so a
# codex implementer overlaps one seat in the repo's own RECOMMENDED setup — a
# warning there is noise, and it demonstrably broke dispatch-author.sh
# --strict-contract by turning the extra stderr line into an empty result.
# Partial overlap is still visible through the pre-existing cross-family control.
case "$out" in
  *"run on the implementer's own runner"*) fail "partial panel overlap must not emit a runner-overlap warning (it fires on the shipped default panel)" ;;
  *) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
esac
assert_contains "$json" '"same_runner_dual_seat": false' "partial panel overlap is NOT a decorrelation loss worth flagging"

# TOTAL overlap: no runner decorrelation anywhere in the terminal gate.
CFG_PANEL_TOTAL="$TEST_TMP/cfg-panel-total-overlap.md"
cat > "$CFG_PANEL_TOTAL" <<'EOF'
- reviewer_engine: claude-opus
- reviewer_effort: high
- reviewer_runner: claude-native
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: codex
- qc_panel: gpt-5.5, gpt-5.6-sol, gpt-5.3-codex-spark
- qc_panel_runners: codex, codex, codex
- qc_panel_efforts: xhigh, high, high
- qc_panel_endpoints: @none, @none, @none
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_TOTAL" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "a panel ENTIRELY on the implementer's runner is refused"
assert_contains "$out" "no runner decorrelation at all" "total panel overlap names the actual loss"

CFG_PANEL_TOTAL_ON="$TEST_TMP/cfg-panel-total-on.md"
cp "$CFG_PANEL_TOTAL" "$CFG_PANEL_TOTAL_ON"
printf -- '- allow_same_runner_dual_seat: on\n' >> "$CFG_PANEL_TOTAL_ON"
json="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_TOTAL_ON" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "total panel overlap is openable with the same explicit key"
assert_contains "$json" '"same_runner_dual_seat": true' "...and is recorded"

# The panel must NOT be dragged into the binary LOOP gate. CFG_PANEL_PARTIAL above
# already proves the permitted case; assert the refusal it produced named the PANEL
# rule and never the loop rule, so a future change cannot quietly merge the two.
out_partial="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_PARTIAL" bash "$SCRIPT" 2>&1 >/dev/null)"
case "$out_partial" in
  *"named explicitly in BOTH"*) fail "panel overlap must not trigger the loop-seat refusal message" ;;
  *) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
esac

# ── 6c3. an ORPHAN panel row must not dilute the diversity ratio ───────────
# Re-review of the round-2 fixes: a ragged index carrying a runner but NO engine
# is unusable — it cannot review anything — yet it was counted as a panel seat.
# Every engine-bearing seat could then sit on the implementer's own rail while
# the orphan kept overlap < total, downgrading a TOTAL loss of runner
# decorrelation to a mere warning. Diversity now counts engine-bearing seats only.
CFG_PANEL_ORPHAN="$TEST_TMP/cfg-panel-orphan.md"
cat > "$CFG_PANEL_ORPHAN" <<'EOF'
- reviewer_engine: claude-opus
- reviewer_effort: high
- reviewer_runner: claude-native
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: codex
- qc_panel: gpt-5.5, gpt-5.6-sol
- qc_panel_runners: codex, codex, agy
- qc_panel_efforts: xhigh, high, high
- qc_panel_endpoints: @none, @none, @none
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_ORPHAN" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "an engine-less orphan runner row cannot mask TOTAL panel overlap"
assert_contains "$out" "(2 of 2)" "diversity counts only the engine-bearing seats"

# ...but the orphan row is still ADMISSION-gated: it can name an unqualified rail
# even though it cannot review. The two sets are deliberately different.
CFG_PANEL_ORPHAN_CURSOR="$TEST_TMP/cfg-panel-orphan-cursor.md"
cat > "$CFG_PANEL_ORPHAN_CURSOR" <<'EOF'
- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: codex
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- qc_panel: claude-opus, gemini-flash
- qc_panel_runners: claude-native, agy, cursor
- qc_panel_efforts: high, high, high
- qc_panel_endpoints: @none, @none, @none
EOF
out="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_PANEL_ORPHAN_CURSOR" bash "$SCRIPT" 2>&1)"; rc=$?
assert_eq "3" "$rc" "an engine-less panel row naming an UNQUALIFIED runner is still refused"
assert_contains "$out" "qc_panel[2]" "the orphan row is admission-gated by index"

# ── 6d. 🟠 #4 an admission that cannot be RECORDED is not granted ───────────
# override_admitted_seats is the auditable record Ruling 1 requires. The append
# used to fall back to the previous array on failure, so an evidence-free
# admission could succeed while vanishing from the record. Shim `node` so ONLY
# the recording call fails (keyed on that script's unique body), and prove the
# resolver refuses instead of admitting silently.
REAL_NODE="$(command -v node)"
[ -n "$REAL_NODE" ] || fail "node not found on PATH — cannot run the recording-failure test"
SHIM_DIR="$TEST_TMP/nodeshim"
mkdir -p "$SHIM_DIR"
cat > "$SHIM_DIR/node" <<EOF
#!/usr/bin/env bash
# Fail ONLY the override-recording append, identified by its unique script body.
if [ "\$1" = "-e" ] && case "\$2" in *"a.push(process.argv[2])"*) true ;; *) false ;; esac; then
  exit 1
fi
exec "$REAL_NODE" "\$@"
EOF
chmod +x "$SHIM_DIR/node"

# sanity: the shim is otherwise transparent — the same roster resolves through it
json="$(PATH="$SHIM_DIR:$PATH" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_OK" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "3" "$rc" "an override-admitted seat whose record cannot be written is REFUSED, not admitted"
out="$(PATH="$SHIM_DIR:$PATH" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_OK" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>&1 >/dev/null)"
assert_contains "$out" "could NOT be recorded" "the refusal explains that the record is the point"

# ...and with the shim absent the SAME roster admits, proving the shim is what
# changed the outcome rather than some unrelated breakage.
json="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR_OK" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_REV" bash "$SCRIPT" 2>/dev/null)"; rc=$?
assert_eq "0" "$rc" "control: without the shim the same roster admits"
assert_contains "$json" '"override_admitted_seats": ["reviewer"]' "control: and records the seat"

# ── 7. UNQUALIFIED_RUNNERS reconciliation ──────────────────────────────────
# The resolver's list is an inline seed table. This is the same-commit ritual
# that stops it going stale: every runner token that IS nameable in a roster and
# whose harness capability record says "unverified" must appear in the list.
# Without this, onboarding a second unverified rail would silently route it with
# no override — the "a script existing is not evidence it is running" failure.
DECLARED="$(grep -E '^UNQUALIFIED_RUNNERS=' "$SCRIPT" | sed -E 's/^UNQUALIFIED_RUNNERS="([^"]*)".*/\1/')"
[ -n "$DECLARED" ] || fail "could not extract UNQUALIFIED_RUNNERS from $SCRIPT — the extraction pattern is stale"

# Runner tokens the schema says a roster can name, minus the non-engine ones.
NAMEABLE="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const out = new Set();
const walk = (o) => {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o.enum) && o.enum.includes("codex")) for (const v of o.enum) if (v) out.add(v);
  for (const k of Object.keys(o)) walk(o[k]);
};
walk(s);
out.delete("auto");
process.stdout.write([...out].join(" "));
' "$REPO_ROOT/schemas/review-loop-contract.schema.json")"

for cap in "$REPO_ROOT"/src/harness/capabilities/*.json; do
  name="$(basename "$cap" .json)"
  status="$(node -e 'process.stdout.write(String((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)||""))' "$cap")"
  [ "$status" = "unverified" ] || continue
  # only runners a roster can actually name matter here
  case " $NAMEABLE " in *" $name "*) ;; *) continue ;; esac
  case " $DECLARED " in
    *" $name "*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
    *) fail "runner '$name' is nameable in a roster and its capability record is 'unverified', but it is MISSING from UNQUALIFIED_RUNNERS in resolve-review-loop.sh — it would route with no operator override" ;;
  esac
done

# And the converse: nothing in the list may be a runner the roster cannot name,
# which would make the entry dead text that protects nothing.
for r in $DECLARED; do
  case " $NAMEABLE " in
    *" $r "*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
    *) fail "UNQUALIFIED_RUNNERS names '$r', which is not a runner token any roster can name — a stale entry that gates nothing" ;;
  esac
done

finalize_test
