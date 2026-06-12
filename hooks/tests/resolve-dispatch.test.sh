#!/usr/bin/env bash
# resolve-dispatch.sh integration test — exercises legacy table, tree table,
# manager refusal, project-override config, input sanitization, and
# malformed-override resilience.
# Uses the PATH-stub pattern from lib.sh; no network required.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-dispatch.sh"

# Wrapper: run script with MODEL_ROUTING_CONFIG_OVERRIDE pointing at a temp
# config file (or /dev/null/nonexistent to suppress project override).
run_dispatch() {
  MODEL_ROUTING_CONFIG_OVERRIDE="${OVERRIDE_FILE:-/dev/null/nonexistent}" \
    bash "$SCRIPT" "$@" 2>&1
}

# run_dispatch_split <stdout_var> <stderr_var> <exit_var> <args...>
# Captures stdout and stderr separately (handles non-zero exits safely).
run_dispatch_split() {
  local out_var="$1" err_var="$2" exit_var="$3"
  shift 3
  local stdout_file="$TEST_TMP/.stdout.$$"
  local stderr_file="$TEST_TMP/.stderr.$$"
  local ec=0
  MODEL_ROUTING_CONFIG_OVERRIDE="${OVERRIDE_FILE:-/dev/null/nonexistent}" \
    bash "$SCRIPT" "$@" >"$stdout_file" 2>"$stderr_file" || ec=$?
  eval "$out_var=$(printf '%q' "$(cat "$stdout_file")")"
  eval "$err_var=$(printf '%q' "$(cat "$stderr_file")")"
  eval "$exit_var=$ec"
  rm -f "$stdout_file" "$stderr_file"
}

# ── 1. --help exits 0 ─────────────────────────────────────────────────────
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT"              "--help exit code"
assert_contains "$HELP_OUT" "resolve-dispatch"  "--help mentions script name"

# ── 2. Missing required args → exit 2 ────────────────────────────────────
OUT="$(bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                   "no args exit code"
assert_contains "$OUT" "missing --role" "no args error message"

# ── 3. Unknown flag → exit 2 ─────────────────────────────────────────────
OUT="$(bash "$SCRIPT" --bogus foo 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                   "unknown flag exit code"
assert_contains "$OUT" "unknown arg"    "unknown flag error message"

# ── 4. Legacy table: all 7 roles return today's exact values ─────────────
# planner → sonnet/plan
OUT="$(run_dispatch --role planner)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy planner exit code"
assert_contains "$OUT" '"model":"sonnet"'                    "legacy planner model=sonnet"
assert_contains "$OUT" '"mode":"plan"'                       "legacy planner mode=plan"
assert_contains "$OUT" '"agent":"autopilot:planner"'         "legacy planner agent"
assert_contains "$OUT" '"source":"default"'                  "legacy planner source=default"
assert_not_contains "$OUT" '"table"'                         "legacy planner no table field"

# reviewer → sonnet/plan
OUT="$(run_dispatch --role reviewer)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy reviewer exit code"
assert_contains "$OUT" '"model":"sonnet"'                    "legacy reviewer model=sonnet"
assert_contains "$OUT" '"mode":"plan"'                       "legacy reviewer mode=plan"
assert_contains "$OUT" '"agent":"autopilot:reviewer"'        "legacy reviewer agent"
assert_not_contains "$OUT" '"table"'                         "legacy reviewer no table field"

# debugger → sonnet/plan
OUT="$(run_dispatch --role debugger)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy debugger exit code"
assert_contains "$OUT" '"model":"sonnet"'                    "legacy debugger model=sonnet"
assert_contains "$OUT" '"mode":"plan"'                       "legacy debugger mode=plan"
assert_contains "$OUT" '"agent":"autopilot:debugger"'        "legacy debugger agent"
assert_not_contains "$OUT" '"table"'                         "legacy debugger no table field"

