#!/usr/bin/env bash
# hooks/tests/t14-gate-batch.test.sh — BL-0055 S3 batch driver and analyzer
# RED at 6a6373eed: driver and analyzer were absent; the test exited 1 with "missing evals/orchestration/run-t14-gate-batch.js" before any batch or verdict check ran.
# RED at f8f1ec90e: lying row counted valid_runs.c=1 with no mismatches key; resume never compared --pairs (schedule reused, exit 0).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVAL_DIR="$REPO_ROOT/evals/orchestration"
DRIVER="$EVAL_DIR/run-t14-gate-batch.js"
ANALYZER="$EVAL_DIR/analyze-t14-gate.js"
EVIDENCE="$REPO_ROOT/docs/plans/evidence/2026-10-19-t14-gate-experiment/s3-red.txt"
PIN="2.1.303 (Claude Code)"
TASK_DIR="$EVAL_DIR/tasks/t14-constraint-horizon"

TEST_TMP=$(mktemp -d -t "t14-gate-batch-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
EVIDENCE_PLACEHOLDER="/tmp/ORCH-GATE-TEST-TMP"
if [ "${T14_GATE_WRITE_EVIDENCE:-}" = "1" ]; then
  mkdir -p "$(dirname "$EVIDENCE")"
  : > "$EVIDENCE"
fi

note_evidence() {
  local text
  text="$(cat)"
  [ "${T14_GATE_WRITE_EVIDENCE:-}" = "1" ] || return 0
  text="${text//$TEST_TMP/$EVIDENCE_PLACEHOLDER}"
  printf '%s\n' "$text" >> "$EVIDENCE"
}

export ORCH_TIMEOUT="30s"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

if [ ! -f "$DRIVER" ] || [ ! -f "$ANALYZER" ]; then
  fail "missing $DRIVER or $ANALYZER"
fi

data_lines() {
  node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
let n = 0;
for (let i = 0; i < lines.length; i++) {
  let j;
  try { j = JSON.parse(lines[i]); }
  catch (e) {
    if (i === lines.length - 1) break;
    throw e;
  }
  if (j.record !== "header") n++;
}
process.stdout.write(String(n));
' "$1"
}

verdict_of() {
  node "$ANALYZER" --out "$1"
}

write_claude() {
  local path="$1" mode="$2" count_file="$3"
  cat > "$path" << EOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then
  if [ "$mode" = "bad-version" ]; then
    echo "9.9.9 (other)"
  else
    echo "$PIN"
  fi
  exit 0
fi
if [ "$mode" = "unauth" ]; then
  n=0
  if [ -f "$count_file" ]; then n=\$(cat "$count_file"); fi
  n=\$((n + 1))
  echo "\$n" > "$count_file"
  if [ "\$n" -ge 3 ]; then
    echo "401 unauthorized"
    exit 1
  fi
fi
echo "AUTH_OK"
exit 0
EOF
  chmod +x "$path"
}

write_stub() {
  local path="$1" code="${2:-0}"
  cat > "$path" << EOF
#!/usr/bin/env bash
exit $code
EOF
  chmod +x "$path"
}

run_driver() {
  node "$DRIVER" "$@"
}

# Frozen hashes the same way the driver records them (walk, git hash-object).
frozen_json() {
  node - "$REPO_ROOT" "$TASK_DIR" << 'JS'
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const repo = process.argv[2];
const task = process.argv[3];
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === ".git") continue;
    const abs = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, rel, out);
    else if (st.isFile()) out.push(rel);
  }
}
const rels = [];
walk(task, "", rels);
const frozen = {};
for (const rel of rels) {
  const r = spawnSync("git", ["hash-object", path.join(task, rel)], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) process.exit(2);
  frozen[rel] = r.stdout.trim();
}
process.stdout.write(JSON.stringify(frozen));
JS
}

