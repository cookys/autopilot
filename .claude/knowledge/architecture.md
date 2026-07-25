<!-- last-verified: 2026-07-26 -->
# Architecture Lessons

## Severity is not repair authority; peer is not Heto

**Date**: 2026-07-26 | **Context**: Revival World 3D asset-pipeline POC drifted into
authenticated device-preview receipts after technically valid review findings were treated
as mandatory current-ticket work.

**Problem**: Two independent concepts were collapsed. First, a verified Critical/Major
establishes that a claim is real, not that it belongs in the current task. Second, invoking
the same model in a fresh context is a useful blind peer sample, but it is not heterogeneous
review. When the strongest cross-family chair was unavailable, a same-model peer was
incorrectly presented as the Heto fallback.

**Solution**: The quality pipeline now separates claim verification from repair authority:
every surviving blocker is disposed `must-fix-now`, `follow-up`, or
`reject-out-of-scope`; only the first class may mutate the ticket, and a sealed full-diff
scope checker stops cumulative repair growth. Review taxonomy is explicit: same-family
fresh-context = peer; Heto requires a different model family. If the qualified chair is
unavailable, fall back to all eligible cross-family panelists rather than one weaker
substitute. Eligibility is per review lineage and payload: exclude implementers from that
lineage and seats whose capability/context cannot carry the diff; do not impose a permanent
role ban on a model.

**Related**: `scripts/adjudicate-findings.js`, `scripts/check-repair-scope.js`,
`skills/quality-pipeline/references/code-review.md`,
`docs/plans/2026-07-26-review-scope-stop-loss.md`.

