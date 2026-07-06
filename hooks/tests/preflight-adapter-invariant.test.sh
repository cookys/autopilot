#!/usr/bin/env bash
# preflight-portability.sh adapter-invariant test (P3) — the content-carrying
# assertion must FAIL when a seeded .agents/skills/<skill> target resolves but does
# NOT contain its `name:` invariant (stub/empty/wrong content), and PASS when intact.
#
# We extract just the check_adapter_targets_carry_invariant function from the script
# (it depends only on $REPO) and run it against a sandbox skills tree — so the test
# never mutates the live .agents/skills symlink target.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/preflight-portability.sh"

# Pull the function body out of the real script (single source of truth — if the
# function is renamed/removed this extraction fails loudly).
FN="$(awk '/^check_adapter_targets_carry_invariant\(\) \{/{p=1} p{print} p&&/^}/{exit}' "$SCRIPT")"
assert_neq "" "$FN" "extracted check_adapter_targets_carry_invariant from preflight script"
eval "$FN"

# sandbox skills tree that the function will read via $REPO/.agents/skills
SBX="$TEST_TMP/repo"
mkdir -p "$SBX/.agents/skills/dev-flow" "$SBX/.agents/skills/quality-pipeline"
REPO="$SBX"   # the function reads $REPO

write_skill() { # <skill> <name-line>
  printf -- '---\nname: %s\ndescription: x\n---\n# %s\n' "$2" "$1" \
    > "$SBX/.agents/skills/$1/SKILL.md"
}

# 1. intact: both targets carry their correct name: invariant → pass (exit 0)
write_skill "dev-flow" "dev-flow"
write_skill "quality-pipeline" "quality-pipeline"
OUT="$(check_adapter_targets_carry_invariant 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "intact adapter targets pass"

# 2. stubbed target: dev-flow/SKILL.md resolves but has WRONG name: → fail (exit 1)
write_skill "dev-flow" "totally-wrong-name"   # file exists, but invariant absent
OUT="$(check_adapter_targets_carry_invariant 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "stubbed (wrong-content) adapter target fails"
assert_contains "$OUT" "lacks invariant" "stub failure names the missing invariant"
assert_contains "$OUT" "dev-flow" "stub failure names the skill"
write_skill "dev-flow" "dev-flow"   # restore

# 3. empty/missing target file → fail (exit 1)
rm "$SBX/.agents/skills/quality-pipeline/SKILL.md"
OUT="$(check_adapter_targets_carry_invariant 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing adapter target file fails"
assert_contains "$OUT" "missing" "missing-target failure message"

finalize_test
