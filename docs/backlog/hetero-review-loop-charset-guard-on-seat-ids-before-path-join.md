# hetero-review-loop: charset guard on seat ids before path.join

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any change that lets a seat id come from outside the driver
- **Context**: `../` in an id could escape the generation directory; no capability gained today because the ledger is writer-controlled (GLM FOLLOW-UP, core review g3)
- **Effort**: S
- **Source**: same g3 dir

