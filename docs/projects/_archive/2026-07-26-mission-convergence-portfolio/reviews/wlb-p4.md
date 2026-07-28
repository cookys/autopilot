# WLB Phase 4 — Compatibility Dogfood

> RED oracle: `cf6d84e`
>
> Candidate: `79bc881`
>
> Aggregate: `cf6d84e..79bc881`
>
> Status: READY

## Frozen Boundary

Phase 4 wires the shipped campaign identity into managed worktree creation,
cleanup, exact branch disposition, and L5/L6 compatibility surfaces. It does
not grant task-close authority: the lifecycle receipt remains evidence for the
later Mission/LSM reducer.

## Deterministic Evidence

- Lifecycle receipt: 63 assertions.
- Worktree controller: 35 assertions.
- Exact branch reaper: 135 assertions.
- Lifecycle budget/creation: 134 assertions.
- Heterogeneous dispatch: 121 assertions.
- Shared worktree reaper: 28 assertions.
- Campaign state: 185 assertions.
- Dispatch lineage: 57 assertions.
- Engine integration: 439 assertions.
- All 28 skills, version mirrors, hook inventory, agent-body sync, canonical
  invariants, README parity, shell/Node syntax, and whitespace checks pass.

The attack matrix covers single/dual evidence loss, full ordinary-evidence
loss, authority-only empty-root replay, directory/sentinel replacement,
same-inode replay, broad permissions, post-authority and post-mirror
`SIGKILL`, legacy/direct cleanup, post-delete recovery, destructive teardown
hooks, managed `TERM`, symlinked `TMPDIR`, retained sibling leaves, tip drift,
generic retry, forged intent, extra record promotion, and lifecycle-lock
insertion races.

## Admitted And Repaired

1. Campaign worktree identity could drift from sealed campaign identity.
2. Empty or incomplete exact inventory could be mistaken for zero residue.
3. Sentinel, inode, mirror, anchor, and registry-only designs admitted replay
   or evidence-loss gaps; Git-ref CAS authority now binds root identity,
   birth-time/device/inode, generation, and record commitments.
4. Root admission occurred after leaf creation; admission now precedes pending
   publication and `git worktree add`.
5. Direct one-shot dispatches accidentally entered managed cleanup; only an
   explicit valid worktree root enables it.
6. Mirror publication, authority CAS, and registry/anchor forward repair had
   torn-write gaps; recovery is intent-scoped and never repairs unexplained
   committed-copy loss or promotes extra records.
7. Root-wide success cleanup could remove retained siblings; cleanup is
   target-only and explicit keep markers carry `retention=inspect`.
8. Project hooks and managed signal traps could remove a leaf/branch before
   journaling; both now journal first and managed traps never delete branches.
9. Hook tip drift and later generic retry could create duplicate membership;
   targeted reap is expected-tip bound and publication rejects same-branch
   different-tip records.
10. Raw symlinked temporary paths split pending and Git identities; planned
    paths are canonical before first publication.
11. Branch disposition could race a new journal append; exact mode holds one
    verified lifecycle lock across canonical rescan, validation, and action.

Every item has a deterministic regression or a reproduced adversarial fixture.
The same-inode allocator repro is intentionally manual because allocation reuse
was not deterministic across reviewer filesystems; the production birth-time
binding and coordinated replacement regression remain gated.

## Review Dispositions

- A receipt-to-new-leaf close race belongs to Mission/LSM atomic closeout.
  Phase 4 explicitly forbids treating a lifecycle receipt as `can_close`.
- Host power-loss durability without filesystem fsync guarantees is not
  claimed. Process death/`SIGKILL` is tested; ambiguous host-crash state must
  fail closed and may require manual recovery.
- Branch deletion with an attached worktree was probe-rejected: the branch
  reaper revalidates complete worktree occupancy immediately around its CAS.

## Transport And Terminal Truth

| Seat | Result | Disposition |
|---|---|---|
| Architect / Ops / Skeptic | Final `CLEAR` | Destructive hook, managed TERM, forged intent, expected-tip retry, replacement, and lock-race paths were independently reproduced after repair. |
| GPT-5.6 Sol xhigh | `FIX-THEN-SHIP` generations | Valid admission, cleanup, intent, membership, and lock findings were repaired. The remaining fsync claim was bounded as fail-closed host-crash liveness, not counted as approval. |
| Qwen3.8-Max-Preview high | Earlier `SHIP-AS-IS`; latest `no_verdict` | Earlier vote covered an obsolete diff; wrapper failure was not counted terminally. |
| Grok 4.5 high | `no_verdict` | Wrapper-protocol failure, not approval. |
| Claude Opus | Unavailable | Quota exhausted; not retried or counted. |

## Final Verdict

`READY` at `79bc881`. No reproduced Critical or Major Phase 4 correctness
finding remains. Mission P0 owns the next integration oracle and enforcement
probe.
