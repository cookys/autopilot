#!/usr/bin/env bash
# check-js-syntax.test.sh — contract for scripts/check-js-syntax.js.
#
# Covers: green on the real (clean) tracked tree; a PLANTED NEGATIVE reproducing the
# ACTUAL v2.34.41 failure mode (a block comment containing the comment-close sequence
# inside it, early-terminating the comment); valid ESM and valid CJS fixtures both pass
# (module-type handling does not false-fail); the stale-exclusion fail-closed path (the
# shipped EXCLUDED_PREFIXES is empty, so this exercises the mechanism on a scratch copy).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-js-syntax.js"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Gate is green on the real repo as it stands.
# ─────────────────────────────────────────────────────────────────────────────
OUT=$(node "$SCRIPT" 2>&1); RC=$?
assert_exit_code "$RC" "0" "check-js-syntax exits 0 on the real tracked tree"
assert_contains "$OUT" "parse cleanly" "success line reports a clean parse"
assert_contains "$OUT" "✓ check-js-syntax:" "success line is prefixed per house style"

# ─────────────────────────────────────────────────────────────────────────────
# Scratch git repo: check-js-syntax.js enumerates via `git ls-files`, so every
# fixture needs a real git-tracked (add, no need to commit) file in its own repo.
# ─────────────────────────────────────────────────────────────────────────────
SCRATCH="$TEST_TMP/scratch"
mkdir -p "$SCRATCH/scripts"
cp "$SCRIPT" "$SCRATCH/scripts/check-js-syntax.js"
(
  cd "$SCRATCH"
  git init -q
  git config user.email t@t; git config user.name t
) >/dev/null 2>&1

run_scratch() { ( cd "$SCRATCH" && node scripts/check-js-syntax.js ); }

# ─────────────────────────────────────────────────────────────────────────────
# 2. PLANTED NEGATIVE — reproduce the ACTUAL v2.34.41 failure mode: a doc comment
#    that mentions the comment-close sequence (built here from two literal chars so
#    this file's OWN block comment above cannot be tripped by writing it inline)
#    early-terminates the block comment, leaving the rest of the header as bad code.
# ─────────────────────────────────────────────────────────────────────────────
CLOSE='*/'
{
  echo "'use strict';"
  echo ""
  echo "/**"
  echo " * Describes something with an example ${CLOSE} embedded right here by accident."
  echo " * The rest of this doc comment is now dangling as bad code below the early close."
  echo " */"
  echo "function broken() { return 1; }"
  echo ""
  echo "module.exports = { broken };"
} > "$SCRATCH/dispatch-plan-review.js"
( cd "$SCRATCH" && git add dispatch-plan-review.js scripts/check-js-syntax.js ) >/dev/null 2>&1

OUT=$(run_scratch 2>&1); RC=$?
assert_exit_code "$RC" "1" "planted */-in-comment negative exits 1"
assert_contains "$OUT" "dispatch-plan-review.js" "failing file is named"
assert_contains "$OUT" "SyntaxError" "Node's actual SyntaxError message is surfaced"

# committing a broken .js into the REAL tracked tree is never done — this fixture
# lives only in the scratch repo under TEST_TMP, cleaned up by lib.sh's EXIT trap.
( cd "$SCRATCH" && git rm -q --cached dispatch-plan-review.js && rm -f dispatch-plan-review.js ) >/dev/null 2>&1

# ─────────────────────────────────────────────────────────────────────────────
# 3. A valid ESM fixture and a valid CJS fixture both pass — module-type handling
#    does not false-fail either direction. check-js-syntax.js delegates entirely to
#    `node --check`, which itself resolves module type from the nearest tracked
#    package.json (falling back to Node's own syntax-detection when absent).
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$SCRATCH/esm-pkg"
cat > "$SCRATCH/esm-pkg/package.json" <<'JSON'
{"type":"module"}
JSON
cat > "$SCRATCH/esm-pkg/valid.js" <<'EOF'
export const x = 1;
export function add(a, b) { return a + b; }
EOF

mkdir -p "$SCRATCH/cjs-pkg"
cat > "$SCRATCH/cjs-pkg/package.json" <<'JSON'
{"type":"commonjs"}
JSON
cat > "$SCRATCH/cjs-pkg/valid.js" <<'EOF'
'use strict';
function add(a, b) { return a + b; }
module.exports = { add };
EOF

( cd "$SCRATCH" && git add esm-pkg/package.json esm-pkg/valid.js cjs-pkg/package.json cjs-pkg/valid.js ) >/dev/null 2>&1

OUT=$(run_scratch 2>&1); RC=$?
assert_exit_code "$RC" "0" "valid ESM + valid CJS fixtures both pass (no false-fail)"
assert_contains "$OUT" "parse cleanly" "clean-pass message shown with mixed module types present"

( cd "$SCRATCH" && git rm -q --cached esm-pkg/valid.js esm-pkg/package.json cjs-pkg/valid.js cjs-pkg/package.json
  rm -rf esm-pkg cjs-pkg ) >/dev/null 2>&1

# ─────────────────────────────────────────────────────────────────────────────
# 4. Stale exclusion → fail-closed exit 2. The shipped EXCLUDED_PREFIXES is empty
#    (the full tracked-JS sweep is clean), so this exercises the mechanism on a
#    patched scratch copy of the script rather than the production exclusion list.
# ─────────────────────────────────────────────────────────────────────────────
STALE_SCRIPT="$TEST_TMP/check-js-syntax.stale.js"
sed 's/^const EXCLUDED_PREFIXES = \[\];$/const EXCLUDED_PREFIXES = ["no-such-path-in-this-repo\/"];/' \
  "$SCRIPT" > "$STALE_SCRIPT"
assert_neq "$(cat "$STALE_SCRIPT")" "$(cat "$SCRIPT")" "sed actually patched the scratch copy (sanity)"
node --check "$STALE_SCRIPT" >/dev/null 2>&1
assert_exit_code "$?" "0" "patched scratch copy is itself valid JS"

cp "$STALE_SCRIPT" "$SCRATCH/scripts/check-js-syntax.js"
( cd "$SCRATCH" && git add scripts/check-js-syntax.js ) >/dev/null 2>&1
OUT=$(run_scratch 2>&1); RC=$?
assert_exit_code "$RC" "2" "a stale exclusion prefix (matches nothing) fails closed with exit 2"
assert_contains "$OUT" "no-such-path-in-this-repo/" "stale-exclusion message names the offending prefix"
assert_contains "$OUT" "stale exclusion" "stale-exclusion message says why it refused to run"

# restore the real (unpatched) script into the scratch repo for cleanliness
cp "$SCRIPT" "$SCRATCH/scripts/check-js-syntax.js"
( cd "$SCRATCH" && git add scripts/check-js-syntax.js ) >/dev/null 2>&1

finalize_test
