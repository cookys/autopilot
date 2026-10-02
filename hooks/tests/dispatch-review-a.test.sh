#!/usr/bin/env bash
# dispatch-review.sh test, shard a (split from dispatch-review.test.sh for wall time).
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

# 1. --help
HELP_OUT="$("$SCRIPT" --help 2>&1)"; assert_eq "0" "$?" "--help exit code"
assert_contains "$HELP_OUT" "READ-ONLY" "--help states read-only"

# 2. preconditions → exit 2
OUT="$("$SCRIPT" --model x --diff-file "$DIFF" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --runner exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing runner precondition"
OUT="$("$SCRIPT" --runner bogus --model x --diff-file "$DIFF" 2>&1)"; assert_eq "2" "$?" "bad runner exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file /nonexistent-diff 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing diff-file exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file "$DIFF" --spec-file /nonexistent-spec 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing spec-file exit 2"
OUT="$("$SCRIPT" --runner codex --model x --diff-file "$DIFF" --effort turbo 2>&1)"; assert_eq "2" "$?" "bad effort exit 2"

# 2b. --max-tokens validation is strict, JSON-valid, and happens before any runner spawn.
for VALUE in 0 -1 1.5 01 abc 200001 999999999999999999999999999999; do
  SPAWN_MARKER_FILE="$TEST_TMP/invalid-max-spawn-$VALUE"; export SPAWN_MARKER_FILE
  rm -f "$SPAWN_MARKER_FILE"
  OUT="$("$SCRIPT" --runner qoderclicn --model qwen --diff-file "$DIFF" --bin "$STUB_SPAWN_MARKER" --max-tokens "$VALUE" 2>&1)"; EXIT=$?
  assert_eq "2" "$EXIT" "invalid --max-tokens '$VALUE' exits 2"
  assert_contains "$OUT" '"status": "precondition_failed"' "invalid --max-tokens '$VALUE' is a precondition"
  node -e 'JSON.parse(process.argv[1])' "$OUT"
  assert_eq "0" "$?" "invalid --max-tokens '$VALUE' emits valid JSON"
  assert_file_absent "$SPAWN_MARKER_FILE" "invalid --max-tokens '$VALUE' does not spawn runner"
done
SPAWN_MARKER_FILE="$TEST_TMP/missing-max-spawn"; export SPAWN_MARKER_FILE
rm -f "$SPAWN_MARKER_FILE"
OUT="$("$SCRIPT" --runner qoderclicn --model qwen --diff-file "$DIFF" --bin "$STUB_SPAWN_MARKER" --max-tokens 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --max-tokens value exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing --max-tokens value is a precondition"
node -e 'JSON.parse(process.argv[1])' "$OUT"
assert_eq "0" "$?" "missing --max-tokens value emits valid JSON"
assert_file_absent "$SPAWN_MARKER_FILE" "missing --max-tokens value does not spawn runner"

for RUNNER_NAME in codex agy grok cc-shim claude-native; do
  SPAWN_MARKER_FILE="$TEST_TMP/unsupported-$RUNNER_NAME-spawn"; export SPAWN_MARKER_FILE
  rm -f "$SPAWN_MARKER_FILE"
  OUT="$("$SCRIPT" --runner "$RUNNER_NAME" --model fixture --diff-file "$DIFF" --bin "$STUB_SPAWN_MARKER" --max-tokens 100 2>&1)"; EXIT=$?
  assert_eq "2" "$EXIT" "$RUNNER_NAME rejects --max-tokens"
  assert_contains "$OUT" '"status": "precondition_failed"' "$RUNNER_NAME rejection is a precondition"
  assert_contains "$OUT" "runner '$RUNNER_NAME'" "$RUNNER_NAME rejection names the runner"
  assert_contains "$OUT" 'no verified enforceable output-token mapping' "$RUNNER_NAME rejection states the unsupported contract"
  node -e 'JSON.parse(process.argv[1])' "$OUT"
  assert_eq "0" "$?" "$RUNNER_NAME rejection emits valid JSON"
  assert_file_absent "$SPAWN_MARKER_FILE" "$RUNNER_NAME rejects before runner spawn"
done

# D2 capability identity is a fail-before-spend precondition, not a soft
# telemetry warning. The foreign receipt is internally valid but binds other IDs.
SPAWN_MARKER_FILE="$TEST_TMP/foreign-d2-review-spawn"; export SPAWN_MARKER_FILE
rm -f "$SPAWN_MARKER_FILE"
OUT="$(AUTOPILOT_PLATFORM_CAPABILITY_RECEIPT="$FOREIGN_D2_RECEIPT" "$SCRIPT" \
  --runner agy --model "Gemini 3.5 Flash (High)" --diff-file "$DIFF" \
  --bin "$STUB_SPAWN_MARKER" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "foreign D2 review receipt exits as precondition failure"
