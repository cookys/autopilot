# hetero-review-loop collect: spec range and collected diff can differ (BL-0389)

Source: the BL-0383 review (g1-g3 and the entrydoc-full review), relayed by the PM (2026-11-04).

## Problem
- `hetero-review-loop collect`, from generation 2 on, reviews only the delta from the previous generation's head, even when `--phase-base` is given.
- When the spec claims "full range", nothing warns that the diff actually collected is narrower.
- In BL-0383, `platforms/CLAUDE.md` and `platforms/AGENTS.md` went through three generations unseen: g1 excluded `platforms/**`, and g2 and g3 collected only deltas. A seat caught it by reading the spec against the diff; a separate full-range phase closed it.

## Fix (PM approved)
- `collect` warns or fails when the spec-declared range and the collected diff differ.
- `collect` gains an opt-in full-range mode for generation > 1.

## Notes
- Same class as BL-0384: the review record diverges from reality.
- Trigger: PM dispatch. Effort M.