# implementer → opus/default (specifically asserted)
OUT="$(run_dispatch --role implementer)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy implementer exit code"
assert_contains "$OUT" '"model":"opus"'                      "legacy implementer model=opus (specific check)"
assert_contains "$OUT" '"mode":"default"'                    "legacy implementer mode=default"
assert_contains "$OUT" '"agent":""'                          "legacy implementer agent empty"
assert_not_contains "$OUT" '"table"'                         "legacy implementer no table field (byte-stability proxy)"

# test-runner → haiku/default
OUT="$(run_dispatch --role test-runner)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy test-runner exit code"
assert_contains "$OUT" '"model":"haiku"'                     "legacy test-runner model=haiku"
assert_contains "$OUT" '"mode":"default"'                    "legacy test-runner mode=default"
assert_not_contains "$OUT" '"table"'                         "legacy test-runner no table field"

# researcher → sonnet/default
OUT="$(run_dispatch --role researcher)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy researcher exit code"
assert_contains "$OUT" '"model":"sonnet"'                    "legacy researcher model=sonnet"
assert_contains "$OUT" '"mode":"default"'                    "legacy researcher mode=default"
assert_not_contains "$OUT" '"table"'                         "legacy researcher no table field"

# think-tank-role → sonnet/plan
OUT="$(run_dispatch --role think-tank-role)"; EXIT=$?
assert_eq "0" "$EXIT"                                        "legacy think-tank-role exit code"
assert_contains "$OUT" '"model":"sonnet"'                    "legacy think-tank-role model=sonnet"
assert_contains "$OUT" '"mode":"plan"'                       "legacy think-tank-role mode=plan"
assert_not_contains "$OUT" '"table"'                         "legacy think-tank-role no table field"

# ── 5. Unknown legacy role → exit 1 ──────────────────────────────────────
OUT="$(run_dispatch --role unknownrole 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT"                    "unknown legacy role exit code"
assert_contains "$OUT" "unknown role"    "unknown legacy role error message"

# ── 6. Tree table: all 6 dispatchable roles return spec values ────────────
# sub-orchestrator → opus/default
OUT="$(run_dispatch --role sub-orchestrator --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                                "tree sub-orchestrator exit code"
assert_contains "$OUT" '"model":"opus"'              "tree sub-orchestrator model=opus"
assert_contains "$OUT" '"mode":"default"'            "tree sub-orchestrator mode=default"
assert_contains "$OUT" '"table":"tree"'              "tree sub-orchestrator table=tree"
assert_contains "$OUT" '"source":"default"'          "tree sub-orchestrator source=default"

# planner → sonnet/plan
OUT="$(run_dispatch --role planner --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                                "tree planner exit code"
assert_contains "$OUT" '"model":"sonnet"'            "tree planner model=sonnet"
assert_contains "$OUT" '"mode":"plan"'               "tree planner mode=plan"
assert_contains "$OUT" '"table":"tree"'              "tree planner table=tree"

# researcher → sonnet/default
OUT="$(run_dispatch --role researcher --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                                "tree researcher exit code"
assert_contains "$OUT" '"model":"sonnet"'            "tree researcher model=sonnet"
assert_contains "$OUT" '"mode":"default"'            "tree researcher mode=default"
assert_contains "$OUT" '"table":"tree"'              "tree researcher table=tree"

# implementer → sonnet/default (specifically asserted — differs from legacy opus)
OUT="$(run_dispatch --role implementer --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                                "tree implementer exit code"
assert_contains "$OUT" '"model":"sonnet"'            "tree implementer model=sonnet (not opus)"
assert_contains "$OUT" '"mode":"default"'            "tree implementer mode=default"
assert_contains "$OUT" '"table":"tree"'              "tree implementer table=tree"
assert_contains "$OUT" '"source":"default"'          "tree implementer source=default"

# judge → haiku/plan
OUT="$(run_dispatch --role judge --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                                "tree judge exit code"
assert_contains "$OUT" '"model":"haiku"'             "tree judge model=haiku"
assert_contains "$OUT" '"mode":"plan"'               "tree judge mode=plan"
assert_contains "$OUT" '"table":"tree"'              "tree judge table=tree"

