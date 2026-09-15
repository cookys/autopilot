# Evidence — mission `ledger-rotation-order-2026-09-16` (v2.36.54)

- `consult-question.md`, `consult-codex-answer.md`: design consult (grok seat still 402 → codex gpt-5.6-sol on
  the raw-prompt rail). Codex recommended (c) writer + provenance-gated reader recovery and confirmed keep-first;
  depth-0 narrowed to (a) writer-only per the owner's frozen scope (plan §1, Review log). The test design
  (two rotations, `.1` + live, equal-`ts` guard, fixture precondition) is codex's, folded into §2.3.
- `g1-*`, `g2-*`, `plan.as-reviewed-g{1,2}.md`, `g{1,2}-receipt.txt`: plan hetero loop (GLM-5.2 + gpt-5.6-sol).
  G1 CONDITIONAL/STOP: two blockers (a §2.1 alternative jq used `group_by`/`sort_by`, contradicting R4) and one
  non-blocking (version reseal vs R9) — all accepted and folded. G2 READY/READY, zero findings, terminal.
- `prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`: /l5 managed campaign attempt 1 (base
  `9fa7ac1a`). Hand cursor-grok-4.6-low committed `7fda94d7` (all six output paths). Rail reviewer MiniMax-M3
  returned a readable FIX-THEN-SHIP (`review-minimax-r1-raw.log`) but two of its findings self-"REVOKED" under a
  duplicated id, so the composition stopped at `product_review_normalization` (`duplicate product review finding
  rotation-carry-jq`) → `review_no_verdict`, durable wait. Per HANDOFF no `--resume` (this repo's ledger is
  already carry-only/scrambled); degraded `session-mode set --level l3 --entry-level l5 --fallback
  precondition_failed`.
- Depth-0 verification of `7fda94d7` in a detached scratch worktree: `verify-7fda94d7-summary.txt` (7 suites
  green: 22/17/36/2/24/103/20), codex mirror `--check`, backlog gate 0 new, `git diff --stat 41193a66 -- src/`
  empty. RED at base: `red-at-base.log` (writer at `9fa7ac1a`) and `red-at-base-41193a66.log` (writer at the
  rubric base; `scripts/run-ledger.sh` byte-identical between them) — 9 FAIL lines each, the T1 "got" order is
  exactly what the test header quotes.
- `review-codex-r1.json`: second-family review, FIX-THEN-SHIP, one 🟡 MUST-FIX (header cited `9fa7ac1a`, rubric R8
  says `41193a66`) — accepted, repaired at depth-0 (`2cd3d5f8`). MiniMax adjudication: `test-discriminator-rigor`
  refuted (an inversion among the three events already implies the four-row order is not append order, and the
  fixture is fully pinned); `backlog-pointer-shape` refuted (`check-backlog-entries.js` requires a resolvable
  Pointer path — `§6` moved to Context); `duplicate-source-citation` accepted (Source shortened); the two
  self-revoked 🟠 are no-ops.
- `dogfood-repro-merged.log`, `repro.js`: plan §5 proof at the merged sha — the base repro
  (`RUN_LEDGER_MAX_BYTES=1500 RUN_LEDGER_MAX_ROTATIONS=1`) now projects `TERMINAL_READY`.
- `integration-record.json` (merge `79528505`, no-ff), `reap-wt.json`, `reap-branches.json` (bundle kept),
  `lifecycle-receipt.json` (`zero_residue: true`).
