# Managed rail: graph-check admits `max_wall_seconds` to 14400, the contract schema caps 7200 — intake burns the attempt

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: graph-check admits `max_wall_seconds` to 14400, the contract schema caps 7200 — intake burns the attempt
> - **Status**: open
> - **Trigger**: blind-review-packet lineage 1 attempt 1 sealed 12000 s: graph-check READY, grant claimed, intake `REJECTED: max_wall_seconds: expected integer in 1..7200`
> - Effort label in the old enum (retired): small fix
> - **Source**: /l5 dogfood 2026-09-17 (`impl-run1-attempt1-intake-rejected.json`)
> - **Pointer**: docs/plans/evidence/2026-09-16-blind-review-packet/README.md
> - **Context**: `mission-execution-graph.js:260` allows 1..14400; `schemas/implementation-campaign-contract.schema.json` maximum 7200. One limit, checked at graph time.
> 

Audit finding: Audit #9: Status open. Original Effort label was Fix; the gate only accepts a size, so the restored row uses S. Graph check still allows 14400 and the contract schema still caps 7200. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
