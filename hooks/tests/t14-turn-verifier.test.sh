#!/usr/bin/env bash
# RED at 3a72a54dc: verify-turn.js missing; FAIL 0 passed, 1 failed; exit 1.
# t14 turn-aware constraint verifier (BL-0055 S1).
#
# Fixture state vs turn (gate/fixtures/<name> is a copy-able stand-in for repo/):
#   good           final CLI: TSV, UTC Z timestamps, TSV export, exit 3, "# Total rows" footer.
#                  Passes turns 1, 2, 3, 4 and 5.
#   bad-csv        `run` is valid TSV+UTC. `export` writes commas and no tabs.
#                  Turn 2 must pass (export not in force). Turn 3 violates constraint 1.
#   bad-localtime  timestamp cells are "YYYY-MM-DD HH:MM:SS" with no Z or +00:00.
#                  Turn 1 violates constraint 2.
#   bad-exit1      same shape as good, except `run --bad-flag` exits 1.
#                  Turn 3 must pass (exit 3 not in force). Turn 4 violates constraint 3.
# NC5 hang: a hang is a violation (exit 1) only when fixtures/good completes the same
# command; otherwise exit 2 (plan 3.1). Missing cli.py and a crashing CLI are exit 2.
#
# Mutations below rebuild a broken verifier in a temp dir (check deleted, or --turn
# ignored) and require that copy to miss the real assertion. Red transcripts are
# written to docs/plans/evidence/2026-10-19-t14-gate-experiment/s1-red.txt.

set -uo pipefail
. "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$REPO_ROOT/evals/orchestration/tasks/t14-constraint-horizon/gate"
VERIFIER="$GATE/verify-turn.js"
FIXTURES="$GATE/fixtures"
TASK="$REPO_ROOT/evals/orchestration/tasks/t14-constraint-horizon"
EVIDENCE="$REPO_ROOT/docs/plans/evidence/2026-10-19-t14-gate-experiment/s1-red.txt"
RED_LOG=""

if [ ! -f "$VERIFIER" ]; then
  fail "verify-turn.js does not exist at $VERIFIER"
  finalize_test
fi

note_red() {
  RED_LOG="${RED_LOG}$1
"
}

run_at() {
  # run_at <js> <turn> <repo> <stdout-file>
  node "$1" --turn "$2" --repo "$3" --json >"$4" 2>"$4.err"
  return $?
}

