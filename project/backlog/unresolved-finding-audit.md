# Audit of verified review findings with no resolution record (BL-0398)

Source: PM ruling, fleet, 2026-11-05. Data: "host count 2026-11-05" (held by the PM).

## Counts
- 99 of 443 review receipts, produced 2026-10-18..2026-11-03, have an earlier generation's verified finding that was never resolved: 545 findings (Major 459, Minor 86).
- Heuristic only, not proof (files cited by the finding versus `git diff --name-only <raised head>..<last head>`):
  - 214: the cited file changed later (likely only missing bookkeeping).
  - 54, in 28 receipts: the cited file never changed later (possibly dropped findings).
  - 277: the finding cites no path.

## Ask (PM)
- Audit the 54 by hand, lanes still in progress first. A finding confirmed dropped gets a follow-up fix in its lane.
- Deadline 2026-11-08.
- Related: BL-0384 (resolutions bookkeeping; shipped as the finalize warning and `refinalize --add-resolutions`, see CHANGELOG.md rrint1 / rrint2). The addendum can close the bookkeeping-only cases once audited.

## Notes
- Trigger: date 2026-11-08. Effort M.
