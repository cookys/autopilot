# hetero-review-loop: confirm finalize always emits severity in open_findings (checker now requires deep equality on id/severity/disposition)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next FIX-THEN-SHIP receipt with verified Major/Minor findings — depth-0 saw severity present on the v2.36.0 receipts, so this is a confirmation row (GLM FOLLOW-UP, core review g3)
- **Context**: shared-format drift surface between finalize and the checker
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/g3/`

