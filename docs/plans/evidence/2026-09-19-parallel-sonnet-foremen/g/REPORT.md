# REPORT — unit G (planreview-g)

## Branches / commits
- `hands/par3-g/planreview-g` head `4ceb55e5be2cc03e10f015f2e6b935ab70d2ff84` (base `15ae809f898104212d14dfb4cce1869c0dc17ed1`)
- Repair: `hands/par3-g/planreview-g-r2` head `8ddc69fd165f00c6d6862539f8b0fff8da7ab569` (base = r1 head)

## diff --stat vs base (r1, 6 files)
```
hooks/tests/dispatch-plan-review.test.sh           | 59 ++++++++++++++++++++++
hooks/tests/secret-scan-diff.test.sh               | 22 ++++++--
platforms/codex/plugin/scripts/dispatch-plan-review.js | 44 ++++++++++++++--
platforms/codex/plugin/src/transport/runner-envelope.js |  2 +
scripts/dispatch-plan-review.js                    | 44 ++++++++++++++--
src/transport/runner-envelope.js                   |  2 +
6 files changed, 160 insertions(+), 13 deletions(-)
```
r2 diff: 1 file, +1/-0 (`hooks/tests/dispatch-plan-review.test.sh` — added missing `assert_artifact_schema` call).

## Review verdict (decorrelated: claude-fable-5-1, effort high)
FIX-THEN-SHIP on r1 diff. Findings:
- 🟠 [schema-conformance-unasserted] MUST-FIX — ACCEPTED. New RED case (precondition_failed seat) omitted the
  `assert_artifact_schema` call every sibling `transport_exhausted` case carries. Real gap (test completeness),
  even though `attempts[].items` in the schema is unconstrained `{"type":"object"}` so it likely wasn't actually
  schema-invalid — dispatched repair to add the assertion and verify empirically rather than assume.
- 🔵 [self-scan-vacuity] CUT/FOLLOW-UP — REFUTED (not blocking). Spec prescribed the exact `--files` command;
  correctly implemented per spec. Left as noted follow-up, not fixed.
- 🔵 [broad-refuse-heuristic] CUT/FOLLOW-UP — REFUTED (not blocking). Spec-sanctioned broad refuse branch;
  noted as a future dispatch-author contract clarification, not required now.

Repair r2 added exactly the accepted fix (one line, `assert_artifact_schema "$OUT" "precondition_failed artifact
matches schema"`) and re-verified. No second repair round needed.

## Verify tail (run in the r2 worktree, all exit 0)
- `hooks/tests/dispatch-plan-review.test.sh` → PASS 281 assertions
- `hooks/tests/secret-scan-diff.test.sh` → PASS 17 assertions
- `node scripts/secret-scan-diff.js --files hooks/tests/secret-scan-diff.test.sh` → `{"findings": []}`
- `hooks/tests/dispatch-author.test.sh` → PASS 114 assertions
- `hooks/tests/plan-review-transport-fallback.test.sh` → PASS 57 assertions
- `hooks/tests/plan-review-transport-fixes.test.sh` → PASS 25 assertions
- `hooks/tests/plan-review-panel-status.test.sh` → PASS 32 assertions
- `bash scripts/sync-codex-plugin-skills.sh --check` → "Codex plugin payload in sync"
- `node scripts/check-js-syntax.js` → 666 files parse cleanly

## Not done / notes
- `schemas/plan-review-artifact.schema.json` was NOT touched — the new `assert_artifact_schema` assertion passed
  without a schema change, confirming the seat-level `error` field and `precondition_failed` classification are
  already schema-valid under the existing unconstrained `attempts[].items: {type: object}` shape. Brief anticipated
  a possible schema edit ("if the seat-record schema blocks a new seat field, add the optional field... never
  store the reason only in a log") — not needed here since nothing blocked it; verified empirically, not assumed.
- Both hands used `cursor-grok-4.6-low` and each made exactly one commit on its branch as instructed.
- No BACKLOG-row text found to be wrong; both rows' described defects matched what the RED tests reproduce.
