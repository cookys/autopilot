# v2.36.113 — cost-tracker context signal (evidence)

- The owner noticed the statusline said 33% context while the cost-tracker hook advised "context heavy"; the model relayed the hook's claim twice without checking the live number.
- What the hook really counted: the cumulative sum of `cache_read` tokens over every API call of the session (calls x window), not the window fill. 62.4M cache-read tokens at 33% real fill.
- Fix (hand I, bundle w113): cost-tracker reads the real context % from the live context file and recommends /clear only at >= 50%.
- cost-fuse now shows session spend and host spend separately instead of one unlabelled host figure.
- The dispatch exemption in cost-fuse is warn-mode only: the review found an `&` (backgrounded chain) and process-substitution bypass.
- Depth-0 ruling: a regex over a shell command line cannot be made bypass-proof, so the exemption never applies in block mode.
- Follow-ups are in BACKLOG (pricing table has no fable row; exemption prefix and session-id collisions).
- Files: `hand-common.md`, `unit-I.md`, `bundle-w113.md`, `land-brief.md`, `closeout-brief.md` (briefs); `*.review.json` (unit reviews I/I2 and landing review `w113`); `REPORT-land.md` (landing foreman report).
- Investigation: `docs/plans/research/2026-10-03-cost-tracker-context-signal-dogfood.md`.
