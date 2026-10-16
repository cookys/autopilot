# Orphan leaf liveness and resource reconstruction

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Context**: Remaining: write a durable intent row BEFORE `git worktree add` so a worktree created but never registered (crash between the add and the controller CAS write) is discoverable. Done 2026-10-16: orphan adoption re-observes the persisted runner identity and refuses absent, partial, live or unknowable ones; `reconstructOwnedInventory` re-reads rows Git no longer corroborates (stale `active`, unregistered path on disk, a branch that moved past its recorded tip).
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:516726d963e606a0bf2ec621ad6962a0228863ff976a64a703be7bbd2d4a598d -->
