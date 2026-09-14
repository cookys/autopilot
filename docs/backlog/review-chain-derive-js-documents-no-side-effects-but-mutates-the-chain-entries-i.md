# review-chain-derive.js documents "no side effects" but mutates the chain entries it receives

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any caller that keeps a reference to the chain after derivation
- **Context**: either copy on entry or drop the purity claim (GLM FOLLOW-UP, core review g2)
- **Effort**: S
- **Source**: same g2 dir

