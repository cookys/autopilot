# affected-suites is imprecise on doc-only changes and blind to three dependency kinds (BL-0391)

Source: PM, 2026-11-04/05 (approved).

## Problem
- Doc-only edits (CHANGELOG and other prose) make `scripts/affected-suites.js` select a near-full set, so operator rule d-a62f4abc fires on almost every lane.
- The selector still misses three kinds of dependency:
  1. Suites that copy scripts into a throwaway layout (2026-11-04 g40d5: a `claude-account.js` require left 7 suites red on develop).
  2. Tests that scan the contents of a whole tree (2026-11-04 BL-0383: `scripts/CLAUDE.md` was counted as a requirer by the qualification-metrics test).
  3. Eval packs that freeze a copy of a skill file (2026-11-04 rrint1: `skills/hetero-review/references/code-loop.md` against `hooks/tests/bpack-content.test.sh`).

## Fix (PM approved)
- Narrow the selection for prose-only diffs.
- Add a replay red for each of the three misses (the selector must pick the suite that went red).

## Notes
- Trigger: PM dispatch. Effort M.