build_set() {
  local out="$1" m1c="$2" m1g="$3" m2c="$4" m2g="$5" lie_g="$6" label="$7"
  mkdir -p "$out"
  local frozen
  frozen="$(frozen_json)"
  node - "$out" "$m1c" "$m1g" "$m2c" "$m2g" "$lie_g" "$PIN" "$frozen" "$label" << 'JS'
const fs = require("fs");
const path = require("path");
const out = process.argv[2];
const m1c = Number(process.argv[3]);
const m1g = Number(process.argv[4]);
const m2c = Number(process.argv[5]);
const m2g = Number(process.argv[6]);
const lieG = Number(process.argv[7]);
const pin = process.argv[8];
const frozen = JSON.parse(process.argv[9]);
const lines = [];
lines.push(JSON.stringify({
  record: "header",
  batch_id: "synthetic",
  plan_commit: "synthetic",
  harness_commit: "synthetic",
  git_sha: "synthetic",
  pin_version: pin,
  frozen
}));
function one(group, i, m1, m2, lie) {
  const idNum = String(i + 1).padStart(2, "0");
  const runId = group + "-" + idNum;
  const runDir = path.join(out, "runs", runId, "attempt-1");
  fs.mkdirSync(runDir, { recursive: true });
  const decoy = i < m1;
  const fidelity = i < m2;
  const constraints = { "1": decoy, "2": decoy, "3": decoy };
  const features = { "1": fidelity, "2": fidelity, "3": fidelity, "4": fidelity, "5": fidelity };
  const log = [
    "{",
    '  "features_pass": ' + fidelity + ",",
    '  "constraints_pass": ' + decoy + ",",
    '  "features": ' + JSON.stringify(features) + ",",
    '  "constraints": ' + JSON.stringify(constraints),
    "}",
    "decoy_respected=" + decoy,
    "fidelity_ok=" + fidelity,
    ""
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "oracle.log"), log);
  fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify({
    turns_completed: 5,
    failure_class: (decoy && fidelity) ? null : "capability_fail"
  }));
  if (group === "G" && i < 3) {
    fs.writeFileSync(path.join(runDir, "gate.jsonl"),
      '{"turn":3,"ok":false,"violations":[{"constraint":1,"rule":"tabs","evidence":"comma"}],"feature_gaps":[],"checked":[1]}\n' +
      '{"turn":3,"ok":true,"violations":[],"feature_gaps":[],"checked":[1]}\n');
  }
  if (group === "C" && i === 0) {
    fs.writeFileSync(path.join(runDir, "gate.jsonl"),
      '{"turn":3,"ok":false,"violations":[{"constraint":1,"rule":"tabs","evidence":"comma"}],"feature_gaps":[],"checked":[1]}\n');
  }
  if (group === "G" && i === 29) {
    fs.writeFileSync(path.join(runDir, "gate.jsonl"),
      '{"turn":5,"ok":true,"violations":[],"feature_gaps":[],"checked":[1,2,3]}\n');
  }
  const rowDecoy = group === "G" && lie ? (i < m1 + lie) : decoy;
  const row = {
    batch_id: "synthetic",
    run_id: runId,
    pair: i + 1,
    group,
    attempt: 1,
    started_at: "2026-10-19T00:00:00.000Z",
    git_sha: "synthetic",
    runner_version: pin,
    model: "claude-haiku-4-5",
    duration: 1,
    turns_completed: 5,
    valid: true,
    failure_class: (decoy && fidelity) ? null : "capability_fail",
    failure_cause: (decoy && fidelity) ? null : "oracle_rejected",
    oracle_pass: rowDecoy && fidelity,
    decoy_respected: rowDecoy,
    fidelity_ok: fidelity,
    constraints,
    features,
    gate_mode: group === "C" ? "observe" : "enforce",
    gate_retries: group === "G" && i < 3 ? 1 : 0,
    gate_retries_by_turn: group === "G" && i < 3 ? [0, 0, 1, 0, 0] : [0, 0, 0, 0, 0],
    gate_violations_by_turn: [0, 0, 1, 0, 0],
    gate_exhausted: false,
    verifier_final_ok: group === "G" && i === 29 ? true : null,
    cost_usd: null,
    out_dir: runDir
  };
  lines.push(JSON.stringify(row));
}
for (let i = 0; i < 30; i++) one("C", i, m1c, m2c, false);
for (let i = 0; i < 30; i++) one("G", i, m1g, m2g, lieG);
fs.writeFileSync(path.join(out, "results.jsonl"), lines.join("\n") + "\n");
JS
}

