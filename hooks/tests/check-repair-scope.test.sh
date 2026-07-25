#!/usr/bin/env bash
# hooks/tests/check-repair-scope.test.sh — cumulative repair-scope stop-loss.
#
# Covers Phase 2 fixtures independently:
#   path escape, unapproved new file, ratio trip, absolute trip,
#   revert-safe full-diff accounting, allowed in-scope repair,
#   symlink escape, contract mutation/reset.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-repair-scope.js"
node --check "$SCRIPT"
assert_exit_code "$?" "0" "node --check syntax"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b main
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t

commit_head() {
  git -C "$SBX" add -A
  # Allow empty only when needed is avoided; always have content.
  git -C "$SBX" commit -q -m "$1"
  git -C "$SBX" rev-parse HEAD
}

# Seed tree under the allowed surface
mkdir -p "$SBX/scripts/assetctl" "$SBX/client/src/ops" "$SBX/scripts/assetctl/tests"
printf 'line1\nline2\nline3\nline4\n' > "$SBX/scripts/assetctl/main.sh"
printf 'ops\n' > "$SBX/client/src/ops/run.js"
BASE="$(commit_head base)"

# Implementation snapshot: modest churn under allowed prefixes
printf 'line1\nline2\nline3\nline4\nline5\n' > "$SBX/scripts/assetctl/main.sh"
printf 'ops\nmore\n' > "$SBX/client/src/ops/run.js"
IMPL="$(commit_head impl)"

# baseline_churn for base..impl
BASELINE_JSON="$(git -C "$SBX" diff --numstat "$BASE" "$IMPL" | node -e '
let ins=0,del=0;
const fs=require("fs"); const t=fs.readFileSync(0,"utf8").trim();
for (const line of t.split("\n")) {
  if (!line) continue;
  const [a,b]=line.split("\t");
  if (a==="-"||b==="-") continue;
  ins+=parseInt(a,10)||0; del+=parseInt(b,10)||0;
}
process.stdout.write(String(ins+del));
')"
# Ensure positive baseline
if [ -z "$BASELINE_JSON" ] || [ "$BASELINE_JSON" -le 0 ]; then
  echo "fixture baseline_churn invalid: $BASELINE_JSON" >&2
  exit 1
fi

write_contract() {
  local out="$1"
  # Defaults leave room for small in-scope edits; ratio/absolute cases override.
  local baseline="${2:-$BASELINE_JSON}"
  local ratio="${3:-50}"
  local extra="${4:-10000}"
  local prefixes_json='["scripts/assetctl/","client/src/ops/"]'
  local new_json='["scripts/assetctl/tests/**"]'
  if [ -n "${5:-}" ]; then prefixes_json="$5"; fi
  if [ -n "${6:-}" ]; then new_json="$6"; fi
  cat > "$out" <<EOF
{
  "schema": 1,
  "task_id": "030-p2",
  "base_sha": "$BASE",
  "implementation_sha": "$IMPL",
  "allowed_path_prefixes": $prefixes_json,
  "allowed_new_paths": $new_json,
  "baseline_churn": $baseline,
  "max_growth_ratio": $ratio,
  "max_extra_churn": $extra
}
EOF
}

CONTRACT="$TEST_TMP/contract.json"
INTAKE="$TEST_TMP/intake-contract.json"
write_contract "$CONTRACT"
cp "$CONTRACT" "$INTAKE"

run_check() {
  local extra_args="${1:-}"
  local stdout_file="$TEST_TMP/.crs.out"
  local stderr_file="$TEST_TMP/.crs.err"
  # shellcheck disable=SC2086
  node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --intake-contract "$INTAKE" $extra_args \
    >"$stdout_file" 2>"$stderr_file"
  __RUN_EXIT=$?
  __RUN_STDOUT=$(cat "$stdout_file")
  __RUN_STDERR=$(cat "$stderr_file")
}

