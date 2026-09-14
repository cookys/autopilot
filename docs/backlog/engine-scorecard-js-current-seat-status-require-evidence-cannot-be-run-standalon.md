# `engine-scorecard.js current/seat-status --require-evidence` cannot be run standalone

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: next time an operator wants the strict admission projection for a live seat (it exits 2: `--require-evidence or --identity-file requires --scope-file`).
- **Context**: the strict path needs a caller-supplied applicability scope file; there is no helper that derives the canonical scope for a role, so foremen fall back to the non-strict `seat-status`. Add a `--role-default-scope` (or print the expected scope JSON) so the strict path is one command.
- **Effort**: S
- **Source**: D7 foreman 2026-08-30.

