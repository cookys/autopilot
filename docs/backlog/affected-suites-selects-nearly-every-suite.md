# Affected-suites selects nearly every suite for a small diff

BL-0213. Code: scripts/affected-suites.js

Round 4 (2026-10-20) `--files` counts on this tree: scripts/dev-setup.sh 39 suites, codex mirror of review-resolution.js 22, docs/plans/2026-10-17-review-only-campaign-fix-increment.md 12. Round 1's caps were 484, 380 and 202.

Round 5 (2026-10-20) measured `node scripts/affected-suites.js --base <rev>^1 --head <rev> --json`. Mode selective. stats.selected: d997355a9 102, b8bdd61f3 269, 3765302f3 83 (same as round 4; round 3 was 97, 204, 78). A slash-star starts a block comment only when it is the first non-blank on its line, and a trailing // is stripped before that check, so `split(/[/*]/)` and `// see /*` no longer erase a later require. Those restores did not change the three merge counts. The round 4 rise from round 3 remains: a slash-star inside a string no longer erases later requires, and a platforms/ mirror no longer makes a source stem generic.

On b8bdd61f3 the largest hops are src/engine/review-resolution.js (252, bare name, now that the codex mirror is not a second stem) and src/engine/autopilot-engine.js (250). `src/status/decisions-sidecar.js` still weakly names `src/engine/autopilot-engine.js` because `fileContains` reads that path as data (190 suites on that chain). That edge stays. `scripts/check-plan-graduation.js` named `docs/scripts-inventory.md` only in JSDoc and `//` comments; that hop stays gone. A star line creates an edge only inside a block comment.

Left in place: a bare word `run` in several scripts still matches `hooks/tests/run.sh` (64 suites on d997355a9, via hooks/tests/dev-setup.test.sh). Dropping every bare `run` would also drop a real extensionless invocation, so those hops stay. An extensionless directory glob in a hooks/tests helper still creates no edge.

Closeout4 ran `node scripts/affected-suites.js --json` on two merges (2026-10-19).

Run 1 (`0270c58cc..d997355a9`): 546 of 616 suites. Always-run is 15. Top fan-in: `scripts/dev-setup.sh` 484 (of which `hooks/tests/lib.sh` alone carries 477, because it sources the script); `hooks/tests/dev-setup.test.sh` 46 (via `hooks/tests/run.sh` 44); the Codex dev-setup mirror 12.

Run 2 (`d997355a9..b8bdd61f3`): 588 of 617. Top fan-in: the Codex mirror of `review-resolution.js` 380 (`src/engine/autopilot-engine.js` carries 378); a docs plan 202; `scripts/session-mode.js` 48.

The outcome gate needs a run record. A selection of 500+ suites has no feasible record, so each push reports no record. The ordinary quality-flow test step would run the same set.

## Round 5 detail (moved from BACKLOG Context)

Round 5 (2026-10-20), mode selective via --base rev^1 --head rev, stats.selected: d997355a9 102, b8bdd61f3 269, 3765302f3 83 (unchanged from round 4; was 97, 204, 78 before that). A slash-star starts a block comment only as the first non-blank on its line, so a regexp or a trailing // no longer erases a later require; counts did not move. Kept: decisions-sidecar.js fileContains('src/engine/autopilot-engine.js') is a real data read (190 on the b8 chain). Largest b8 hops: review-resolution.js 252, autopilot-engine.js 250. Left: bare word run still weakly matches hooks/tests/run.sh (64 on d997, via dev-setup.test.sh); pruning that word is not safe. Extensionless hooks/tests helper globs still create no edge.

## Follow-up

When a regex literal on one line contains adjacent escaped slashes (for example the literal slash-backslash-slash-backslash-slash form used to match a double slash), the double-slash stripping eats the rest of that line, including a require that follows; no such pattern exists in the tree today; source: selfix g3 review b7aed995.
