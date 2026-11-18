# Cursor broker runner verification

Fleet task: 01M7Q2MRVTXVQG4MQXV1K5P05B

## 1. Task and acceptance

Replace the Cursor implementer’s local CLI with the broker, import its returned diff through the existing wrapper commit, and admit observed-available Cursor as an implementer-only pace fallback. Acceptance: cases (a)–(e), all failure verdicts, unchanged model-name guards, scratch red/green control, no new dispatch failures, synchronized mirrors and inventories.

Base HEAD and origin/develop were identical: `66dba115287e694275cdda42aeee405a88615768`.

## 2. Located change points

- Old launch: `run_worker bash -c 'cd "$1" && exec "$2" -p --trust --force --workspace "$1" …'` in `scripts/dispatch-hetero.sh`.
- Old binary gate: `command -v "$CURSOR_BIN" … || die_precondition "cursor binary not found …"`.
- Old mapper: `MODEL="$(cursor_model_for "$CURSOR_BIN" "$MODEL" "$EFFORT" "$CURSOR_FAST")"`.
- Pace admission follows the existing Kimi exhaustion check; pool configuration is `scripts/lib/pace-roles.json`.
- Reference correction separates pace selection from the model-name guard’s refusal.

## 3–4. Incremental evidence

Artifacts are under `/tmp/cursor-broker-evidence-01M7Q2MR/`.

- `client-check.log`: exit 0; framing, exact keys, split response, local model/byte rejection and allowed response projection.
- `runner-a.log`: exit 0; shared standalone clone, patch commit, exact hash and cleanup.
- `broker-cases.log`: exit 0; (a)–(f), including quota observations, auto dispatch and all failure verdicts.
- Legacy model mapper: exit 0, 50 assertions. Migrated routing: exit 0, 68 assertions. Review/author local-CLI fixtures: exit 0, 77 assertions.
- Initial sync check exited 1 for the expected helpers/seams and mirror drift; inventory registration and generation resolved them.

Negative control: in a scratch source tree replace only the broker execution arm with the base’s local-CLI arm. Case (a) exits 1; observed line:

`FAIL [cursor-broker-runner] (a) cursor broker dispatch exits 0: expected '0', got '1'`

Restore the broker arm in that scratch tree: case (a) exits 0. Artifacts: `negative-control.log`, `negative-control.rc`, `restored-control.log`, `restored-control.rc`; scratch tree: `negative/`.

## 5. Final verification

All logs and companion exit-code files are under `/tmp/cursor-broker-evidence-01M7Q2MR/`.

| Command | Exit | Result / log |
|---|---:|---|
| `bash hooks/tests/cursor-broker-runner.test.sh < /dev/null` | 0 | 23 assertions; cases (a)–(f); `final-broker.log` |
| `bash hooks/tests/dispatch-hetero.test.sh < /dev/null` | 1 | 394 passed / 16 pre-existing failures; identical base summary; `final-dispatch-hetero.log` |
| `node --test scripts/pace-select.test.js < /dev/null` | 0 | 45 passed / 0 failed; `final-pace.log` |
| `bash hooks/tests/cursor-model.test.sh < /dev/null` | 0 | 50 assertions; `final-cursor-model.log` |
| `bash hooks/tests/dispatch-hetero-cursor-routing.test.sh < /dev/null` | 0 | 68 assertions; `final-cursor-routing.log` |
| `bash hooks/tests/dispatch-review-author-cursor.test.sh < /dev/null` | 0 | 77 assertions; `final-cursor-review-author.log` |
| `bash hooks/tests/dispatch-hetero-wall-timeout.test.sh < /dev/null` | 0 | 36 assertions; `final-wall-timeout.log` |
| `bash hooks/tests/dispatch-hetero-watchdog-followups.test.sh < /dev/null` | 0 | 31 assertions; unavailable systemd user scope cases skipped by existing suite; `final-watchdog-followups.log` |
| `bash hooks/tests/context-window.test.sh < /dev/null` | 1 | 42 pre-existing failing assertions; identical normalized base summary; `final-context-window.log` |
| `bash scripts/sync-all.sh --check < /dev/null` | 0 | All 16 rituals green; `final-sync.log` |

Base dispatch run (frozen archive of `66dba115`): exit 1, `base-frozen-dispatch-hetero.log`; summary **394 passed, 16 failed**. Full normalized summary comparison: exit 0, `dispatch-baseline-comparison.log`: **0 new failing assertions**. The 16 failures are cc-shim fixture assertions. The extra context-window check also exits 1 on base; normalized summary comparison exits 0 (`context-baseline-comparison.log`, 42 identical failures). These exceptions are recorded rather than reported as passing suites.

Generator `bash scripts/sync-codex-plugin-skills.sh < /dev/null`: exit 0 (`sync-generate.log`). Additional syntax, `git diff --check`, config registry and script inventory checks: exit 0. New broker helpers use Node built-ins for JSON parsing. New suite mode on disk: executable; Git index mode is checked at staging.


## Changed files (one reason per file)