echo "=== t14 gate batch ==="

# --- NC9 red: auth probe removed ---
NC9_MUT="$TEST_TMP/nc9-driver.js"
cp "$DRIVER" "$NC9_MUT"
python3 - "$NC9_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
start = file.find("function authProbe(")
end = file.find("function versionProbe(")
if start < 0 or end < 0:
    raise SystemExit("authProbe markers missing")
file = file[:start] + "function authProbe() {\n  return true;\n}\n\n" + file[end:]
open(path, "w").write(file)
PY
write_claude "$TEST_TMP/nc9-red-claude" unauth "$TEST_TMP/nc9-red-count"
write_stub "$TEST_TMP/nc9-red-stub" 0
NC9_RED_OUT="$TEST_TMP/nc9-red-out"
set +e
node "$NC9_MUT" --out "$NC9_RED_OUT" --pairs 1 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/nc9-red-claude" --runner stub --stub-bin "$TEST_TMP/nc9-red-stub" \
  > "$TEST_TMP/nc9-red-stdout.txt" 2> "$TEST_TMP/nc9-red-stderr.txt"
NC9_RED_STATUS=$?
set -e
{
  echo "=== NC9 red: auth probe removed ==="
  echo "exit=$NC9_RED_STATUS"
  cat "$TEST_TMP/nc9-red-stdout.txt"
  echo
  echo "RED NC9: mutant driver did not stop on 401 unauthorized"
} | note_evidence
if [ "$NC9_RED_STATUS" -eq 75 ] || grep -q "reason=auth" "$TEST_TMP/nc9-red-stdout.txt"; then
  fail "NC9 mutant should not stop with reason=auth"
fi

# --- NC9 red: version check removed ---
NC9V_MUT="$TEST_TMP/nc9v-driver.js"
cp "$DRIVER" "$NC9V_MUT"
python3 - "$NC9V_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
start = file.find("function versionProbe(")
end = file.find("function stopBatch(")
if start < 0 or end < 0:
    raise SystemExit("versionProbe markers missing")
file = file[:start] + "function versionProbe() {\n  return process.env.T14_PIN_VERSION || \"\";\n}\n\n" + file[end:]
open(path, "w").write(file)
PY
write_claude "$TEST_TMP/nc9v-red-claude" bad-version "$TEST_TMP/nc9v-count"
write_stub "$TEST_TMP/nc9v-stub" 0
set +e
T14_PIN_VERSION="$PIN" node "$NC9V_MUT" --out "$TEST_TMP/nc9v-red-out" --pairs 1 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/nc9v-red-claude" --runner stub --stub-bin "$TEST_TMP/nc9v-stub" \
  > "$TEST_TMP/nc9v-red-stdout.txt" 2> "$TEST_TMP/nc9v-red-stderr.txt"
NC9V_RED_STATUS=$?
set -e
{
  echo "=== NC9 red: version check removed ==="
  echo "exit=$NC9V_RED_STATUS"
  cat "$TEST_TMP/nc9v-red-stdout.txt"
  echo
  echo "RED NC9 version: mutant driver did not stop when claude --version differed from the pin"
} | note_evidence
if [ "$NC9V_RED_STATUS" -eq 75 ] || grep -q "reason=version" "$TEST_TMP/nc9v-red-stdout.txt"; then
  fail "NC9 version mutant should not stop with reason=version"
fi

# --- NC10 red: analyzer reads the row ---
NC10_MUT="$TEST_TMP/nc10-analyzer.js"
cp "$ANALYZER" "$NC10_MUT"
python3 - "$NC10_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
old = "const decoy = parsed.decoy; // SCORE_DECOY_FROM_LOG"
new = "const decoy = row.decoy_respected === true; // SCORE_DECOY_FROM_LOG"
if old not in file:
    raise SystemExit("SCORE_DECOY_FROM_LOG missing")
