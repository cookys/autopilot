#!/usr/bin/env bash
# claude-native-model-preflight.test.sh — BL-0364 (round 2): every claude-native dispatch point refuses a
# model the claude CLI would reject (bare `claude-opus` -> unrecognized_model) BEFORE claude is started.
# Covers dispatch-review.sh, dispatch-author.sh (also the path of dispatch-consult / dispatch-plan-review),
# dispatch-hetero.sh, and the resolver reviewer_engine path from a template copy.
# Negative control: dispatch-review.sh with its check removed starts claude with `--model claude-opus`.
. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.claude"
REAL="$TEST_TMP/real-claude-config"; mkdir -p "$REAL"
printf '{"claudeAiOauth":{"accessToken":"stub"}}\n' > "$REAL/.credentials.json"
export CLAUDE_CONFIG_DIR="$REAL" TMPDIR="$TEST_TMP/tmproot"; mkdir -p "$TMPDIR"
export AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID

STUB="$TEST_TMP/claude-stub"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' "$*" >> "$STUB_REC"
echo '{"verdict":"READY","findings":[]}'
STUBEOF
chmod +x "$STUB"; export STUB_REC="$TEST_TMP/rec"
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n' > "$TEST_TMP/d.diff"
printf 'Return a small JSON object.\n' > "$TEST_TMP/p.txt"

review() { # <scripts-dir> <model>
  rm -f "$STUB_REC"
  "$1/dispatch-review.sh" --runner claude-native --model "$2" --diff-file "$TEST_TMP/d.diff" --bin "$STUB" --timeout 20s 2>/dev/null < /dev/null
}
author() { # <model>
  rm -f "$STUB_REC"
  "$REPO_ROOT/scripts/dispatch-author.sh" --runner claude-native --model "$1" --prompt-file "$TEST_TMP/p.txt" --bin "$STUB" --timeout 20s 2>/dev/null < /dev/null
}
called() { [ -f "$STUB_REC" ] && echo called || echo not-called; }

# ─── dispatch-review.sh ───
OUT=$(review "$REPO_ROOT/scripts" claude-opus); RC=$?
assert_eq "$RC" "2" "review: bare claude-opus is a precondition failure (rc 2)"
assert_contains "$OUT" '"status": "precondition_failed"' "review: result is precondition_failed, not a seat verdict"
assert_contains "$OUT" "claude-opus-5-5" "review: error names a valid spelling"
assert_eq "$(called)" "not-called" "review: claude was never started"
OUT=$(review "$REPO_ROOT/scripts" claude-opus-5-5); RC=$?
assert_not_contains "$OUT" "precondition_failed" "review: full id is not refused"
assert_contains "$(cat "$STUB_REC")" "--model claude-opus-5-5" "review: full id reaches the CLI"
OUT=$(review "$REPO_ROOT/scripts" opus); RC=$?
assert_not_contains "$OUT" "precondition_failed" "review: opus alias is not refused"
assert_contains "$(cat "$STUB_REC")" "--model opus" "review: alias reaches the CLI"

# ─── dispatch-author.sh (consult and plan-review both go through it) ───
OUT=$(author claude-opus); RC=$?
assert_eq "$RC" "2" "author: bare claude-opus is a precondition failure (rc 2)"
assert_eq "$(called)" "not-called" "author: claude was never started"
OUT=$(author claude-opus-5-5); RC=$?
assert_not_contains "$OUT" "precondition_failed" "author: full id is not refused"
assert_eq "$(called)" "called" "author: full id starts claude"

# ─── dispatch-hetero.sh ───
SBX="$TEST_TMP/hsbx"; mkdir -p "$SBX"
(cd "$SBX" && git init -q && git config user.email t@example.com && git config user.name T && git commit -q --allow-empty -m x)
OUT=$(cd "$SBX" && "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner claude-native --model claude-opus --branch b1 --prompt-file "$TEST_TMP/p.txt" 2>&1 < /dev/null); RC=$?
assert_eq "$RC" "2" "hetero: bare claude-opus is a precondition failure (rc 2)"
assert_contains "$OUT" '"status": "precondition_failed"' "hetero: result is precondition_failed"
assert_contains "$OUT" '"dispatcher_called": false' "hetero: nothing was dispatched"

# ─── resolver reviewer_engine path: template copy with reviewer_engine: claude-opus ───
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/no-config.json" AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"
cp "$REPO_ROOT/project-config-template/review-loop-config.md" "$TEST_TMP/tpl.md"
sed -i -E 's/^- reviewer_engine:.*/- reviewer_engine: claude-opus/; s/^- reviewer_runner:.*/- reviewer_runner: claude-native/' "$TEST_TMP/tpl.md"
R_ENGINE=$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/tpl.md" "$REPO_ROOT/scripts/resolve-review-loop.sh" --field reviewer_engine 2>/dev/null)
R_RUNNER=$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/tpl.md" "$REPO_ROOT/scripts/resolve-review-loop.sh" --field reviewer_runner 2>/dev/null)
assert_eq "$R_ENGINE/$R_RUNNER" "claude-opus/claude-native" "resolver passes the configured reviewer_engine through unchanged"
OUT=$(review "$REPO_ROOT/scripts" "$R_ENGINE"); RC=$?
assert_eq "$RC" "2" "resolver -> dispatch-review: the resolved reviewer_engine is refused before dispatch"
assert_eq "$(called)" "not-called" "resolver -> dispatch-review: claude was never started"

# ─── negative control: dispatch-review.sh without its check starts claude with the bad model ───
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp -r "$REPO_ROOT/scripts" "$MUT/scripts"; ln -s "$REPO_ROOT/src" "$MUT/src"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const o = "seat-model-id.js\" check \"$MODEL\" 2>&1)\"";
  const s = fs.readFileSync(f, "utf8"); if (s.split(o).length !== 2) { console.error("MUTATION TARGET NOT UNIQUE"); process.exit(3); }
  fs.writeFileSync(f, s.replace(o, () => "seat-model-id.js\" check opus 2>&1)\""));' "$MUT/scripts/dispatch-review.sh" || fail "mutation setup failed"
OUT=$(review "$MUT/scripts" claude-opus); RC=$?
assert_eq "$(called)" "called" "negative control: without the check claude is started"
assert_contains "$(cat "$STUB_REC" 2>/dev/null)" "--model claude-opus" "negative control: the bad model reaches the CLI argv"

finalize_test