assert_contains "$OUT" '"status": "precondition_failed"' "foreign D2 review receipt is fail closed"
assert_contains "$OUT" 'D2 capability claim validation failed' "foreign D2 review receipt names claim authority"
assert_contains "$OUT" '"usage": null' "foreign D2 review receipt has no usage"
assert_file_absent "$SPAWN_MARKER_FILE" "foreign D2 review receipt spawns no runner"

# 2c. Supported rails receive their exact native argv; omission synthesizes no argument or result field.
QODER_ARGV_FILE="$TEST_TMP/qoder-max.argv"; export QODER_ARGV_FILE
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner qoderclicn --model qwen --diff-file "$DIFF" --bin "$STUB_QODERCN_MARKER" --max-tokens 200000 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "qoder accepts upper-bound --max-tokens"
assert_contains "$(paste -sd ' ' "$QODER_ARGV_FILE")" '--max-output-tokens 200000' "qoder receives exact output-token argv"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner qoderclicn --model qwen --diff-file "$DIFF" --bin "$STUB_QODERCN_MARKER" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "qoder omission preserves reviewed behavior"
assert_not_contains "$(cat "$QODER_ARGV_FILE")" '--max-output-tokens' "qoder omission adds no output-token argv"
assert_not_contains "$OUT" 'max_tokens' "qoder omission adds no result field"

ANTHROPIC_ARGV_FILE="$TEST_TMP/anthropic-max.argv"; export ANTHROPIC_ARGV_FILE
OUT="$(PATH="$FAKE_NODE_DIR:$PATH" DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model fixture --diff-file "$DIFF" --context-window off --max-tokens 1 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible accepts lower-bound --max-tokens"
assert_contains "$(paste -sd ' ' "$ANTHROPIC_ARGV_FILE")" '--max-tokens 1' "anthropic-compatible receives exact adapter argv"
OUT="$(PATH="$FAKE_NODE_DIR:$PATH" DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model fixture --diff-file "$DIFF" --context-window off 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible omission preserves reviewed behavior"
assert_not_contains "$(cat "$ANTHROPIC_ARGV_FILE")" '--max-tokens' "anthropic-compatible omission adds no adapter argv"
RESULT_KEYS="$(node -e 'const v=JSON.parse(process.argv[1]); console.log(Object.keys(v).sort().join(","))' "$OUT")"
assert_eq "error,findings,frame_closed_by,model,no_finding_proof,raw_log,runner,status,usage,verdict" "$RESULT_KEYS" \
  "omitted --max-tokens preserves result JSON shape"

# 3. codex path: verdict parsed → reviewed, exit 0
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "codex reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "codex reviewed status"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "codex verdict parsed"
assert_contains "$OUT" 'does not reverse' "codex findings captured"

# 3q. qoder path: STDOUT parsed (stderr split off), verdict → reviewed, runner reported. Real
# qoder prints a benign 'fatal: not a git repository' to STDERR from the scratch cwd; the
# split-stream capture keeps it out of the parse (see dispatch-review.sh qoderclicn branch).
OUT="$("$SCRIPT" --runner qoderclicn --model Qwen3.8-Max-Preview --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "qoder reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "qoder reviewed status"
assert_contains "$OUT" '"runner": "qoderclicn"' "qoder runner reported"

# 4. FAIL-CLOSED: empty capture → no_verdict, exit 1 (NEVER a pass)
OUT="$("$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "empty capture exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "empty → no_verdict"
assert_contains "$OUT" '"verdict": null' "no_verdict has null verdict"
assert_not_contains "$OUT" 'SHIP-AS-IS' "empty capture is NEVER read as a ship verdict"