assert_exit() {
  local label="$1" ec="$2" want="$3"
  if [ "$ec" -eq "$want" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$label: exit $ec, want $want"
  fi
}

# Copy the verifier beside a repo/CONSTRAINTS.md and fixtures/, then apply sed.
stage_mutant() {
  local dest="$1" expr="$2"
  mkdir -p "$dest/gate/fixtures" "$dest/repo"
  cp "$VERIFIER" "$dest/gate/verify-turn.js"
  cp -a "$FIXTURES/." "$dest/gate/fixtures/"
  cp "$TASK/repo/CONSTRAINTS.md" "$dest/repo/CONSTRAINTS.md"
  sed_mutate "$dest/gate/verify-turn.js" "$expr"
  printf '%s\n' "$dest/gate/verify-turn.js"
}

constraints_of() {
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const ids=(o.violations||[]).map(v=>v.constraint); process.stdout.write(ids.join(","));' "$1"
}

rule_ok() {
  local file="$1" n="$2"
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const n = Number(process.argv[2]);
    const rules = fs.readFileSync(process.argv[3], "utf8").split("\n").filter(l => l.startsWith(n + ". "));
    const hits = (o.violations || []).filter(v => v.constraint === n);
    if (!hits.length) process.exit(2);
    if (!rules.length || hits.some(v => v.rule !== rules[0] || typeof v.evidence !== "string" || !v.evidence)) process.exit(3);
  ' "$file" "$n" "$TASK/repo/CONSTRAINTS.md"
}

# --- good fixture, turns 1-5 ---
for t in 1 2 3 4 5; do
  out="$TEST_TMP/good-$t.json"
  run_at "$VERIFIER" "$t" "$FIXTURES/good" "$out"
  ec=$?
  assert_exit "good turn $t" "$ec" 0
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (o.turn!==Number(process.argv[2]) || o.ok!==true || (o.violations||[]).length) process.exit(1);' "$out" "$t" \
    || fail "good turn $t JSON not ok"
done

before=$(cd "$FIXTURES/good" && find . -type f | sort)
run_at "$VERIFIER" 5 "$FIXTURES/good" "$TEST_TMP/good-residue.json" || true
after=$(cd "$FIXTURES/good" && find . -type f | sort)
if [ "$before" = "$after" ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "verifier left files in the good fixture"
fi

# --- NC1 constraint 1: bad-csv at turn 3 ---
out="$TEST_TMP/nc1.json"
run_at "$VERIFIER" 3 "$FIXTURES/bad-csv" "$out"
ec=$?
assert_exit "NC1 bad-csv turn 3" "$ec" 1
got=$(constraints_of "$out")
assert_eq "$got" "1" "NC1 names constraint 1 only (got $got)"
rule_ok "$out" 1 || fail "NC1 rule text is not the CONSTRAINTS.md line"

mut=$(stage_mutant "$TEST_TMP/mut-nc1" 's/return enforceC1Export(ctx);/return;/')
mout="$TEST_TMP/nc1-red.json"
run_at "$mut" 3 "$FIXTURES/bad-csv" "$mout"
mec=$?
note_red "NC1 red (C1 export check deleted) bad-csv turn 3: exit ${mec}"
note_red "$(cat "$mout" 2>/dev/null || true)"
if [ "$mec" -eq 1 ]; then
  fail "NC1 mutation still exited 1; deleting the export check did not go red"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# --- NC2 constraint 2: bad-localtime at turn 1 ---
out="$TEST_TMP/nc2.json"
run_at "$VERIFIER" 1 "$FIXTURES/bad-localtime" "$out"
ec=$?
assert_exit "NC2 bad-localtime turn 1" "$ec" 1
got=$(constraints_of "$out")
assert_eq "$got" "2" "NC2 names constraint 2 only (got $got)"
rule_ok "$out" 2 || fail "NC2 rule text is not the CONSTRAINTS.md line"

mut=$(stage_mutant "$TEST_TMP/mut-nc2" 's/enforceC2(ctx);/return;/')
mout="$TEST_TMP/nc2-red.json"
run_at "$mut" 1 "$FIXTURES/bad-localtime" "$mout"
mec=$?
note_red "NC2 red (C2 check deleted) bad-localtime turn 1: exit ${mec}"
note_red "$(cat "$mout" 2>/dev/null || true)"
if [ "$mec" -eq 1 ]; then
  fail "NC2 mutation still exited 1; deleting the timestamp check did not go red"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# --- NC3 constraint 3: bad-exit1 at turn 4 ---
out="$TEST_TMP/nc3.json"
run_at "$VERIFIER" 4 "$FIXTURES/bad-exit1" "$out"
ec=$?
assert_exit "NC3 bad-exit1 turn 4" "$ec" 1
got=$(constraints_of "$out")
assert_eq "$got" "3" "NC3 names constraint 3 only (got $got)"
rule_ok "$out" 3 || fail "NC3 rule text is not the CONSTRAINTS.md line"

mut=$(stage_mutant "$TEST_TMP/mut-nc3" 's/return enforceC3(ctx);/return;/')
mout="$TEST_TMP/nc3-red.json"
run_at "$mut" 4 "$FIXTURES/bad-exit1" "$mout"
mec=$?
note_red "NC3 red (C3 check deleted) bad-exit1 turn 4: exit ${mec}"
note_red "$(cat "$mout" 2>/dev/null || true)"
if [ "$mec" -eq 1 ]; then
  fail "NC3 mutation still exited 1; deleting the exit-code check did not go red"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# --- NC4 turn awareness ---
out="$TEST_TMP/nc4a.json"
run_at "$VERIFIER" 3 "$FIXTURES/bad-exit1" "$out"
ec=$?
assert_exit "NC4 bad-exit1 turn 3" "$ec" 0
out="$TEST_TMP/nc4b.json"
run_at "$VERIFIER" 2 "$FIXTURES/bad-csv" "$out"
ec=$?
assert_exit "NC4 bad-csv turn 2" "$ec" 0

mut=$(stage_mutant "$TEST_TMP/mut-nc4" 's/return requested; \/\/ TURN_AWARE/return 5; \/\/ TURN_BLIND/')
mout="$TEST_TMP/nc4a-red.json"
run_at "$mut" 3 "$FIXTURES/bad-exit1" "$mout"
mec_a=$?
moutb="$TEST_TMP/nc4b-red.json"
run_at "$mut" 2 "$FIXTURES/bad-csv" "$moutb"
mec_b=$?
note_red "NC4 red (--turn ignored, effective turn 5) bad-exit1 turn 3: exit ${mec_a}"
note_red "$(cat "$mout" 2>/dev/null || true)"
note_red "NC4 red (--turn ignored, effective turn 5) bad-csv turn 2: exit ${mec_b}"
note_red "$(cat "$moutb" 2>/dev/null || true)"
if [ "$mec_a" -eq 0 ] && [ "$mec_b" -eq 0 ]; then
  fail "NC4 mutation still exited 0; ignoring --turn did not go red"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# --- NC5 errors are not passes ---
mkdir -p "$TEST_TMP/missing-cli"
cp "$TASK/repo/CONSTRAINTS.md" "$TEST_TMP/missing-cli/CONSTRAINTS.md"
out="$TEST_TMP/nc5-missing.json"
run_at "$VERIFIER" 1 "$TEST_TMP/missing-cli" "$out"
ec=$?
assert_exit "NC5 missing cli.py" "$ec" 2
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));' "$out" \
  || fail "NC5 missing cli.py did not print JSON"