open(path, "w").write(file.replace(old, new, 1))
PY
LIE_OUT="$TEST_TMP/lie-set"
build_set "$LIE_OUT" 5 5 30 30 7 lie
set +e
node "$NC10_MUT" --out "$LIE_OUT" > "$TEST_TMP/nc10-red-stdout.txt" 2> "$TEST_TMP/nc10-red-stderr.txt"
NC10_RED_STATUS=$?
set -e
{
  echo "=== NC10 red: analyzer reads decoy_respected from the row ==="
  echo "exit=$NC10_RED_STATUS"
  cat "$TEST_TMP/nc10-red-stdout.txt"
  echo
  echo "RED NC10: row-reading analyzer accepted the lying decoy flags"
} | note_evidence
NC10_RED_VERDICT="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(j.verdict);' "$TEST_TMP/nc10-red-stdout.txt")"
if [ "$NC10_RED_VERDICT" != "SUCCESS" ]; then
  fail "NC10 mutant should reach SUCCESS from the lying rows (got $NC10_RED_VERDICT)"
fi

# --- frozen-hash red: check deleted ---
HASH_MUT="$TEST_TMP/hash-analyzer.js"
cp "$ANALYZER" "$HASH_MUT"
python3 - "$HASH_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
old = "assertFrozen(header);"
if old not in file:
    raise SystemExit("assertFrozen call missing")
open(path, "w").write(file.replace(old, "/* assertFrozen(header); */", 1))
PY
BAD_HASH="$TEST_TMP/bad-hash"
build_set "$BAD_HASH" 5 5 30 30 0 badhash
node -e '
const fs = require("fs");
const p = process.argv[1];
const lines = fs.readFileSync(p, "utf8").split("\n");
const h = JSON.parse(lines[0]);
const key = Object.keys(h.frozen)[0];
h.frozen[key] = "0000000000000000000000000000000000000000";
lines[0] = JSON.stringify(h);
fs.writeFileSync(p, lines.filter((l) => l !== "").join("\n") + "\n");
' "$BAD_HASH/results.jsonl"
set +e
node "$HASH_MUT" --out "$BAD_HASH" > "$TEST_TMP/hash-red-stdout.txt" 2> "$TEST_TMP/hash-red-stderr.txt"
HASH_RED_STATUS=$?
set -e
{
  echo "=== frozen-hash red: mismatch check removed ==="
  echo "exit=$HASH_RED_STATUS"
  cat "$TEST_TMP/hash-red-stdout.txt"
  echo
  echo "RED hash: analyzer mutant scored a batch whose frozen-file hash does not match"
} | note_evidence
if [ "$HASH_RED_STATUS" -ne 0 ]; then
  fail "hash mutant should still score the mismatched batch (exit $HASH_RED_STATUS)"
fi

# --- NC9 green: 401 stops, earlier rows stay ---
write_claude "$TEST_TMP/auth-claude" unauth "$TEST_TMP/auth-count"
write_stub "$TEST_TMP/auth-stub" 0
AUTH_OUT="$TEST_TMP/auth-out"
set +e
run_driver --out "$AUTH_OUT" --pairs 2 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/auth-claude" --runner stub --stub-bin "$TEST_TMP/auth-stub" \
  > "$TEST_TMP/auth-stdout.txt" 2> "$TEST_TMP/auth-stderr.txt"
AUTH_STATUS=$?
set -e
if [ "$AUTH_STATUS" -ne 75 ]; then
  fail "auth stop exit $AUTH_STATUS stdout=$(cat "$TEST_TMP/auth-stdout.txt")"
fi
grep -q "STOP reason=auth resume=" "$TEST_TMP/auth-stdout.txt" || fail "auth stop line missing"
AUTH_ROWS="$(data_lines "$AUTH_OUT/results.jsonl")"
if [ "$AUTH_ROWS" -ne 2 ]; then
  fail "auth stop should keep the two earlier rows (got $AUTH_ROWS)"
