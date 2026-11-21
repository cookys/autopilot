# affected-suites is imprecise on doc-only changes and blind to three dependency kinds (BL-0391)

Source: PM, 2026-11-04/05 (approved).

## Problem
- Doc-only edits (CHANGELOG and other prose) make `scripts/affected-suites.js` select a near-full set, so the old operator rule d-a62f4abc fired a pre-merge full suite on almost every lane. PM ruling 2026-11-21 on task 01M7XRRV (operator 11-21) supersedes it: a selection of half or more no longer escalates to a pre-merge full suite. Pre-merge runs only the fast tier. The three dependency kinds below are caught by the post-merge full affected run (`scripts/post-merge-suite.sh`), not by widening the pre-merge selection. The full suite before a release tag is unchanged.
- The selector still misses three kinds of dependency:
  1. Suites that copy scripts into a throwaway layout (2026-11-04 g40d5: a `claude-account.js` require left 7 suites red on develop).
  2. Tests that scan the contents of a whole tree (2026-11-04 BL-0383: `scripts/CLAUDE.md` was counted as a requirer by the qualification-metrics test).
  3. Eval packs that freeze a copy of a skill file (2026-11-04 rrint1: `skills/hetero-review/references/code-loop.md` against `hooks/tests/bpack-content.test.sh`).

## Fix (PM approved)
- Narrow the selection for prose-only diffs.
- Add a replay red for each of the three misses (the selector must pick the suite that went red).

## Notes
- Trigger: PM dispatch. Effort M.
