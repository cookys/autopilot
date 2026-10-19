# Managed rail: `changed_files >= max_changed_files` refuses repair when the hand touched every sealed path

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: `changed_files >= max_changed_files` refuses repair when the hand touched every sealed path
> - **Status**: open
> - **Trigger**: 1a-B campaign 2026-09-17: hand changed all 13 `output_paths`, verification red → `campaign mutation budget exhausted` at repair_authorized (13 >= 13)
> - **Effort**: Fix
> - **Source**: /l5 dogfood 2026-09-17 (`impl-run1.json`, lineage 1 attempt 1)
> - **Pointer**: docs/plans/evidence/2026-09-17-blind-review-packet-engine/README.md
> - **Context**: `campaignMutationBudgetStatus` axis `changed_files` uses `>=` against the sealed cap, so a repair touching NO new file is refused; graph-check should require cap > |output_paths| or the axis should count new paths only.
> 

Audit finding: Audit #6: Status open. Original Effort label was Fix; the gate only accepts a size, so the restored row uses S. The mutation-budget refusal is still in the engine. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
