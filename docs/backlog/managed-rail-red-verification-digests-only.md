# Managed rail: a red `campaign_verification` keeps only digests — the failing command and its output are lost

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: a red `campaign_verification` keeps only digests — the failing command and its output are lost
> - **Status**: open
> - **Trigger**: 1a-B campaign 2026-09-17: verification red in-rail, all 13 commands green at the same commit out-of-rail; run output / work order / ledger carry only `receipt_digest`, `argv_hash`, `env_fingerprint`
> - **Effort**: S
> - **Source**: /l5 dogfood 2026-09-17 (`impl-run1.json`, work order `blind-review-packet-engine-2026-09-17-a1.json`)
> - **Pointer**: docs/plans/evidence/2026-09-17-blind-review-packet-engine/README.md
> - **Context**: `createVerificationReceipt` gets stdout/stderr/exitStatus but nothing durable keeps the failing command or its tail; write a `raw_log` next to the receipt and name the command in the ledger (1a-B cause: next row).
> 

Audit finding: Audit #8: Status open, Effort S. No fix found for a red campaign_verification that keeps only digests. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
