#!/usr/bin/env bash
# resolve-review-loop-unknown-escalation.test.sh — the unknown_escalation knob
# (plan docs/plans/2026-09-07-unknown-escalation-ladder.md P2, rubric R8/R13).
# Modelled on the consult/discuss switch test: default parity (only the new
# keys are added, defaults auto/2/1/1), --field arms, on ⇒ budgets required
# (exit 3), off ⇒ capability_warnings + unknown_resolved_from off, bad values
# exit 3, and markdown-list regex scoping (a JS-literal line is not a config line).
. "$(dirname "$0")/lib.sh"

RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=j[process.argv[1]];process.stdout.write(v===undefined?"<absent>":(typeof v==="object"?JSON.stringify(v):String(v)))})' "$1"; }

# ── 1. shipped template: defaults present ──
TPL="$REPO_ROOT/project-config-template/review-loop-config.md"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TPL" bash "$RESOLVER" 2>"$TEST_TMP/tpl.err")"; RC=$?
assert_eq "0" "$RC" "resolver exits 0 on the shipped template"
assert_eq "auto" "$(printf '%s' "$OUT" | jget unknown_escalation)" "template: unknown_escalation auto"
assert_eq "2" "$(printf '%s' "$OUT" | jget unknown_budget_u1)" "template: U1 budget 2"
assert_eq "1" "$(printf '%s' "$OUT" | jget unknown_budget_u2)" "template: U2 budget 1"
assert_eq "1" "$(printf '%s' "$OUT" | jget unknown_budget_u3)" "template: U3 budget 1"
assert_eq "default" "$(printf '%s' "$OUT" | jget unknown_resolved_from)" "template: resolved_from default"

# ── 2. missing knob ⇒ auto with defaults; --field arms ──
CFG="$TEST_TMP/min.md"; printf -- '- consult_dispatch: auto\n' > "$CFG"
assert_eq "auto" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$RESOLVER" --field unknown_escalation 2>/dev/null)" "missing knob ⇒ auto"
assert_eq "2" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$RESOLVER" --field unknown_budget_u1 2>/dev/null)" "--field unknown_budget_u1 default 2"
assert_eq "default" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$RESOLVER" --field unknown_resolved_from 2>/dev/null)" "--field unknown_resolved_from default"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$RESOLVER" 2>/dev/null)"
assert_not_contains "$(printf '%s' "$OUT" | jget capability_warnings)" "unknown_escalation" "auto emits no ladder capability warning"

# ── 3. on without budgets ⇒ exit 3; on with budgets ⇒ explicit ──
CFG_ON="$TEST_TMP/on.md"; printf -- '- unknown_escalation: on\n' > "$CFG_ON"
REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON" bash "$RESOLVER" >/dev/null 2>"$TEST_TMP/on.err"; RC=$?
assert_eq "3" "$RC" "on without budgets exits 3"
assert_contains "$(cat "$TEST_TMP/on.err")" "unknown_budget_u1" "on-without-budgets message names the missing field"
printf -- '- unknown_escalation: on\n- unknown_budget_u1: 3\n- unknown_budget_u2: 1\n- unknown_budget_u3: 0\n' > "$CFG_ON"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ON" bash "$RESOLVER" 2>/dev/null)"; RC=$?
assert_eq "0" "$RC" "on with all three budgets exits 0"
assert_eq "explicit" "$(printf '%s' "$OUT" | jget unknown_resolved_from)" "on ⇒ resolved_from explicit"
assert_eq "3" "$(printf '%s' "$OUT" | jget unknown_budget_u1)" "explicit budget value carried"
assert_eq "0" "$(printf '%s' "$OUT" | jget unknown_budget_u3)" "zero is a valid explicit budget"

# ── 4. off ⇒ capability_warnings + resolved_from off, still exit 0 ──
CFG_OFF="$TEST_TMP/off.md"; printf -- '- unknown_escalation: off\n' > "$CFG_OFF"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_OFF" bash "$RESOLVER" 2>/dev/null)"; RC=$?
assert_eq "0" "$RC" "off exits 0"
assert_eq "off" "$(printf '%s' "$OUT" | jget unknown_resolved_from)" "off ⇒ resolved_from off"
assert_contains "$(printf '%s' "$OUT" | jget capability_warnings)" "unknown_escalation off" "off emits a capability_warnings line"
assert_eq "off" "$(printf '%s' "$OUT" | jget unknown_escalation)" "knob value never rewritten"

# ── 5. invalid values exit 3 ──
CFG_BAD="$TEST_TMP/bad.md"; printf -- '- unknown_escalation: maybe\n' > "$CFG_BAD"
REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_BAD" bash "$RESOLVER" >/dev/null 2>"$TEST_TMP/bad.err"; RC=$?
assert_eq "3" "$RC" "invalid knob value exits 3"
assert_contains "$(cat "$TEST_TMP/bad.err")" "auto|on|off" "invalid-knob message lists the allowed set"
printf -- '- unknown_escalation: auto\n- unknown_budget_u2: two\n' > "$CFG_BAD"
REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_BAD" bash "$RESOLVER" >/dev/null 2>"$TEST_TMP/bad2.err"; RC=$?
assert_eq "3" "$RC" "non-integer budget exits 3 even under auto"
assert_contains "$(cat "$TEST_TMP/bad2.err")" "unknown_budget_u2" "non-integer message names the field"

# ── 6. markdown-list regex scoping: a JS-literal line is not a config line ──
CFG_JS="$TEST_TMP/js.md"; printf -- "some prose mentioning unknown_escalation: 'off', in a code sample\n- consult_dispatch: auto\n" > "$CFG_JS"
assert_eq "auto" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_JS" bash "$RESOLVER" --field unknown_escalation 2>/dev/null)" "prose/JS-literal mention does not set the knob"

# ── 7. schema three-way agreement still holds with the new fields ──
node "$REPO_ROOT/scripts/check-contract-schema.js" >/dev/null 2>"$TEST_TMP/schema.err"; RC=$?
assert_eq "0" "$RC" "check-contract-schema.js agrees (fields in properties, x-field-order, required, shell case)"

finalize_test
