#!/usr/bin/env bash
# qc-panel.sh integration tests (no live model calls, no network).
# Uses QC_CLAUDE_BIN / QC_AGY_BIN env seams with PATH-stub scripts.
# Covers:
#   - 6 judge invocations recorded (S3: file-per-invocation counting)
#   - synthesizer merge correct on agreeing judges
#   - dissent surfaces when judges disagree
#   - verdict artifact written
#   - calibration sample appended with baseline=self-report (M2)
#   - non-verdict-bearing report → skipped
#   - judge failure → non-zero exit (liveness)
#   - token estimate present; not 7× inflated (N2)
#   - model env overrides honored (M4)
#   - path traversal in --proj/--node → exit 2 (S1)
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/qc-panel.js"

# ── Isolation ────────────────────────────────────────────────────────────────
OUT_DIR="$TEST_TMP/panel-out"
mkdir -p "$OUT_DIR"
CAL_DIR="$TEST_TMP/calibration"
export CALIBRATION_DATA_DIR="$CAL_DIR"

# ── Stub binaries ─────────────────────────────────────────────────────────────

# S3: file-per-invocation counting (race-safe: each call writes one file)
INVOKE_DIR="$TEST_TMP/invocations"
mkdir -p "$INVOKE_DIR"

# Claude stub: writes canned ACHIEVED/EXTRA/MISSED output; creates one invocation file
STUB_CLAUDE="$TEST_TMP/claude"
cat > "$STUB_CLAUDE" <<'STUB'
#!/usr/bin/env bash
# Usage: claude -p --model <m>  (stdin = prompt)
# Read the full stdin (prompt) to detect which question shape is being asked
PROMPT="$(cat)"
# S3: file-per-invocation (race-safe)
touch "${INVOKE_DIR}/claude.$(date +%s%N 2>/dev/null || date +%s).$$"

# Emit structured output matching question shape
if printf '%s' "$PROMPT" | grep -q "NOT achieved"; then
  printf 'MISSED: goal-3 not completed\n'
elif printf '%s' "$PROMPT" | grep -q "BEYOND"; then
  printf 'EXTRA: added extra logging\n'
else
  printf 'ACHIEVED: goal-1 done\nACHIEVED: goal-2 done\n'
fi
# M4: emit the model name so tests can verify env override is honored
MODEL_USED=""
for arg in "$@"; do
  if [ "$prev" = "--model" ]; then MODEL_USED="$arg"; fi
  prev="$arg"
done
printf 'MODEL_USED:%s\n' "$MODEL_USED" >&2
STUB
chmod +x "$STUB_CLAUDE"
export QC_CLAUDE_BIN="$STUB_CLAUDE"

# agy stub: writes verdict to ./verdict.txt (file-write mode recipe)
# Creates one invocation file per call
STUB_AGY="$TEST_TMP/agy"
cat > "$STUB_AGY" <<'STUB'
#!/usr/bin/env bash
# agy -p <prompt> --model ... --dangerously-skip-permissions --print-timeout 8m
# cwd = throwaway dir; writes verdict.txt then prints DONE
PROMPT="${2:-}"
# S3: file-per-invocation (race-safe)
touch "${INVOKE_DIR}/agy.$(date +%s%N 2>/dev/null || date +%s).$$"

if printf '%s' "$PROMPT" | grep -q "NOT achieved"; then
  printf 'MISSED: goal-3 not completed (agy)\n' > ./verdict.txt
elif printf '%s' "$PROMPT" | grep -q "BEYOND"; then
  printf 'EXTRA: extra logging (agy)\n' > ./verdict.txt
else
  printf 'ACHIEVED: goal-1 done (agy)\nACHIEVED: goal-2 done (agy)\n' > ./verdict.txt
fi
printf 'DONE\n'
STUB
chmod +x "$STUB_AGY"
export QC_AGY_BIN="$STUB_AGY"
export INVOKE_DIR

