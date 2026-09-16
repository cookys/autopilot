# Evidence — mission `red-verification-repair-2026-09-16` (v2.36.56)

- `consult-question.md`, `consult-codex-answer.md`: design consult (codex gpt-5.6-sol, grok still 402). Recommends
  (a) — predicate around the `REVIEW_COMPLETED` append, not a swallowed reducer error; rejects (b) (a red candidate in
  ADJUDICATING can reach TERMINAL_READY/FOLLOW_UP) and (c) (`requireFullDiffBeforeRepair` still blocks; blind repair
  spend); audits every reader; names the adjacent `findingBoundRepairPaths` blocker that depth-0 folded in (§1.2).
- `base-suites-d14bfb68.txt`: the seven verification suites were run GREEN at base before sealing (lesson from B).
- `g1-*`, `g2-*`, `plan.as-reviewed-g{1,2}.md`, receipts: plan hetero loop (GLM-5.2 + gpt-5.6-sol). G1 one blocker
  (R6 had no assertion) → T7 added; G2 terminal at cap, four blockers (T5 reach proof, R7 byte-identity command, T7
  provenance, exact output_paths) all accepted and folded.
- `prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`: /l5 managed campaign attempt 1 (base `1d822ee3`;
  product files identical to rubric base `d14bfb68`). Hand cursor-grok-4.6-low `d986afbf`: verify green, in-rail
  MiniMax-M3 full-diff review SHIP-AS-IS (`review-minimax-r1-raw.log`), full_suite, adjudicate, convergence, final
  panel: GLM-5.2 FIX-THEN-SHIP (`final-panel-glm-raw.log`), MiniMax SHIP-AS-IS, **codex seat `transport_failed`**
  (the cuda P1 defect — blind-review no-tools profile refuses codex — now measured on this host too) → `final_panel_seat_transport_failed`,
  2/3. Degraded `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- `verify-suites.txt`: depth-0 verification of `d986afbf` on a temp branch in a scratch worktree — routing 83 (base 73),
  state 295, implementation-campaign 73, controller-execution-independent 1, p6d 2, mission-runtime-v2 103, receipt 11;
  syntax, codex mirror, backlog gate; the five R7 files byte-identical to `d14bfb68`; changed files ⊆ §2.5 + docs.
- `red-at-base-d14bfb68-routing.txt`: head tests over base product — 8 FAIL; T1 `expected zero gen-0 review_completed
  attempts, got […review_completed(0)…]`, run `phase=campaign_event_journal reason=cannot apply review_completed while
  campaign is VERTICAL_VERIFICATION`; T2–T5 never reached; T7 `t7_base_probe=[]`.
- `review-codex-r1.json` (+ raw): second-family review FIX-THEN-SHIP, one 🟠 — the same finding as GLM's final-panel
  MUST-FIX: engine T7 should assert `gen0Gate.input.vertical_failed === true`. **Refuted with rationale** after trying it
  (`8ab3a51e`): the controller gate journal stores no `input` object, only `input_digest = sha256({kind, input})`
  (`controller-execution.js` `recordGateEntry`), so the field can only ever read `undefined`; the `vertical_failed`
  binding is inside the digest by construction (`campaign-composition.js` ~1791) and the assertable form is the
  composition adapter-payload guard in `implementation-campaign-state.test.sh` (`gen0Reviews[0].vertical_failed === true`).
  The plan's T7 clause presumed a field the structure never had — G1/G2 and both review families took it literally;
  the test now pins the shape (`input === undefined`, `input_digest` 64-hex) so the mistake is not repeated.
- Plan §5 dogfood (a managed campaign with a deliberately red verify_cmd) is DEFERRED, stated in the CHANGELOG: the
  routing block already drives the real `campaignEventAppender`, the real sandbox ledger and real git commits through
  the red → REPAIR_AUTHORIZED → repair → green → review_completed(1) path; the live campaign would add only transport,
  and the next naturally red campaign (cuda/openclaw) is the measurement.
- `integration-record.json` (merge `5117590c`), `reap-wt.json`, `reap-branches.json` (bundle kept), `lifecycle-receipt.json`
  (`zero_residue: true`).
