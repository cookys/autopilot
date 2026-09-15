# Evidence — mission `disposition-resume-2026-09-16` (v2.36.53)

- `consult-question.md`, `consult-codex.txt`, `consult-grok-402.json`: design consult. The roster's consult
  seat (grok-4.6) returned 402 (Grok Build balance exhausted); re-run on the raw-prompt rail with codex
  gpt-5.6-sol. Recommendation (a): verify git_candidate durable-wait resumes; C0/C1/C2 dual-anchor assertions.
- `g1-*`, `g2-*`, `plan.as-reviewed-g{1,2}.md`, `g{1,2}-receipt.txt`: plan hetero loop (GLM-5.2 + gpt-5.6-sol),
  terminal at the generation cap with zero unaddressed blockers.
- `grant.json` / `impl-run1-dirty-tree-burned.json`: attempt 1 burned pre-spend — depth-0 edited the checkout
  (plan B fold + evidence copy) while the rail was in its readiness probe; the contract checker saw a dirty tree.
- `grant2.json`, `impl-brief.md`, `impl-run2.json`: attempt 2. Implementer cursor-grok-4.6-low committed
  `3ca6c738` (sealed verify_cmd green in the rail's detached checkout); the rail reviewer MiniMax-M3 returned
  `no_verdict` (`review-minimax-no-verdict-raw.log`: NO-FINDING-PROOF format fault, content reads SHIP-AS-IS).
  The composition marked it `review_no_verdict / durable_wait / resumable` (v2.36.43 works at that layer), but
  `campaign resume` / `--resume` cannot project the campaign: the ledger (2.1 MB ≫ RUN_LEDGER_MAX_BYTES 256 KiB)
  rotates on EVERY append and `run-ledger.sh`'s carry-forward re-materializes the active runs' journal rows
  grouped by base64(row) — chronological order lost, `event input artifact must match the prior output
  artifact`. Rail defect, BACKLOG (fired). Degraded per `session-mode set --level l3 --entry-level l5
  --fallback precondition_failed`.
- `review-codex-r1.json`: second-family review, FIX-THEN-SHIP, 2 MUST-FIX accepted (preflight fail-open on
  contract re-read; T3 must corrupt the writer-fence digest) → depth-0 repair `b9730890` on the mission branch.
  `review-codex-r2.json`: FIX-THEN-SHIP, 1 MUST-FIX refuted (explicit `--campaign-ledger` is canonical-only
  since v2.36.42, same resolver as the preflight). Mutation note: dropping the fence-digest check in
  `verifyResumeCandidate` leaves T3 green — the projection layer rejects the same corruption first.
- `verify-3ca6c738.log`, `verify-b9730890.log`: depth-0 verification in detached worktrees (routing 73/0, state
  295/0, engine 493/0, mission-runtime-v2 103/0, receipt 11/0, syntax, mirror, backlog gate, sync-all 14 ok).
  `red-at-base-1ea8825b.log`: the candidate's test file alone on base fails 5 assertions.
- `integration-receipt.json` (merge `527d59d2`, no-ff), `reap-wt.json`, `reap-branches.json`,
  `lifecycle-receipt.json` (`zero_residue: true`).
- `status task --root-run-id` remains `TASK_STATUS_INPUT_UNAVAILABLE` (no writer; known limit).
