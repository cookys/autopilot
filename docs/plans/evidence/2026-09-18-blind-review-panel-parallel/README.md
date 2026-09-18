# Evidence — mission `blind-review-panel-parallel-2026-09-18` (v2.36.65; blind review redesign cut 2-A)

- Plan: `../../2026-09-18-blind-review-panel-parallel.md` (base `aab9523d` = v2.36.64; sealed at `7f5d6ee8`).
  `base-suites-aab9523d.txt`: fifteen §4.1 commands green at base, detached checkout.
- Unknown-escalation: U1 (`ladder-classify.json`); consult rail attempted, `rail-failed` on the codex quota
  (`consult-codex-quota-rail-failed.json`, question in `consult-question.md`).
- Plan hetero loop (GLM-5.2 + claude-fable-5-1, MiniMax fallback): G1 `g1-*` (8 folded — one budget definition via
  `budget_consumer`, digested-body identity, single pre-prepare refusal + reserve plumbing graph→projection→contract,
  helper as the only launch path with `spawnSync`'s contract, content identity for reuse, timestamp-overlap
  assertions, two more suites, template sentence dropped); G2 `g2-*` terminal at the cap (2 folded — backstop = seat
  `--timeout`, no per-seat timing in artifacts). Receipts rc 0. Growth 1.26×.
- Campaign attempt 1 (`grant.json`, `impl-brief.md`, rails in `scratch/`): hand cursor-grok-4.6-low ran 91 min and
  committed `30b69a1a` (31 files ⊆ §2.5 + mirrors, +1958/−142) — then the rail returned `boundary_rejected: main
  checkout mutated during the round` (`impl-run1-attempt1-boundary-rejected.json`). **Cause: depth-0 committed a
  docs-only handoff to `develop` while the campaign ran.** Not a rail defect; lesson recorded (memory
  `campaign-running-main-checkout-frozen`). `--resume` from BOUNDARY_REJECTED: first attempt blocked at strict-l5
  readiness (`strict_l5_provider_not_ready`, transient — `status readiness --probe` 5 min later showed all six seats
  usable, `readiness-probe.json`); second attempt `campaign resume from BOUNDARY_REJECTED cannot dispatch
  implementation` → terminalized (`impl-run2-readiness-not-ready.json`, `impl-run3-resume-refused.json`). RAIL
  OBSERVATION (BACKLOG row): BOUNDARY_REJECTED is in `durableResumablePhases` but resume also needs
  `generation_claim.resume_candidate`, which a boundary rejection never records — the "re-dispatch once quiescent"
  message promises a path the rail cannot take. Degraded per doc to l3; candidate = the retained worktree's `30b69a1a`.
- Depth-0 at `30b69a1a`: scope ⊆ §2.5; `review-packet.js`/`dispatch-review.sh`/`cleanroom-launch.sh`/resolvers
  byte-identical; 15/15 green on a scratch branch (`head-suites-30b69a1a.txt`).
- Second-family reviews of `7f5d6ee8..30b69a1a` (123 KB, no path filter): claude-fable-5-1 FIX-THEN-SHIP (2 🟠 2 🟡 2 🔵,
  `review-claude-r2.json`), GLM-5.2 FIX-THEN-SHIP (2 🟠 2 🔵, `review-glm-r2.json`). Adjudication (`43c95f88`):
  ✅ 🟠 `panel-finish-rebudget` re-derived (the finish call re-ran `prepareReview` and re-checked the wall after the
  batch; a slow batch discarded every seat) → finish reuses the prepared review and the carried timeout; RED-first
  engine case through the REAL fan-out path with a clock that jumps past the wall (`repair-red-*`). ✅ 🟠
  `reserve-not-sealed` (both seats): the plan named `campaign-intake.js`, but sealed limits are built by
  `implementation-campaign.js` `normalizeLimits` with a closed `LIMIT_KEYS` set (+ a copy in
  `src/status/task-status.js`) — sealed there (reuse flag as 0/1 so every limit stays an integer), engine reads the
  sealed limits only; **four files outside §2.5** (the two + mirrors) — recorded here and in the plan's §2.5 note.
  ✅ 🟡 batch-identity: whole-object `deepStrictEqual` with per-run nonces normalized. ❌ 🟡 acceptance-gate: the
  acceptance path's budget check is the panel's own pre-prepare check with the specific reason; tripping the generic
  gate would make `final_panel_budget_exhausted` unreachable (hand's rule kept). ❌ GLM 🟠 routing-suite-not-run:
  the routing suite is green at candidate and repair (its `proof_parity_run` stubs are index-ordered by construction);
  the real-batch engine case is the stronger ordering proof.
- Plan §5 host dogfood (`dogfood-panel.json`): three REAL seats (MiniMax-M3, GLM-5.2, claude-fable-5-1) through
  `dispatchReviewJsonBatch` → `review-fanout.js` on a 5.5 KB packet: all three reviewed, wall 62 s (≈ the slowest
  seat). The claude seat reviewed the helper itself and found two real defects — `stdin-epipe-crash` 🟠 (a child
  exiting before stdin drains → uncaught EPIPE → the whole fan-out dies with no array) and `utf8-chunk-split` 🟡 —
  both re-derived (`fanout-repro-*`), plus a third found reproducing them: `process.stdout.write` + `exit` truncated
  result arrays past ~64 KiB. Repaired at `1b335648` with RED-first review-runner cases.
- Delta reviews (claude-fable-5-1): `review-claude-r3.json` on `30b69a1a..43c95f88` FIX-THEN-SHIP (🟠 scope: the four
  sealing files — accepted as the recorded scope amendment; 2 🔵 folded: `seat_timeout_seconds` pinned in the
  real-batch case); `review-claude-r4.json` on `43c95f88..1b335648` SHIP-AS-IS (2 🔵 optional hardening). 15/15 green at `43c95f88`
  (`head-suites-43c95f88.txt`) and `1b335648` (`head-suites-1b335648.txt`).
- Merge `67e3a560`; `integration-record.json`, `reap-*.json`, `residue-receipt.json` = closeout.
