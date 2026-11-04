# check-phase-review-receipt --chain accepts packets review sets (BL-0378)

Source: follow-up recorded when the parent item closed (2026-11-04). Not yet scheduled.

BL-0373 shipped `--chain A,B` in aa95f0ce3 (Mode A phase ids only). Left open when it closed: review-packet sets (`--packets`) are not accepted as chain members and must be validated separately with `--packets`. Wanted: a chain whose members may be packets sets, with the same two rules (one contiguous base..tip; every changed path covered by the LAST set that touched it). Red case: a gap between a Mode A member and a packets member must fail.
