#!/usr/bin/env bash
# hooks/tests/check-repair-scope.test.sh — cumulative repair-scope stop-loss.
#
# Covers Phase 2 fixtures independently:
#   path escape, unapproved new file, ratio trip, absolute trip,
#   revert-safe full-diff accounting, allowed in-scope repair,
#   symlink escape, contract seal mutation/reset, literal " => " filename,
#   movable ref rejection (branch/tag/abbrev SHA), mandatory independent seal.
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
  local base_sha="${7:-$BASE}"
  local impl_sha="${8:-$IMPL}"
  if [ -n "${5:-}" ]; then prefixes_json="$5"; fi
  if [ -n "${6:-}" ]; then new_json="$6"; fi
  cat > "$out" <<EOF
{
  "schema": 1,
  "task_id": "030-p2",
  "base_sha": "$base_sha",
  "implementation_sha": "$impl_sha",
  "allowed_path_prefixes": $prefixes_json,
  "allowed_new_paths": $new_json,
  "baseline_churn": $baseline,
  "max_growth_ratio": $ratio,
  "max_extra_churn": $extra
}
EOF
}

CONTRACT="$TEST_TMP/contract.json"
SEAL="$TEST_TMP/contract.seal.json"
write_contract "$CONTRACT"
node "$SCRIPT" seal --contract "$CONTRACT" --out "$SEAL" >/dev/null
assert_exit_code "$?" "0" "seal writes independent freeze artifact"
[ -f "$SEAL" ] || { echo "seal file missing" >&2; exit 1; }

reseal() {
  node "$SCRIPT" seal --contract "$CONTRACT" --out "$SEAL" >/dev/null
}

run_check() {
  local extra_args="${1:-}"
  local stdout_file="$TEST_TMP/.crs.out"
  local stderr_file="$TEST_TMP/.crs.err"
  # shellcheck disable=SC2086
  node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL" $extra_args \
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
assert_contains "$__RUN_STDOUT" '"seal_ok":true' "seal was consumed"

# 2. PATH ESCAPE — touch file outside allowed prefixes
mkdir -p "$SBX/scripts/preview"
echo 'auth receipts' > "$SBX/scripts/preview/server.js"
H_ESC="$(commit_head 'path escape preview')"
run_check
assert_exit_code "$__RUN_EXIT" "1" "path escape trips"
assert_contains "$__RUN_STDOUT" '"verdict":"TRIP"' "path escape TRIP"
assert_contains "$__RUN_STDOUT" 'path_escape' "path escape reason"
assert_contains "$__RUN_STDOUT" 'scripts/preview/server.js' "path escape names file"

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
{
  echo 'x'
  for i in $(seq 1 80); do echo "pad $i"; done
} > "$SBX/scripts/assetctl/main.sh"
H_RATIO="$(commit_head 'ratio blow')"
write_contract "$CONTRACT" "$BASELINE_JSON" "1.05" "10000"
reseal
run_check
assert_exit_code "$__RUN_EXIT" "1" "ratio trip"
assert_contains "$__RUN_STDOUT" 'ratio_trip' "ratio_trip reason"

# 5. ABSOLUTE TRIP — huge max_growth_ratio but tiny max_extra_churn
write_contract "$CONTRACT" "$BASELINE_JSON" "100" "1"
reseal
run_check
assert_exit_code "$__RUN_EXIT" "1" "absolute trip"
assert_contains "$__RUN_STDOUT" 'absolute_trip' "absolute_trip reason"

# 6. REVERT-SAFE full-diff accounting — revert then re-add cannot hide churn
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
reseal
git -C "$SBX" reset --hard "$H_OK" >/dev/null
{
  echo 'big'
  for i in $(seq 1 40); do echo "block $i"; done
} > "$SBX/scripts/assetctl/main.sh"
H_BIG="$(commit_head 'big change')"
CHURN_BIG=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.total_churn))" \
  "$(node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL")")
git -C "$SBX" revert --no-edit HEAD >/dev/null
H_REVERT="$(git -C "$SBX" rev-parse HEAD)"
CHURN_REVERT=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.total_churn))" \
  "$(node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL")")
{
  echo 'big'
  for i in $(seq 1 40); do echo "block $i"; done
} > "$SBX/scripts/assetctl/main.sh"
H_READD="$(commit_head 're-add big')"
CHURN_READD=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.total_churn))" \
  "$(node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL")")
