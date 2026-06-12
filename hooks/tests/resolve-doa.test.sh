#!/usr/bin/env bash
# resolve-doa.sh integration test — exercises preset selection, fail-closed
# behaviour, project-override config, and malformed-override resilience.
# Uses the PATH-stub pattern from lib.sh; no network required.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-doa.sh"

# Wrapper: run script with DOA_CONFIG_OVERRIDE pointing at a temp config file
run_doa() {
  DOA_CONFIG_OVERRIDE="${OVERRIDE_FILE:-/dev/null/nonexistent}" \
    bash "$SCRIPT" "$@" 2>&1
}

# ── 1. --help exits 0 and mentions the presets ─────────────────────────────
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT"         "--help exit code"
assert_contains "$HELP_OUT" "DOA"  "--help mentions DOA"

# ── 2. Missing required args → exit 2 ───────────────────────────────────────
OUT="$(bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                     "no args exit code"
assert_contains "$OUT" "missing --role"   "no args error message"

OUT="$(bash "$SCRIPT" --role implementer 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                     "missing --tier exit code"
assert_contains "$OUT" "missing --tier"   "missing --tier error message"

OUT="$(bash "$SCRIPT" --tier sonnet 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                     "missing --role exit code"
assert_contains "$OUT" "missing --role"   "missing --role error message"

# ── 3. Unknown flag → exit 2 ────────────────────────────────────────────────
OUT="$(bash "$SCRIPT" --bogus foo 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"              "unknown flag exit code"
assert_contains "$OUT" "unknown arg" "unknown flag error message"

# ── 4. cloud-high-trust: (implementer, sonnet) ──────────────────────────────
OUT="$(run_doa --role implementer --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                         "implementer/sonnet exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'   "implementer/sonnet preset"
assert_contains "$OUT" '"read_only":"autonomous"'       "implementer/sonnet read_only"
assert_contains "$OUT" '"reversible":"autonomous"'      "implementer/sonnet reversible"
assert_contains "$OUT" '"external":"logged"'            "implementer/sonnet external"
assert_contains "$OUT" '"irreversible":"escalate"'      "implementer/sonnet irreversible"
assert_contains "$OUT" '"source":"default"'             "implementer/sonnet source"

# ── 5. cloud-high-trust: fable-tier ─────────────────────────────────────────
OUT="$(run_doa --role manager --tier fable)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "manager/fable exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'  "manager/fable preset"
assert_contains "$OUT" '"external":"logged"'          "manager/fable external=logged"

# ── 6. cloud-high-trust: opus-tier ──────────────────────────────────────────
OUT="$(run_doa --role sub-orchestrator --tier opus)"; EXIT=$?
assert_eq "0" "$EXIT"                                   "sub-orchestrator/opus exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'    "sub-orchestrator/opus preset"

# ── 7. local-low-trust: (judge, flash) ──────────────────────────────────────
OUT="$(run_doa --role judge --tier flash)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "judge/flash exit code"
assert_contains "$OUT" '"preset":"local-low-trust"'   "judge/flash preset"
assert_contains "$OUT" '"read_only":"autonomous"'     "judge/flash read_only=autonomous"
assert_contains "$OUT" '"reversible":"escalate"'      "judge/flash reversible=escalate"
assert_contains "$OUT" '"external":"escalate"'        "judge/flash external=escalate"
assert_contains "$OUT" '"irreversible":"escalate"'    "judge/flash irreversible=escalate"
assert_contains "$OUT" '"source":"default"'           "judge/flash source=default"

# ── 8. local-low-trust: haiku-tier ──────────────────────────────────────────
OUT="$(run_doa --role synthesizer --tier haiku)"; EXIT=$?
assert_eq "0" "$EXIT"                               "synthesizer/haiku exit code"
assert_contains "$OUT" '"preset":"local-low-trust"' "synthesizer/haiku preset"

# ── 9. Fail-closed: unknown tier → all escalate ─────────────────────────────
OUT="$(run_doa --role implementer --tier unknowntier)"; EXIT=$?
assert_eq "0" "$EXIT"                                   "unknown tier exit code (0, not crash)"
assert_contains "$OUT" '"preset":"fail-closed-default"' "unknown tier preset=fail-closed"
assert_contains "$OUT" '"read_only":"escalate"'         "unknown tier read_only=escalate"
assert_contains "$OUT" '"reversible":"escalate"'        "unknown tier reversible=escalate"
assert_contains "$OUT" '"external":"escalate"'          "unknown tier external=escalate"
assert_contains "$OUT" '"irreversible":"escalate"'      "unknown tier irreversible=escalate"
assert_contains "$OUT" '"source":"fail-closed-default"' "unknown tier source=fail-closed-default"

