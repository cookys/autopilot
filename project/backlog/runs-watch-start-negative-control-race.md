# runs-watch-start.test.js "no start lock and no pending check" is a race (BL-0346)

The negative control depends on timing to get the interleaving, so under heavy host load (load about 43) it occasionally misses. Observed 2026-10-31 in the fourth generation of the BL-0336 U1 review. U1 added a retry as a stopgap.

Fix direction: force the interleaving deterministically (barrier or hook) instead of relying on probability.
