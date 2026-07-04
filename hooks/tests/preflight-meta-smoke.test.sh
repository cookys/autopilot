#!/usr/bin/env bash
# hooks/tests/preflight-meta-smoke.test.sh — meta-smoke test for scripts/preflight-portability.sh
# Proves that the release gate passes on the real tree and fails when a seeded violation is planted.

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/preflight-portability.sh"

# DEFAULT: self-skip. The full preflight takes minutes and its OpenCode checks are
# structurally flaky under concurrent load (recorded gotcha) — running it inside the
# default suite (which itself generates load) is a flake generator, and the gate is
# already executed FOR REAL at every release (finish-flow) and in CI drift gates.
# This meta-smoke (does the gate FAIL on a seeded violation?) is an operator/CI-nightly
# tool: run with PREFLIGHT_META_FULL=1.
if [ "${PREFLIGHT_META_FULL:-0}" != "1" ]; then
  echo "SKIP [preflight-meta-smoke] set PREFLIGHT_META_FULL=1 to run (slow; not load-safe)"
  finalize_test
  exit 0
fi

# ─── Case 1: PASS-equivalent ───
# Run the real preflight script on the real tree.
# The test must not flake on machines without OpenCode, so we run the script,
# capture its exit code and output, assert that the exit code is 0 (since
# self-skipping checks return 0), and document which checks self-skipped.
# We also assert that the checks that ALWAYS run are present and passing in the output.

if [ "${PREFLIGHT_META_FULL:-0}" = "1" ]; then
  echo "=== Case 1: Running real preflight-portability on real clean tree ==="
  OUT="$(bash "$SCRIPT" 2>&1)"
  EXIT=$?

  # Print the output to the console for visibility/logging.
  echo "$OUT"

  assert_eq "0" "$EXIT" "preflight-portability exits 0 on a clean repository"

  # Document which environment-dependent checks self-skipped.
  echo "Environment-dependent check analysis:"
  if echo "$OUT" | grep -q "skip:"; then
    echo "The following environment-dependent checks self-skipped on this host:"
    echo "$OUT" | grep "skip:"
  else
    echo "All environment-dependent checks ran and passed (no skips)."
  fi

  # Assert on the subset of checks that ALWAYS run.
  always_run_checks=(
    "intent-capture.js returns version with CLAUDE_PLUGIN_ROOT"
    "intent-capture.js returns 'unknown' without env var, no throw"
    "intent-capture.js works from symlinked path (no throw)"
    "session-start.js emits hookSpecificOutput envelope when env set"
    "session-start.js emits additional_context envelope when env unset"
    "sync-version.js --check: canonical & mirrors in sync"
    "sync-agent-bodies.sh --check: agent-bodies/ in sync with agents/"
    ".agents/skills symlink resolves to ../skills (target exists)"
    ".agents/skills adapter targets CARRY their name: invariant"
    "scripts/validate.sh: all skills pass structural validation"
    "hook inventory: doc counts + tier membership match wiring"
    "README parity: README.md ↔ README.zh-TW.md badges + sections"
    "Codex plugin payload mirror is in sync"
    "doc-drift gate: internal links resolve + code-fences balance"
  )

  for check in "${always_run_checks[@]}"; do
    assert_contains "$OUT" "$check" "Always-run check '$check' is present in output"
  done
else
  echo "=== Case 1 (clean full run) skipped — set PREFLIGHT_META_FULL=1 for the slow path ==="
fi

# ─── Case 2: FAIL ───
# Perturb the real tree by corrupting the name invariant in dev-flow's SKILL.md.
# The preflight script should fail with a non-zero exit code, and the output
# should name the check that failed. We use a trap-protected restore.

TARGET_FILE="$REPO_ROOT/skills/dev-flow/SKILL.md"
BACKUP_FILE="$TEST_TMP/SKILL.md.bak"

# 1. Back up the target file.
cp "$TARGET_FILE" "$BACKUP_FILE"

# 2. Add an additional cleanup handler for emergency restore in case of failure.
# We extend the EXIT trap from lib.sh to ensure restore happens even on early exit/interruption.
cleanup_smoke() {
  if [ -f "$BACKUP_FILE" ]; then
    cp "$BACKUP_FILE" "$TARGET_FILE"
  fi
  cleanup_test_tmp
}
trap cleanup_smoke EXIT

# 3. Seed a violation: corrupt "name: dev-flow" in skills/dev-flow/SKILL.md
sed 's/name: dev-flow/name: corrupt-flow/' "$TARGET_FILE" > "$TEST_TMP/SKILL.md.tmp" && mv "$TEST_TMP/SKILL.md.tmp" "$TARGET_FILE"

echo "=== Case 2: Running preflight-portability with seeded violation ==="
FAIL_OUT="$(bash "$SCRIPT" 2>&1)"
FAIL_EXIT=$?

# Print the output to the console for visibility/logging.
echo "$FAIL_OUT"

# Assert nonzero exit
assert_neq "0" "$FAIL_EXIT" "preflight-portability exits nonzero when a violation is seeded"

# Assert the failure names the seeded check: ".agents/skills adapter targets CARRY their name: invariant"
assert_contains "$FAIL_OUT" "✗ .agents/skills adapter targets CARRY their name: invariant" "failure output names the seeded check"

# 4. Restore the file manually
cp "$BACKUP_FILE" "$TARGET_FILE"
rm -f "$BACKUP_FILE"

# 5. Restore proof: byte-identical restore == pre-test state (a full rerun is the slow path)
if cmp -s "$TARGET_FILE" "$BACKUP_FILE" 2>/dev/null || git diff --quiet -- "$TARGET_FILE"; then
  echo "restore verified byte-identical (git diff clean)"
else
  fail "restore left $TARGET_FILE differing from HEAD"
fi
if [ "${PREFLIGHT_META_FULL:-0}" = "1" ]; then
  echo "=== Verifying preflight-portability passes after restore (slow path) ==="
  RESTORED_OUT="$(bash "$SCRIPT" 2>&1)"
  RESTORED_EXIT=$?
  assert_eq "0" "$RESTORED_EXIT" "preflight-portability passes again after restoring the file"
fi

# 6. Assert repo is clean at the end
# Since hooks/tests/preflight-meta-smoke.test.sh is running, it might show up as untracked.
# We filter it out of the git status output to check if any other files are modified/untracked.
status=$(git status --porcelain | grep -v "hooks/tests/preflight-meta-smoke.test.sh" || true)
assert_eq "" "$status" "git status shows the repository is clean after the test run"

finalize_test