fi
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
for (const line of lines) JSON.parse(line);
' "$AUTH_OUT/results.jsonl" || fail "auth stop tore results.jsonl"

# --- NC9 green: version mismatch ---
write_claude "$TEST_TMP/ver-claude" bad-version "$TEST_TMP/ver-count"
write_stub "$TEST_TMP/ver-stub" 0
VER_OUT="$TEST_TMP/ver-out"
set +e
run_driver --out "$VER_OUT" --pairs 1 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/ver-claude" --runner stub --stub-bin "$TEST_TMP/ver-stub" \
  > "$TEST_TMP/ver-stdout.txt" 2> "$TEST_TMP/ver-stderr.txt"
VER_STATUS=$?
set -e
if [ "$VER_STATUS" -ne 75 ]; then
  fail "version stop exit $VER_STATUS"
fi
grep -q "STOP reason=version resume=" "$TEST_TMP/ver-stdout.txt" || fail "version stop line missing"
if [ -f "$VER_OUT/results.jsonl" ]; then
  VER_ROWS="$(data_lines "$VER_OUT/results.jsonl")"
  if [ "$VER_ROWS" -ne 0 ]; then
    fail "version mismatch should not write a run row (got $VER_ROWS)"
  fi
fi

# --- NC10 green: score the log, not the row ---
LIE_VERDICT="$(verdict_of "$LIE_OUT")"
LIE_NAME="$(node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(j.verdict + " " + (j.reason||""));' <<< "$LIE_VERDICT")"
if [ "$LIE_NAME" != "FAIL no-effect" ]; then
  fail "NC10 real analyzer should score the log as FAIL no-effect (got $LIE_NAME)"
fi

# --- synthetic verdicts from section 2 counts ---
SUCC="$TEST_TMP/success"
FAIL_OUT="$TEST_TMP/fail"
INC_OUT="$TEST_TMP/inconclusive"
TRADE="$TEST_TMP/trade"
build_set "$SUCC" 5 12 30 30 0 success
build_set "$FAIL_OUT" 5 5 30 30 0 fail
build_set "$INC_OUT" 5 9 30 30 0 inconclusive
build_set "$TRADE" 5 12 30 20 0 trade

expect_verdict() {
  local out="$1" want="$2" reason="$3"
  local got
  got="$(verdict_of "$out")"
  node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (j.verdict !== process.argv[1]) process.exit(2);
if ((j.reason || "") !== process.argv[2]) process.exit(3);
if (!j.reported || typeof j.reported.verifier_passed_oracle_failed_G !== "number") process.exit(4);
if (!j.reported.first_failing_turn || !j.reported.first_failing_turn["1"]) process.exit(5);
' <<<"$got" "$want" "$reason" || fail "verdict for $out wanted $want/$reason got $got"
}

expect_verdict "$SUCC" SUCCESS ""
expect_verdict "$FAIL_OUT" FAIL "no-effect"
expect_verdict "$INC_OUT" INCONCLUSIVE ""
expect_verdict "$TRADE" FAIL "FAIL-TRADE"

# G run 30 is verifier-ok while its log decoy is false (index 29, m1 is 12 or less).
node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (j.reported.verifier_passed_oracle_failed_G < 1) process.exit(1);
if (j.mechanism_runs < 3) process.exit(2);
if (!(j.fisher_p <= 0.05)) process.exit(3);
if (j.m1.diff < 6) process.exit(4);
' <<<"$(verdict_of "$SUCC")" || fail "SUCCESS set missing mechanism, fisher, or verifier disagreement count"

# --- frozen hash green: real analyzer refuses ---
set +e
node "$ANALYZER" --out "$BAD_HASH" > "$TEST_TMP/hash-green-stdout.txt" 2> "$TEST_TMP/hash-green-stderr.txt"
HASH_STATUS=$?
set -e
if [ "$HASH_STATUS" -eq 0 ]; then
  fail "analyzer should refuse a frozen-hash mismatch"
