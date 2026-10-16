# Review seat format rejects void the whole round (BL-0197)

2026-10-16: five hetero review rounds were voided as seat_gap because one seat's answer had a bad format.
- MiniMax-M3 NO-FINDING-PROOF missing `conclusion=` (qsgate g1, requalev g1) or `evidence=` (requalev g4).
- GLM-5.3 repeated the whole answer twice (requalev g2, violates exactly one).
All verdicts were SHIP; each void re-ran all four seats (about 10-20 min, four seats of cost).

Directions (not implemented; rules stay: three fields, exactly one block):
- full NO-FINDING-PROOF example in the review prompt;
- re-ask only the failing seat once instead of voiding the round;
- collect auto-redispatches a single seat on format failure.

Code: scripts/dispatch-review.sh (BATTERY_FAIL_REASON, ~686-742), scripts/hetero-review-loop.js collect.
