# check-plan-graduation.js reference rewrite must skip sha-bound plan/rubric files

Every `docs/mission-*-sources.json` seals `plan_sha256`/`rubric_sha256` over the plan bytes; the mission
runtime (`scripts/next-touch-validation.js`, `mission-execution-graph-check.js`, terminal reconcile) re-derives
them. The v2.36.78 `--fix` and the v2.36.80 `--migrate-archive-layout` reference rewrite treated those plans
as ordinary text and rewrote `docs/plans/…` / `docs/projects/_archive/…` mentions inside them → 26 sealed
files drifted (`next-touch-validation` red: `active plan/rubric digest does not match source manifest`).
Restored byte-exact from git history in the v2.36.80 follow-up commit; 15 further mismatches predate this
work (plans edited after seal by later releases, missions terminal).

Fix shape: build the sha-bound set from every sources manifest (`docs/` + `plan_path`/`rubric_path`) and
exclude it from `rewritePlanReferences`/`rewriteLegacyArchiveReferences`; report skipped files as
`plan_reference_frozen` (report-only). Test: a sealed plan whose text mentions a moved plan keeps its bytes.
