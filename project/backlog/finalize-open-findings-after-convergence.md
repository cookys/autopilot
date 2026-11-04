# code-loop finalize leaves resolved findings in open_findings after convergence (BL-0384)

Source: PM, 2026-11-04.

## Problem
When the generation N+1 disposition does not write explicit resolutions, findings that were fixed and re-reviewed stay in the receipt JSON's `open_findings`, even though every verdict is SHIP-AS-IS. `refinalize` cannot add them afterwards.

## Evidence
- codeforge: `open_findings_count` still lists the 6 from g1.
- alfred: 19 g1 findings across links 1-3; worked around with a closure table in `receipt.md` (their local BL-0032).
- autopilot itself: g40d5 g2 missed `_resolve` and burned a generation. A scratchpad guard covers this locally, but the product still has the gap.

## Fix options
1. When finalize converges, refuse (or warn loudly) if `open_findings` is non-empty and has no matching resolution.
2. A supported after-the-fact way to add a resolution, recording the fix sha and the re-review head.

## Red case
Reproduce a g(N+1) disposition that is missing resolutions while the verdict is SHIP-AS-IS. The check must go red before the fix, green after.

## Notes
Trigger: after d5fu and the entry-doc split (BL-0383). Effort M.
