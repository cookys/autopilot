- 2-A attempt 1: hand cursor-grok-4.6-low ran 91 min, 31 files, committed 30b69a1a in its worktree; the rail then
  returned `boundary_rejected: main checkout mutated during the round (before=51b22b16 after=6329008e)` — CAUSE: depth-0
  (me) committed a docs-only handoff to develop while the campaign ran. Not a rail defect: the fingerprint is doing
  its job. Lesson recorded in memory (campaign-running-main-checkout-frozen).
- `--resume` from BOUNDARY_REJECTED: first attempt blocked at strict_l5_provider_readiness (`strict_l5_provider_not_ready`,
  4 min of probes; `status readiness --probe` 5 min later showed all six seats usable — transient). Second attempt:
  `campaign resume from BOUNDARY_REJECTED cannot dispatch implementation` → terminalizeManagedCampaignFailure. RAIL
  OBSERVATION (BACKLOG row): BOUNDARY_REJECTED is in durableResumablePhases (autopilot-engine.js ~:9288) but resume
  also requires generation_claim.resume_candidate, which a boundary rejection never records — so the "worktree
  retained — re-dispatch once the main checkout is quiescent" message promises a path the rail cannot take; the
  candidate commit is only recoverable at depth-0.
- Degraded l3 per doc; candidate = the hand's 30b69a1a in the retained worktree; depth-0 verification (15 suites on a
  scratch branch), GLM + claude second-family reviews on the full diff 7f5d6ee8..30b69a1a (123 KB, no path filter).
