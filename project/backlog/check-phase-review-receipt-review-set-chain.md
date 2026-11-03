# check-phase-review-receipt verifies a chain of review sets (--chain A,B) (BL-0373)

Reported by the PM, 2026-11-04. Order: after BL-0371 (selgap) and BL-0372 (bl-ap-streamjson); not yet dispatched.

## Case

alfred M2 first reviewed base..x with review set A. The fix delta added new files that the frozen set A cannot take in, so x..tip was reviewed with set B. Checking with A alone fails with "changed after its last reviewed head", even though B covers every changed path.

## Wanted behaviour

`check-phase-review-receipt --chain A,B` passes when both hold:

1. The union of the sets' reviewed ranges is one contiguous base..tip.
2. Every changed path is covered by the LAST set that touched it.

## Red case

A gap between the two sets' ranges must fail.
