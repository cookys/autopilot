# autopilot effort vocabulary has no `minimal` — the muse-spark contributor tier cannot be examined at its cheapest setting

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a Board request to examine or route a seat at `minimal` (asked 2026-09-03 for opencode-go/muse-spark-1.3-contributor), or a second provider whose cheapest reasoning tier is below `low`.
- **Context**: `dispatch-hetero.sh` (`--effort` enum), `engine-scorecard.js` (`EFFORT_VALUES`), `src/engine/capability-evidence.js`, `schemas/review-loop-contract.schema.json`, `implementer-ladder.js` and the seat-hash partition all enumerate `low|medium|high|xhigh|max`. Adding `minimal` is a vocabulary change across every validator plus the seat-identity/effort partition (v2.35.9) — an L with its own parity gates, not a one-line enum edit. Probe evidence that the tier is real: reasoning ≈53 tokens vs low ≈103 on the same prompt.
- **Effort**: L
- **Source**: v2.35.14 probe (`CHANGELOG.md`); opencode models.dev `reasoning_options` for the model

