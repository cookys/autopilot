# Evidence — mission `proof-parity-raw-log-2026-09-16` (v2.36.57; cuda P1 deliverable 1 of 2)

- `consult-question.md`, `consult-codex-answer.md`: design consult (codex gpt-5.6-sol). Two deliverables (A1
  pre-spend admission alone; B+C together), one-or-more separator grammar on both sides with distinct
  shape/semantic failures and a shared vector table, schema-lenient salvage with runner/model from the
  invocation, optional `raw_log` on the failed seat receipt. Defect B was reproduced locally before the consult
  (`checked=… . evidence=… . conclusion=…` passes the battery, Node rejects with the "tautological" message);
  revival.3d then reported the same rejection on `claude-fable-5` via `claude-native` and manual
  `dispatch-review.sh` passing every time — the engine's Node validator is the only divergence.
- `base-suites-0e3ea3cc.txt`: the eight suites + canonical invariants were GREEN at base before sealing.
- `g1-*`, `g2-*`, `plan.as-reviewed-g{1,2}.md`, receipts: plan hetero loop (GLM-5.2 + gpt-5.6-sol). G1 three
  blockers (empty-field precedence, performReview top-level `raw_log` assertion, unknown-key closure) accepted;
  G2 terminal at cap: normalized-emptiness precedence + seat-receipt source accepted, "version bump outside
  output_paths" rejected with rationale (release commit is depth-0, as v2.36.53–56).
- `prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`: /l5 managed campaign attempt 1 (base
  `b6a5e42e`; product files identical to rubric base `0e3ea3cc`). Hand cursor-grok-4.6-low `76bc02a8` (17
  files). In-rail MiniMax-M3 review FIX-THEN-SHIP (`review-minimax-r1-raw.log`): 🟠 the `ship_comma_sep` stub
  branch was renamed away so the comma assertion passed vacuously (true — via the default `;` proof, not by
  failing as MiniMax said); 🔵 the performReview `raw_log` wrapper was hand-built and never called the engine
  (true — tautological). Composition parked `awaiting_disposition` (v2.36.43 durable wait).
- `disposition-authority.json`, `impl-run2.json`: depth-0 disposed both findings `must-fix-now` and resumed
  with `--resume --campaign-disposition-authority` — **this exercised v2.36.53's verified pre-claim resume and
  v2.36.54's order-preserving carry on a live ledger for the first time**: intake admitted, disposition
  adjudicated, `scope_before_repair`, `convergence` (REPAIR_AUTHORIZED) all passed, then
  `prepare_implementation` refused: `caller branch disagrees with campaign stage (expected
  mission/…-a1-repair-r2-76bc02a)` — the resume path validates the caller's `--branch` against the DERIVED
  repair branch instead of deriving it (in-run repairs derive it themselves, see v2.36.56's routing test).
  New fired BACKLOG row; the terminal journal then failed again (`MUTATION_FAILURE_EVIDENCE_REQUIRED`, open
  row). Degraded `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- Depth-0 repairs on the mission branch (`52b89a95`): real-engine `proof` / `proof-taut` modes in the routing
  red-path block drive `AutopilotEngine.runImplementationReviewLoop` end to end (real sandbox ledger, real
  appender, two qualified final-panel seats): the `.`-separated full-diff proof is `reviewed`; seat B's
  tautological proof yields a `no_verdict` receipt carrying `raw_log` inside its digest while seat A keeps the
  exact base v1 key set and digest; a tautological FULL-DIFF run shows `performReview`'s non-reviewed outcome
  with top-level `raw_log`. The hand's stub-fed composition panel block (pass-through only) and the hand-built
  wrapper were removed; `ship_comma_sep` restored with a content assertion.
- `review-codex-r1.json` (+ raw): second-family review FIX-THEN-SHIP — 🟠 the panel fixture (min 1) never
  blocked and the reviewed seat's digest was not pinned; 🟡 RED-at-base headers missing on the salvage/receipt
  blocks. Both accepted, repaired `96723849` (sealed minimum 2 → panel blocks with the failed seat excluded;
  reviewed seat key set + digest pinned to a literal body; headers added; `;`-inside guard labelled).
- `verify-suites.txt` (+ routing 89, review-runner 39, dispatch-review 416 at the final tree): autopilot-engine
  493, receipt 17, qc-panel-honesty 1, status-task 5, state 295; canonical, syntax, mirror, backlog gate; four
  R7 files byte-identical to `0e3ea3cc`.
- `red-at-base-0e3ea3cc.txt`: head tests over base product — review-runner 5 FAIL (vector parity, salvage ×3),
  routing 6 FAIL (period proof, tautology raw_log, both real-engine modes), receipt 6 FAIL (raw_log digest,
  schema); dispatch-review passes at base (the battery already accepted single `.`/`,`/space separators — only
  the `+` run and the shared vector table are new there).
- `integration-record.json` (merge `3079903f`), `reap-wt.json`, `reap-branches.json` (bundle kept),
  `lifecycle-receipt.json` (`zero_residue: true`).
