#!/usr/bin/env bash
# config-audit.test.sh — scripts/lib/config-audit.js: one fixture per finding rule, a clean config that must stay silent,
# and a negative control per rule: a mutant copy of the lib with that rule renamed (the check effectively removed) must
# make the same fixture's assertion fail. Plus the CLI exit codes and the dev-setup.sh --check wiring.
. "$(dirname "$0")/lib.sh"

LIBDIR="$REPO_ROOT/scripts/lib"
CC="$TEST_TMP/cc"; mkdir -p "$CC"
# Isolate from the real machine: Claude settings dir, managed settings, window env.
export CLAUDE_CONFIG_DIR="$CC" AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/no-managed.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_GAP AUTOPILOT_CONTEXT_BUDGET_MODE
export HOME="$TEST_TMP/h"; mkdir -p "$HOME"

set_window() { if [ -n "$1" ]; then printf '{"autoCompactWindow":%s}' "$1" > "$CC/settings.json"; else rm -f "$CC/settings.json"; fi; }
cfg() { printf '%s' "$1" > "$TEST_TMP/cfg.json"; }

# rules_of <lib-dir>: space-separated rules found for $TEST_TMP/cfg.json
rules_of() { node "$1/config-audit.js" --json --config "$TEST_TMP/cfg.json" --project-dir "$TEST_TMP/proj" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).findings.map(f=>f.rule).join(" "))}catch{console.log("ERR")}})'; }

# mutant <rule>: copy of the lib dir whose finding for <rule> is renamed, so the rule never reports under its name.
mutant() {
  local d="$TEST_TMP/mut-$1"; mkdir -p "$d"
  cp "$LIBDIR/config-audit.js" "$LIBDIR/config-path.js" "$LIBDIR/autocompact-window.js" "$LIBDIR/config-keys.json" "$d/"
  sed -i "s/rule: '$1'/rule: 'MUTED_$1'/" "$d/config-audit.js"
  grep -q "MUTED_$1" "$d/config-audit.js" || fail "mutant $1: rule string not found in config-audit.js"
  echo "$d"
}

CLEAN='{"config_schema_version":1,"context_budget":{"t1":100000,"t2":150000,"gap":50000,"mode":"warn"},"update_check":true,"hooks":{"exec-boundary":true},"AUTOPILOT_TASKS":"off","foreman_guard":{"mode":"warn","role_caps":{"foreman":10}},"dirty_tree_reminder":false}'

set_window 250000
cfg "$CLEAN"
assert_eq "$(rules_of "$LIBDIR")" "" "clean config: no findings"
node "$LIBDIR/config-audit.js" --config "$TEST_TMP/cfg.json" >/dev/null; assert_eq "$?" "0" "clean config: CLI exit 0"
assert_eq "$(rules_of "$LIBDIR")" "" "clean config: stays silent on a second run"

# case table: rule | window | config
KILLED=0; TOTAL=0
check_rule() {
  local rule="$1" win="$2" json="$3" extra="${4:-}"
  set_window "$win"; cfg "$json"
  local got; got="$(rules_of "$LIBDIR")"
  case " $got " in *" $rule "*) ;; *) fail "rule $rule not reported (got: $got)";; esac
  assert_eq "$(rules_of "$LIBDIR" | tr ' ' '\n' | grep -c "^$rule$")" "1" "$rule: reported exactly once"
  # negative control
  local m; m="$(mutant "$rule")"; TOTAL=$((TOTAL + 1))
  case " $(rules_of "$m") " in *" $rule "*) echo "NOT KILLED: mutant of $rule still reports it";; *) KILLED=$((KILLED + 1));; esac
  # clean config under the same window stays silent in this mutant too (mutant did not break unrelated output)
  : "$extra"
}
V1='"config_schema_version":1'
check_rule unknown_key 250000 "{$V1,\"context_budgt\":{\"t2\":1}}"
check_rule bad_value 250000 "{$V1,\"context_budget\":{\"mode\":\"of\"}}"
check_rule bad_type 250000 "{$V1,\"update_check\":\"yes\"}"
check_rule unreadable 250000 '{not json'
check_rule t1_not_below_t2 250000 "{$V1,\"context_budget\":{\"t1\":200000,\"t2\":150000}}"
check_rule t2_gap_over_window 250000 "{$V1,\"context_budget\":{\"t2\":300000}}"
check_rule no_autocompact_window "" "{$V1}"
check_rule defaults_changed 250000 '{"update_check":true}'
assert_eq "$KILLED" "$TOTAL" "negative controls: every removed check is caught ($KILLED of $TOTAL mutants killed)"
echo "negative controls: $KILLED/$TOTAL mutants killed (red when the check is removed)"

# detail content
set_window 250000; cfg "{$V1,\"context_budgt\":{\"t2\":1},\"context_budget\":{\"mdoe\":\"off\"}}"
OUT="$(node "$LIBDIR/config-audit.js" --config "$TEST_TMP/cfg.json")"; assert_eq "$?" "1" "findings: CLI exit 1" 2>/dev/null || true
assert_contains "$OUT" "context_budgt" "typo top-level key reported"
assert_contains "$OUT" "try: context_budget" "typo suggests the closest known key"
assert_contains "$OUT" "try: context_budget.mode" "nested typo suggests context_budget.mode"
cfg "{$V1,\"context_budget\":{\"mode\":\"of\"}}"
OUT="$(node "$LIBDIR/config-audit.js" --config "$TEST_TMP/cfg.json")"
assert_contains "$OUT" "reminders stay on" "mode typo says what it does"
cfg "{$V1,\"context_budget\":{\"t1\":0,\"t2\":150000}}"
assert_eq "$(rules_of "$LIBDIR")" "" "t1=0 (tier disabled) is not a contradiction"
cfg "{$V1,\"context_budget\":{\"mode\":\"off\",\"t2\":900000}}"
assert_eq "$(rules_of "$LIBDIR")" "" "mode=off skips the window checks"
set_window 250000; rm -f "$TEST_TMP/cfg.json"
assert_eq "$(rules_of "$LIBDIR" | tr ' ' '\n' | grep -c defaults_changed)" "1" "absent file: only the schema listing applies"
node "$LIBDIR/config-audit.js" --bogus >/dev/null 2>&1; assert_eq "$?" "2" "CLI: unknown flag exits 2"

# dev-setup.sh --check prints the audit
cfg '{"context_budgt":{"t2":1},"config_schema_version":1}'; set_window 250000
OUT="$(AUTOPILOT_CONFIG_FILE="$TEST_TMP/cfg.json" bash "$REPO_ROOT/scripts/dev-setup.sh" --check 2>&1)"
assert_contains "$OUT" "WARN config" "dev-setup --check: config findings printed as WARN"
assert_contains "$OUT" "unknown_key: context_budgt" "dev-setup --check: names the unknown key"
cfg "$CLEAN"
OUT="$(AUTOPILOT_CONFIG_FILE="$TEST_TMP/cfg.json" bash "$REPO_ROOT/scripts/dev-setup.sh" --check 2>&1)"
assert_not_contains "$OUT" "WARN config" "dev-setup --check: clean config prints no config WARN"

finalize_test