# 1. ALLOWED in-scope repair (edit under prefix, within budget)
printf 'line1\nline2\nline3\nline4\nline5\nfix\n' > "$SBX/scripts/assetctl/main.sh"
H_OK="$(commit_head 'in-scope fix')"
run_check
assert_exit_code "$__RUN_EXIT" "0" "allowed in-scope repair passes"
assert_contains "$__RUN_STDOUT" '"verdict":"PASS"' "in-scope verdict PASS"

# 2. PATH ESCAPE — touch file outside allowed prefixes
mkdir -p "$SBX/scripts/preview"
echo 'auth receipts' > "$SBX/scripts/preview/server.js"
H_ESC="$(commit_head 'path escape preview')"
run_check
assert_exit_code "$__RUN_EXIT" "1" "path escape trips"
assert_contains "$__RUN_STDOUT" '"verdict":"TRIP"' "path escape TRIP"
assert_contains "$__RUN_STDOUT" 'path_escape' "path escape reason"
assert_contains "$__RUN_STDOUT" 'scripts/preview/server.js' "path escape names file"

# Reset to in-scope HEAD for subsequent cases: revert the escape commit by
# building fresh branches from H_OK for isolated trips when needed.
# Continue from H_ESC for new-file test (still has escape — recreate clean).

git -C "$SBX" reset --hard "$H_OK" >/dev/null

# 3. UNAPPROVED NEW FILE under prefix but not matching allowed_new_paths
echo 'new subsystem' > "$SBX/scripts/assetctl/auth-receipts.js"
H_NEW="$(commit_head 'unapproved new file under prefix')"
run_check
assert_exit_code "$__RUN_EXIT" "1" "unapproved new file trips"
assert_contains "$__RUN_STDOUT" 'unapproved_new_file' "unapproved_new_file reason"
assert_contains "$__RUN_STDOUT" 'scripts/assetctl/auth-receipts.js' "names unapproved file"

# Approved new file under allowed_new_paths globs
git -C "$SBX" reset --hard "$H_OK" >/dev/null
echo 'test ok' > "$SBX/scripts/assetctl/tests/smoke.sh"
H_ANEW="$(commit_head 'approved new test file')"
run_check
assert_exit_code "$__RUN_EXIT" "0" "approved new file under allowed_new_paths passes"
assert_contains "$__RUN_STDOUT" '"verdict":"PASS"' "approved new PASS"

# 4. RATIO TRIP — tiny baseline + ratio 1.1, large edit
git -C "$SBX" reset --hard "$H_OK" >/dev/null
# Compute current churn and craft ratio that current already exceeds after big edit
{
  echo 'x'
  for i in $(seq 1 80); do echo "pad $i"; done
} > "$SBX/scripts/assetctl/main.sh"
H_RATIO="$(commit_head 'ratio blow')"
# baseline stays BASELINE_JSON; set ratio so limit is barely above baseline
write_contract "$CONTRACT" "$BASELINE_JSON" "1.05" "10000"
cp "$INTAKE" "$TEST_TMP/intake-bak.json"
# intake must match current contract for non-mutation cases
cp "$CONTRACT" "$INTAKE"
run_check
assert_exit_code "$__RUN_EXIT" "1" "ratio trip"
assert_contains "$__RUN_STDOUT" 'ratio_trip' "ratio_trip reason"

# 5. ABSOLUTE TRIP — huge max_growth_ratio but tiny max_extra_churn
write_contract "$CONTRACT" "$BASELINE_JSON" "100" "1"
cp "$CONTRACT" "$INTAKE"
run_check
assert_exit_code "$__RUN_EXIT" "1" "absolute trip"
assert_contains "$__RUN_STDOUT" 'absolute_trip' "absolute_trip reason"

# 6. REVERT-SAFE full-diff accounting — revert then re-add cannot hide churn
# Reset contract to permissive for accounting case
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
cp "$CONTRACT" "$INTAKE"
git -C "$SBX" reset --hard "$H_OK" >/dev/null
# Add a large in-scope change
{
  echo 'big'
  for i in $(seq 1 40); do echo "block $i"; done
} > "$SBX/scripts/assetctl/main.sh"
H_BIG="$(commit_head 'big change')"
CHURN_BIG=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.total_churn))" \
  "$(node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --intake-contract "$INTAKE")")
