# Replace `users.nick` with `users.display_name` in one deploy

## Scope

In scope are the `users` migration, all readers and writers that depend on `users.nick`, the canonical schema, and preservation of the `accounts` name import wherever a supported upgrade still requires it. The application switch and column drop happen in one deploy. Delete `db/migrate/legacy_nick.sql` after the cutover succeeds.

Out of scope are changes to the `accounts` schema, new name-normalization rules, public API contract changes, and a multi-release deprecation. If a public API exposes `nick`, preserve its existing field and behavior at the API boundary while using `display_name` for storage.

## 1. Resolve implementation prerequisites

- Use the supplied paths as the starting point. `db/migrate/001_init.sql` creates `users.nick`, `db/migrate/legacy_nick.sql` imports `accounts.login`, `db/schema.sql` declares both name columns, and `src/users.js` reads `nick`. Confirm the paths in the implementation checkout. Determine whether `db/schema.sql` is maintained by hand or generated, and record its regeneration command if applicable.
- Identify the production database engine and version, inspect the live `users` schema and migration history, and identify how fresh installs construct the schema. Confirm the runner’s ordering, checksum and missing-file behavior, retry semantics, and transaction boundaries. Confirm the engine’s catalog inspection, conditional add-column support, column-drop procedure, and DDL commit behavior.
- Inventory direct and indirect `nick` dependencies, including application queries, API mappings, jobs, views, triggers, and external consumers. Identify every writer that must be paused and every reader that must be switched, updated, or kept compatible during the cutover. Resolve any dependency that cannot be coordinated within the maintenance window before proceeding.
- Determine which supported upgrades require the `accounts` import, when it runs, and whether `accounts` is present at that point. If required, preserve the import in the supported migration path before cutover and test that it runs at the correct point without overwriting existing nonempty display names. Establish how the runner will accept the later removal of `legacy_nick.sql`, including on databases where it is already recorded as applied. Resolve any history or checksum conflict before implementation.
- Record the exact commands and expected results for fresh install, supported upgrades, each migration stage, schema and migration-history inspection, traffic and job controls, backup and restore, and application smoke tests. Verify those commands against the actual runner and deployment environment. The supplied files establish no migration or deployment CLI. Resolve those tooling gaps before implementing or scheduling the cutover.

Run this dependency search from the checkout root as a starting point. Check deployed jobs and external consumers separately.

```sh
rg -n '\bnick\b|display_name|legacy_nick\.sql|\baccounts\b' .
```

## 2. Prepare the migration and application changes

- Preserve `db/migrate/001_init.sql`. Use `db/migrate/002_backfill_display_name.sql` for the additive stage and `db/migrate/003_drop_users_nick.sql` for the destructive stage, subject to verification of the runner’s naming, ordering, and execution rules. If it requires other filenames or a runner-native format, record the exact replacement paths and stage commands before implementation. Configure execution so a failed or pending backfill check prevents the drop.
- In the additive stage, add `display_name` only when absent. If conditional DDL is unavailable, inspect the schema through the runner or deployment wrapper under exclusive migration control and issue the add only when needed. Check that any existing column has the expected definition. Copy `nick` only where `display_name` is `NULL` or `''` and `nick` is neither `NULL` nor `''`. Preserve existing nonempty display names. Make the stage safe to retry from the schema and migration states the runner can actually leave behind.
- Update all identified readers and writers, including `src/users.js`, where the label becomes ``u.display_name || `user-${u.id}` ``. Update or regenerate `db/schema.sql` to match the final schema. Where a fresh install starts from the canonical schema, verify that the runner correctly establishes its migration baseline.
- Prepare a recovery release that works against the final schema and a tested procedure for repairing defects after traffic resumes while preserving current writes. Preserve the pre-drop IDs and `nick` values in a recoverable backup for the recovery window so legacy values are available if a dependency needs repair. Verify both the recovery release and the procedure before scheduling the cutover.

## 3. Rehearse and prove the checks detect failures

Run the exact deployment and cleanup commands on a production-sized copy of roughly 2 million users and exercise fresh installation and every supported upgrade state. Include upgrades with `display_name` absent and upgrades with it already populated. Measure elapsed time, lock duration, and peak disk usage for the backfill, drop, and recovery. If dropping the column requires a table rebuild, verify that row data, IDs, indexes, constraints, foreign keys, and dependent objects are preserved or deliberately updated. Set the maintenance window and abort deadline from the measured cutover and recovery times.

For each new or changed acceptance check, first run it with a deliberate fault on a disposable database or test build and confirm it fails for the expected reason. Then run it against the release candidate and confirm it passes. Record both results.

| Check | Deliberate fault to detect |
| --- | --- |
| Fresh install and supported upgrades | Break the schema baseline or migration order, or omit the required `accounts` import on an upgrade fixture that relies on it. |
| Backfill completeness and preservation | Leave an eligible row unfilled and, in a separate run, overwrite a preexisting nonempty display name. Compare row by row against pre-backfill expectations while `nick` is still available. |
| Column drop and schema integrity | Leave `nick` in the final schema or omit an expected index, constraint, or dependent object in a disposable fixture. |
| Label and application smoke tests | Break the fallback, then independently break the read, create, and update paths. Verify persisted names after both writes. |
| Migration history after cleanup | Introduce an invalid migration-history state and verify the runner or history check rejects it. Then verify the actual removal against fresh, previously migrated, and supported pre-cutover databases. |
| Recovery | Inject failures before and after the drop, and simulate a defect after traffic resumes. Confirm that recovery restores service and preserves writes acknowledged after resumption. |

Run the label check from the checkout root against the updated module.

```sh
node <<'NODE'
const assert = require('node:assert/strict')
const { label } = require('./src/users.js')

assert.equal(label({ id: 7, display_name: 'Ada', nick: 'Old' }), 'Ada')
assert.equal(label({ id: 7, display_name: '', nick: 'Old' }), 'user-7')
assert.equal(label({ id: 7, display_name: null }), 'user-7')
NODE
```

## 4. Cut over in one deploy

1. Pause traffic, jobs, and other processes that access `users`. Verify the pause and take the rehearsed recoverable snapshot with writes quiesced. Capture the baseline for row-level backfill verification.
2. Run the additive migration and any required import in their rehearsed order. Verify that every eligible row received its legacy name and every preexisting nonempty display name was preserved. Check the remaining maintenance window before starting the drop.
3. Run the destructive migration using the verified engine procedure. Confirm the final schema, data integrity, and recorded migration state. Activate the updated application and jobs while traffic remains paused. Run read, create, and update smoke tests and verify the fallback.
4. If a step fails before traffic resumes, keep access paused. Roll back only changes covered by a verified open transaction. If changes have committed, including through DDL auto-commit, use the rehearsed recovery procedure. Restore the quiesced snapshot and previous application if needed, then verify the restored state before resuming.
5. Resume traffic and jobs after all gates pass. If a defect surfaces afterward, pause affected operations as needed and use the rehearsed recovery release or forward repair against the live schema. Use the retained legacy values where needed and preserve all acknowledged post-cutover writes.

## 5. Remove the legacy script

After the cutover succeeds, delete `db/migrate/legacy_nick.sql` using the cleanup procedure rehearsed before deployment. Re-run the migration-history, fresh-install, and supported-upgrade checks on the resulting checkout. Confirm that upgrades requiring the `accounts` import still produce the expected display names and that databases with the legacy script recorded as applied can still run subsequent migrations.
