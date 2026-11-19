# Replace `users.nick` with `users.display_name` in one deploy

## Scope

This release covers the `users` schema, the name backfill, `src/users.js`, every verified `nick` reader and writer, fresh-install bootstrap, and removal of `db/migrate/legacy_nick.sql` after the drop succeeds. Rehearsal, cutover, and recovery are part of the release. Changes to `accounts`, unrelated schema or migration history, and new display-name rules are out of scope.

Keep application traffic and all `users` writers paused through backfill, validation, column removal, and application smoke tests. Use a single release and maintenance window, with a required verification gate before the drop.

## 1. Resolve implementation prerequisites

The supplied files include `db/migrate/001_init.sql`, `db/migrate/legacy_nick.sql`, `db/schema.sql`, and `src/users.js`. The initial migration creates `nick` alone, while the schema snapshot includes both columns. Confirm which paths the runner and bootstrap actually use and inspect the live schema and migration ledger before choosing the SQL. Start the caller inventory with `rg -n --hidden -g '!.git' '\bnick\b|legacy_nick\.sql|display_name' .`, then check deployed services, scheduled jobs, and database dependencies through the production inventory and database catalog.

Resolve these open prerequisites before scheduling implementation or cutover.

| Open prerequisite | Required resolution |
| --- | --- |
| Production database and schema | Confirm the engine and version, deployed column definitions, dependencies, supported drop procedure, and DDL transaction behavior. Obtain read-only schema and catalog output if direct access is unavailable. |
| Migration runner and bootstrap | Identify discovery, ordering, transaction boundaries, ledger and checksum rules, and the normal fresh-install command. Confirm how to pause between migration stages and how to remove the legacy script without breaking validation. If the runner requires the original file, resolve that dependency through a supported history mechanism before shipping. |
| Readers, writers, and traffic controls | Identify all deployed callers and database objects that reference `nick`. Record the exact drain, stop, start, and resume commands and how to verify that no writer remains active. Confirm explicitly if there are no additional callers or writers. |
| Rehearsal and recovery | Secure an isolated, production-equivalent database with roughly two million representative rows and access to the production backup and restore tooling. A sanitized copy or representative fixture is acceptable if it reproduces the relevant schema, data distribution, and operating conditions. Agree on downtime, disk headroom, and recovery limits before rehearsal. |

## 2. Define the backfill and validation rules

Keep each nonempty `display_name`, including when it differs from `nick`. Copy a nonempty `nick` only when `display_name` is `NULL` or `''`. Rows with neither value continue to render as `user-${id}`. Apply the same empty-value definition in SQL and JavaScript, with no trimming or normalization.

Before backfilling, capture the total row count, counts for each case, the count of conflicting nonempty names, and the expected result keyed by `id` for every row. If `display_name` was absent, add it before capturing this baseline. Before dropping `nick`, compare actual values with the expected values using null-safe comparisons and check for missing or extra IDs. Require zero row-level mismatches, an unchanged row count, and reconciliation of the expected update, conflict, and fallback counts.

## 3. Build the release with an explicit pre-drop gate

- Create two ordered migrations under `db/migrate/`. Assign their exact filenames after verifying the runner’s numbering and discovery rules. The first adds `display_name` where required and backfills it. The second drops `nick` and updates any verified dependent database objects. Protect the second stage with a mandatory pre-drop validation that exits nonzero on any mismatch. If the runner can only apply migrations as a batch, embed the validation before the drop and verify that a failed check prevents the runner from reaching the drop.
- Change `src/users.js` to return ``u.display_name || `user-${u.id}```. Update every verified reader, writer, and database dependency to use `display_name`. Update `db/schema.sql` so `users` contains only `id` and `display_name`. Preserve `db/migrate/001_init.sql` and other checksum-tracked migrations.
- Stage deletion of `db/migrate/legacy_nick.sql` as the final release step after the drop succeeds. Rehearse the exact upgrade and cleanup sequence, including migration-history validation and a fresh install from the final release artifact.
- Record exact runnable commands in the release runbook for bootstrap, both migration stages, validation, application tests, backup, restore, and service control. Create missing verification scripts or test targets as part of the release. Include expected outputs and the exit status that blocks each subsequent step.

## 4. Rehearse the upgrade, failure gates, and recovery

For each new or changed verification check, first run the same command against a deliberately broken fixture and confirm that it fails for the expected reason. Reset the fixture and confirm that the corrected run passes. Use disposable rehearsal data for these controls.

| Check | Negative control |
| --- | --- |
| Migration history and fresh install | Introduce a ledger or checksum mismatch where the runner validates one. Separately break bootstrap and confirm that the fresh-install command fails. |
| Backfill reconciliation and pre-drop gate | Skip a required copy, overwrite a conflicting name, and swap expected names between two IDs while preserving aggregate counts. Verify that each fault fails validation and prevents the drop. |
| Final schema and row integrity | Leave `nick` present, omit `display_name`, and remove a fixture row in separate runs. Confirm that the corresponding checks fail. |
| Label rendering | Make the implementation ignore `display_name`. Test a preserved name, a migrated name, a conflicting row, and fallbacks for both `NULL` and `''`. |
| Application writes | Make the write path omit `display_name` or send the write to the wrong field. Confirm that an app-level write followed by a read fails the expected-value assertion. |
| Recovery | Present an incomplete restore and confirm that schema, data, or old-release smoke checks prevent reopening traffic. Then restore a complete backup and verify the old release. |

Run the full protocol on the production-sized copy and test a fresh install through normal bootstrap. Measure backfill and drop times separately, including locks, temporary disk use, journal or WAL growth where applicable, total downtime, and recovery time. Rehearse interruption before the drop and after committed DDL. Approve cutover only when verification passes and the measured upgrade and recovery fit the agreed limits.

## 5. Execute the cutover

1. Drain traffic, stop all application instances and verified background writers, and confirm writes have stopped. Take a consistent pre-migration backup and record its restore point.
2. Run the expand and backfill stage. Reconcile the baseline and actual results while `nick` remains available. Advance only after the pre-drop gate passes.
3. Run the drop stage, start the new release with traffic still paused, and verify the final schema, row integrity, representative labels, and an application write and read. Complete removal of `db/migrate/legacy_nick.sql` and validate migration history using the final release artifact.
4. Reopen traffic after every cutover check passes. Monitor application errors and user-name reads and writes.

## 6. Recover according to the cutover state

Before traffic reopens, keep writers paused if any check fails. Roll back when the verified transaction boundary covers all relevant changes. If a stage committed, including through implicit DDL commits, restore the consistent pre-deploy backup and redeploy the old release. Verify the restored schema and data, migration history, and old-release reads and writes before reopening.

After traffic reopens, use a forward fix when practical. If recovery requires returning to the old release, pause writes, capture the current database state, and preserve and reconcile post-cutover writes before reopening on a restored database. Rehearse that reconciliation where the available tooling supports it. If the team cannot reconcile those writes, keep the current database intact and obtain explicit authorization for any recovery that would discard them. Copying `display_name` back to `nick` cannot recover original `nick` values that differed from `display_name`.
