# WLB Phase 2 — Safe Lifecycle Controller

> Candidate: `56b742f`
>
> Repair: `56b742f..6f61f54`
>
> Aggregate: `0e9c21c..6f61f54`
>
> Status: READY

## Frozen Boundary

Phase 2 owns deterministic `scan`, `check`, and explicit `reap --yes` behavior for one canonical
repository plus `root_run_id`. It may remove only exact dead, clean, schema-2 worktrees while
preserving branch refs and a durable pre-removal branch/tip journal. Branch disposition,
`LifecycleResidueReceipt`, digest/freshness validation, LSM consumption, and `can_close` remain
Phase 3 or later work.

## Deterministic Evidence

- Controller oracle: 22 assertions pass.
- Lifecycle budget oracle: 97 assertions pass.
- Shared worktree reaper: 19 assertions pass.
- Branch reaper: 103 assertions pass.
- Heterogeneous dispatch regression: 112 assertions pass.
- All 28 skill validators and canonical cross-file invariants pass.
- Shell syntax and whitespace checks pass.

The controller fixtures cover clean removal; dirty, live, unsupported-lock, malformed,
identity-mismatched, legacy, marker-symlink, and pending preservation; linked-worktree invocation;
NUL-delimited newline paths; cleanliness-command failure; and cleanliness, marker-byte, and
lifetime-lock inode races. Exact branch refs survive removal. A branch/tip journal is atomically
persisted under the canonical Git common directory before a marker-bearing path is removed.

## Panel Results

### Admitted And Repaired

1. A linked worktree supplied as `--repo` could hide itself from the owned count.
2. A valid same-root pending-creation record did not block `check`.
3. Line-oriented porcelain parsing could omit paths containing newlines.
4. `git status` execution failure was conflated with a dirty worktree.
5. Fault-injection environment variables were not guarded by explicit test mode.
6. Marker revalidation was not the final identity comparison before removal.
7. Branch inventory existed only in final stdout, leaving a process-death window after removal.

### Dispositions

- Bash `exec {fd}>&-` was directly probed and correctly closes a dynamic descriptor; claims that
  lifecycle and probe fds leaked were rejected.
- Schema-2 marker branches already pass `git check-ref-format --branch`; ref argument-injection
  claims were rejected.
- The safety model is cooperative: creators and legitimate workers must honor the repository
  lifecycle lock and per-worktree lifetime lock. Git cannot make arbitrary same-UID writes across
  marker bytes, branch refs, registration, status, and removal one filesystem transaction. The
  controller therefore performs serial immediate revalidation, preserves any observed drift, uses
  non-force removal, and durably journals disposition input before removal. It does not claim
  protection from a process deliberately bypassing both locks in the final instruction window.

## Transport And Terminal Truth

| Seat | Result | Disposition |
|---|---|---|
| Architect / Ops / Skeptic panel | Three reproduced Major findings | Linked-root, pending-only, and NUL-path failures repaired and regression-tested. |
| GPT-5.6 Sol high | Reviewed two generations | Status/test-hook/NUL/journal findings repaired; arbitrary lock-bypassing final-window claim bounded by the stated cooperative lock model. |
| GLM-5.2 high | Final `SHIP-AS-IS` | Terminal clearing verdict on `0e9c21c..6f61f54`. |
| Qwen3.8-Max-Preview max | Final `SHIP-AS-IS` | Independent terminal clearing verdict on the same frozen diff. |

## Final Verdict

`READY` at `6f61f54`. No reproduced Critical or Major Phase 2 finding remains inside the
cooperative lifecycle-lock contract. Phase 3 now owns exact branch disposition and the
versioned, freshness-bound residue receipt.
