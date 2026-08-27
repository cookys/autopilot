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