- `CHANGELOG.md` — Record broker behavior, model migration and pace eligibility without a version bump.
- `docs/dev/cursor-broker-runner-verification.md` — Record verification, baseline exceptions, negative control, file reasons and scope boundaries.
- `docs/scripts-inventory.md` — Index the broker client, clone lifecycle helper and quota observer.
- `hooks/tests/cursor-broker-runner.test.sh` — Exercise stub wire contract, shared clone, commit/hash/cleanup, quota, refusals, auto choice and failure mappings; executable.
- `hooks/tests/dispatch-hetero-cursor-routing.test.sh` — Preserve model-name refusal oracles and replace local-CLI success cases with broker integration.
- `hooks/tests/dispatch-hetero-wall-timeout.test.sh` — Exercise Cursor watchdog through the group seam at the broker’s 60-second minimum.
- `platforms/codex/plugin/references/hetero-dispatch.md` — Regenerated mirror of references/hetero-dispatch.md; Document broker contract, migration, seams, pace fallback and rollback.
- `platforms/codex/plugin/scripts/dispatch-hetero.sh` — Regenerated mirror of scripts/dispatch-hetero.sh; Replace local execution with the broker helper; add preconditions, metadata, verdict mapping and quota signals.
- `platforms/codex/plugin/scripts/lib/config-keys.json` — Regenerated mirror of scripts/lib/config-keys.json; Register socket, shared-root and group-wrapper seams.
- `platforms/codex/plugin/scripts/lib/cursor-broker-client.js` — Regenerated mirror of scripts/lib/cursor-broker-client.js; Implement newline JSON transport, edit-only prompt, byte guard and allowed response projection.
- `platforms/codex/plugin/scripts/lib/cursor-broker-run.js` — Regenerated mirror of scripts/lib/cursor-broker-run.js; Create a shared standalone HEAD clone, request work, apply successful diff and clean only the owned clone.
- `platforms/codex/plugin/scripts/lib/cursor-model.sh` — Regenerated mirror of scripts/lib/cursor-model.sh; Own the composer default/predicate while retaining the legacy mapper/table.
- `platforms/codex/plugin/scripts/lib/cursor-quota-observe.js` — Regenerated mirror of scripts/lib/cursor-quota-observe.js; Record availability/billing stops in the quota mirror with a one-hour recheck.
- `platforms/codex/plugin/scripts/lib/pace-roles.json` — Regenerated mirror of scripts/lib/pace-roles.json; Add the composer broker pool to implementer roles only.
- `platforms/codex/plugin/scripts/pace-select.js` — Regenerated mirror of scripts/pace-select.js; Admit observed-available Cursor behind measured quota without inventing percentages; exclude exhaustion and review roles.
- `platforms/codex/plugin/scripts/pace-select.test.js` — Regenerated mirror of scripts/pace-select.test.js; Pin the extended implementer allowlist and Cursor pool.
- `platforms/codex/plugin/skills/dev-flow/references/card-relocated.md` — Regenerated mirror of skills/dev-flow/references/card-relocated.md; Expose broker helpers in the existing Available Scripts table.
- `references/hetero-dispatch.md` — Document broker contract, migration, seams, pace fallback and rollback.
- `scripts/CLAUDE.md` — Add all three helper names to the dispatch inventory.
- `scripts/dispatch-hetero.sh` — Replace local execution with the broker helper; add preconditions, metadata, verdict mapping and quota signals.
- `scripts/lib/config-keys.json` — Register socket, shared-root and group-wrapper seams.
- `scripts/lib/cursor-broker-client.js` — Implement newline JSON transport, edit-only prompt, byte guard and allowed response projection.
- `scripts/lib/cursor-broker-run.js` — Create a shared standalone HEAD clone, request work, apply successful diff and clean only the owned clone.
- `scripts/lib/cursor-model.sh` — Own the composer default/predicate while retaining the legacy mapper/table.
- `scripts/lib/cursor-quota-observe.js` — Record availability/billing stops in the quota mirror with a one-hour recheck.
- `scripts/lib/pace-roles.json` — Add the composer broker pool to implementer roles only.
- `scripts/pace-select.js` — Admit observed-available Cursor behind measured quota without inventing percentages; exclude exhaustion and review roles.
- `scripts/pace-select.test.js` — Pin the extended implementer allowlist and Cursor pool.
- `skills/dev-flow/references/card-relocated.md` — Expose broker helpers in the existing Available Scripts table.

## Deferred / outside scope

- Real broker, real lanegit permissions and live Cursor authentication were not exercised; wire/group behavior uses the required seams.
- No broker service, hangar file, credential, login or real shared work directory was modified. No version bump, release, push, merge or deployment.
- No Cursor review/author auto pool or roster qualification was added; qualification files remain authoritative.
- The local implementer execution path is removed. `--cursor-bin`/`--cursor-fast` parsing is retained because the eval stub and historical consumers reference them; the broker refuses them clearly. The legacy mapper/table remains used by review/author wrappers and the model-name guard.
- Existing dispatch/context-window failures are outside scope; baseline comparisons record added failures.
- Cross-family review remains the caller’s independent gate; no reviewer verdict is asserted here.

## First live broker run (2026-11-18)

- Broker run `b024489b9100`, model `composer-2.5`, wall 74 s, diff_sha16 `1a2704d5f0e1d184`.
- The broker round trip, diff apply and wrapper commit all worked. The dispatch then stopped at the `backlog_single_writer` boundary, because that task edited `project/backlog/BACKLOG.md` by hand; BACKLOG rows are written only through `scripts/project-record.js`. Choose live-run tasks that do not touch BACKLOG.md.
