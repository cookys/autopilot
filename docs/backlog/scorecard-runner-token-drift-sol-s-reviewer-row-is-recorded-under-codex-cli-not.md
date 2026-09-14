# scorecard runner token drift: sol's reviewer row is recorded under `codex-cli`, not `codex`

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any seat resolver that matches runner tokens exactly (topology `--role plan_reviewer` normalises it today)
- **Context**: a qualified seat silently drops out of auto-derived panels when the recorded runner spelling differs from the dispatch runner enum
- **Effort**: S
- **Source**: `docs/plans/evidence/2026-09-04-dev-flow-hetero-loops-default/context.md`