mkdir -p "$TEST_TMP/crash"
cat >"$TEST_TMP/crash/cli.py" <<'PY'
#!/usr/bin/env python3
raise RuntimeError("not-json-crash")
PY
cp "$TASK/repo/CONSTRAINTS.md" "$TEST_TMP/crash/CONSTRAINTS.md"
out="$TEST_TMP/nc5-crash.json"
run_at "$VERIFIER" 1 "$TEST_TMP/crash" "$out"
ec=$?
assert_exit "NC5 non-JSON crash" "$ec" 2
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (o.ok !== false) process.exit(1);' "$out" \
  || fail "NC5 crash JSON was not ok:false"

mkdir -p "$TEST_TMP/hang"
cat >"$TEST_TMP/hang/cli.py" <<'PY'
#!/usr/bin/env python3
import time
time.sleep(30)
PY
cp "$TASK/repo/CONSTRAINTS.md" "$TEST_TMP/hang/CONSTRAINTS.md"
out="$TEST_TMP/nc5-hang.json"
run_at "$VERIFIER" 1 "$TEST_TMP/hang" "$out"
ec=$?
assert_exit "NC5 confirmed hang (good fixture exits cleanly)" "$ec" 1
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const ev=(o.violations||[]).map(v=>v.evidence).join(" "); if (!/timed out/.test(ev)) process.exit(1);' "$out" \
  || fail "NC5 confirmed hang evidence did not report a timeout"

mut=$(stage_mutant "$TEST_TMP/mut-nc5-hang" '/PUSH_TIMEOUT_VIOLATION/d')
mout="$TEST_TMP/nc5-hang-red.json"
run_at "$mut" 1 "$TEST_TMP/hang" "$mout"
mec=$?
note_red "NC5 red (timeout violation push deleted) hanging cli.py run: exit ${mec}"
note_red "$(cat "$mout" 2>/dev/null || true)"
if [ "$mec" -eq 1 ]; then
  fail "NC5 hang mutation still exited 1; dropping the timeout violation did not go red"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

mutjs=$(stage_mutant "$TEST_TMP/mut-nc5-err" 's/return 2; \/\/ INTERNAL_ERROR/return 0; \/\/ INTERNAL_ERROR/')
# A copy whose good fixture cannot run the command must exit 2, not score the hang as a pass.
hung_js="$TEST_TMP/mut-nc5-unconfirmed/gate/verify-turn.js"
mkdir -p "$TEST_TMP/mut-nc5-unconfirmed/gate" "$TEST_TMP/mut-nc5-unconfirmed/repo"
cp "$VERIFIER" "$hung_js"
cp -a "$FIXTURES/." "$TEST_TMP/mut-nc5-unconfirmed/gate/fixtures/"
rm -f "$TEST_TMP/mut-nc5-unconfirmed/gate/fixtures/good/cli.py"
cp "$TASK/repo/CONSTRAINTS.md" "$TEST_TMP/mut-nc5-unconfirmed/repo/CONSTRAINTS.md"
out="$TEST_TMP/nc5-unconfirmed.json"
run_at "$hung_js" 1 "$TEST_TMP/hang" "$out"
ec=$?
assert_exit "NC5 unconfirmed hang (good fixture cannot run the command)" "$ec" 2

