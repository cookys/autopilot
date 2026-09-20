# Evidence — mission `final-panel-blind-admission-2026-09-16` (v2.36.58; cuda P1 deliverable 2 of 2)

- Design: consult "Deliverable 1 / A1" in `../2026-09-16-proof-parity-raw-log/consult-codex-answer.md`.
- `base-suites-9b049c00.txt`: six suites green at base before sealing.
- `g1-*`, `g2-*`, plans as reviewed, receipts: plan hetero loop (GLM-5.2 + gpt-5.6-sol). G1 seven findings all
  accepted (endpoint rendering, one line per seat, pinned claim counts, standing-pin fixture, two-seat resolver
  fixture, real appender/ledger stated, scope-integrity extras); G2 terminal at cap, one blocker accepted
  (precedence: the blind check runs BEFORE the qualification loop).
- `prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`: /l5 managed campaign attempt 1 (base
  `a1ee6ff5`; product identical to rubric base `9b049c00`). Hand cursor-grok-4.6-low `bcc5f720` (15 files).
  verify + full_suite (six suites, twice) green, in-rail MiniMax review SHIP-AS-IS (`review-minimax-r1-raw.log`),
  adjudicate, scope — then the campaign wall budget tripped at `convergence` (5635 s > the 5400 s I sealed; two
  passes of `resolve-review-loop.test.sh` alone are ~30 min). Budget artifact, not a defect: degraded
  `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- Depth-0 checks at `bcc5f720`: syntax, codex mirror, backlog gate; the five R7 files byte-identical to `9b049c00`;
  `dispatch-review.sh` diff comment-only; changed files ⊆ §2.5.
- `review-codex-r1.json` (+ raw): second-family review FIX-THEN-SHIP, two 🟠 — (1) the parity test only asserted
  the gate message was ABSENT for capable runners (a later precondition would pass it): accepted, repaired
  `c3eb31f6` — the stub exits 99 (a signature no precondition produces), every capable runner is driven to
  the binary with its minimal setup (cc-shim/anthropic-compatible `--endpoint` fixture, fake `node` on PATH) and
  must show `rc=99`; incompatible runners must exit 2 with the gate message and never show `rc=99`;
  (2) `sPin` repeats `override_admitted_seats` and the admitted control only checked "some claim was called":
  the control now asserts the gate did not fire and the Mission claim was reached exactly once (full
  `admitted` needs sealed-contract adapters — that engine-level control is the routing suite's red-path/proof
  blocks whose qc seats the hand moved to cc-shim and which run to completion); the pin-store fixture is
  REFUTED with rationale: intake reads roster `override_admitted_seats`, the pin-store→override step lives in
  resolve-review-loop (`resolve-review-loop-standing-pin.test.sh`).
- `red-at-base.txt` / `red-at-base-9b049c00.txt`: head tests over base product — state 1 FAIL (the blind-intake
  block), routing 2, qc-panel-rejection 5, dispatch-review 2 (the incompatible-runner side of the parity loop is
  gate-preserving; the Node predicate side is new).
- `integration-record.json` (merge `931b31b2`), `reap-wt.json`, `reap-branches.json` (bundle kept),
  `lifecycle-receipt.json` (`zero_residue: true`).
- Dogfood (plan §5): this host's pin still holds `gpt-5.6-sol/codex` at `qc_panel[0]` — after this release every
  managed campaign here stops at intake with `final_panel_seat_blind_incompatible` until the operator re-pins
  (asked in the session summary; not done unilaterally).
