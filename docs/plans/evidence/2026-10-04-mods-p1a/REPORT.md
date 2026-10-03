# P1a landing — STOPPED before release (no version bump, no commit, no push)
Branch release/v2.36.115 in /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/run-land/../land at 2f59aa1b; 9 picks clean, enforcement_mode=enforce after each.
Suite: 405 files, 3 red: L1 unit suite, qualification-feed-adopt, qualification-scorecard-tools. All three red at origin/develop too (base worktree /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/run-land/base; L1 failure lists identical, 22 fails, AA cache inside git worktree). Pre-existing.
Store: test-created leak: /run/user/1000/autopilot/runs-enrich-cursor.json now holds dir=/tmp/autopilot-test-manifest-repo-identity-b31NSy/runs-old (branch's manifest-repo-identity.test.sh calls status runs without isolating the live dir). Other changed paths are real-session activity. No leftover runs --watch process.
Other gates green: check-js-syntax, sync-codex-plugin-skills --check, validate.sh, check-claude-md-inventory.
Review: run review-1791056950-4064573-3aa6, verdict FIX-THEN-SHIP (see /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/run-land/p1a.review.json).

## Round 2 (stopped again)
Picked fec41d15 -> b27e6aa6, 5bd2cca3 -> 0284414a (enforce ok). Full suite 2: same 3 reds (L1, qualification-feed-adopt, qualification-scorecard-tools), L1 failure list identical to base. Round-2 review review-1791059880-1330487-354b: FIX-THEN-SHIP, MUST-FIX fresh-bound-rotation-set. No release.

## Round 3 — LANDED
cf54fc74 -> aca55046. Solo reruns (9 suites) all rc=0; L1 failure list identical to base. Review round 3 review-1791061184-1469822-cdb4 SHIP-AS-IS. V=2.36.115, release commit and pushed SHA 97be7170dd59a8f4153d5f2886c145fedfdad4c4 (ls-remote confirmed).
Reviews: r1 review-1791056950-4064573-3aa6 (FIX-THEN-SHIP), r2 review-1791059880-1330487-354b (FIX-THEN-SHIP), r3 above.

> Later diagnosis (closeout): the suite did set `AUTOPILOT_LIVE_DIR`, but on /tmp (not RAM-backed) via `mkdir -p` (mode 755); `scripts/lib/live-state-dir.js` rejected the override and fell through to the real live dir. See README and BACKLOG.