# 3g. grok glued-preamble normalization (v2.36.4): preamble + BEGIN on one line is split
# once before the shared locator, so the complete review is parsed — grok only.
OUT="$(STUB_MODE=glued_preamble_frame "$SCRIPT" --runner grok --model grok-4.6 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "grok glued preamble+frame: reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "grok glued preamble+frame: reviewed"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "grok glued preamble+frame: verdict parsed"
# 3g-neg-1: the split does not launder framing vocabulary left in the preamble (rule 7 holds).
OUT="$(STUB_MODE=glued_preamble_frame_vocab_echo "$SCRIPT" --runner grok --model grok-4.6 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "grok glued preamble with residual framing vocabulary: no_verdict"
assert_contains "$OUT" 'framing vocabulary' "grok glued preamble with residual vocabulary: rule 7 names the reason"
assert_not_contains "$OUT" '"verdict": "SHIP-AS-IS"' "grok glued preamble with residual vocabulary: never a SHIP"
# 3g-neg-2: the normalization is grok-scoped — the same glued shape on codex is still rule 7.
OUT="$(STUB_MODE=glued_preamble_frame "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "codex glued preamble+frame: still rejected (normalization is grok-scoped)"
assert_contains "$OUT" 'framing vocabulary' "codex glued preamble+frame: rule 7"

# 4b. Whole-prompt echo is rejected if the first non-empty line is not the marker.
OUT="$(STUB_MODE=prompt_echo "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "prompt-echo output no_verdict"
assert_contains "$OUT" '"status": "no_verdict"' "prompt-echo output is no_verdict"

# 4c. Multi-line FINDINGS are preserved for shell-backed runners.
OUT="$(STUB_MODE=multiline "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "multiline findings reviewed exit 0"
assert_contains "$OUT" 'line one' "multiline findings first line captured"
assert_contains "$OUT" 'line two' "multiline findings second line captured"
assert_not_contains "$OUT" '```' "multiline findings omit fence delimiters"

# 4d. A verdict without the required FINDINGS line is fail-closed.
OUT="$(STUB_MODE=missing_findings "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing FINDINGS exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "missing FINDINGS → no_verdict"

# 4e. SHIP-AS-IS requires one structured, non-tautological no-finding proof.
OUT="$(STUB_MODE=ship_bare "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "bare SHIP-AS-IS exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "bare SHIP-AS-IS → no_verdict"
OUT="$(STUB_MODE=ship_tautology "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "tautological no-finding proof exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "tautological no-finding proof → no_verdict"
OUT="$(STUB_MODE=ship_duplicate_proof "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "duplicate no-finding proof exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "duplicate no-finding proof → no_verdict"
OUT="$(STUB_MODE=ship "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "structured no-finding proof reviewed exit 0"
assert_contains "$OUT" '"no_finding_proof": "checked=' "SHIP-AS-IS emits parsed no-finding proof"
assert_not_contains "$OUT" 'FINDINGS: none\\nNO-FINDING-PROOF' \
  "proof line is not swallowed into findings"
# 契約改動 2026-08-15：非 SHIP 判決帶一行多餘的 NO-FINDING-PROOF **不再**丟棄整份
# review。那行是噪音不是違約，而丟棄會把「審查者發現了真問題」變成「沒有判決」
# ——往錯的方向 fail-closed，findings 靜默消失。實測 MiniMax-M3 3/3 都這樣，
# 且改 prompt 措辭無效。該行被忽略、不解析、不外露（no_finding_proof 仍為 null）。
OUT="$(STUB_MODE=fix_with_proof "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "FIX-THEN-SHIP with stray proof line is accepted"
assert_contains "$OUT" '"status": "reviewed"' "FIX-THEN-SHIP with stray proof → reviewed"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "FIX-THEN-SHIP verdict survives the stray proof line"
assert_contains "$OUT" 'parser accepts unsafe input' "findings are NOT discarded over the stray proof line"
assert_contains "$OUT" '"no_finding_proof": null' "stray proof line is not parsed or surfaced"

# 分隔符韌性（2026-08-15）：欄位以 label 定位，不綁死 `;`。
# kimi-code/k3 交出八個面向、七條帶原始碼的證據，只因為最後一欄用句號分隔就被
# 判「欄位為空」——閘門越嚴，寫得越詳細的審查者越容易被踢掉。
OUT="$(STUB_MODE=ship_period_sep "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "period-separated no-finding proof is accepted"
assert_contains "$OUT" '"no_finding_proof": "checked=' "period-separated proof is parsed"
OUT="$(STUB_MODE=ship_comma_sep "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "comma-separated no-finding proof is accepted"
assert_contains "$OUT" '"no_finding_proof": "checked=restore discipline in the sync window, evidence=' \
  "comma-separated proof is the one the stub emitted (MiniMax r1: the branch had been renamed away)"
