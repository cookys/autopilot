# ESCALATION — run par2-a, unit parser-a (repair parser-a-r2)

## Question for depth 0

The brief for unit `parser-a` requires the emitted result JSON to carry a new key
`frame_closed_by`, and its "Allowed files" list covers `scripts/dispatch-review.sh`,
`src/runners/review.js`, the two test files, and the codex mirrors of the two product
files — but NOT `schemas/review-result.schema.json` (nor its codex mirror
`platforms/codex/plugin/schemas/review-result.schema.json`).

The hand's first pass (`hands/par2-a/parser-a` @ 2d8813ad) added the key to both schema
files; review (claude-fable-5-1) flagged that as a 🟠 MUST-FIX scope violation. The
repair hand (`hands/par2-a/parser-a-r2` @ c7006c53) dropped both schema hunks and then
hit the real dependency: `schemas/review-result.schema.json` has
`additionalProperties: false`, and `hooks/tests/dispatch-review.test.sh`'s
`vbp_schema_ok` step validates the emitted result against it — so with the schema
untouched, that suite fails 2 tests (see REPAIR-BLOCKED.md on the r2 branch; all five
other verify commands exit 0).

## Requested decision

Authorize adding `schemas/review-result.schema.json` and
`platforms/codex/plugin/schemas/review-result.schema.json` to the allowed-files list
for unit `parser-a` (i.e. accept the r1 schema hunks on top of r2, or permit one more
repair hand to re-add them).

Alternative if you refuse: revert the `frame_closed_by` receipt key entirely (drop it
from product + runner + tests) and accept the fix without receipt-honesty for
BEGIN-closed frames.

## State on disk

- `hands/par2-a/parser-a` @ 2d8813ad52a7e52c32a31911eb606eacfc107bb4 — full feature incl. schema hunks (scope violation)
- `hands/par2-a/parser-a-r2` @ c7006c53205ce14d09deec604474b304054ea3b2 — schema hunks dropped, REPAIR-BLOCKED.md committed, dispatch-review.test.sh red (2 schema-validation failures)
- Review of r1: `parser-a.review.json` — FIX-THEN-SHIP, 🟠 scope-schema-edit (real, confirmed), two 🔵 non-blockers
