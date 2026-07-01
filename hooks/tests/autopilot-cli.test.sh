#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/bin/autopilot.js"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

STUB_VERDICT="$TEST_TMP/eng-verdict"
cat > "$STUB_VERDICT" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: delegated through public CLI"
EOF
chmod +x "$STUB_VERDICT"

OUT="$(node "$CLI" --help 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "autopilot --help exits 0"
assert_contains "$OUT" "dispatch review" "autopilot help lists dispatch review"
assert_contains "$OUT" "engine review-loop" "autopilot help lists engine review-loop"
assert_contains "$OUT" "engine implement-review" "autopilot help lists engine implement-review"

printf 'implementer loop prompt\n' > "$TEST_TMP/engine-impl-review-prompt.txt"
OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing base exits 2"
assert_contains "$OUT" "flags --prompt-file, --branch, --base are required" "implement-review reports missing base"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --base base-sha 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing branch exits 2"
assert_contains "$OUT" "flags --prompt-file, --branch, --base are required" "implement-review reports missing branch"

OUT="$(node "$CLI" engine implement-review --branch loop-branch --base base-sha 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing prompt-file exits 2"
assert_contains "$OUT" "flags --prompt-file, --branch, --base are required" "implement-review reports missing prompt-file"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base base-sha --max-rounds 0 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review invalid max-rounds exits 2"
assert_contains "$OUT" "invalid --max-rounds value: 0" "implement-review validates max-rounds"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base base-sha --cwd 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing cwd value exits 2"
assert_contains "$OUT" "--cwd requires a value" "implement-review validates cwd value"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base develop 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "implement-review moving base ref exits 1"
assert_contains "$OUT" "base must be a full immutable git SHA" "implement-review blocks moving base refs before dispatch"

OUT="$(node "$CLI" dispatch review --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "dispatch review preserves reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "dispatch review emits delegated JSON"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "dispatch review preserves verdict"
assert_contains "$OUT" "delegated through public CLI" "dispatch review preserves findings"

OUT="$(node "$CLI" dispatch review --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin /nonexistent/runner 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "dispatch review preserves precondition exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "dispatch review preserves precondition JSON"

OUT="$(node "$CLI" bogus command 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown command exits 2"
assert_contains "$OUT" "unknown command" "unknown command explains failure"

OUT="$(node "$CLI" dispatch 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing dispatch subcommand exits 2"
assert_contains "$OUT" "unknown dispatch subcommand" "missing dispatch subcommand explains failure"

OUT="$(ENGINE_SCORECARD_DIR="$TEST_TMP/empty-scorecard" node "$CLI" engine review-loop --check-scorecard 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "engine review-loop preserves resolver exit 0"
assert_contains "$OUT" '"reviewer_engine": "gpt-5.5"' "engine review-loop emits delegated JSON"
assert_contains "$OUT" '"reviewer_qualified": false' "engine review-loop preserves scorecard fields"

OUT="$(ENGINE_SCORECARD_DIR="$TEST_TMP/empty-scorecard" node "$CLI" engine review-loop --check-scorecard --enforce 2>&1)"; EXIT=$?
assert_eq "3" "$EXIT" "engine review-loop preserves enforce exit 3"
assert_contains "$OUT" '"reviewer_qualified": false' "engine review-loop emits data on enforce block"

OUT="$(node "$CLI" engine 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing engine subcommand exits 2"
assert_contains "$OUT" "unknown engine subcommand" "missing engine subcommand explains failure"

MODULE_OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { dispatchReview } = require(path.join(root, 'src', 'runners', 'review'));
const result = dispatchReview([], {
  scriptPath: path.join(root, 'scripts', 'missing-dispatch-review.sh'),
  stdio: 'pipe',
});
console.log(result.error ? 'error' : 'no-error');
console.log(result.status === null ? 'status-null' : `status-${result.status}`);
NODE
)"
assert_contains "$MODULE_OUT" "error" "review module reports missing script"
assert_contains "$MODULE_OUT" "status-null" "review module missing script has null status"

finalize_test
