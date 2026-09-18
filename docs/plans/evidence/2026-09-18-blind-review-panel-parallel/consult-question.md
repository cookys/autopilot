Bounded question (cut 2-A of the blind review redesign, autopilot engine):

The campaign composer (src/engine/campaign-composition.js) is fully synchronous and every review dispatch is a spawnSync of scripts/dispatch-review.sh. We want the final panel's N seats to run concurrently without making the composer async. Proposed: one Node helper (scripts/lib/review-fanout.js) that spawns all N dispatch-review.sh jobs at once from a JSON job list and returns results in job order, invoked by ONE spawnSync from the engine; dispatchReview becomes a batch-of-one through the same helper.

1. Is a synchronous fan-out helper (spawnSync of a process that internally runs N concurrent children) sound on Linux/Node ≥ 20 — any pitfalls with stdout buffering (maxBuffer), per-child timeouts/kill escalation, or zombie children when the parent is SIGKILLed?
2. For the panel budget: today each seat gets remaining/N; with concurrency each seat gets the whole remainder. Is there a hazard in giving N seats the full remainder simultaneously (the campaign wall is a single clock, so the panel still ends within it)?
3. A sealed "final_panel_reserve_seconds" pocket beyond max_wall_seconds, panel-only, bounded ≤1800 and ledger-visible — is that an acceptable budgeting shape, or should the reserve instead be subtracted from the earlier stations' budget? Those stations do not check the wall today.
Answer with concrete pitfalls and the minimal mitigations; no verdicts.
