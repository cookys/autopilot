#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

cat > "$TEST_TMP/codex" <<'STUB'
#!/usr/bin/env bash
cat > "$PROMPT_CAPTURE_FILE"
if grep -qF 'You are a code reviewer' "$PROMPT_CAPTURE_FILE"; then
  begin="$(sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]*>>>\)$/\1/p' "$PROMPT_CAPTURE_FILE" | head -1)"
  end="$(sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]*>>>\)$/\1/p' "$PROMPT_CAPTURE_FILE" | head -1)"
  printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=fixture; evidence=diff inspected; conclusion=no blocker remains\n%s\n' "$begin" "$end"
else
  printf '%s\n' '{"results":[{"id":"fixture","status":"fixed","reason":"repair present"}]}'
fi
STUB
chmod +x "$TEST_TMP/codex"
printf '%s\n' 'Return one JSON object and nothing else.' > "$TEST_TMP/spec"
printf '%s\n' 'diff --git a/x b/x' '+fixture change' > "$TEST_TMP/diff"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 AUTOPILOT_DISPATCH_MANIFEST=0 AUTOPILOT_CONTEXT_WINDOW_GATE=off AUTOPILOT_TEST_CN_GATE_OFF=1
PROMPT_CAPTURE_FILE="$TEST_TMP/ordinary" bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/diff" --spec-file "$TEST_TMP/spec" --bin "$TEST_TMP/codex" > "$TEST_TMP/ordinary.json" 2> "$TEST_TMP/ordinary.err"
assert_exit_code "$?" 0 'ordinary dispatch succeeds'
assert_contains "$(cat "$TEST_TMP/ordinary")" 'You are a code reviewer' 'ordinary prompt keeps review frame'
assert_contains "$(cat "$TEST_TMP/ordinary")" 'VERDICT:' 'ordinary prompt keeps verdict'
sed -E 's/[0-9a-f]{32}/<NONCE>/g' "$TEST_TMP/ordinary" > "$TEST_TMP/ordinary-normalized"
if [ -n "${ORDINARY_PROMPT_BASELINE:-}" ]; then
  if [ -f "$ORDINARY_PROMPT_BASELINE" ]; then
    cmp -s "$ORDINARY_PROMPT_BASELINE" "$TEST_TMP/ordinary-normalized"
    assert_exit_code "$?" 0 'ordinary prompt matches pre-change bytes after nonce normalization'
  else
    cp "$TEST_TMP/ordinary-normalized" "$ORDINARY_PROMPT_BASELINE"
  fi
fi
PROMPT_CAPTURE_FILE="$TEST_TMP/raw" bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test --diff-file "$TEST_TMP/diff" --spec-file "$TEST_TMP/spec" --bin "$TEST_TMP/codex" --raw-answer > "$TEST_TMP/raw.json" 2> "$TEST_TMP/raw.err"
assert_exit_code "$?" 0 'raw dispatch succeeds'
raw="$(cat "$TEST_TMP/raw")"
assert_contains "$raw" 'Return one JSON object and nothing else.' 'raw prompt includes spec'
assert_contains "$raw" '+fixture change' 'raw prompt includes diff'
for forbidden in 'You are a code reviewer' 'VERDICT:' 'AUTOPILOT-REVIEW-' 'NO-FINDING-PROOF'; do
  assert_not_contains "$raw" "$forbidden" "raw prompt excludes $forbidden"
done
answer="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).answer || "")' "$TEST_TMP/raw.json")"
assert_eq "$answer" '{"results":[{"id":"fixture","status":"fixed","reason":"repair present"}]}' 'raw answer is exact JSON text'
cat > "$TEST_TMP/framed-answer" <<'FIXTURE'
<<<AUTOPILOT-REVIEW-fixture>>>
VERDICT: SHIP-AS-IS
FINDINGS: none
<<<AUTOPILOT-END-fixture>>>
FIXTURE
node -e 'const r=require(process.argv[1]);const fs=require("fs");const v=r.validateAnswer(r.parseAnswerText(fs.readFileSync(process.argv[2],"utf8")),["fixture"]);if(v.error!=="answer is not a JSON object")process.exit(1);' "$REPO_ROOT/scripts/lib/repair-recheck.js" "$TEST_TMP/framed-answer"
assert_exit_code "$?" 0 'framed answer reproduces recheck validation failure'
node -e 'const r=require(process.argv[1]);const a=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8")).answer;if(!r.validateAnswer(r.parseAnswerText(a),["fixture"]).ok)process.exit(1);' "$REPO_ROOT/scripts/lib/repair-recheck.js" "$TEST_TMP/raw.json"
assert_exit_code "$?" 0 'raw prompt elicits valid recheck answer from fake runner'
finalize_test
