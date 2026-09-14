# v2.35.5 qc-panel 🔵 follow-ups (managed-campaign rail debt, 2026-08-31)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: next touch of the named files.
- **Context**: four Suggestion-tier items from the three-seat panels, all excluded from the ship with rationale: (1) whitespace re-indent churn in `src/campaign/cli.js` ~412-437/598 pollutes blame in the projection path — revert cosmetically; (2) the staging lib's plan-mode refusal (`scripts/lib/qualify-stage-credentials.sh`) is unit-tested but no e2e asserts a recipe `run.sh` exits non-zero under `set -e` when it fires — add one drift e2e; (3) `src/mission/cli.js` mixes module-local `emit()` (cmdWithdraw) and injectable `emitTo()` (cmdGrantV2) — the withdraw-interplay fixture had to monkey-patch `process.stdout.write`; funnel every cmdX through one emission helper; (4) `scripts/run-ledger.sh` non-init subcommands' `--help` prints the whole script source instead of usage (U2 foreman, 2026-08-31).
- **Effort**: XS–S each.
- **Source**: v2.35.5 qc panels + foremen, 2026-08-31.

