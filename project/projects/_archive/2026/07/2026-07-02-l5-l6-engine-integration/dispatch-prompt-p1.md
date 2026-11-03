# Heterogeneous Implementer Task: Phase 7 Engine Integration

## Goal

Complete Phase 7 of `docs/plans/2026-07-01-cross-harness-engine-infrastructure.md`: make `/l5` and `/l6` use an `AutopilotEngine`/CLI path for implementer -> review -> repair orchestration, while preserving existing shell contracts.

## Scope

Edit only files needed for this feature:

- `src/runners/implementer.js` (new)
- `src/engine/autopilot-engine.js`
- `src/engine/index.js`
- `bin/autopilot.js`
- `hooks/tests/autopilot-engine.test.sh`
- `hooks/tests/autopilot-cli.test.sh`
- `skills/l5/SKILL.md`
- `skills/l6/SKILL.md`
- `CHANGELOG.md`
- version mirrors touched by `node scripts/sync-version.js --version 2.28.2 --hook-count 22 --skill-count 27`
- project README if implementation decisions need tracking

Do not add new runners, change reviewer policy semantics, change dispatch isolation, or rewrite existing shell scripts unless a focused test proves it is necessary.

## Required Implementation

1. Add `src/runners/implementer.js`, analogous to `src/runners/review.js`, wrapping `scripts/dispatch-hetero.sh`.
   - Export `dispatchImplement`, `dispatchImplementJson`, `parseImplementationOutput`, and `DISPATCH_HETERO`.
   - Parse the last JSON object from stdout and validate the actual `dispatch-hetero.sh` result shape.
   - Required fields: `status`, `runner`, `model`, `branch`, `base`, `commit`, `files_changed`, `insertions`, `deletions`, `worktree`, `agent_log`, `error`.
   - `containment` / `contained` may be absent on `precondition_failed`; do not make precondition JSON unparsable.
   - Valid statuses: `committed`, `no_op`, `question_suspected`, `dirty`, `failure`, `precondition_failed`.

2. Extend `AutopilotEngine`.
   - Keep existing `resolveRoster()` and `reviewDiff()` behavior backward compatible.
   - Add implementer roster validation for `implementer_runner`, `implementer_engine`, `implementer_effort`.
   - Add `buildImplementationArgs({ roster, promptFile, branch, base, extraImplementationArgs })`.
   - Add `implementTask({ promptFile, branch, base, roster?, rosterArgs?, extraImplementationArgs? })`.
   - Add `runImplementationReviewLoop({ promptFile, branch, base, roster?, maxRounds?, convergenceVerdict?, requireQualifiedReviewer? })`.
   - The loop must:
     1. Resolve roster once when not injected.
     2. Dispatch implementation with immutable `base`.
     3. On `committed`, review `base..commit`.
     4. If reviewer verdict equals `loop_convergence_verdict`, return a converged result.
     5. Otherwise dispatch a repair implementation on a new branch based on the previous commit, then review the full original base-to-new-commit diff.
     6. Stop at `loop_max_rounds` and return a blocked/non-converged result with reason.
   - Add DI seams so tests do not call real models:
     - `implementationDispatcher`
     - `reviewDispatcher` already exists
     - `diffProvider` for turning `{ base, commit, branch, round }` into a diff file path
     - `repairPromptWriter` for creating the repair prompt file
   - Ledger rows must cover every dispatched unit: roster resolution, implementation, review, and repair implementation. Include runner/model/base/branch/commit/exit status when available.

3. Extend CLI.
   - Keep existing commands unchanged.
   - Add:
     `node bin/autopilot.js engine implement-review --prompt-file <file> --branch <branch> --base <immutable-sha> [--max-rounds N] [--require-qualified-reviewer]`
   - Print the engine result JSON to stdout.
   - Exit `0` only when the loop converges; exit `1` for non-converged/blocked engine results; exit `2` for usage errors.
   - Update `--help`.

4. Update docs.
   - `skills/l5/SKILL.md`: canonical path is now the engine CLI; direct `dispatch-hetero.sh` / `dispatch-review.sh` calls remain compatibility fallback and implementation detail.
   - `skills/l6/SKILL.md`: same canonical engine CLI path, with verification authoring still modeled as a delegated unit.

5. Version/changelog.
   - Add `CHANGELOG.md` entry for `2.28.2`.
   - Run the canonical sync script for `2.28.2` while preserving current counts (`27` skills, `22` hooks).

## Tests

Update focused tests so they run without network/model calls:

- `bash hooks/tests/autopilot-engine.test.sh`
  - Existing review-only tests must still pass.
  - Add implementer args/ledger test.
  - Add implementer -> review -> repair -> review convergence test using injected dispatchers. First review should return `FIX-THEN-SHIP`, repair should commit a second SHA, second review should return `SHIP-AS-IS`.
- `bash hooks/tests/autopilot-cli.test.sh`
  - Help lists `engine implement-review`.
  - Missing required args fail with exit `2` before dispatch.
- `bash hooks/tests/review-loop-runner.test.sh`
- `bash hooks/tests/review-runner.test.sh`
- `node scripts/sync-version.js --check`

## Acceptance

- No live model calls in tests.
- Existing shell contracts remain compatible.
- `AutopilotEngine` can demonstrate implementer -> review -> repair through DI.
- `/l5` and `/l6` docs no longer instruct users to manually orchestrate shell scripts as the primary path.
