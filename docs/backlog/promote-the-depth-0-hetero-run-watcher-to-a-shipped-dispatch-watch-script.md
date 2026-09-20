# Promote the depth-0 hetero-run watcher to a shipped dispatch-watch script

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next `/l4`–`/l6` session that has to wake parked foremen — depth-0 re-armed a scratch script ~40 times in v2.36.0 (report the first run whose `dispatch-status.js` phase flips from running to terminal)
- **Context**: parked foremen are never woken by their own background children; a shipped watcher plus a documented `SendMessage` wake step would replace the hand-rolled loop. Reference copy: `docs/projects/_archive/2026/09/2026-09-04-dev-flow-hetero-loops/ledger/watch-hetero.sh`
- **Effort**: S (new script ⇒ PATCH; wire in all four places)
- **Source**: v2.36.0 session

