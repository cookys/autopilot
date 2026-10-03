# v2.36.111 evidence — REVIEWING resume, per-seat final-panel reuse, reviewer output budget

Pipeline: depth-0 wrote one bundle (`bundle-w111.md`) and dispatched parallel sonnet hands A/B/C/D into
one clone (briefs `hand-common.md`, `unit-*.md`). Each row got its own fable review (`<unit>.review.json`);
repairs followed as C-r2, A-r2, A3, A3-repair and R1. One landing foreman (`land-brief.md`, `REPORT-land.md`)
cherry-picked the rows and ran the full suite; one combined review returned SHIP-AS-IS
(`land-w111.review.json`, run `review-1790988220-2436217-0822`). `closeout-brief.md` is this closeout.

TMPDIR probe (`tmpdir-repro.out`, `link.dispatch-author.log`): 4 TMPDIR shapes x 2 suites; only a symlinked
TMPDIR failed (agy bwrap bind and the verify-cmd directory). `finalize-probe.out` is the lib.sh finalize survey.

What per-row review MISSED, and who caught it:
- Unit A's suite had no `finalize_test` (green by construction). It passed the hand's self-report AND the
  per-row fable review; the C-r2 hand caught it by reading the output (no PASS line).
- A-r2's suite tolerated a blocked resume. The per-row review caught it (🟠 `a2-status-not-asserted`).
- The boundary-rejected terminal-audit defect was found by a read-only debugger with a control run
  (`debug-boundary.md`, `DEBUG-boundary-terminal-audit.md`); it is a product defect, queued, not fixed here.
- The landing full suite caught a Population B fixture registration that no per-row Verify ran.

The landing push needed the GitHub noreply author email (10 commits were rewritten). Reaping of the
`final-panel-seats/` store: no reaper removes it (BACKLOG row added).