# synthesizer → haiku/plan
OUT="$(run_dispatch --role synthesizer --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                                "tree synthesizer exit code"
assert_contains "$OUT" '"model":"haiku"'             "tree synthesizer model=haiku"
assert_contains "$OUT" '"mode":"plan"'               "tree synthesizer mode=plan"
assert_contains "$OUT" '"table":"tree"'              "tree synthesizer table=tree"

# ── 7. Manager --tree → exit 3, stderr MANAGER_NOT_DISPATCHABLE ──────────
run_dispatch_split MGOUT MGERR MGEXIT --role manager --tree
assert_eq "3" "$MGEXIT"                              "manager --tree exit code = 3"
assert_contains "$MGERR" "MANAGER_NOT_DISPATCHABLE"  "manager --tree stderr has MANAGER_NOT_DISPATCHABLE"

# ── 8. Unknown role with --tree → exit 1 ─────────────────────────────────
OUT="$(run_dispatch --role unknownrole --tree 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT"                                "unknown tree role exit code"
assert_contains "$OUT" "unknown tree role"           "unknown tree role error message"

# ── 9. Override file via MODEL_ROUTING_CONFIG_OVERRIDE ───────────────────
OVERRIDE_DIR="$TEST_TMP/project-override"
mkdir -p "$OVERRIDE_DIR"
OVERRIDE_FILE="$OVERRIDE_DIR/routing-config.md"
cat > "$OVERRIDE_FILE" <<'CFGEOF'
# Test override config
## Project Model Routing

| Role | Model | Mode |
|------|-------|------|
| implementer | sonnet | plan |
| tree:implementer | haiku | default |
CFGEOF

# (a) tree:implementer row honored with --tree → source=project, table=tree
OUT="$(run_dispatch --role implementer --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                            "override tree: exit code"
assert_contains "$OUT" '"model":"haiku"'         "override tree: model from tree: row"
assert_contains "$OUT" '"mode":"default"'        "override tree: mode from tree: row"
assert_contains "$OUT" '"table":"tree"'          "override tree: table=tree"
assert_contains "$OUT" '"source":"project"'      "override tree: source=project"

# (b) bare implementer row still resolves legacy lookups
OUT="$(run_dispatch --role implementer)"; EXIT=$?
assert_eq "0" "$EXIT"                            "override legacy: exit code"
assert_contains "$OUT" '"model":"sonnet"'         "override legacy: bare implementer row honored"
assert_contains "$OUT" '"mode":"plan"'            "override legacy: mode from bare row"
assert_contains "$OUT" '"source":"project"'       "override legacy: source=project"
assert_not_contains "$OUT" '"table"'              "override legacy: no table field"

# (c) config with ONLY bare implementer does NOT match --tree (falls back to tree default sonnet)
OVERRIDE_FILE="$OVERRIDE_DIR/bare-only.md"
cat > "$OVERRIDE_FILE" <<'CFGEOF'
| Role | Model | Mode |
|------|-------|------|
| implementer | haiku | plan |
CFGEOF
OUT="$(run_dispatch --role implementer --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                            "bare-only config: tree fallback exit code"
assert_contains "$OUT" '"model":"sonnet"'         "bare-only config: tree falls back to sonnet default (not haiku)"
assert_contains "$OUT" '"source":"default"'       "bare-only config: tree source=default"
assert_contains "$OUT" '"table":"tree"'           "bare-only config: tree table present"

# (d) config with ONLY tree:implementer does NOT match legacy lookups (falls back to opus)
OVERRIDE_FILE="$OVERRIDE_DIR/tree-only.md"
cat > "$OVERRIDE_FILE" <<'CFGEOF'
| Role | Model | Mode |
|------|-------|------|
| tree:implementer | haiku | plan |
CFGEOF
OUT="$(run_dispatch --role implementer)"; EXIT=$?
assert_eq "0" "$EXIT"                            "tree-only config: legacy fallback exit code"
assert_contains "$OUT" '"model":"opus"'           "tree-only config: legacy falls back to opus default"
assert_contains "$OUT" '"source":"default"'       "tree-only config: legacy source=default"
assert_not_contains "$OUT" '"table"'              "tree-only config: legacy no table field"

unset OVERRIDE_FILE