OUT="$(STUB_MODE=ship_space_sep "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "space-separated no-finding proof is accepted"
OUT="$(STUB_MODE=ship_mixed_sep "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "mixed-punctuation no-finding proof is accepted"
# RED at base 0e3ea3cc: doubled `;;` was absorbed into the field by the single-char
# separator class + greedy capture (observed: status reviewed). The `+` quantifier
# still accepts the run; pin that the battery remains green.
OUT="$(STUB_MODE=ship_doubled_sep "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "doubled-separator no-finding proof is accepted"
OUT="$(STUB_MODE=ship_pipe_sep "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "pipe-separated proof is a shape failure"
assert_contains "$OUT" "NO-FINDING-PROOF must contain non-empty checked, evidence, and conclusion fields" \
  "pipe separator uses the battery shape message"
OUT="$(STUB_MODE=ship_tautology "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_contains "$OUT" "NO-FINDING-PROOF contains a tautological checked, evidence, or conclusion value" \
  "blacklist value uses the battery tautology message (preservation)"

# 反向：放寬分隔符**沒有**放寬反鴨子蓋章的閘門。缺欄位、同義反覆仍然擋。
OUT="$(STUB_MODE=ship_missing_conclusion "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "proof without a conclusion field still fails"
assert_contains "$OUT" '"status": "no_verdict"' "proof without conclusion → no_verdict"
OUT="$(STUB_MODE=ship_tautology_period "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "tautological proof still fails under the relaxed separator"
assert_contains "$OUT" '"status": "no_verdict"' "tautological proof (period-separated) → no_verdict"

# 4f. Extra/duplicated VERDICT token is rejected by the single-verdict guard.
OUT="$(STUB_MODE=forged "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "forged verdict content exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "forged diff content → no_verdict"

# 4g. Diff-leakage text is rejected by the leak guard.
OUT="$(STUB_MODE=leak "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "leak content exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "leakage content → no_verdict"

# 4g1. Natural-language findings may mention detector vocabulary without being
#     rejected; only structurally echoed framing is leakage.
OUT="$(STUB_MODE=lexical "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "lexical detector vocabulary exits 0"
assert_contains "$OUT" '"status": "reviewed"' "lexical detector vocabulary remains reviewed"

# 4g. Content after END is rejected (trailing non-blank payload).
OUT="$(STUB_MODE=trailing "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "trailing content after END exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "trailing content after END → no_verdict"

# 4h. Oversized wrapped block is rejected.
OUT="$(STUB_MODE=oversized "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "oversized block exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "oversized block → no_verdict"

# 4i. Missing END marker is rejected.
OUT="$(STUB_MODE=no_end "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing END exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "missing END → no_verdict"

# BEGIN-closed frame: second derived BEGIN as last non-blank line, END never seen.
# RED at 8d899e716fca11213aec40a314a62fb2726a68c8: no_verdict with
# "duplicate derived BEGIN marker found inside capture"
OUT="$(STUB_MODE=begin_closed "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "BEGIN-closed frame exit 0"
assert_contains "$OUT" '"status": "reviewed"' "BEGIN-closed frame is reviewed"
assert_contains "$OUT" '"frame_closed_by": "begin-marker"' "BEGIN-closed envelope stamps begin-marker"

# Second BEGIN followed by any further non-blank line stays the anti-fabrication guard.
# RED at 8d899e716fca11213aec40a314a62fb2726a68c8: no_verdict with
# "duplicate derived BEGIN marker found inside capture" (unchanged)
OUT="$(STUB_MODE=begin_closed_then_content "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "BEGIN then extra content still exit 1"
assert_contains "$OUT" '"status": "no_verdict"' "BEGIN then extra content → no_verdict"
assert_contains "$OUT" "duplicate derived BEGIN marker found inside capture" \
  "BEGIN then extra content keeps exit-3 reason"

# Normal BEGIN…END envelope reports frame_closed_by end-marker.
# RED at 8d899e716fca11213aec40a314a62fb2726a68c8: reviewed JSON had no frame_closed_by key
OUT="$(STUB_MODE=pass "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "normal END envelope still exit 0"
assert_contains "$OUT" '"status": "reviewed"' "normal END envelope is reviewed"
assert_contains "$OUT" '"frame_closed_by": "end-marker"' "normal END envelope stamps end-marker"

# 4j. Chrome-skip locator (v-frame-loss fix): leading chrome lines with no
# framing vocabulary are skipped up to the derived BEGIN; leading chrome that
# DOES carry framing vocabulary without being byte-exactly the derived BEGIN
# is a HARD REJECT, never a skip.

# POSITIVE: one line of harness chrome ahead of a complete, valid, exactly
# framed block. This is the regression that discarded four real reviews.
OUT="$(STUB_MODE=chrome_then_valid "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "harness chrome ahead of a valid block still reviews (exit 0)"
assert_contains "$OUT" '"status": "reviewed"' "harness chrome ahead of a valid block → reviewed"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "harness chrome ahead of a valid block: verdict parsed"
assert_contains "$OUT" 'does not reverse' "harness chrome ahead of a valid block: findings parsed"