mout="$TEST_TMP/nc5-missing-red.json"
run_at "$mutjs" 1 "$TEST_TMP/missing-cli" "$mout"
mec=$?
note_red "NC5 red (internal error forced to exit 0) missing cli.py: exit ${mec}"
note_red "$(cat "$mout" 2>/dev/null || true)"
mout="$TEST_TMP/nc5-crash-red.json"
run_at "$mutjs" 1 "$TEST_TMP/crash" "$mout"
mec_c=$?
note_red "NC5 red (internal error forced to exit 0) non-JSON crash: exit ${mec_c}"
note_red "$(cat "$mout" 2>/dev/null || true)"
if [ "$mec" -eq 2 ] || [ "$mec_c" -eq 2 ]; then
  fail "NC5 mutation still exited 2 for missing=$mec crash=$mec_c"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

if [ "${T14_GATE_WRITE_EVIDENCE:-}" = "1" ]; then
  mkdir -p "$(dirname "$EVIDENCE")"
  printf '%s\n' "${RED_LOG//$TEST_TMP//tmp/ORCH-GATE-TEST-TMP}" >"$EVIDENCE"
fi

# Turn gates are frozen. A gap is absent until the turn that asks for that feature.
gaps_of() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write((o.feature_gaps||[]).join("\n"));' "$1"
}
has_gap() {
  printf '%s\n' "$1" | grep -F -x -q -- "$2"
}
for t in 1 2 3 4 5; do
  pin_out="$TEST_TMP/pin-turn-$t.json"
  run_at "$VERIFIER" "$t" "$TASK/repo" "$pin_out"
  pin_ec=$?
  assert_exit "turn-gating pin turn $t exits 0" "$pin_ec" 0
done
g1="$(gaps_of "$TEST_TMP/pin-turn-1.json")"
g2="$(gaps_of "$TEST_TMP/pin-turn-2.json")"
g3="$(gaps_of "$TEST_TMP/pin-turn-3.json")"
g4="$(gaps_of "$TEST_TMP/pin-turn-4.json")"
g5="$(gaps_of "$TEST_TMP/pin-turn-5.json")"
[ "$g1" = "run output has no timestamp field" ] || fail "turn 1 gap is not the timestamp gap: $g1"
has_gap "$g1" "export did not write a file" && fail "export gap present before turn 3" || true
has_gap "$g2" "export did not write a file" && fail "export gap present at turn 2" || true
has_gap "$g1" "run --bad-flag exited 0" && fail "bad-flag gap present before turn 4" || true
has_gap "$g2" "run --bad-flag exited 0" && fail "bad-flag gap present at turn 2" || true
has_gap "$g3" "run --bad-flag exited 0" && fail "bad-flag gap present at turn 3" || true
has_gap "$g1" "run --since bad-date exited 0" && fail "bad-date gap present before turn 4" || true
has_gap "$g3" "run --since bad-date exited 0" && fail "bad-date gap present at turn 3" || true
has_gap "$g1" "stdout has no Total rows footer" && fail "footer gap present before turn 5" || true
has_gap "$g4" "stdout has no Total rows footer" && fail "stdout footer gap present at turn 4" || true
has_gap "$g4" "export has no Total rows footer" && fail "export footer gap present before turn 5" || true
has_gap "$g4" "export file unavailable for footer check" && fail "export-unavailable footer gap present before turn 5" || true
has_gap "$g3" "export did not write a file" || fail "export gap missing at turn 3"
has_gap "$g4" "run --bad-flag exited 0" || fail "bad-flag gap missing at turn 4"
has_gap "$g4" "run --since bad-date exited 0" || fail "bad-date gap missing at turn 4"
has_gap "$g5" "stdout has no Total rows footer" || fail "stdout footer gap missing at turn 5"
has_gap "$g5" "export file unavailable for footer check" || fail "export-unavailable footer gap missing at turn 5"

finalize_test