# ── 10. Input sanitization ────────────────────────────────────────────────
# Pipe in role value: 'implementer|judge' rejected → exit 2
OUT="$(bash "$SCRIPT" --role 'implementer|judge' 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                            "sanitize: pipe-in-role exits 2"
assert_contains "$OUT" "invalid --role"          "sanitize: pipe-in-role error message"

# Wildcard: '.*' is regex meta-char; must be rejected
OUT="$(bash "$SCRIPT" --role '.*' 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                            "sanitize: wildcard-role exits 2"
assert_contains "$OUT" "invalid --role"          "sanitize: wildcard-role error message"

# Pipe with --tree
OUT="$(bash "$SCRIPT" --role 'implementer|judge' --tree 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                            "sanitize: pipe-in-role --tree exits 2"
assert_contains "$OUT" "invalid --role"          "sanitize: pipe-in-role --tree error message"

# Clean valid inputs still work (regression)
OUT="$(run_dispatch --role implementer)"; EXIT=$?
assert_eq "0" "$EXIT"                            "sanitize: clean legacy still works"
assert_contains "$OUT" '"model":"opus"'           "sanitize: clean legacy correct model"

OUT="$(run_dispatch --role implementer --tree)"; EXIT=$?
assert_eq "0" "$EXIT"                            "sanitize: clean tree still works"
assert_contains "$OUT" '"model":"sonnet"'         "sanitize: clean tree correct model"

# ── 11. Malformed override → no crash, falls back to defaults ────────────
MALFORMED_FILE="$TEST_TMP/malformed-routing.md"
cat > "$MALFORMED_FILE" <<'BEOF'
this file has no pipe-table rows at all
just random text with | half | pipes
BEOF

OUT="$(MODEL_ROUTING_CONFIG_OVERRIDE="$MALFORMED_FILE" \
  bash "$SCRIPT" --role implementer 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                            "malformed legacy: exit code (no crash)"
assert_contains "$OUT" '"model":"opus"'           "malformed legacy: falls back to opus default"

OUT="$(MODEL_ROUTING_CONFIG_OVERRIDE="$MALFORMED_FILE" \
  bash "$SCRIPT" --role implementer --tree 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                            "malformed tree: exit code (no crash)"
assert_contains "$OUT" '"model":"sonnet"'         "malformed tree: falls back to sonnet default"
assert_contains "$OUT" '"table":"tree"'           "malformed tree: table=tree still present"

# ── 12. --help must not leak implementation code ──────────────────────────
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"
assert_not_contains "$HELP_OUT" "set -euo pipefail" "--help does not leak code (set -euo)"
assert_not_contains "$HELP_OUT" 'TREE_MODE=0'       "--help does not leak code (TREE_MODE)"

# ── 13. Override-row model/mode injection → row ignored, fall back ────────
INJECT_FILE="$TEST_TMP/inject-routing.md"
cat > "$INJECT_FILE" <<'IEOF'
| Role | Model | Mode |
|------|-------|------|
| tree:implementer | sonnet","injected":"true | default |
| implementer | bad"value | plan |
IEOF

OUT="$(MODEL_ROUTING_CONFIG_OVERRIDE="$INJECT_FILE" \
  bash "$SCRIPT" --role implementer --tree 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                             "inject tree: exit code (no crash)"
assert_not_contains "$OUT" '"injected"'            "inject tree: crafted field NOT in output"
assert_contains "$OUT" '"model":"sonnet"'          "inject tree: falls back to tree default"
assert_contains "$OUT" '"source":"default"'        "inject tree: source=default (row ignored)"
assert_contains "$OUT" "warning: ignoring override row" "inject tree: loud stderr warning"

OUT="$(MODEL_ROUTING_CONFIG_OVERRIDE="$INJECT_FILE" \
  bash "$SCRIPT" --role implementer 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                             "inject legacy: exit code (no crash)"
assert_not_contains "$OUT" 'bad"value'             "inject legacy: crafted value NOT in output"
assert_contains "$OUT" '"model":"opus"'            "inject legacy: falls back to opus default"

finalize_test