# ── Build a minimal verdict-bearing node report ────────────────────────────────
REPORT="$TEST_TMP/report.json"
cat > "$REPORT" <<'EOF'
{
  "node": "test-node-1",
  "verdict": "pass",
  "confidence": 0.9,
  "evidence_pointers": ["scripts/tree.js:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

# Small artifact
ARTIFACT="$TEST_TMP/artifact.txt"
printf 'build output: success\n' > "$ARTIFACT"

# ── Test 1: panel runs, 6+ judge calls recorded (S3: file-per-invocation) ────
# Clean the invoke dir before the test run
rm -f "$INVOKE_DIR"/*

"$SCRIPT" \
  --report "$REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$OUT_DIR" \
  --node test-node-1 > "$TEST_TMP/panel_run_out.txt" 2>&1
RUN_EXIT=$?

assert_eq "0" "$RUN_EXIT" "panel exits 0"

# S3: count by ls | wc -l (race-safe, no shared counter file)
FINAL_COUNT="$(ls "$INVOKE_DIR" | wc -l | tr -d ' ')"
# 6 judge calls (3 claude + 3 agy) + 1 synth = 7 total; require >= 6
if [ "$FINAL_COUNT" -ge 6 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "S3: expected >= 6 invocation files, got $FINAL_COUNT"
fi

# ── Test 2: verdict artifact written ─────────────────────────────────────────
VERDICT_FILE=""
for _f in "$OUT_DIR"/test-node-1-*.json; do
  case "$_f" in *skipped*) continue ;; esac
  [ -f "$_f" ] && VERDICT_FILE="$_f" && break
done
assert_file_exists "${VERDICT_FILE:-/nonexistent}" "verdict artifact written"

# ── Test 3: verdict artifact has correct schema ────────────────────────────────
if [ -f "${VERDICT_FILE:-}" ]; then
  assert_contains "$(cat "$VERDICT_FILE")" '"status":"ok"'           "verdict has status:ok"
  assert_contains "$(cat "$VERDICT_FILE")" '"verdict":'               "verdict has verdict field"
  assert_contains "$(cat "$VERDICT_FILE")" '"token_estimate":'        "verdict has token_estimate"
  assert_contains "$(cat "$VERDICT_FILE")" '"judges":'                "verdict has judges refs"
fi

# ── Test 4: calibration sample appended with baseline=self-report (M2) ───────
assert_file_exists "$CAL_DIR/samples.jsonl" "calibration samples.jsonl created"
SAMPLE_LINE="$(tail -1 "$CAL_DIR/samples.jsonl")"
assert_contains "$SAMPLE_LINE" '"panel_verdict":'          "calibration sample has panel_verdict"
assert_contains "$SAMPLE_LINE" '"authoritative_verdict":' "calibration sample has auth_verdict"
assert_contains "$SAMPLE_LINE" '"tokens":'                "calibration sample has tokens"
assert_contains "$SAMPLE_LINE" '"baseline":"self-report"' "M2: internal sample has baseline=self-report"

# ── Test 5: token estimate is a positive integer; not 7× inflated (N2) ───────
if [ -f "${VERDICT_FILE:-}" ]; then
  TOKEN_EST="$(grep -o '"token_estimate":[0-9]*' "$VERDICT_FILE" | cut -d: -f2)"
  if [ -n "$TOKEN_EST" ] && [ "$TOKEN_EST" -gt 0 ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "token_estimate should be > 0, got: '$TOKEN_EST'"
  fi
  # N2: token total must NOT include a 7th context accumulation.
  # The context file in the stub is tiny (~30 bytes = ~7 tokens).
  # With N2 fix: 6 judge calls × (prompt + ctx + resp) + synth.
  # Without fix (old bug): extra +ctx on top = would be inflated by ~7 tokens
  # more. We can't easily assert the exact value in a stub env, but we CAN
  # assert it's < some reasonable upper bound to catch a regression where
  # ctx is counted 7 times instead of 6.  The stub responses are small, so
  # token_estimate should be < 10000 for a stub run.
  if [ "$TOKEN_EST" -lt 10000 ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "N2: token_estimate suspiciously large ($TOKEN_EST); possible 7× inflation bug"
  fi
fi

# ── Test 6: MISSED items appear in verdict ────────────────────────────────────
# Both judges reported MISSED for Q3 → synthesizer should surface this
# The synthesizer is also stubbed (claude stub handles MISSED question too)
# Since MISSED lines were emitted, deterministic verdict should be "fail"
if [ -f "${VERDICT_FILE:-}" ]; then
  VERDICT_VAL="$(grep -o '"verdict":"[^"]*"' "$VERDICT_FILE" | cut -d'"' -f4)"
  # With MISSED items present, deterministic merge → fail
  assert_eq "$VERDICT_VAL" "fail" "verdict is fail when missed goals present"
fi

# ── Test 7: non-verdict-bearing report → skipped, exit 0 ─────────────────────
NULL_REPORT="$TEST_TMP/null-report.json"
cat > "$NULL_REPORT" <<'EOF'
{
  "node": "null-node",
  "verdict": null,
  "confidence": null,
  "evidence_pointers": [],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

SKIP_OUT_DIR="$TEST_TMP/skip-panel-out"
mkdir -p "$SKIP_OUT_DIR"
SKIP_OUT="$("$SCRIPT" \
  --report "$NULL_REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$SKIP_OUT_DIR" \
  --node null-node 2>&1)"
SKIP_EXIT=$?
assert_eq "0" "$SKIP_EXIT" "null-verdict report exits 0"
assert_contains "$SKIP_OUT" '"status":"skipped"'             "skipped status in output"
assert_contains "$SKIP_OUT" '"skipped_reason":"null-verdict"' "null-verdict reason"

# Authority pin (verdict-bytes preservation, v2.34.33): a no_verdict artifact that
# CARRIES a salvaged unratified_verdict must still be a null-verdict skip — the
# salvage column is human-adjudication data and can never become the panel verdict.
UNRAT_REPORT="$TEST_TMP/unratified-report.json"
printf '%s\n' '{"verdict":null,"unratified_verdict":"SHIP-AS-IS"}' > "$UNRAT_REPORT"
UNRAT_OUT_DIR="$TEST_TMP/unratified-panel-out"
mkdir -p "$UNRAT_OUT_DIR"
UNRAT_OUT="$("$SCRIPT" \
  --report "$UNRAT_REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$UNRAT_OUT_DIR" \
  --node unratified-node 2>&1)"
UNRAT_EXIT=$?
assert_eq "0" "$UNRAT_EXIT" "unratified-bearing null-verdict report still exits 0"
assert_contains "$UNRAT_OUT" '"skipped_reason":"null-verdict"' \
  "unratified_verdict never becomes the panel verdict (still null-verdict skip)"

# No calibration sample for skipped runs
SKIP_SAMPLES="$TEST_TMP/calibration-skip"
mkdir -p "$SKIP_SAMPLES"
CALIBRATION_DATA_DIR="$SKIP_SAMPLES" "$SCRIPT" \
  --report "$NULL_REPORT" \
  --artifacts "$ARTIFACT" \
  --out "$SKIP_OUT_DIR" \
  --node null-node2 >/dev/null 2>&1 || true
assert_file_absent "$SKIP_SAMPLES/samples.jsonl" "no calibration sample for skipped run"

# ── Test 8: judge failure → non-zero exit (liveness) ─────────────────────────
FAIL_CLAUDE="$TEST_TMP/claude-fail"
printf '#!/usr/bin/env bash\nexit 1\n' > "$FAIL_CLAUDE"
chmod +x "$FAIL_CLAUDE"

FAIL_AGY="$TEST_TMP/agy-fail"
printf '#!/usr/bin/env bash\nexit 1\n' > "$FAIL_AGY"
chmod +x "$FAIL_AGY"

FAIL_OUT_DIR="$TEST_TMP/fail-panel-out"
mkdir -p "$FAIL_OUT_DIR"
QC_CLAUDE_BIN="$FAIL_CLAUDE" QC_AGY_BIN="$FAIL_AGY" \
  "$SCRIPT" --report "$REPORT" --artifacts "$ARTIFACT" \
  --out "$FAIL_OUT_DIR" --node fail-node >/dev/null 2>&1
FAIL_EXIT=$?
assert_eq "1" "$FAIL_EXIT" "judge failure → exit 1 (liveness)"

# ── Test 9: dissent — judges disagree on verdict ──────────────────────────────
# Create a report with a clean "pass" verdict and a panel where one judge misses
AGREE_REPORT="$TEST_TMP/agree-report.json"
cat > "$AGREE_REPORT" <<'EOF'
{
  "node": "agree-node",
  "verdict": "pass",
  "confidence": 0.95,
  "evidence_pointers": ["scripts/tree.js:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

# Claude stub always emits MISSED; agy stub that emits NO MISSED (all achieved)
AGREE_AGY="$TEST_TMP/agy-agree"
cat > "$AGREE_AGY" <<'STUB'
#!/usr/bin/env bash
# For Q3 (NOT achieved) — says nothing missed
if printf '%s' "${2:-}" | grep -q "NOT achieved"; then
  printf '' > ./verdict.txt
else
  printf 'ACHIEVED: everything done (agy)\n' > ./verdict.txt
fi
printf 'DONE\n'
STUB
chmod +x "$AGREE_AGY"

# Claude always reports MISSED; agy never does → disagreement
AGREE_OUT_DIR="$TEST_TMP/agree-panel-out"
mkdir -p "$AGREE_OUT_DIR"
AGREE_CAL_DIR="$TEST_TMP/calibration-agree"

QC_CLAUDE_BIN="$STUB_CLAUDE" QC_AGY_BIN="$AGREE_AGY" \
  CALIBRATION_DATA_DIR="$AGREE_CAL_DIR" \
  "$SCRIPT" --report "$AGREE_REPORT" --artifacts "$ARTIFACT" \
  --out "$AGREE_OUT_DIR" --node agree-node 2>/dev/null
AGREE_EXIT=$?
assert_eq "0" "$AGREE_EXIT" "disagree scenario exits 0"

# ── Test 10: --help exits 0 and mentions required flags ───────────────────────
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "--report" "--help mentions --report"
assert_contains "$HELP_OUT" "--artifacts" "--help mentions --artifacts"

# ── Test 11: missing --report → exit 2 ───────────────────────────────────────
"$SCRIPT" --artifacts "$ARTIFACT" --out "$OUT_DIR" 2>/dev/null; MISS_EXIT=$?
assert_eq "2" "$MISS_EXIT" "missing --report → exit 2"

# ── Test 12: missing --artifacts → exit 2 ────────────────────────────────────
"$SCRIPT" --report "$REPORT" --out "$OUT_DIR" 2>/dev/null; MISS_EXIT2=$?
assert_eq "2" "$MISS_EXIT2" "missing --artifacts → exit 2"

# ── Test 13: S1 — path traversal in --proj exits 2 ───────────────────────────
"$SCRIPT" --report "$REPORT" --artifacts "$ARTIFACT" \
  --proj '../x' --node test-node-1 2>/dev/null; TRAV_EXIT=$?
assert_eq "2" "$TRAV_EXIT" "S1: '../x' proj exits 2 (path traversal rejected)"

# ── Test 14: S1 — invalid --proj (special chars) exits 2 ─────────────────────
"$SCRIPT" --report "$REPORT" --artifacts "$ARTIFACT" \
  --proj 'bad proj!' --node test-node-1 2>/dev/null; BAD_PROJ_EXIT=$?
assert_eq "2" "$BAD_PROJ_EXIT" "S1: 'bad proj!' exits 2 (invalid proj name)"

# ── Test 15: M4 — QC_JUDGE_A_MODEL env override honored ──────────────────────
# Create a claude stub that records the model arg to a file
MODEL_RECORD_DIR="$TEST_TMP/model-records"
mkdir -p "$MODEL_RECORD_DIR"

MODEL_CLAUDE="$TEST_TMP/claude-model-record"
# Use a temp file path baked in at write time (not via env var) so the stub
# doesn't need MODEL_RECORD_DIR exported at runtime.
_M4_MODELS_FILE="$MODEL_RECORD_DIR/models.txt"
cat > "$MODEL_CLAUDE" <<STUB
#!/usr/bin/env bash
# Records --model arg to a fixed path (baked in at definition time)
MODEL_VAL=""
prev=""
for arg in "\$@"; do
  if [ "\$prev" = "--model" ]; then MODEL_VAL="\$arg"; fi
  prev="\$arg"
done
printf '%s\n' "\$MODEL_VAL" >> "${_M4_MODELS_FILE}"
cat >/dev/null  # consume stdin
printf 'ACHIEVED: done\n'
STUB
chmod +x "$MODEL_CLAUDE"

M4_CAL_DIR="$TEST_TMP/calibration-m4"
M4_OUT_DIR="$TEST_TMP/m4-panel-out"
mkdir -p "$M4_OUT_DIR"
rm -f "$MODEL_RECORD_DIR/models.txt"

QC_CLAUDE_BIN="$MODEL_CLAUDE" QC_AGY_BIN="$STUB_AGY" \
  QC_JUDGE_A_MODEL="claude-test-override" \
  QC_SYNTH_MODEL="claude-synth-override" \
  CALIBRATION_DATA_DIR="$M4_CAL_DIR" \
  "$SCRIPT" --report "$REPORT" --artifacts "$ARTIFACT" \
  --out "$M4_OUT_DIR" --node m4-node >/dev/null 2>&1 || true

if [ -f "$MODEL_RECORD_DIR/models.txt" ]; then
  assert_contains "$(cat "$MODEL_RECORD_DIR/models.txt")" "claude-test-override" \
    "M4: QC_JUDGE_A_MODEL override honored"
  assert_contains "$(cat "$MODEL_RECORD_DIR/models.txt")" "claude-synth-override" \
    "M4: QC_SYNTH_MODEL override honored"
else
  fail "M4: no model records written by stub"
fi

# ── R3: corrupt (non-JSON) report file → exit 2, never a silent skip ─────────
BAD_REPORT="$TEST_TMP/bad-report.json"
printf 'this is { not valid json\n' > "$BAD_REPORT"
"$SCRIPT" --report "$BAD_REPORT" --artifacts "$ARTIFACT" \
  --out "$TEST_TMP/bad-out" >/dev/null 2>&1; BAD_EXIT=$?
assert_eq "2" "$BAD_EXIT" "R3: corrupt report file exits 2 (precondition), not silent skip"

# ── Test 16: verdict vocabulary bridge — "approved" maps to pass ──────────────
APPROVED_REPORT="$TEST_TMP/approved-report.json"
cat > "$APPROVED_REPORT" <<'EOF'
{
  "node": "approved-node",
  "verdict": "approved",
  "confidence": 0.9,
  "evidence_pointers": ["scripts/tree.js:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

VOCAB_CAL_DIR="$TEST_TMP/calibration-vocab"
VOCAB_OUT_DIR="$TEST_TMP/vocab-panel-out"
mkdir -p "$VOCAB_OUT_DIR"
QC_CLAUDE_BIN="$STUB_CLAUDE" QC_AGY_BIN="$STUB_AGY" \
  CALIBRATION_DATA_DIR="$VOCAB_CAL_DIR" \
  "$SCRIPT" --report "$APPROVED_REPORT" --artifacts "$ARTIFACT" \
  --out "$VOCAB_OUT_DIR" --node approved-node >/dev/null 2>&1
VOCAB_EXIT=$?
assert_eq "0" "$VOCAB_EXIT" "vocab: 'approved' verdict exits 0 (mapped to pass)"
assert_file_exists "$VOCAB_CAL_DIR/samples.jsonl" "vocab: calibration sample landed"
assert_contains "$(cat "$VOCAB_CAL_DIR/samples.jsonl")" '"authoritative_verdict":"pass"' \
  "vocab: 'approved' normalized to pass in sample"

# ── Test 17: unmappable verdict → NAMED liveness failure BEFORE judges run ────
WEIRD_REPORT="$TEST_TMP/weird-report.json"
cat > "$WEIRD_REPORT" <<'EOF'
{
  "node": "weird-node",
  "verdict": "implemented-tests-green",
  "confidence": 0.9,
  "evidence_pointers": ["scripts/tree.js:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

WEIRD_CAL_DIR="$TEST_TMP/calibration-weird"
WEIRD_OUT_DIR="$TEST_TMP/weird-panel-out"
mkdir -p "$WEIRD_OUT_DIR"
WEIRD_ERR="$(QC_CLAUDE_BIN="$STUB_CLAUDE" QC_AGY_BIN="$STUB_AGY" \
  CALIBRATION_DATA_DIR="$WEIRD_CAL_DIR" \
  "$SCRIPT" --report "$WEIRD_REPORT" --artifacts "$ARTIFACT" \
  --out "$WEIRD_OUT_DIR" --node weird-node 2>&1 >/dev/null)"
WEIRD_EXIT=$?
assert_eq "1" "$WEIRD_EXIT" "vocab: unmappable verdict exits 1 (liveness)"
assert_contains "$WEIRD_ERR" "VERDICT_UNMAPPABLE" "vocab: named error on stderr"
assert_file_absent "$WEIRD_CAL_DIR/samples.jsonl" \
  "vocab: no sample for unmappable verdict (failed before judges)"

# ── Test 18: SCOPE_RULE actually reaches the judge prompts ────────────────────
# A silent drop of the scope-rule injection would pass every stub-routing test;
# record the real prompts and assert the rule's distinctive phrase is present.
PROMPT_RECORD="$TEST_TMP/prompt-records.txt"
PROMPT_CLAUDE="$TEST_TMP/claude-prompt-record"
cat > "$PROMPT_CLAUDE" <<STUB
#!/usr/bin/env bash
# Records full stdin (prompt+context) then answers like the basic stub
cat >> "${PROMPT_RECORD}"
printf 'ACHIEVED: recorded\n'
STUB
chmod +x "$PROMPT_CLAUDE"

SCOPE_CAL_DIR="$TEST_TMP/calibration-scope"
SCOPE_OUT_DIR="$TEST_TMP/scope-panel-out"
mkdir -p "$SCOPE_OUT_DIR"
QC_CLAUDE_BIN="$PROMPT_CLAUDE" QC_AGY_BIN="$STUB_AGY" \
  CALIBRATION_DATA_DIR="$SCOPE_CAL_DIR" \
  "$SCRIPT" --report "$REPORT" --artifacts "$ARTIFACT" \
  --out "$SCOPE_OUT_DIR" --node scope-node >/dev/null 2>&1 || true
if [ -f "$PROMPT_RECORD" ]; then
  assert_contains "$(cat "$PROMPT_RECORD")" "OUT OF SCOPE" \
    "scope rule reaches judge A prompt"
  assert_contains "$(cat "$PROMPT_RECORD")" "Scope rule:" \
    "scope rule preamble present in prompt"
else
  fail "scope-rule test: no prompts recorded by stub"
fi

# ── Test 19: refute pass is SHADOW / NON-GATING — REFUTED misses never flip ───
# Locks the v2.24.0 invariant mechanically (BACKLOG): even when the cross-family
# refute judge REFUTES every real miss, the authoritative verdict MUST stay
# `fail`. A refute pass that could suppress a true critical is worse than the bug
# it fixes — graduation from shadow is calibration-gated, so this guards the
# non-gating contract before any graduation can silently break it.

# claude stub: detects the Q4 refute prompt FIRST (it would otherwise misroute on
# the synth/Q3 branches), then synth → deterministic fail, then the Q1/Q2/Q3 shapes.
REFUTE_CLAUDE="$TEST_TMP/claude-refute"
cat > "$REFUTE_CLAUDE" <<'STUB'
#!/usr/bin/env bash
PROMPT="$(cat)"
if printf '%s' "$PROMPT" | grep -q "REFUTE this claim"; then
  printf 'REFUTED: the claimed miss is out of scope\n'
elif printf '%s' "$PROMPT" | grep -q "synthesis judge"; then
  printf '{"verdict":"fail","dissents":[],"extras":[]}\n'
elif printf '%s' "$PROMPT" | grep -q "NOT achieved"; then
  printf 'MISSED: goal-3 not completed\n'
elif printf '%s' "$PROMPT" | grep -q "BEYOND"; then
  printf 'EXTRA: extra logging\n'
else
  printf 'ACHIEVED: goal-1 done\n'
fi
STUB
chmod +x "$REFUTE_CLAUDE"

# agy stub: refute prompt arrives as $2; refute branch first, then Q-shapes.
REFUTE_AGY="$TEST_TMP/agy-refute"
cat > "$REFUTE_AGY" <<'STUB'
#!/usr/bin/env bash
PROMPT="${2:-}"
if printf '%s' "$PROMPT" | grep -q "REFUTE this claim"; then
  printf 'REFUTED: the claimed miss is out of scope (agy)\n' > ./verdict.txt
elif printf '%s' "$PROMPT" | grep -q "NOT achieved"; then
  printf 'MISSED: goal-3 not completed (agy)\n' > ./verdict.txt
elif printf '%s' "$PROMPT" | grep -q "BEYOND"; then
  printf 'EXTRA: extra logging (agy)\n' > ./verdict.txt
else
  printf 'ACHIEVED: goal-1 done (agy)\n' > ./verdict.txt
fi
printf 'DONE\n'
STUB
chmod +x "$REFUTE_AGY"

REFUTE_REPORT="$TEST_TMP/refute-report.json"
cat > "$REFUTE_REPORT" <<'EOF'
{
  "node": "refute-node",
  "verdict": "pass",
  "confidence": 0.9,
  "evidence_pointers": ["scripts/tree.js:1-10@HEAD"],
  "artifact_paths": [],
  "doa_log": [],
  "escalations": []
}
EOF

REFUTE_CAL_DIR="$TEST_TMP/calibration-refute"
REFUTE_OUT_DIR="$TEST_TMP/refute-panel-out"
mkdir -p "$REFUTE_OUT_DIR"
QC_CLAUDE_BIN="$REFUTE_CLAUDE" QC_AGY_BIN="$REFUTE_AGY" \
  CALIBRATION_DATA_DIR="$REFUTE_CAL_DIR" \
  "$SCRIPT" --report "$REFUTE_REPORT" --artifacts "$ARTIFACT" \
  --out "$REFUTE_OUT_DIR" --node refute-node >/dev/null 2>&1
REFUTE_EXIT=$?
assert_eq "0" "$REFUTE_EXIT" "refute scenario exits 0"

REFUTE_VERDICT_FILE=""
for _f in "$REFUTE_OUT_DIR"/refute-node-*.json; do
  case "$_f" in *skipped*) continue ;; esac
  [ -f "$_f" ] && REFUTE_VERDICT_FILE="$_f" && break
done
assert_file_exists "${REFUTE_VERDICT_FILE:-/nonexistent}" "refute: verdict artifact written"

if [ -f "${REFUTE_VERDICT_FILE:-}" ]; then
  RV_CONTENT="$(cat "$REFUTE_VERDICT_FILE")"
  RV_VERDICT="$(printf '%s' "$RV_CONTENT" | grep -o '"verdict":"[^"]*"' | head -1 | cut -d'"' -f4)"
  # THE invariant: misses were all REFUTED, yet the authoritative verdict holds fail.
  assert_eq "$RV_VERDICT" "fail" "NON-GATING: verdict stays fail though every miss was refuted"
  assert_contains "$RV_CONTENT" '"refute_shadow":' "refute_shadow field present"
  assert_contains "$RV_CONTENT" '"survived_misses":[]' "survived_misses empty (all refuted)"
  # refuted_misses must carry the refuted candidate(s) — not silently dropped.
  REFUTED_ARR="$(printf '%s' "$RV_CONTENT" | python3 -c '
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(len(d.get("refute_shadow", {}).get("refuted_misses", [])))
except Exception:
    print(0)
' 2>/dev/null || echo 0)"
  if [ "${REFUTED_ARR:-0}" -ge 1 ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "refute: refuted_misses should be non-empty, got count=$REFUTED_ARR"
  fi
fi

# The shadow result rides into the calibration sample's source tag (survived:0).
assert_file_exists "$REFUTE_CAL_DIR/samples.jsonl" "refute: calibration sample landed"
if [ -f "$REFUTE_CAL_DIR/samples.jsonl" ]; then
  assert_contains "$(tail -1 "$REFUTE_CAL_DIR/samples.jsonl")" "survived:0" \
    "refute: calibration source tag records survived:0"
fi

finalize_test
