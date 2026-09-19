# Plan G — precondition reasons reach the plan-review artifact; secret-scan fixture stops planting literals
1. RED: a precondition_failed author envelope becomes an empty-output transport_exhausted seat with no reason.
2. dispatchSeat carries envelope status/error; precondition_failed is its own classification, not retried, reason in seat record + policy_reason; schema optional field if needed (+ twin).
3. secret-scan-diff.test.sh: five literals → runtime concatenation; scanner over the suite file exits 0; suite still green.
4. Sync mirrors; verify; ONE commit.
Acceptance: the 2026-09-15 shape records "active session-mode=l5 blocks non-strict dispatch" in the artifact; a release-range secret scan no longer names the suite.
