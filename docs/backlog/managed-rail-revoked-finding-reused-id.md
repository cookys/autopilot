# Managed rail: a reviewer that self-revokes a MUST-FIX under a reused finding id is normalized as no_verdict

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: a reviewer that self-revokes a MUST-FIX under a reused finding id is normalized as no_verdict
> - **Status**: open
> - **Trigger**: a rail review whose findings text contains "REVOKED" and two entries with one `[id]` — `product_review_normalization` fails `duplicate product review finding <id>` and the campaign parks in durable wait although the verdict was readable
> - **Effort**: S
> - **Source**: /l5 dogfood 2026-09-16 (mission ledger-rotation-order, MiniMax-M3 r1)
> - **Pointer**: docs/plans/evidence/2026-09-16-ledger-rotation-order/README.md
> - **Context**: a 🟠 and a 🔵 shared id `rotation-carry-jq`, the 🟠 ending "REVOKED"; the duplicate-id check is correct fail-closed but discards a readable review. Option: drop REVOKED findings before the duplicate check, keep them advisory.
> 

Audit finding: Audit #11: Status open, Effort S. A withdrawn MUST-FIX that reuses a finding id is still rejected as a duplicate finding. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
