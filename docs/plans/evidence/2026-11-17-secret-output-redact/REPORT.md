# Secret-output redaction evidence

Base: `e6e5a5a3ade37f490230b514eb97f2acbb0a10bc`. Task: `01M7KW98HVPK9B9Y73DTDFP251`. Synthetic values only; no network or real credential/config inspection.

## 1. Task and acceptance

Add a default-on PostToolUse Bash hook that replaces secret values in stdout/stderr using a response-shaped `updatedToolOutput`, retaining names, surrounding text and response metadata. PHP defines, env/systemd assignments and existing shared service tokens must redact. `block`/`warn` redact, `off` is silent. Unchanged or malformed responses emit nothing. Named tests, inventories and generated mirrors must pass.

## 2. Located change points

- `hooks/_shared/secret-patterns.js`: existing `module.exports = {` / `patterns,` extended with `redactOutput`.
- `hooks/hooks.json`: existing `"PostToolUse": [` extended with the Bash registration.
- `profiles/hook-classes.json`: existing `{ "stem": "scheduled-wakeup-guard", "class": "invariant_effect" },` followed by the new class row.
- `docs/guide/settings-reference.md`: both existing `depth0_delegate_gate.secret_print` rows extended with output behavior.
- Inventory text: existing `46 hooks (30 default-on, 16 opt-in)` reconciled to derived 47/31/16.
- Later check-discovered dependency: `profiles/profile-catalog.json` existing `hook_classes_sha256` refreshed from the hook-class file.
- `hooks/pm-output-cap.js` and a root `hooks.json` are absent at this base. The caller supplied the response-object mechanism; the canonical registration is `hooks/hooks.json`.

## 3–4. Incremental red → green

Each implementation family was verified before advancing. Logs and matching `.exit` files preserve the run results; absolute checkout prefixes in logs are normalized to `<worktree>`.

| Criterion | Red artifact / exit | Green artifact / exit |
|---|---|---|
| Absent hook baseline | `red.log` / 1 (26 failures) | `hook-final.log` / 0 |
| PHP quotes, escapes, spacing, case | `red.log` / 1 | `php-green.log` / 0 (9 cases) |
| Env/systemd assignments | `env-red.log` / 1 (8 behavioral failures) | `env-green.log` / 0 (24 combined cases) |
| Shared service tokens | `token-red.log` / 1 (behavioral failure) | `token-green.log` / 0 (25 combined cases) |
| Default-on registration and profile class | `red.log` / 1 | `wiring-green.log` / 0 (26 cases) |
| Inventory numbers and membership | `inventory-red.log` / 1 | `inventory-final.log` / 0 |
| Generated mirror parity | `inventory-tests.log` / 1 (52 passed, 1 stale-mirror failure) | `inventory-tests-final.log` / 0 (53 assertions) |
| Hook-class catalog binding | `sync-check.log` / 1 (`PROFILE_SOURCE_DRIFT`) | `profile-green.log` and `sync-check-final.log` / 0 |

## 5. Final pass

| Command | Exit | Artifact / result |
|---|---|---|
| `node --test hooks/secret-output-redact.test.js` | 0 | `hook-final.log`: 27 passed, 0 failed |
| `node --test hooks/bash-launch-guard.test.js` | 0 | `bash-launch-final.log`: 860 passed, 10 skipped, 0 failed |
| `node scripts/check-hook-inventory.js --check` | 0 | `inventory-final.log`: 47 hooks / 31 default-on / 16 opt-in / 0 disabled |
| `bash hooks/tests/check-hook-inventory.test.sh` | 0 | `inventory-tests-final.log`: 53 assertions |
| `bash scripts/sync-all.sh` | 0 | `sync-generate-final.log`: `ok:true` |
| `bash scripts/sync-all.sh --check` | 0 | `sync-check-final.log`: all 16 rituals passed, `ok:true` |
| `node scripts/sync-version.js --check` | 0 | `version-final.log` |

The large-output test passes a synthetic ~3 MiB response, including an unterminated quoted PHP value, through the real hook process under a 5-second timeout. Test temp directories stay inside this worktree; the existing guard and inventory suites use a worktree-local TMPDIR.

## Not performed / scope boundary

No network, real credential/env/PHP-config/systemd-unit reads, live Claude session probe, version bump, deployment, merge or push. No new Codex hook adapter. The caller’s independent cross-family review is still pending; no review verdict is claimed. Existing `redact()` / `scan()` behavior and command guard rules were not changed. The hook-inventory checker derives membership automatically and required no source edit.

## Changed files (one reason per file)