assert_eq "$CHURN_READD" "$CHURN_BIG" "revert-safe: re-add churn equals direct big churn (not summed rounds)"
node -e "
const big=Number('$CHURN_BIG'), readd=Number('$CHURN_READD'), rev=Number('$CHURN_REVERT');
if (readd === big + rev) { console.error('gamed by summing rounds'); process.exit(1); }
if (readd !== big) { console.error('readd!=big', readd, big); process.exit(1); }
"

# 7. SYMLINK ESCAPE — symlink under allowed prefix pointing outside repo
git -C "$SBX" reset --hard "$H_OK" >/dev/null
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
reseal
OUTSIDE="$TEST_TMP/outside-secret"
echo secret > "$OUTSIDE"
ln -s "$OUTSIDE" "$SBX/scripts/assetctl/leak"
git -C "$SBX" add -A
git -C "$SBX" commit -q -m 'symlink escape'
run_check
assert_exit_code "$__RUN_EXIT" "1" "symlink escape trips"
assert_contains "$__RUN_STDOUT" 'symlink_escape' "symlink_escape reason"

# 8. CONTRACT MUTATION vs independent seal (in-loop reset)
git -C "$SBX" reset --hard "$H_OK" >/dev/null
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
reseal
# Mutate contract in place (widen prefixes) without resealing
node -e '
const fs=require("fs");
const p=process.argv[1];
const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.allowed_path_prefixes.push("scripts/preview/");
fs.writeFileSync(p, JSON.stringify(c,null,2));
' "$CONTRACT"
run_check
assert_exit_code "$__RUN_EXIT" "1" "contract mutation vs seal trips"
assert_contains "$__RUN_STDOUT" 'contract_mutated' "contract_mutated reason"

# Restore match → pass again
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
reseal
run_check
assert_exit_code "$__RUN_EXIT" "0" "restored seal match passes on in-scope HEAD"

# 8b. Same-path / self-comparison of contract and seal is rejected (exit 2)
node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$CONTRACT" \
  >"$TEST_TMP/same.out" 2>"$TEST_TMP/same.err"
assert_exit_code "$?" "2" "same-path seal rejected"
assert_contains "$(cat "$TEST_TMP/same.err")" "independent" "same-path names independence"

# 8c. Missing --seal fails closed (exit 2) — optional intake is not enough
node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" \
  >"$TEST_TMP/noseal.out" 2>"$TEST_TMP/noseal.err"
assert_exit_code "$?" "2" "missing --seal exit 2"
assert_contains "$(cat "$TEST_TMP/noseal.err")" "--seal" "missing seal names --seal"

# 8d. Legacy --intake-contract rejected
node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL" \
  --intake-contract "$CONTRACT" \
  >"$TEST_TMP/legacy.out" 2>"$TEST_TMP/legacy.err"
assert_exit_code "$?" "2" "legacy --intake-contract rejected"

# 9. BINARY file under allowed path still subject to path rules (and doesn't crash)
printf '\x00\x01\x02bin' > "$SBX/scripts/assetctl/blob.bin"
H_BIN="$(commit_head 'binary add')"
run_check
assert_exit_code "$__RUN_EXIT" "1" "binary new file without new-path glob trips"
assert_contains "$__RUN_STDOUT" 'unapproved_new_file' "binary unapproved_new_file"

# 10. Missing required contract field fails closed (exit 2)
echo '{"schema":1}' > "$TEST_TMP/bad.json"
node "$SCRIPT" check --contract "$TEST_TMP/bad.json" --seal "$SEAL" --repo "$SBX" \
  >"$TEST_TMP/bad.out" 2>"$TEST_TMP/bad.err"
assert_exit_code "$?" "2" "malformed contract exit 2"

# 11. --help
node "$SCRIPT" --help >"$TEST_TMP/help.out" 2>&1
assert_exit_code "$?" "0" "--help exit 0"
assert_contains "$(cat "$TEST_TMP/help.out")" "max_growth_ratio" "--help documents growth fields"
assert_contains "$(cat "$TEST_TMP/help.out")" "--seal" "--help documents mandatory seal"

