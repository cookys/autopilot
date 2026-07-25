#!/usr/bin/env bash
# Routing contract regression: future plans never become parity audits.
. "$(dirname "$0")/lib.sh"

AUDIT="$REPO_ROOT/skills/audit/SKILL.md"
ROUTING="$REPO_ROOT/references/routing-tiebreaks.md"
REVIEWER="$REPO_ROOT/agents/reviewer.md"
RESEARCH_TO_SHIP="$REPO_ROOT/skills/research-to-ship/SKILL.md"

AUDIT_BODY="$(cat "$AUDIT")"
ROUTING_BODY="$(cat "$ROUTING")"
REVIEWER_BODY="$(cat "$REVIEWER")"
RESEARCH_BODY="$(cat "$RESEARCH_TO_SHIP")"

# Positive control: old/new implementation parity remains an audit trigger.
assert_contains "$AUDIT_BODY" "Compare two existing implementations" "audit description keeps existing-implementation parity"
assert_contains "$AUDIT_BODY" "feature parity review between old and new systems" "old/new parity remains an audit trigger"

# Negative controls: future asset-pipeline/architecture plan critique is not audit.
assert_contains "$AUDIT_BODY" "future/unimplemented plan readiness" "audit metadata excludes future plans"
assert_contains "$AUDIT_BODY" "routing_precondition_failed" "audit fails before exploration when target is absent"
assert_contains "$AUDIT_BODY" "current repository as a whole is not a substitute" "repo root cannot masquerade as future target"
assert_contains "$ROUTING_BODY" "critique this future plan" "routing table names future-plan prompt"
assert_contains "$ROUTING_BODY" "scripts/dispatch-plan-review.js" "future plans route to bounded plan-review rail"

# One invocation is terminal; reviewer prose cannot create a hidden loop.
assert_contains "$AUDIT_BODY" "One audit invocation performs one comparison pass and then terminates" "audit is single-pass"
assert_contains "$REVIEWER_BODY" "Never schedule another plan-review generation" "reviewer cannot schedule R2"
assert_contains "$REVIEWER_BODY" "current repository not yet implementing" "future absence is not a finding"

# Frozen-rubric/class/POC fields match the controller contract.
assert_contains "$REVIEWER_BODY" '"rubric_id": "R1"' "plan finding requires rubric_id"
assert_contains "$REVIEWER_BODY" '"class": "decision-now|implementation-spike|future"' "plan finding requires class"
assert_contains "$REVIEWER_BODY" '"blocks_next_slice_or_immediate_integrity": true' "POC blocker next-slice predicate is explicit"
assert_contains "$REVIEWER_BODY" '"cannot_defer_to_spike": true' "POC blocker deferral predicate is explicit"
assert_contains "$RESEARCH_BODY" "run \`scripts/dispatch-plan-review.js\`" "research-to-ship uses the bounded controller"
assert_contains "$RESEARCH_BODY" "never run generation 3" "research-to-ship carries the hard generation stop"
assert_not_contains "$RESEARCH_BODY" "loop until it converges" "research-to-ship no longer promises unbounded convergence"

finalize_test
