# Plan A — wall expiry terminalizes and always writes the summary
1. RED: engine case — hand returns implemented, clock past the wall → blocked/campaign_wall_budget, lease held, no terminal event.
2. Route every in-loop wall exhaustion (and the reducer's WALL_BUDGET_EXCEEDED) through terminalizeManagedCampaignFailure: MUTATION_FAILED with lease/lineage/candidate when a hand may have committed, TERMINAL_STOP otherwise; result status wall_expired; summary JSON never empty.
3. Implementation dispatch gets --timeout = remaining wall (builder-managed), refuse-and-terminalize when below the minimum.
4. Reducer pin; new suite; sync mirrors; verify; ONE commit.
Acceptance: the 2026-08-30 shape (commit lands, wall elapses before review) ends in a journaled terminal with the candidate named, lease released, non-empty summary.
