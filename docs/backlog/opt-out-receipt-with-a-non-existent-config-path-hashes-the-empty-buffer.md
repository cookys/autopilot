# Opt-out receipt with a non-existent config path hashes the empty buffer

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: D2-repair R2/R3 does not already require the config path to exist (it is in that brief; verify at closeout)
- **Context**: sha256 of empty matches a receipt claiming the empty-file hash; the resolver's `off` re-derivation is the real boundary (MiniMax CUT/FOLLOW-UP)
- **Effort**: S
- **Source**: same ledger dir as above