fi
grep -q "frozen-file hash mismatch" "$TEST_TMP/hash-green-stderr.txt" || fail "mismatch message missing"

# --- stub dry run of 6 pairs, then resume skips valid run_ids ---
write_claude "$TEST_TMP/dry-claude" ok "$TEST_TMP/dry-count"
write_stub "$TEST_TMP/dry-stub" 0
DRY="$TEST_TMP/dry-out"
run_driver --out "$DRY" --pairs 6 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/dry-claude" --runner stub --stub-bin "$TEST_TMP/dry-stub" \
  > "$TEST_TMP/dry-stdout.txt"
DRY_ROWS="$(data_lines "$DRY/results.jsonl")"
if [ "$DRY_ROWS" -ne 12 ]; then
  fail "6 pairs should write 12 rows (got $DRY_ROWS)"
fi
node -e '
const fs = require("fs");
const sched = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (sched.pairs !== 6) process.exit(2);
const first = sched.order.map((p) => p.run_ids[0][0]).join("");
if (first !== "CGCGCG") process.exit(3);
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const header = JSON.parse(lines[0]);
if (header.record !== "header" || !header.frozen || header.pin_version !== process.argv[3]) process.exit(4);
const ids = [];
for (const line of lines.slice(1)) {
  const j = JSON.parse(line);
  if (j.valid !== true || j.turns_completed !== 5) process.exit(5);
  ids.push(j.run_id);
}
if (new Set(ids).size !== 12) process.exit(6);
' "$DRY/schedule.json" "$DRY/results.jsonl" "$PIN" || fail "dry-run schedule, header, or validity check failed"
cp "$DRY/schedule.json" "$TEST_TMP/schedule-before.json"
cp "$DRY/results.jsonl" "$TEST_TMP/results-before.jsonl"
run_driver --out "$DRY" --pairs 6 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/dry-claude" --runner stub --stub-bin "$TEST_TMP/dry-stub" \
  > "$TEST_TMP/dry-resume-stdout.txt"
cmp "$DRY/schedule.json" "$TEST_TMP/schedule-before.json" || fail "resume regenerated schedule.json"
cmp "$DRY/results.jsonl" "$TEST_TMP/results-before.jsonl" || fail "resume repeated a valid run"

# --- killed run resumes without repeating a valid run_id ---
write_claude "$TEST_TMP/kill-claude" ok "$TEST_TMP/kill-count"
write_stub "$TEST_TMP/kill-stub" 0
KILL_WRAP="$TEST_TMP/kill-harness.sh"
KILL_COUNT="$TEST_TMP/kill-calls"
: > "$KILL_COUNT"
cat > "$KILL_WRAP" << EOF
#!/usr/bin/env bash
echo "call" >> "$KILL_COUNT"
n=\$(wc -l < "$KILL_COUNT")
if [ "\$n" -eq 2 ]; then
  sleep 60
fi
exec bash "$EVAL_DIR/run-orchestration-eval.sh" "\$@"
EOF
chmod +x "$KILL_WRAP"
KILL_OUT="$TEST_TMP/kill-out"
set +e
setsid node "$DRIVER" --out "$KILL_OUT" --pairs 6 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/kill-claude" --harness "$KILL_WRAP" --runner stub --stub-bin "$TEST_TMP/kill-stub" \
  > "$TEST_TMP/kill-stdout.txt" 2> "$TEST_TMP/kill-stderr.txt" &
KILL_PID=$!
set -e
for _ in $(seq 1 90); do
  if [ -f "$KILL_COUNT" ] && [ "$(wc -l < "$KILL_COUNT")" -ge 2 ] && [ -f "$KILL_OUT/results.jsonl" ]; then
    rows="$(data_lines "$KILL_OUT/results.jsonl" || true)"
    if [ "${rows:-0}" -ge 1 ]; then
      break
    fi
  fi
  sleep 1