# 12. LITERAL " => " FILENAME — must not masquerade as allowed path
# Real path: "evil => scripts/assetctl/main.sh" (outside allowed prefixes).
# Naive non-NUL " => " rewrite checks existing allowed scripts/assetctl/main.sh
# and would PASS; NUL + --no-renames keeps the literal path and TRIPs.
git -C "$SBX" reset --hard "$H_OK" >/dev/null
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
reseal
python3 - <<PY
import os
path = os.path.join("$SBX", "evil => scripts", "assetctl", "main.sh")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    f.write("pwn\\n")
print("wrote", path)
PY
git -C "$SBX" add -A
git -C "$SBX" commit -q -m 'malicious literal arrow filename'
run_check
assert_exit_code "$__RUN_EXIT" "1" "literal => filename must trip path_escape (not masquerade)"
assert_contains "$__RUN_STDOUT" 'path_escape' "literal => trips path_escape"
assert_contains "$__RUN_STDOUT" 'evil => scripts/assetctl/main.sh' "names the literal path, not rewritten allowlisted form"
assert_not_contains "$__RUN_STDOUT" '"verdict":"PASS"' "literal => must not PASS"

# 13. MOVABLE REFS rejected: branch name as base_sha
git -C "$SBX" reset --hard "$H_OK" >/dev/null
git -C "$SBX" branch -f movable-base "$BASE"
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000" '' '' "movable-base" "$IMPL"
node "$SCRIPT" seal --contract "$CONTRACT" --out "$SEAL" >"$TEST_TMP/branch-seal.out" 2>"$TEST_TMP/branch-seal.err"
# loadContract should reject non-full-hex at seal/load time
assert_exit_code "$?" "2" "branch name as base_sha rejected at contract load"
assert_contains "$(cat "$TEST_TMP/branch-seal.err")" "40-hex" "branch reject names full object ID requirement"

# 14. Tag name as implementation_sha rejected
git -C "$SBX" tag -f movable-impl "$IMPL"
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000" '' '' "$BASE" "movable-impl"
node "$SCRIPT" check --contract "$CONTRACT" --repo "$SBX" --seal "$SEAL" \
  >"$TEST_TMP/tag.out" 2>"$TEST_TMP/tag.err" || true
# seal may be stale; either load fails (exit 2) before seal check
node "$SCRIPT" seal --contract "$CONTRACT" --out "$TEST_TMP/tag.seal.json" \
  >"$TEST_TMP/tag-seal.out" 2>"$TEST_TMP/tag-seal.err"
assert_exit_code "$?" "2" "tag name as implementation_sha rejected"
assert_contains "$(cat "$TEST_TMP/tag-seal.err")" "40-hex" "tag reject names full object ID"

# 15. Abbreviated SHA rejected
ABBREV="${BASE:0:7}"
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000" '' '' "$ABBREV" "$IMPL"
node "$SCRIPT" seal --contract "$CONTRACT" --out "$TEST_TMP/abbrev.seal.json" \
  >"$TEST_TMP/abbrev.out" 2>"$TEST_TMP/abbrev.err"
assert_exit_code "$?" "2" "abbreviated SHA as base_sha rejected"
assert_contains "$(cat "$TEST_TMP/abbrev.err")" "40-hex" "abbrev reject names full object ID"

# Restore valid contract+seal for any follow-on harness inspection
write_contract "$CONTRACT" "$BASELINE_JSON" "50" "10000"
reseal

# 16. Doc/contract regression: canonical prose requires post-mutation + pre-acceptance
# scope checks and independent --seal (mechanically distinguishable tokens).
DOC_REVIEW="$REPO_ROOT/skills/quality-pipeline/references/code-review.md"
DOC_SKILL="$REPO_ROOT/skills/quality-pipeline/SKILL.md"
grep -q 'after every repair mutation' "$DOC_REVIEW" \
  || { echo "missing post-mutation scope check token in code-review.md" >&2; exit 1; }
grep -q 'before acceptance' "$DOC_REVIEW" \
  || { echo "missing before-acceptance scope check token in code-review.md" >&2; exit 1; }
grep -q -- '--seal' "$DOC_REVIEW" \
  || { echo "missing --seal token in code-review.md" >&2; exit 1; }
grep -q 'completeness' "$DOC_REVIEW" \
  || { echo "missing completeness token in code-review.md" >&2; exit 1; }
grep -q 'after every repair mutation' "$DOC_SKILL" \
  || { echo "missing post-mutation scope check token in SKILL.md" >&2; exit 1; }
grep -q 'before acceptance' "$DOC_SKILL" \
  || { echo "missing before-acceptance scope check token in SKILL.md" >&2; exit 1; }
grep -q -- '--seal' "$DOC_SKILL" \
  || { echo "missing --seal token in SKILL.md" >&2; exit 1; }

finalize_test
