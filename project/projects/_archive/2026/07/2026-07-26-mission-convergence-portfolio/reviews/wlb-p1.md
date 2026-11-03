# WLB Phase 1 — Bounded Heto Review

> Candidate: `a27f621`
>
> Repair: `a27f621..7484031`
>
> Aggregate: `7bc9cad..7484031`
>
> Status: READY
>
> Repair policy: admit only reproduced Phase 1 safety/correctness findings

## Frozen Checklist

Only a concrete violation of these Phase 1 requirements may block:

1. Schema-2 markers bind `created_at`, branch/base, run/root/loop identity, and schema.
2. Managed leaf creation uses one canonical common-dir lock and a configurable `1..32` per-root
   cap with fail-closed default `4`.
3. Pending records close the publication crash window and are reconciled under that same lock.
4. Only exact dead clean state is reclaimed. Dirty, live, unsupported, malformed, legacy,
   identity-mismatched, moved-tip, and unknown state is preserved.
5. Budget rejection is parseable JSON and creates neither branch nor worktree.
6. Direct one-shot dispatch remains compatible.
7. P2 controller, P3 branch/receipt work, LSM consumption, and Phase 33 package sync remain out of
   scope.

## Deterministic Evidence

- WLB lifecycle oracle: 97 assertions pass, including sequential cap, 8-way `4 + 4`
  concurrency, parseable resource receipt, first-use excludes, preservation matrix, and four real
  SIGKILL checkpoints (`after-pending`, `after-add`, `after-marker`, `after-verification`).
- Existing focused suites pass: dispatch 112, GC 42, resolver 17, reaper 18.
- Skill validation, version/hook checks, canonical invariants, shell syntax, and whitespace checks
  pass.
- Full suite L1 passes `169/169`. L2 passes 216 of 223 files. All seven non-green files reproduce
  at the untouched `7bc9cad` baseline: four pre-existing engine/profile/supervised debts and three
  Phase-33 Codex-mirror sync consumers.

## Panel Results

### Admitted Findings

The bounded QA/architecture/Ops panel and heterogeneous reviewers found these reproducible P1
defects; all are repaired in the aggregate:

1. Resource-budget rejection double-quoted `run_id` and was not valid JSON.
2. Creation recorded an immutable base SHA but initially called `worktree add` through the mutable
   base ref.
3. Conflicting legacy/malformed markers could be mistaken for an absent-marker crash window.
4. Reclamation did not initially bind actual branch/HEAD/ref identity or fail closed when
   worktree enumeration failed.
5. Ambiguous cleanup could erase pending evidence; first-use excludes were installed too late.
6. Forced cleanup and check-then-delete branch removal could destroy raced state. Repair uses
   non-force worktree removal and preserves branch plus pending evidence for P2/P3 disposition.
7. Direct one-shot cleanup needed common excludes before marker/lock verification.
8. Manufactured crash fixtures did not prove actual process-death boundaries; four real SIGKILL
   checkpoints now do.

### Dispositions

- Requests for `scan|reap|check`, residue schemas/digests, exact branch disposition, stale-receipt
  validation, and LSM consumption were rejected as explicit P2/P3/later-phase scope.
- Schema-1/malformed residue consuming fail-closed repository capacity is intentional plan text,
  not accidental same-root attribution.
- Claims that the probe FD closed before removal, functions were called before definition,
  direct lineage could be empty, or add-before-marker HEAD differs from its just-created base were
  disproved by code order and passing executable oracles.

### Transport And Terminal Truth

| Seat | Result | Disposition |
|---|---|---|
| GPT-5.6 Sol high | Reviewed; found cleanup/CAS issues | Admitted and repaired; a later closure attempt timed out and did not count. |
| Qwen3.8-Max-Preview max | Formal `SHIP-AS-IS` on the repaired aggregate; later found the direct-exclude issue | Issue repaired; final raw response said `SHIP-AS-IS` but parser rejected its preamble, so that response did not count. |
| GLM-5.2 high | Latest `7484031` aggregate: `SHIP-AS-IS` | Terminal clearing verdict. |
| MiniMax-M3 high | Reviewed | Claims were either disproved or described preservation-first behavior. |
| Grok 4.5 high | Two `no_verdict` protocol failures | Transport-only; never counted as a verdict. |
| Opus | Quota exhausted until 2026-07-30 12:00 Asia/Taipei | Transport-only; not retried. |

## Final Verdict

`READY` at `7484031`. The locked cap, exact schema-2 identity, pending crash evidence, conservative
reconciliation, direct compatibility, and real SIGKILL matrix satisfy Phase 1. No reproduced
Critical/Major P1 finding remains. P2/P3 receipt/controller work stays visible and unclaimed.
