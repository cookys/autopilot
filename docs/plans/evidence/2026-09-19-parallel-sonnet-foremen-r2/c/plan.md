# Plan C — a rejected intake never strands a claim silently (consult ruling: never auto-release)
1. RED: grant → move HEAD → intake rejects mission_grant_ref_mismatch → result/journal carry nothing about claim A → next grant attempt_blocked_by_open_claim with no recovery hint.
2. One exported helper at both layers: never release; emit + journal stranded_claim {ids, resolution from resolveCampaignForClaim, exact recovery command}.
3. attempt_blocked_by_open_claim detail carries recovery; exact-replay path untouched; releaseMission refusals untouched.
4. New suite (+x) pinning: no no_effect_release, claim live, next grant blocked WITH recovery, withdraw --never-started then frees it; mirrors; verify; ONE commit.
Acceptance: the 2026-09-11 shape tells the operator exactly what to run, and nothing mints attempt N+1 without an explicit withdraw.
