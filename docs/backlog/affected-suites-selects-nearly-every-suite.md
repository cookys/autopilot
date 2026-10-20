# Affected-suites selects nearly every suite for a small diff

BL-0213. Code: scripts/affected-suites.js

Top three fan-in sources: scripts/dev-setup.sh 484 suites (hooks/tests/lib.sh carries 477); codex mirror of review-resolution.js 380 (src/engine/autopilot-engine.js carries 378); docs/plans/2026-10-17-review-only-campaign-fix-increment.md 202.

Round 3 (2026-10-20) measured `node scripts/affected-suites.js --json` on the three merges. Mode selective. stats.selected: d997355a9 97, b8bdd61f3 204, 3765302f3 78.

JavaScript block comments and lines whose first non-blank character is `*` no longer create edges. `scripts/check-plan-graduation.js` named `docs/scripts-inventory.md` only in JSDoc and `//` comments; after the strip that hop is gone, and the file does not `readFileSync` that path. `src/status/decisions-sidecar.js` still weakly names `src/engine/autopilot-engine.js` because `fileContains` reads that path as data (~142 suites). That edge stays.

Left in place: a bare word `run` in several scripts still matches `hooks/tests/run.sh`. Dropping every bare `run` would also drop a real extensionless invocation, so those hops stay.

Closeout4 ran `node scripts/affected-suites.js --json` on two merges (2026-10-19).

Run 1 (`0270c58cc..d997355a9`): 546 of 616 suites. Always-run is 15. Top fan-in: `scripts/dev-setup.sh` 484 (of which `hooks/tests/lib.sh` alone carries 477, because it sources the script); `hooks/tests/dev-setup.test.sh` 46 (via `hooks/tests/run.sh` 44); the Codex dev-setup mirror 12.

Run 2 (`d997355a9..b8bdd61f3`): 588 of 617. Top fan-in: the Codex mirror of `review-resolution.js` 380 (`src/engine/autopilot-engine.js` carries 378); a docs plan 202; `scripts/session-mode.js` 48.

The outcome gate needs a run record. A selection of 500+ suites has no feasible record, so each push reports no record. The ordinary quality-flow test step would run the same set.