# BUDGET (first-pass qc 🟠 chrome-battery-bypass): the skipped prefix is bounded.
# The old locator required the frame at line 1, so the block size cap also
# bounded the whole response; an unbounded prefix removed that, letting a huge
# preamble ride in front of a small valid block with none of it inspected.
# Real chrome is one or two lines, so the budget only catches the pathological
# case — and these two assertions pin BOTH directions: just under the budget
# still reviews, just over it fails closed. Without the second, the budget could
# be set to infinity and nothing would notice.
OUT="$(STUB_MODE=chrome_then_valid AUTOPILOT_REVIEW_CHROME_MAX_LINES=5 \
  "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "chrome within budget still reviews (exit 0)"
assert_contains "$OUT" '"status": "reviewed"' "chrome within budget → reviewed"

OUT="$(STUB_MODE=chrome_then_valid AUTOPILOT_REVIEW_CHROME_MAX_LINES=0 \
  "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "chrome OVER budget fails closed (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "chrome over budget → no_verdict"
assert_contains "$OUT" 'exceeded the budget' "chrome over budget names the budget"

OUT="$(STUB_MODE=chrome_then_valid AUTOPILOT_REVIEW_CHROME_MAX_BYTES=1 \
  "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "chrome over the BYTE budget fails closed (exit 1)"
assert_contains "$OUT" 'exceeded the budget' "byte budget also names the budget"

# NEGATIVE: the skipped prefix is held to the SAME leak rule as the block. The
# block-level scan (prompt_framing_leakage) rejects these anchored prompt/diff
# patterns; before this guard a skipped prefix escaped that scan entirely, so a
# leading `diff --git` line — which the old positional rail rejected — was
# tolerated. Both directions matter: these must fail, real harness chrome must not.
OUT="$(STUB_MODE=diff_echo_chrome "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "diff-echo as leading chrome fails closed (exit 1)"
assert_contains "$OUT" '"status": "no_verdict"' "diff-echo as leading chrome → no_verdict"
assert_contains "$OUT" 'echoed prompt/diff structure' "diff-echo names the leak rule, not the budget"

OUT="$(STUB_MODE=hunk_echo_chrome "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "quoted hunk-header echo as leading chrome fails closed (exit 1)"
assert_contains "$OUT" 'echoed prompt/diff structure' "a Markdown quote marker does not launder an echoed hunk header"

# POSITIVE: multiple leading chrome lines, including one with leading
# whitespace, still parse.
OUT="$(STUB_MODE=chrome_multi_then_valid "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "multiple leading chrome lines still review (exit 0)"
assert_contains "$OUT" '"status": "reviewed"' "multiple leading chrome lines → reviewed"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "multiple leading chrome lines: verdict parsed"

# NEGATIVE: a REAL truncated frame (two angle brackets, not three) as leading
# chrome, followed by a complete valid block. Proves the fix did not just
# weaken the parser into "skip until you find begin" — a malformed frame that
# carries the vocabulary is rejected, not silently skipped.
OUT="$(STUB_MODE=truncated_frame_chrome "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "truncated frame as leading chrome exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "truncated frame as leading chrome → no_verdict"
# The REASON must be the framing-vocabulary rejection, not a generic "no BEGIN
# frame". awk's END block used to rewrite the rule-level exit code (7 -> 2,
# 3 -> 5, 8 -> 2), so the parser failed closed but named the wrong failure. This
# assertion is what pins the code path, not just the outcome.
assert_contains "$OUT" 'framing vocabulary' "truncated frame names the vocabulary rejection, not a generic missing-frame"
assert_not_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "truncated-frame chrome never authorizes a verdict"

# NEGATIVE: the derived BEGIN embedded inside a longer prose line (the echo
# shape the original positional anchor defended against) as leading chrome,
# followed by a valid block. Must still be rejected.
OUT="$(STUB_MODE=embedded_begin_chrome "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "embedded BEGIN inside a prose line exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "embedded BEGIN inside a prose line → no_verdict"
assert_not_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "embedded-BEGIN chrome never authorizes a verdict"

# NEGATIVE (unchanged behaviour): chrome only, no frame anywhere → no_verdict.
OUT="$(STUB_MODE=chrome_only_no_frame "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "chrome with no frame at all exit 1 (fail-closed)"
assert_contains "$OUT" '"status": "no_verdict"' "chrome with no frame at all → no_verdict"


finalize_test
