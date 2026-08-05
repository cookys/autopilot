#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

# Exercise the real preflight function in a disposable tree. The canonical
# checkout is never edited, so production Mission/git authority cannot leak in.
SANDBOX="$TEST_TMP/repo"
mkdir -p "$SANDBOX/scripts" "$SANDBOX/skills/dev-flow" "$SANDBOX/skills/quality-pipeline" "$SANDBOX/.agents"
cp "$REPO_ROOT/scripts/preflight-portability.sh" "$SANDBOX/scripts/preflight-portability.sh"
ln -s ../skills "$SANDBOX/.agents/skills"
printf '%s\n' '---' 'name: dev-flow' 'description: fixture' '---' > "$SANDBOX/skills/dev-flow/SKILL.md"
printf '%s\n' '---' 'name: quality-pipeline' 'description: fixture' '---' > "$SANDBOX/skills/quality-pipeline/SKILL.md"

CLEAN_OUT="$(bash "$SANDBOX/scripts/preflight-portability.sh" --meta-fixture 2>&1)"
CLEAN_RC=$?
assert_eq "0" "$CLEAN_RC" "clean sandbox fixture passes"
assert_contains "$CLEAN_OUT" "✓ .agents/skills adapter targets" "clean check is exercised"

sed 's/name: dev-flow/name: corrupt-flow/' "$SANDBOX/skills/dev-flow/SKILL.md" \
  > "$SANDBOX/skills/dev-flow/SKILL.md.bad"
mv "$SANDBOX/skills/dev-flow/SKILL.md.bad" "$SANDBOX/skills/dev-flow/SKILL.md"
set +e
BAD_OUT="$(bash "$SANDBOX/scripts/preflight-portability.sh" --meta-fixture 2>&1)"
BAD_RC=$?
set -e
assert_neq "0" "$BAD_RC" "planted adapter violation fails closed"
assert_contains "$BAD_OUT" "✗ .agents/skills adapter targets" "failure names planted invariant"

finalize_test
