# ICC Phase 1 Gate

> Verdict: READY
>
> Baseline: `3d08535`
>
> Phase commits: `ef68372..3444daf`
>
> Final aggregate diff SHA-256:
> `87875fefe6ab2132e0fee2943481dcfd9572d05811a4e83bbd5a26fc460429a1`

## Deterministic Evidence

The final focused suite passed 1,090 assertions:

- `autopilot-engine`: 437; `autopilot-engine-resilience`: 12.
- `implementation-campaign`: 73; `implementation-campaign-state`: 163.
- `autopilot-cli`: 54; `dispatch-hetero`: 112; `dispatch-detach`: 51.
- `engine-lifecycle-observation`: 69; supervised bridge: 12.
- `run-ledger`: 25; concurrency: 46; directive: 36.

`scripts/validate.sh` passed 28/28 skills. Version, agent-body, hook-inventory,
README-parity, canonical-invariant, syntax, and `git diff --check` gates passed.
The changed shell path introduced no new ShellCheck finding; the script retains
its pre-existing whole-file warnings.

## Review Trail

| Pass | Seat | Result | Depth-0 disposition |
|---|---|---|---|
| Early implementation cycles | GLM / Sol | FIX / SHIP | Reproduced intake, durability, contract binding, resume, crash recovery, release, wall-budget, and stage-state defects were fixed through `0ea8926`. False or P2/P3 findings were rejected against the frozen rubric. |
| Aggregate candidate `0ea8926` | Qwen (`review-1785092406-1275298-b1d4`) | SHIP-AS-IS | Counted; one cosmetic CLI-help note was non-blocking. |
| Aggregate candidate `0ea8926` | Sol (`review-1785092236-1272795-b326`) | FIX | Four reproduced P1 authority defects plus one fail-closed API conflict were fixed in `af2c5f7`. |
| Aggregate candidate `af2c5f7` | Qwen (`review-1785093481-1315350-df2c`) | SHIP-AS-IS | Counted. |
| Aggregate candidate `af2c5f7` | Sol (`review-1785093481-1315349-3b77`) | FIX | CLI resume eligibility and release replay were admitted and fixed. Actual post-mutation scope composition was scheduled to P2; rewriting an owner-controlled ledger and all unkeyed digests was outside the P1 trust model. |
| Disposition delta `8155eca` | Qwen (`review-1785094235-1350902-13cc`) | SHIP-AS-IS | Counted. |
| Disposition delta `8155eca` | Sol (`review-1785094235-1350892-b4b8`) | FIX | One concrete idempotency-key collision remained; fixed by separating completion and transition identities. |
| Terminal delta `3444daf` | Qwen (`review-1785094413-1357416-54db`) | SHIP-AS-IS | Counted. |
| Terminal delta `3444daf` | Sol (`review-1785094413-1357409-b086`) | SHIP-AS-IS | Counted; no findings. |

Grok and GLM outputs that failed the strict response envelope were not counted
as verdicts. Their raw findings were adjudicated but did not open additional
review seats. MiniMax's broad late finding list was not counted as a terminal
gate; independently reproduced items were already covered by the Sol repair.

## Frozen Decisions

- Managed mutation requires one canonical sealed campaign intake. The temporary
  unmanaged rail is explicit, machine-readable, and prohibited for L5/L6.
- Campaign identity, reducer state, stage history, journal rows, generation,
  nonce, artifacts, clocks, and three budget axes fail closed on drift.
- Only `PREPARED` resume can dispatch implementation in P1. Phase-aware
  continuation is owned by P2 and cannot replay a completed mutation early.
- A successful admission release is journaled before its lease closes. Mission
  completion and lease transition have separate stable idempotency identities;
  replay returns the original receipt without calling Mission twice.
- Actual post-mutation scope accounting remains the first ordered P2
  composition responsibility. The feature branch is not released between P1
  and P2.
