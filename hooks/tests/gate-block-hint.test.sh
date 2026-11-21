#!/usr/bin/env bash
# gate-block-hint.test.sh — Fleet-Task 01M803Z0SF3MQG07WYWH3TH25T. Every gate block/deny
# message carries one fix sentence and one doc reference (hooks/lib/gate-hint.js), and
# every cited doc resolves in the tree. The audit is hooks/tests/lib/gate-block-hint-audit.js;
# its INVENTORY is the contract (one anchor per block site).
#
# Negative controls (red before green, references/evidence-discipline.md §58):
#   1. a gate file with one gateHint() tail stripped -> audit RED, names the file;
#   2. a gateHint() citing a doc that does not exist -> audit RED, "does not resolve".
. "$(dirname "$0")/lib.sh"

AUDIT="$REPO_ROOT/hooks/tests/lib/gate-block-hint-audit.js"

# --- green control on the real tree ---
OUT="$(node "$AUDIT" "$HOOKS_DIR" "$REPO_ROOT" 2>&1 < /dev/null)"; RC=$?
assert_exit_code "$RC" 0 "real tree: every gate block site carries a gateHint() fix+doc tail and every cited doc resolves"
assert_contains "$OUT" "AUDIT GREEN (gate-block-hint)" "audit prints GREEN with the site count"

# --- negative control 1: one fix+doc tail stripped from a block message ---
# (the depth0-delegate-gate read-burst deny loses its gateHint(); the audit must go red
# and name the file — a stripped gate message is exactly the defect this gate blocks.)
NEG1="$TEST_TMP/neg-stripped"
mkdir -p "$NEG1"
for f in "$HOOKS_DIR"/*; do ln -s "$f" "$NEG1/$(basename "$f")"; done
rm "$NEG1/depth0-delegate-gate.js"
cp "$HOOKS_DIR/depth0-delegate-gate.js" "$NEG1/depth0-delegate-gate.js"
sed_mutate "$NEG1/depth0-delegate-gate.js" \
  "s|^.*改派 Explore/survey subagent（model: sonnet）做大量閱讀.*|        );|" \
  || { echo "FATAL [$TEST_NAME] negative control 1 not applied (mutation missed its anchor)" >&2; exit 1; }
grep -vq "改派 Explore/survey subagent" "$NEG1/depth0-delegate-gate.js" \
  || { echo "FATAL [$TEST_NAME] negative control 1 strip did not take effect" >&2; exit 1; }
OUT="$(node "$AUDIT" "$NEG1" "$REPO_ROOT" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control 1: audit is RED when a block message loses its fix+doc tail"
assert_contains "$OUT" "depth0-delegate-gate.js" "negative control 1: audit names the stripped gate file"
assert_contains "$OUT" "read burst on guarded model" "negative control 1: audit names the stripped block site"

# --- negative control 2: a gateHint() citing a doc that does not exist ---
NEG2="$TEST_TMP/neg-doc"
mkdir -p "$NEG2"
for f in "$HOOKS_DIR"/*; do ln -s "$f" "$NEG2/$(basename "$f")"; done
rm "$NEG2/mcp-health.js"
cp "$HOOKS_DIR/mcp-health.js" "$NEG2/mcp-health.js"
sed_mutate "$NEG2/mcp-health.js" "s|'hooks/README.md'|'docs/guide/does-not-exist.md'|" \
  || { echo "FATAL [$TEST_NAME] negative control 2 not applied (mutation missed its anchor)" >&2; exit 1; }
OUT="$(node "$AUDIT" "$NEG2" "$REPO_ROOT" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control 2: audit is RED when a cited doc does not exist"
assert_contains "$OUT" "does not resolve" "negative control 2: audit reports the missing doc"
assert_contains "$OUT" "docs/guide/does-not-exist.md" "negative control 2: audit prints the bad doc path"

# --- negative control 3: earlier block site in a multi-site file loses its gateHint() ---
NEG3="$TEST_TMP/neg-earlier-site"
mkdir -p "$NEG3"
for f in "$HOOKS_DIR"/*; do ln -s "$f" "$NEG3/$(basename "$f")"; done
cp --remove-destination "$HOOKS_DIR/exec-boundary.js" "$NEG3/exec-boundary.js"
sed_mutate "$NEG3/exec-boundary.js" \
  "s|gateHint('改在 feature 分支上改完再推；保護 ref 不接受 force-push', 'CLAUDE.md')|''|" \
  || { echo "FATAL [$TEST_NAME] negative control 3 not applied (mutation missed its anchor)" >&2; exit 1; }
OUT="$(node "$AUDIT" "$NEG3" "$REPO_ROOT" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control 3: audit is RED when an earlier site in a multi-site file loses its gateHint()"
assert_contains "$OUT" "exec-boundary.js" "negative control 3: audit names exec-boundary.js"
assert_contains "$OUT" "E1 protected-ref force-push" "negative control 3: audit names the stripped earlier site"

# --- negative control 4: a gateHint() in hooks/lib/ citing a doc that does not exist ---
NEG4="$TEST_TMP/neg-lib-doc"
mkdir -p "$NEG4/lib"
for f in "$HOOKS_DIR"/*; do
  base="$(basename "$f")"
  [ "$base" = "lib" ] && continue
  ln -s "$f" "$NEG4/$base"
done
for f in "$HOOKS_DIR/lib"/*; do ln -s "$f" "$NEG4/lib/$(basename "$f")"; done
rm "$NEG4/lib/ask-guard.js"
cp "$HOOKS_DIR/lib/ask-guard.js" "$NEG4/lib/ask-guard.js"
sed_mutate "$NEG4/lib/ask-guard.js" "s|'docs/dev/decision-cli.md'|'docs/guide/missing-lib-doc.md'|" \
  || { echo "FATAL [$TEST_NAME] negative control 4 not applied (mutation missed its anchor)" >&2; exit 1; }
OUT="$(node "$AUDIT" "$NEG4" "$REPO_ROOT" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control 4: audit is RED when a hooks/lib/ gateHint() cites a missing doc"
assert_contains "$OUT" "does not resolve" "negative control 4: audit reports the missing doc"
assert_contains "$OUT" "docs/guide/missing-lib-doc.md" "negative control 4: audit prints the bad doc path"

# --- negative control 5: unrelated later hint cannot cover the last site ---
NEG5="$TEST_TMP/neg-last-site"
mkdir -p "$NEG5"
for f in "$HOOKS_DIR"/*; do ln -s "$f" "$NEG5/$(basename "$f")"; done
cp --remove-destination "$HOOKS_DIR/per-turn-gate.js" "$NEG5/per-turn-gate.js"
sed_mutate "$NEG5/per-turn-gate.js" "s|gateHint('先修好 verifier 指出的問題（或恢復它的執行環境）再結束 turn', 'hooks/README.md')|''|" \
  || { echo "FATAL [$TEST_NAME] negative control 5 mutation missed" >&2; exit 1; }
printf "\n gateHint('unrelated', 'hooks/README.md');\n" >> "$NEG5/per-turn-gate.js"
OUT="$(node "$AUDIT" "$NEG5" "$REPO_ROOT" 2>&1 < /dev/null)"; RC=$?
assert_neq "$RC" 0 "negative control 5: a later unrelated hint cannot cover the last block site"
assert_contains "$OUT" "per-turn verifier block" "negative control 5: audit names the last site"

finalize_test
