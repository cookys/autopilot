#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SKILL="$REPO_ROOT/skills/engine-onboarding/SKILL.md"
REF="$REPO_ROOT/skills/engine-onboarding/references/role-and-harness-governance.md"

assert_file_exists "$REF" "role/harness governance reference exists"

SKILL_BODY="$(cat "$SKILL")"
REF_BODY="$(cat "$REF")"

assert_contains "$SKILL_BODY" "role-and-harness-governance.md" "engine-onboarding links governance reference"
assert_contains "$SKILL_BODY" "planner, implementer, verifier, reviewer, or orchestrator" "engine-onboarding trigger names all governed roles"
assert_contains "$SKILL_BODY" 'Canonical roles are `owner`, `implementer`, `reviewer`, `verification_author`, and `explorer`' "engine-onboarding records canonical role evidence support"
assert_contains "$SKILL_BODY" "stored and returned rows are canonical" "engine-onboarding separates legacy aliases from canonical evidence"
assert_contains "$SKILL_BODY" 'Disk-backed `report`/`ladder` never returns a qualified routing candidate' "engine-onboarding blocks disk-backed ladder authority"
assert_contains "$SKILL_BODY" "Implementer, verification-author, explorer, and owner auto-qualification require their own role-specific eval suites" "engine-onboarding records unimplemented-role routing caveat"

for level in H0 H1 H2 H3 H4 H5; do
  assert_contains "$REF_BODY" "$level" "governance reference includes harness level $level"
done

for state in "R0 documented" "R1 spike-passed" "R2 scorecard-recordable" "R3 auto-routable" "R4 gate-routable" "R5 self-maintaining"; do
  assert_contains "$REF_BODY" "$state" "governance reference includes role promotion state $state"
done

for role in Owner Implementer "Verification author" Reviewer Explorer; do
  assert_contains "$REF_BODY" "$role" "governance reference includes role $role"
done

assert_contains "$REF_BODY" "R2 evidence store" "governance reference names scorecard evidence state"
assert_contains "$REF_BODY" "not, by itself" "governance reference separates scorecard evidence from permission"
assert_contains "$REF_BODY" "roles must not use fallback-ladder routing" "governance reference blocks ladder routing for R2-only roles"
assert_contains "$REF_BODY" "Pick exactly one target role" "governance reference requires per-role qualification"
assert_contains "$REF_BODY" "Do not qualify \"the model\" globally" "governance reference blocks global model qualification"
assert_contains "$REF_BODY" "driver CLI availability" "governance reference separates driver availability"
assert_contains "$REF_BODY" "third-party provider quota" "governance reference separates provider quota"
assert_contains "$REF_BODY" "Promote separately" "governance reference separates scorecard/resolver/gate/maintenance promotion"
assert_contains "$REF_BODY" "Evaluation Dimensions" "governance reference defines role evaluation dimensions"
assert_contains "$REF_BODY" "Survey alone is never enough for H3/H4/H5" "governance reference separates survey from dispatch/gating evidence"
assert_contains "$REF_BODY" "must not hardcode real model IDs" "governance reference records no-hardcoded-model rule"
assert_contains "$REF_BODY" "effort presets" "governance reference blocks hardcoded effort policy"
assert_contains "$REF_BODY" "Official docs or local probes are older than the configured TTL" "governance reference records TTL refresh trigger"
assert_contains "$REF_BODY" "Scorecard schema, eval corpus, role threshold, or fallback ladder policy changes" "governance reference records governance drift trigger"

finalize_test
