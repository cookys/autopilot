# check-phase-review-receipt: a head moved only by commits touching allowlisted excluded paths should still validate

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: every release closeout — CHANGELOG/ledger/archive commits land after the last review generation, so the receipt's head never equals the merge head
- **Context**: the checker binds `review_head_sha` to the branch head; today the honest sequence is "checker exit 0 at the reviewed head, recorded in the ledger, then docs-only commits". Candidate: accept a moved head when `git diff <receipt_head>..<head>` touches only paths matched by the frozen exclusion allowlist (plus CHANGELOG.md / INDEX.md), and record that delta in the receipt check output
- **Effort**: S
- **Source**: v2.36.0 closeout, `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/`

