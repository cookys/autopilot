# Acceptance rubric — runner-aware reviewer output-token budget

Every item is required and content-bound to the frozen execution plan.

## R1 Canonical input is strict

`--max-tokens` accepts only one positive base-10 integer in 1..200000. Missing, zero, negative,
fractional, non-numeric, or over-range input exits 2 with a valid `precondition_failed` JSON object
before any runner spawn.

## R2 Supported mappings are exact

Anthropic-compatible receives exactly `--max-tokens <n>` and Qoder receives exactly
`--max-output-tokens <n>`. Fixtures observe argv rather than trusting prose or self-report.

## R3 Unsupported runners fail before spend

Codex, agy, Grok, cc-shim, and Claude-native each reject a supplied budget before runner
resolution/spawn. No budget is ignored, approximated with turns/chars/dollars, or forwarded through
an unverified config key.

## R4 Omission is compatible

Without `--max-tokens`, all seven runners retain their existing argument/default behavior and the
result JSON schema is unchanged. The direct Anthropic adapter and Qoder receive no newly synthesized
default cap.

## R5 Truncation remains fail-closed

Anthropic `stop_reason=max_tokens` remains `no_verdict`; a Qoder exit-0 partial wrapped block caused
by the cap also remains `no_verdict`. No partial `SHIP-AS-IS` can pass.

## R6 Existing review authority is preserved

Process exit truth, stdout-vs-stderr parsing, wrapped markers, verifier isolation, read-only scratch
posture, timeout handling, and no-finding proof rules are not weakened.

## R7 Documentation and scope are honest

Help/reference docs state the exact two supported and five unsupported rails, the unit/range, and
the distinction from input/window/turn/byte budgets. Only the authorized eight output paths change;
adjacent trigger-gated review-efficiency work stays untouched.

## R8 Verification and lifecycle close

Focused reviewer and detach tests, the full hook suite with the supported contention factor,
`bash -n`, skill validation, sync/version/inventory gates, completeness scan, and independent
depth-0 full-diff QC pass. The exact backlog item is removed, the project tracker is terminal, the
candidate is locally merged to `develop`, and nothing is pushed or published.