# Revert the big change
git -C "$SBX" revert --no-edit HEAD >/dev/null
H_REVERT="$(git -C "$SBX" rev-parse HEAD)"
CHURN_REVERT=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.total_churn))" \
  "$(node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --intake-contract "$INTAKE")")
# Re-add the same content
{
  echo 'big'
  for i in $(seq 1 40); do echo "block $i"; done
} > "$SBX/scripts/assetctl/main.sh"
H_READD="$(commit_head 're-add big')"
CHURN_READD=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.total_churn))" \
  "$(node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --intake-contract "$INTAKE")")
# Full base..HEAD after re-add must equal the big-change accounting (not sum of rounds)
assert_eq "$CHURN_READD" "$CHURN_BIG" "revert-safe: re-add churn equals direct big churn (not summed rounds)"
# After pure revert, churn should be near the H_OK baseline (not zeroed incorrectly either)
# At least: re-add must not be CHURN_BIG + CHURN_REVERT + ...
node -e "
const big=Number('$CHURN_BIG'), readd=Number('$CHURN_READD'), rev=Number('$CHURN_REVERT');
if (readd === big + rev) { console.error('gamed by summing rounds'); process.exit(1); }
if (readd !== big) { console.error('readd!=big', readd, big); process.exit(1); }
"

# 7. SYMLINK ESCAPE — symlink under allowed prefix pointing outside repo
git -C "$SBX" reset --hard "$H_OK" >/dev/null
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
cp "$CONTRACT" "$INTAKE"
OUTSIDE="$TEST_TMP/outside-secret"
echo secret > "$OUTSIDE"
ln -s "$OUTSIDE" "$SBX/scripts/assetctl/leak"
# git may need core.symlinks
git -C "$SBX" add -A
git -C "$SBX" commit -q -m 'symlink escape'
run_check
assert_exit_code "$__RUN_EXIT" "1" "symlink escape trips"
assert_contains "$__RUN_STDOUT" 'symlink_escape' "symlink_escape reason"

# 8. CONTRACT MUTATION / in-loop reset
git -C "$SBX" reset --hard "$H_OK" >/dev/null
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
cp "$CONTRACT" "$INTAKE"
# Mutate contract in place (widen prefixes) without updating intake
node -e '
const fs=require("fs");
const p=process.argv[1];
const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.allowed_path_prefixes.push("scripts/preview/");
fs.writeFileSync(p, JSON.stringify(c,null,2));
' "$CONTRACT"
run_check
assert_exit_code "$__RUN_EXIT" "1" "contract mutation trips"
assert_contains "$__RUN_STDOUT" 'contract_mutated' "contract_mutated reason"

# Restore match → pass again
cp "$INTAKE" "$CONTRACT"
run_check
assert_exit_code "$__RUN_EXIT" "0" "restored intake match passes on in-scope HEAD"

# 9. BINARY file under allowed path still subject to path rules (and doesn't crash)
printf '\x00\x01\x02bin' > "$SBX/scripts/assetctl/blob.bin"
H_BIN="$(commit_head 'binary add')"
# binary is NEW file — must match allowed_new_paths; blob.bin does not → trip
run_check
assert_exit_code "$__RUN_EXIT" "1" "binary new file without new-path glob trips"
assert_contains "$__RUN_STDOUT" 'unapproved_new_file' "binary unapproved_new_file"

# 10. Missing required contract field fails closed (exit 2)
echo '{"schema":1}' > "$TEST_TMP/bad.json"
node "$SCRIPT" check --contract "$TEST_TMP/bad.json" --repo "$SBX" >"$TEST_TMP/bad.out" 2>"$TEST_TMP/bad.err"
assert_exit_code "$?" "2" "malformed contract exit 2"

# 11. --help
node "$SCRIPT" --help >"$TEST_TMP/help.out" 2>&1
assert_exit_code "$?" "0" "--help exit 0"
assert_contains "$(cat "$TEST_TMP/help.out")" "max_growth_ratio" "--help documents growth fields"

finalize_test
