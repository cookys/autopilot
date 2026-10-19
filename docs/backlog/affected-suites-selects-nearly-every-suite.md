# Affected-suites selects nearly every suite for a small diff

BL-0213. Code: `scripts/affected-suites.js`.

Closeout4 ran `node scripts/affected-suites.js --json` on two merges (2026-10-19).

Run 1 (`0270c58cc..d997355a9`): 546 of 616 suites. Always-run is 15. Top fan-in: `scripts/dev-setup.sh` 484 (of which `hooks/tests/lib.sh` alone carries 477, because it sources the script); `hooks/tests/dev-setup.test.sh` 46 (via `hooks/tests/run.sh` 44); the Codex dev-setup mirror 12.

Run 2 (`d997355a9..b8bdd61f3`): 588 of 617. Top fan-in: the Codex mirror of `review-resolution.js` 380 (`src/engine/autopilot-engine.js` carries 378); a docs plan 202; `scripts/session-mode.js` 48.

The outcome gate needs a run record. A selection of 500+ suites has no feasible record, so each push reports no record. The ordinary quality-flow test step would run the same set.
