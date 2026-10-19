# Managed rail: already-scrambled carry-only ledger segments cannot project — reader recovery or locked migration

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: already-scrambled carry-only ledger segments cannot project — reader recovery or locked migration
> - **Status**: open
> - **Trigger**: host ledgers already rotated under the sorted `group_by` carry (zero original journals; file order is base64, not append) still throw `event input artifact must match the prior output artifact`
> - **Effort**: L
> - **Source**: l5 implementation plan 2026-09-16 (writer-only ship; reader recovery out of scope)
> - **Pointer**: docs/plans/2026-09-16-ledger-rotation-order.md
> - **Context**: plan §6 — reader recovery for `_rotation_carry` rows (digest-chain linearisation inside the fail-closed reducer) or a locked migration proving digests unchanged. Re-sized L 2026-09-19; needs its own plan + hetero loop.
> 

Audit finding: Audit #4 (REPORT.md section 3.2): Status open, Effort L. Writer-only ship left reader recovery behind. No reader recovery in CHANGELOG through v2.36.78. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
