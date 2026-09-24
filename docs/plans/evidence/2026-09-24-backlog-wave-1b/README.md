# Evidence — backlog bundles wave-1b (v2.36.95)

Ten BACKLOG rows left over from the 2026-09-21 bundle plans (the handoff said 11; the real count is 10):
rlr 131/136/137, hlsm 139/140, dlrm 93/109/122/123, mrce 15. Shipped as v2.36.95, `41f1bff6`.

## Shape
- Depth-0 wrote the briefs and delegated all product work. Four `sonnet` foremen ran as Agent subagents, one fresh clone
  per unit, all pinned at `475ebdc7`. Hands were `cursor-grok-4.6-low` via `dispatch-hetero.sh`; every row got a
  `claude-fable-5-1` review.
- Briefs: the 09-21 foreman rules and row briefs, with `preamble.md` prepended as a set of overrides. Row 15's brief was
  rewritten (`row15.md`) because the owner had already authorized widening its scope on 09-21.
- Landing and repair foremen: `brief-land.md` and `brief-repair.md`. Per-unit reports: `REPORT-*.md`.

## What went wrong, and the fix
1. **Mission enforce refused every raw hand dispatch.** The first briefs omitted the clone-local
   "PARALLEL-RUN LOCAL ONLY … enforcement_mode shadow" commit that the documented recipe requires
   (`../2026-09-19-parallel-sonnet-foremen/common.md` line 7). Depth-0 added the commit afterwards and messaged each foreman.
   One foreman (hlsm, `REPORT-hlsm-attempt1.md`) correctly refused a governance downgrade that arrived in a message it
   could not authenticate, and reset its clone. The retry put the shadow commit into the brief itself, where it was accepted.
   Lesson: the shadow commit belongs in the brief from the start, never in a follow-up message.
2. **Five suites were red only after integration.** The units verified on `475ebdc7` and ran only their own bundle suites;
   the landing base was `8564ef2c`. Bisect traced all five reds to rows 122 and 15. Three repair commits
   (`REPORT-repair.md`) fixed them:
   - row 122 dropped `agy` from the effort-consuming set (a product fix), and some fixtures carried fabricated effort values;
   - row 15's new guard correctly rejected a fixture that was not a git repo, so the fixture now runs `git init`;
   - a population pin was re-pinned from 42/6 to 43/7.
   The mrce foreman had labelled the routing red "pre-existing at base". That was wrong: the suite is green at base.
   Lesson: per-row Verify has to include the consumer suites of every contract the row changes, not only the bundle suite.
3. The final combined review (`final-review.json`) returned SHIP-AS-IS with three 🔵 items. The full gate run
   (`gates2-results.txt`) passed 44/44.
