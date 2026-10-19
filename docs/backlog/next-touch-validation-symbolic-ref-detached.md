# `next-touch-validation.test.sh` reads `symbolic-ref HEAD` — always red in the rail's detached verification checkout

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### `next-touch-validation.test.sh` reads `symbolic-ref HEAD` — always red in the rail's detached verification checkout
> - **Status**: open
> - **Trigger**: 1a-B campaign 2026-09-17: verification red in-rail, all 13 commands green on a branch; `basewt` detached reproduced `Command failed: git symbolic-ref -q --short HEAD`
> - **Effort**: S
> - **Source**: /l5 dogfood 2026-09-17 + advisor cross-check (`campaign-verification.js:322-341` attests a DETACHED checkout by design)
> - **Pointer**: docs/plans/evidence/2026-09-17-blind-review-packet-engine/README.md
> - **Context**: test line ~1765 builds `candidateRef` from the current branch; derive it from a fixed ref or skip the D8 rebind case when HEAD is detached. Until fixed, keep the suite out of `verification_commands` (l5 recipe step 3).
> 

Audit finding: Audit #7: Status open, Effort S. The test still reads symbolic-ref HEAD. Whether it is still red in a detached checkout was not re-run. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
