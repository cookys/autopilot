# `hooks/tests/run.sh` TIMEOUT marker collides with a suite that self-exits 124/137

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a suite observed to exit 124/137 on its own (e.g. propagating a child's SIGKILL) shows as `[TIMEOUT]` in the summary.
- **Context**: `is_suite_timeout_ec` treats any 124/137 as the wrapper's timeout. Still counted FAILED (fail-closed), so cosmetic; distinguish by checking elapsed ≥ the ceiling, or by having `timeout` write a sentinel.
- **Effort**: XS
- **Source**: rail-fix qc panel 2026-08-30 (GLM-5.2 🔵).

