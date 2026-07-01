#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SKILL="$REPO_ROOT/skills/engine-onboarding/SKILL.md"
REF="$REPO_ROOT/skills/engine-onboarding/references/role-and-harness-governance.md"

assert_file_exists "$REF" "role/harness governance reference exists"

SKILL_BODY="$(cat "$SKILL")"
REF_BODY="$(cat "$REF")"

assert_contains "$SKILL_BODY" "role-and-harness-governance.md" "engine-onboarding links governance reference"
assert_contains "$SKILL_BODY" "planner, implementer, verifier, reviewer, or orchestrator" "engine-onboarding trigger names all governed roles"
assert_contains "$SKILL_BODY" "Verifier and orchestrator qualification are methodology-defined but not scorecard-routable yet" "engine-onboarding records verifier/orchestrator routing caveat"

for level in H0 H1 H2 H3 H4 H5; do
  assert_contains "$REF_BODY" "$level" "governance reference includes harness level $level"
done

for role in Planner Implementer Verifier Reviewer Orchestrator; do
  assert_contains "$REF_BODY" "$role" "governance reference includes role $role"
done

assert_contains "$REF_BODY" "Survey alone is never enough for H3/H4/H5" "governance reference separates survey from dispatch/gating evidence"
assert_contains "$REF_BODY" "must not hardcode real model IDs" "governance reference records no-hardcoded-model rule"
assert_contains "$REF_BODY" "effort presets" "governance reference blocks hardcoded effort policy"
assert_contains "$REF_BODY" "Official docs or local probes are older than the configured TTL" "governance reference records TTL refresh trigger"
assert_contains "$REF_BODY" "Scorecard schema, eval corpus, role threshold, or fallback ladder policy changes" "governance reference records governance drift trigger"

finalize_test
