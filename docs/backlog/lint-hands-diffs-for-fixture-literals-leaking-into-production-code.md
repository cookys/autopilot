# Lint hands diffs for fixture literals leaking into production code

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: next hands cut on a script with a test that names phases/ids (`p7`, `fixture`, `test`)
- **Context**: `references/evidence-discipline.md` §23 — three reviewers caught a `phase === 'p7'` carve-out the suite could not
- **Effort**: S
- **Source**: core review g2, v2.36.0

