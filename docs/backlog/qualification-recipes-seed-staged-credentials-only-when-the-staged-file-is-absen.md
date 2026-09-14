# Qualification recipes seed staged credentials only when the staged file is absent — rotating OAuth runners reuse stale material

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Status**: shipped in U2 (branch `u2-staging-20260831`) — `scripts/lib/qualify-stage-credentials.sh` reseeds credential files by sha256 stamp (mismatch => reseed) and `plan` mode refuses on drift; all 14 `docs/plans/evidence/*/administration/*/run.sh` recipes migrated identically; covered by `hooks/tests/qualify-recipe-credential-staging.test.sh`.
- **Trigger**: already fired 2026-08-30 (D7): kimi and grok seats returned 240/240 `provider_process_failed` each (480 case attempts, ~1600 s) because the `if [ ! -f <staged> ]` guard kept 2026-08-29 credentials while the live ones had rotated; codex/cc-shim/agy were spared only because they do not rotate.
- **Context**: every `run.sh` under `docs/plans/evidence/*/administration/*/` copies this block. Seed unconditionally (or stamp the staging dir with the source file's sha256 and reseed on mismatch), and make `plan` mode compare staged vs live hashes and refuse when they differ. The harness rule correctly refused a verdict, so no capability row was polluted.
- **Effort**: S
- **Source**: D7 administration ledger 2026-08-30.

