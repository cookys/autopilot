# WLB Phase 3 — Exact Branch Disposition And Residue Receipt

> RED oracle: `788f72e`
>
> Candidate: `07295f4`
>
> Aggregate: `2d7bc66..07295f4`
>
> Status: READY

## Frozen Boundary

Phase 3 owns canonical-journal-bound exact branch disposition and the versioned
`LifecycleResidueReceipt`. It preserves the existing containment, full-history bundle,
occupancy, and exact-tip compare-delete protections. A receipt binds canonical repository and
root identity, current head, worktree scan, branch inventory, durable dispositions, blockers,
and content digest. It exposes validation to LSM but never computes `can_close` or clears a
session marker.

## Deterministic Evidence

- Lifecycle receipt oracle: 47 assertions pass.
- Exact branch reaper oracle: 122 assertions pass.
- Worktree controller oracle: 24 assertions pass.
- Lifecycle budget integration: 97 assertions pass.
- Shared worktree reaper: 19 assertions pass.
- Heterogeneous dispatch regression: 112 assertions pass.
- RED/GREEN gate: `VALIDATED` for `2d7bc66..07295f4`, including all three focused oracles.
- All 28 skill validators, version mirrors, hook inventory, agent-body sync, canonical
  invariants, shell/Node syntax, and whitespace checks pass.

The negative controls cover dirty worktrees, custom branch names without regex ownership,
unowned or malformed inventory, exact-tip handoff, moved/recreated/symbolic refs, impossible
acknowledgement states, orphan dispositions, stale head/marker/journal state, thin bundles,
SHA-256 repositories, sequential batches, pre/post-delete `SIGKILL`, and newline worktree paths.

## Admitted And Repaired

1. Receipt branches were not externally bound to canonical journal and disposition state.
2. Failed or moved dispositions could be waived by an acknowledgement.
3. Exact inventory mode could also classify unrelated regex branches.
4. Journal records accepted incomplete identities and duplicate branch ownership.
5. Sequential batches retained already resolved inventory and poisoned later reaps.
6. Recreated direct or symbolic refs and acknowledgement tip drift were under-checked.
7. Bundle verification accepted source-dependent thin bundles.
8. SHA-256 bundle verification and rollback inherited SHA-1 assumptions.
9. Branch deletion preceded durable disposition publication, leaving a crash-recovery gap.
10. Write-ahead reaped records hid refs that were still live.
11. Caller-authored inventory could delete a contained branch without canonical ownership.
12. Receipt validation did not require the caller's expected `root_run_id`.
13. Pre-observation journal mutation could publish a receipt from a stale selected branch set.
14. Newline worktree paths produced filename-prefixed marker hashes and failed journal validation.

Every item has a focused regression or a reproduced adversarial fixture. The final local
Architect/Ops/Skeptic closure returned `CLEAR`.

## Review Dispositions

- LSM `can_close`, finish-marker clearing, and Phase 4 compatibility documentation were rejected
  as later-phase ownership.
- Claims that Phase 1/P2 work was absent were based on reviewing only the P3 delta, not the
  aggregate prerequisite history.
- GLM's final non-clearing claims about journal ordering, temp permissions, atomic rename,
  intent timing, and live-ref filtering were rejected by code trace and probes. Node `mkdtemp`
  produced mode `0700`; `eligible` is complete before intent persistence; a live write-ahead ref
  intentionally remains unresolved.
- Completeness scan's two new `XXXXXX` findings are `mktemp` templates, not stubs.

## Transport And Terminal Truth

| Seat | Result | Disposition |
|---|---|---|
| Architect / Ops / Skeptic panel | Reproduced safety and crash findings; final `CLEAR` | All admitted Critical/Major paths repaired and rerun against the latest tree. |
| GPT-5.6 Sol xhigh | Participated in repair generations | Root substitution, journal ownership, write-ahead filtering, and orphan disposition findings were repaired; later transport stalls were not counted as terminal votes. |
| GLM-5.2 high | Reviewed multiple generations | One intermediate `SHIP-AS-IS`; final non-clearing claims were probe-rejected, so GLM is not counted as the terminal clearing seat. |
| Qwen3.8-Max-Preview high | Final `SHIP-AS-IS` | Clearing verdict on `2d7bc66..07295f4`, findings `none`. |
| Grok 4.5 high | Two `no_verdict` runs | Wrapper-protocol failures were recorded and never counted as approval. |
| Claude Opus | Unavailable | Quota exhaustion; not retried and not counted. |

## Final Verdict

`READY` at `07295f4`. No reproduced Critical or Major Phase 3 finding remains. Phase 4 owns
compatibility wiring and the four-leaf occupancy/reap/receipt dogfood.