| File | Reason |
|---|---|
| `.claude-plugin/marketplace.json` | Reconcile advertised hook totals without changing version. |
| `.claude-plugin/plugin.json` | Reconcile canonical hook totals without changing version. |
| `CHANGELOG.md` | Document output redaction, the shared knob and inventory change. |
| `CLAUDE.md` | Reconcile the agent entry hook tally. |
| `README.md` | Reconcile English hook badges and counts. |
| `README.zh-TW.md` | Reconcile Traditional Chinese hook badges and counts. |
| `docs/dev/hook-harness-matrix.md` | Generated inventory row; live hook firing remains explicitly unverified. |
| `docs/guide/settings-reference.md` | Document both layers under the existing secret_print knob in both tables. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/REPORT.md` | Record acceptance, red/green results, final exits, scope and every changed file. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/bash-launch-final.exit` | Record exit status for bash-launch-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/bash-launch-final.log` | Preserve synthetic verification output for bash-launch-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/bash-launch.exit` | Record exit status for bash-launch. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/bash-launch.log` | Preserve synthetic verification output for bash-launch. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/env-green.exit` | Record exit status for env-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/env-green.log` | Preserve synthetic verification output for env-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/env-red.exit` | Record exit status for env-red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/env-red.log` | Preserve synthetic verification output for env-red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/expanded-green.exit` | Record exit status for expanded-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/expanded-green.log` | Preserve synthetic verification output for expanded-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/hook-final.exit` | Record exit status for hook-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/hook-final.log` | Preserve synthetic verification output for hook-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-final.exit` | Record exit status for inventory-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-final.log` | Preserve synthetic verification output for inventory-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-green.exit` | Record exit status for inventory-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-green.log` | Preserve synthetic verification output for inventory-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-red.exit` | Record exit status for inventory-red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-red.log` | Preserve synthetic verification output for inventory-red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-tests-final.exit` | Record exit status for inventory-tests-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-tests-final.log` | Preserve synthetic verification output for inventory-tests-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-tests.exit` | Record exit status for inventory-tests. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/inventory-tests.log` | Preserve synthetic verification output for inventory-tests. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/php-green.exit` | Record exit status for php-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/php-green.log` | Preserve synthetic verification output for php-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/profile-green.exit` | Record exit status for profile-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/profile-green.log` | Preserve synthetic verification output for profile-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/red.exit` | Record exit status for red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/red.log` | Preserve synthetic verification output for red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-check-final.exit` | Record exit status for sync-check-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-check-final.log` | Preserve synthetic verification output for sync-check-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-check.exit` | Record exit status for sync-check. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-check.log` | Preserve synthetic verification output for sync-check. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-generate-final.exit` | Record exit status for sync-generate-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-generate-final.log` | Preserve synthetic verification output for sync-generate-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-generate.exit` | Record exit status for sync-generate. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/sync-generate.log` | Preserve synthetic verification output for sync-generate. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/token-green.exit` | Record exit status for token-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/token-green.log` | Preserve synthetic verification output for token-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/token-red.exit` | Record exit status for token-red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/token-red.log` | Preserve synthetic verification output for token-red. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/version-final.exit` | Record exit status for version-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/version-final.log` | Preserve synthetic verification output for version-final. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/wiring-green.exit` | Record exit status for wiring-green. |
| `docs/plans/evidence/2026-11-17-secret-output-redact/wiring-green.log` | Preserve synthetic verification output for wiring-green. |
| `hooks/README.md` | Document the default-on hook, response contract and shared patterns. |
| `hooks/_shared/secret-patterns.js` | Add output-specific value redaction while reusing service-token definitions. |
| `hooks/hooks.json` | Register the default-on Bash PostToolUse hook once. |
| `hooks/secret-output-redact.js` | Add the PostToolUse Bash response-object redactor and shared-knob handling. |
| `hooks/secret-output-redact.test.js` | Exercise synthetic PHP/env/token, malformed-input, knob, metadata, large-output and wiring cases. |
| `platforms/codex/plugin/hooks/_shared/secret-patterns.js` | Generated shared-pattern support mirror. |
| `platforms/codex/plugin/profiles/baselines/claude-hooks.json` | Generated Claude hook baseline mirror. |
| `platforms/codex/plugin/profiles/hook-classes.json` | Generated hook-class mirror. |
| `platforms/codex/plugin/profiles/profile-catalog.json` | Generated profile catalog mirror. |
| `plugin.json` | Mirror canonical hook totals. |
| `profiles/hook-classes.json` | Retain the security effect in every profile. |
| `profiles/profile-catalog.json` | Refresh the existing hook-class digest after adding the hook. |
