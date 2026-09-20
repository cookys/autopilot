# `hetero-review-loop.js` collect appends to chain.json without a lock or atomic rename

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: two collects for the same phase ever run concurrently (today callers serialise by generation)
- **Context**: a lost chain entry would self-recover on retry, never forge a gate pass; MiniMax CUT/FOLLOW-UP on the D2 review 2026-09-04
- **Effort**: S
- **Source**: `docs/projects/_archive/2026/09/2026-09-04-dev-flow-hetero-loops/ledger/review-D2-attempt1-parser-defect/`

