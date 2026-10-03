# Population B switch suite flakes with a stale entry under parallel runs

`hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh` Population B reported a "stale entry
autopilot-engine-repair-branch.test.sh" twice on 2026-10-03 (w112 row G check and w113 hand I) during
`--parallel` runs; both passed on a solo rerun.

Suspects: a grep or listing over a tree another parallel suite is mutating, or a shared temp path.
Find the race (run the suite alongside the full parallel set, capture the listing it saw) before
touching the registration list itself. Record any further sighting here.