# ── 10. Fail-closed: unknown role with known tier ───────────────────────────
# Spec: "unknown role or unknown tier → escalate-by-default"
# Unknown role (even with a known tier) → fail-closed.
OUT="$(run_doa --role unknownrole --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                    "unknown role/known tier exit code"
assert_contains "$OUT" '"preset":"fail-closed-default"'  "unknown role/known tier preset"
assert_contains "$OUT" '"source":"fail-closed-default"'  "unknown role/known tier source"
assert_contains "$OUT" '"read_only":"escalate"'          "unknown role/known tier read_only=escalate"

# Unknown role + unknown tier → also fail-closed
OUT="$(run_doa --role unknownrole --tier unknowntier)"; EXIT=$?
assert_eq "0" "$EXIT"                                    "unknown role/tier exit code"
assert_contains "$OUT" '"preset":"fail-closed-default"'  "unknown role/tier preset"
assert_contains "$OUT" '"source":"fail-closed-default"'  "unknown role/tier source"

# ── 11. Positional args (role tier) work the same as flags ──────────────────
OUT="$(run_doa implementer sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                  "positional args exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'   "positional args preset"
assert_contains "$OUT" '"role":"implementer"'          "positional args role in JSON"
assert_contains "$OUT" '"model_tier":"sonnet"'         "positional args tier in JSON"

# ── 12. Project override config: honored ────────────────────────────────────
OVERRIDE_DIR="$TEST_TMP/project-override"
mkdir -p "$OVERRIDE_DIR"
OVERRIDE_FILE="$OVERRIDE_DIR/doa-config.md"
cat > "$OVERRIDE_FILE" <<'CFGEOF'
# Test override config
## Project Override

| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | local-low-trust |
CFGEOF

OUT="$(run_doa --role implementer --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "override: exit code"
assert_contains "$OUT" '"preset":"local-low-trust"'  "override: preset honoured"
assert_contains "$OUT" '"source":"project"'           "override: source=project"
# Non-overridden pair falls back to default
OUT="$(run_doa --role judge --tier flash)"; EXIT=$?
assert_contains "$OUT" '"source":"default"'           "override: non-overridden falls back to default"
unset OVERRIDE_FILE

# ── 13. Malformed override → fail-closed, not crash ─────────────────────────
MALFORMED_FILE="$TEST_TMP/malformed-doa.md"
cat > "$MALFORMED_FILE" <<'BEOF'
this file has no pipe-table rows at all
just random text with | half | pipes
BEOF

OUT="$(OVERRIDE_FILE="$MALFORMED_FILE" DOA_CONFIG_OVERRIDE="$MALFORMED_FILE" \
  bash "$SCRIPT" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "malformed override: exit code (no crash)"
# Malformed file has no matching row → falls through to default tier mapping
assert_contains "$OUT" '"preset":"cloud-high-trust"' "malformed override: falls back to default"

# ── 14. Project override with unknown preset name → fail-closed ─────────────
BAD_PRESET_FILE="$TEST_TMP/bad-preset-doa.md"
cat > "$BAD_PRESET_FILE" <<'BPEOF'
## Project Override

| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | made-up-preset |
BPEOF

OUT="$(DOA_CONFIG_OVERRIDE="$BAD_PRESET_FILE" \
  bash "$SCRIPT" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                                   "bad preset name: exit code (no crash)"
assert_contains "$OUT" '"preset":"fail-closed-default"' "bad preset name: fail-closed"
assert_contains "$OUT" '"source":"fail-closed-default"' "bad preset name: source=fail-closed-default"

# ── 15. Input sanitization — shell-special chars rejected with exit 2 ──────
# Pipe in role value: 'implementer|judge' should not match the grep -iE pattern
OUT="$(bash "$SCRIPT" --role 'implementer|judge' --tier sonnet 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                                      "sanitize: pipe-in-role exits 2"
assert_contains "$OUT" "invalid --role"                    "sanitize: pipe-in-role error message"

# Wildcard in role: '.*' is a valid regex meta-char; must be rejected
OUT="$(bash "$SCRIPT" --role '.*' --tier sonnet 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                                      "sanitize: wildcard-role exits 2"
assert_contains "$OUT" "invalid --role"                    "sanitize: wildcard-role error message"

# Pipe in tier value
OUT="$(bash "$SCRIPT" --role implementer --tier 'sonnet|haiku' 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                                      "sanitize: pipe-in-tier exits 2"
assert_contains "$OUT" "invalid --tier"                    "sanitize: pipe-in-tier error message"

# Clean valid inputs still work (regression check)
OUT="$(run_doa --role implementer --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                      "sanitize: clean input still works"
assert_contains "$OUT" '"preset":"cloud-high-trust"'       "sanitize: clean input correct preset"

finalize_test
