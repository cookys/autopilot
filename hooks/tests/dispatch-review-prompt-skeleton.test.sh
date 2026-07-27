#!/usr/bin/env bash
# Hooks test to capture the actual assembled prompt of scripts/dispatch-review.sh
# and assert required elements are present, then byte-diff the captured prompt
# (with volatile tokens normalized) against a committed golden skeleton.

. "$(dirname "$0")/lib.sh"

# 1. Write the capture stub to $TEST_TMP/capture-stub.sh and chmod +x it.
cat <<'EOF' > "$TEST_TMP/capture-stub.sh"
#!/usr/bin/env bash
prompt=""
i=1
while [ "$i" -le "$#" ]; do
  arg="${!i}"
  if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
    ni=$((i+1)); na="${!ni}"
    if [ -n "$na" ] && [ -f "$na" ]; then prompt="$(cat "$na")"; else prompt="$na"; fi
    break
  fi
  i=$((i+1))
done
[ -z "$prompt" ] && prompt="$(cat)"
[ -n "${PROMPT_CAPTURE_FILE:-}" ] && printf '%s' "$prompt" > "$PROMPT_CAPTURE_FILE"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
if [ -z "$begin" ] || [ -z "$end" ]; then exit 0; fi
printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\nNO-FINDING-PROOF: checked=fixture diff and acceptance contract; evidence=changed assignment is present in captured diff; conclusion=specified assignment change has no blocking failure\n%s\n' "$begin" "$end"
EOF
chmod +x "$TEST_TMP/capture-stub.sh"

# 2. Write a small fixture diff to $TEST_TMP/fixture.diff
cat <<'EOF' > "$TEST_TMP/fixture.diff"
diff --git a/x.js b/x.js
--- a/x.js
+++ b/x.js
@@ -1 +1 @@
-const a = 1
+const a = 2
EOF

# 3. Run dispatch-review.sh and capture exit code
PROMPT_CAPTURE_FILE="$TEST_TMP/captured-prompt.txt" \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-test \
  --diff-file "$TEST_TMP/fixture.diff" --bin "$TEST_TMP/capture-stub.sh" \
  > "$TEST_TMP/dr-out.json" 2> "$TEST_TMP/dr-err.txt"
rc=$?

# 4. Assert the dispatch-review exit code is 0 (reviewed)
assert_eq "$rc" "0" "dispatch-review exit code must be 0"

# 5. Assert the prompt was captured
assert_file_exists "$TEST_TMP/captured-prompt.txt" "captured prompt file must exist"

# 6. Read the captured prompt
CAPTURED="$(cat "$TEST_TMP/captured-prompt.txt")"

# 7. Assert structural elements
assert_contains "$CAPTURED" "You are a code reviewer." "prompt must contain reviewer instruction"
assert_contains "$CAPTURED" "<<<AUTOPILOT-REVIEW-" "prompt must contain BEGIN marker prefix"
assert_contains "$CAPTURED" "<<<AUTOPILOT-END-" "prompt must contain END marker prefix"
assert_contains "$CAPTURED" "VERDICT: SHIP-AS-IS or FIX-THEN-SHIP" "prompt must contain verdict contract"
assert_contains "$CAPTURED" "FINDINGS: one finding per line" "prompt must contain findings contract"
assert_contains "$CAPTURED" "NO-FINDING-PROOF: checked=" \
  "prompt must require a machine-parseable no-finding proof"
assert_contains "$CAPTURED" "Bounded convergence contract:" \
  "prompt must bound review convergence"
assert_contains "$CAPTURED" "bounded keep/cut list and a minimum shippable version" \
  "prompt must replace unbounded defect hunting with a bounded deliverable"
assert_contains "$CAPTURED" "MUST-FIX" \
  "prompt must distinguish current blockers"
assert_contains "$CAPTURED" "CUT/FOLLOW-UP" \
  "prompt must explicitly remove nonblocking work from the current version"
assert_contains "$CAPTURED" "smallest concrete remediation" \
  "prompt must require attacks to include a bounded fix"
assert_contains "$CAPTURED" "MUST-FIX list is empty" \
  "prompt must define the terminal ship condition"
assert_contains "$CAPTURED" "Bare claims such as" \
  "prompt must reject tautological no-finding claims"
assert_contains "$CAPTURED" "Diff under review:" "prompt must contain diff heading"
assert_contains "$CAPTURED" "+const a = 2" "prompt must contain fixture diff line"

REVIEWER_BODY="$(cat "$REPO_ROOT/agents/reviewer.md")"
assert_contains "$REVIEWER_BODY" "bounded keep/cut list and a minimum shippable version" \
  "methodology reviewer must use the same bounded deliverable"
assert_contains "$REVIEWER_BODY" "MUST-FIX list is empty" \
  "methodology reviewer must use the same terminal condition"
assert_contains "$REVIEWER_BODY" "no-finding proof receipt" \
  "methodology reviewer must require an auditable no-finding trace"

# 8. Normalize volatile tokens and diff against committed golden skeleton
GOLDEN="$REPO_ROOT/evals/reviewer-bench/prompt-skeleton.golden"
NORM_CAPTURED="$(sed -E 's/[0-9a-f]{32}/<NONCE>/g' "$TEST_TMP/captured-prompt.txt")"
assert_file_exists "$GOLDEN" "golden skeleton file must exist"
GOLDEN_CONTENT="$(cat "$GOLDEN")"
assert_eq "$NORM_CAPTURED" "$GOLDEN_CONTENT" \
  "normalized assembled prompt must match committed golden skeleton (evals/reviewer-bench/prompt-skeleton.golden); if the template changed intentionally, regenerate the golden in the same commit"

# 9. Finalize
finalize_test