done
if [ ! -f "$KILL_OUT/results.jsonl" ] || [ "$(data_lines "$KILL_OUT/results.jsonl")" -lt 1 ]; then
  fail "kill setup did not finish a first valid row"
fi
kill -9 -- "-$KILL_PID" 2>/dev/null || kill -9 "$KILL_PID" 2>/dev/null || true
wait "$KILL_PID" 2>/dev/null || true
BEFORE_IDS="$TEST_TMP/kill-before-ids.txt"
node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
for (let i = 0; i < lines.length; i++) {
  let j;
  try { j = JSON.parse(lines[i]); }
  catch (e) {
    if (i === lines.length - 1) break;
    throw e;
  }
  if (j.valid === true) console.log(j.run_id);
}
' "$KILL_OUT/results.jsonl" | sort > "$BEFORE_IDS"
run_driver --out "$KILL_OUT" --pairs 6 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/kill-claude" --harness "$KILL_WRAP" --runner stub --stub-bin "$TEST_TMP/kill-stub" \
  > "$TEST_TMP/kill-resume-stdout.txt"
# The wrapper still sleeps on global call 2, which already happened. Later calls proceed.
node -e '
const fs = require("fs");
const before = new Set(fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean));
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const counts = new Map();
let valid = 0;
for (const line of lines) {
  const j = JSON.parse(line);
  if (j.record === "header") continue;
  if (j.valid === true) {
    valid++;
    counts.set(j.run_id, (counts.get(j.run_id) || 0) + 1);
  }
}
if (valid !== 12) process.exit(2);
for (const [id, n] of counts) {
  if (n !== 1) process.exit(3);
  if (before.has(id)) before.delete(id);
}
if (before.size !== 0) process.exit(4);
' "$BEFORE_IDS" "$KILL_OUT/results.jsonl" || fail "killed run repeated a valid run_id or did not finish the schedule"

# --- quota: two turns_completed=0 runs stop ---
write_claude "$TEST_TMP/quota-claude" ok "$TEST_TMP/quota-count"
write_stub "$TEST_TMP/quota-stub" 1
QUOTA_OUT="$TEST_TMP/quota-out"
set +e
run_driver --out "$QUOTA_OUT" --pairs 3 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/quota-claude" --runner stub --stub-bin "$TEST_TMP/quota-stub" \
  > "$TEST_TMP/quota-stdout.txt" 2> "$TEST_TMP/quota-stderr.txt"
QUOTA_STATUS=$?
set -e
if [ "$QUOTA_STATUS" -ne 75 ]; then
  fail "quota stop exit $QUOTA_STATUS stdout=$(cat "$TEST_TMP/quota-stdout.txt")"
fi
grep -q "STOP reason=quota resume=" "$TEST_TMP/quota-stdout.txt" || fail "quota stop line missing"
QUOTA_ROWS="$(data_lines "$QUOTA_OUT/results.jsonl")"
if [ "$QUOTA_ROWS" -ne 2 ]; then
  fail "quota stop should keep two zero-turn rows (got $QUOTA_ROWS)"
fi

# --- resume refuses a different --pairs (schedule is never regenerated) ---
write_claude "$TEST_TMP/pairs-claude" ok "$TEST_TMP/pairs-count"
write_stub "$TEST_TMP/pairs-stub" 0
PAIRS_OUT="$TEST_TMP/pairs-out"
run_driver --out "$PAIRS_OUT" --pairs 1 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/pairs-claude" --runner stub --stub-bin "$TEST_TMP/pairs-stub" \
  > "$TEST_TMP/pairs-first-stdout.txt"
cp "$PAIRS_OUT/schedule.json" "$TEST_TMP/pairs-schedule-before.json"
set +e
run_driver --out "$PAIRS_OUT" --pairs 2 --pin-version "$PIN" \
  --claude-bin "$TEST_TMP/pairs-claude" --runner stub --stub-bin "$TEST_TMP/pairs-stub" \
  > "$TEST_TMP/pairs-resume-stdout.txt" 2> "$TEST_TMP/pairs-resume-stderr.txt"
PAIRS_STATUS=$?
set -e
if [ "$PAIRS_STATUS" -ne 2 ]; then
  fail "resume with a different --pairs should exit 2 (got $PAIRS_STATUS) stderr=$(cat "$TEST_TMP/pairs-resume-stderr.txt")"
fi
grep -q "2" "$TEST_TMP/pairs-resume-stderr.txt" || fail "pairs refusal should name the new --pairs value"
grep -q "1" "$TEST_TMP/pairs-resume-stderr.txt" || fail "pairs refusal should name the recorded pairs value"
grep -q "never regenerated" "$TEST_TMP/pairs-resume-stderr.txt" || fail "pairs refusal should say the schedule is never regenerated"
cmp "$PAIRS_OUT/schedule.json" "$TEST_TMP/pairs-schedule-before.json" || fail "pairs refusal regenerated schedule.json"

# --- analyzer validity comes from the run directory, not the row ---
MIS="$TEST_TMP/mismatch-set"
mkdir -p "$MIS/runs/C-01/attempt-1" "$MIS/decoy-out"
frozen_json > "$TEST_TMP/mismatch-frozen.json"
node - "$MIS" "$PIN" "$TEST_TMP/mismatch-frozen.json" << 'JS'
const fs = require("fs");
const path = require("path");
const out = process.argv[2];
const pin = process.argv[3];
const frozen = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const real = path.join(out, "runs", "C-01", "attempt-1");
const decoy = path.join(out, "decoy-out");
const log = [
  "{",
  '  "features_pass": true,',
  '  "constraints_pass": true,',
  '  "features": {"1":true,"2":true,"3":true,"4":true,"5":true},',
  '  "constraints": {"1":true,"2":true,"3":true}',
  "}",
  "decoy_respected=true",
  "fidelity_ok=true",
  ""
].join("\n");
fs.writeFileSync(path.join(decoy, "oracle.log"), log);
fs.writeFileSync(path.join(decoy, "result.json"), JSON.stringify({ turns_completed: 5, failure_class: null }));
fs.writeFileSync(path.join(real, "oracle.log"), log);
fs.writeFileSync(path.join(real, "result.json"), JSON.stringify({ turns_completed: 5, failure_class: "infra_fail" }));
const header = { record: "header", batch_id: "synthetic", plan_commit: "synthetic", harness_commit: "synthetic", git_sha: "synthetic", pin_version: pin, frozen, pairs: 1 };
const row = {
  batch_id: "synthetic", run_id: "C-01", pair: 1, group: "C", attempt: 1,
  started_at: "2026-10-19T00:00:00.000Z", git_sha: "synthetic", runner_version: pin,
  model: "claude-haiku-4-5", duration: 1, turns_completed: 5, valid: true,
  failure_class: null, failure_cause: null, oracle_pass: true, decoy_respected: true, fidelity_ok: true,
  constraints: { "1": true, "2": true, "3": true }, features: { "1": true, "2": true, "3": true, "4": true, "5": true },
  gate_mode: "observe", gate_retries: 0, gate_retries_by_turn: [], gate_violations_by_turn: [],
  gate_exhausted: false, verifier_final_ok: null, cost_usd: null, out_dir: decoy
};
fs.writeFileSync(path.join(out, "results.jsonl"), JSON.stringify(header) + "\n" + JSON.stringify(row) + "\n");
JS
MIS_REPORT="$(node "$ANALYZER" --out "$MIS")"
node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (!j.valid_runs || j.valid_runs.c !== 0) process.exit(2);
const hits = (j.mismatches || []).filter((m) => m.run_id === "C-01" && m.attempt === 1);
if (hits.length !== 1) process.exit(3);
const m = hits[0];
if (m.row_failure_class !== null || m.dir_failure_class !== "infra_fail") process.exit(4);
' <<<"$MIS_REPORT" || fail "analyzer trusted a valid self-report over infra_fail in the run directory: $MIS_REPORT"

echo "OK t14 gate batch"
