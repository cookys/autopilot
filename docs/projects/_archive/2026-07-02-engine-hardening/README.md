# Engine hardening follow-up

## Project Goal

> **Final goal**: Ship the external architecture review hardening follow-up for the `/l5`/`/l6` engine integration so the new `engine implement-review` path is release-ready.
>
> **Success criteria**:
> - F1: `scripts/sync-codex-plugin-skills.sh --check` is read-only, detects Codex mirror drift, and is wired into pre-commit plus `preflight-portability.sh`.
> - F2: `engine implement-review` fails closed by default when `reviewer_qualified` is absent or false, with an explicit documented escape hatch.
> - F3: release metadata is retargeted to `v2.29.0`, and `CHANGELOG.md` explicitly records `harness-maintenance`.
> - F4: architecture/front-door docs describe the `src/engine` layer and canonical `bin/autopilot.js engine implement-review` path.
> - Ride-along F5-F9/S1-S7 items from the archived report are either fixed or explicitly deferred only when they do not affect ship-readiness.
> - Acceptance gates from the archived report pass, plus a final `/l5`-style full-diff review converges to `SHIP-AS-IS` or equivalent.
>
> **Scope boundary**: Included: archived report F1-F4, feasible ride-alongs F5-F9/S1-S7, version/doc/package mirror updates, focused tests and gates. Excluded: new engine families, domain-aware routing, changing the already-merged v2.28.2 implementation semantics beyond the reviewed hardening items, and remote push/release publishing.

## Source Material

- Backlog entry: `docs/BACKLOG.md` → "Engine integration follow-up hardening from external architecture review".
- Archived report: `docs/projects/_archive/2026-07-02-l5-l6-engine-integration/review-findings-2026-07-02.md`.
- Parent implementation plan: `docs/plans/2026-07-01-cross-harness-engine-infrastructure.md`.

## CEO Decisions

| Decision | Outcome | Rationale |
|----------|---------|-----------|
| F2 reviewer qualification policy | Fail closed by default; add `--allow-unqualified-reviewer` escape hatch. | The canonical `/l5` path should not silently proceed with an unknown reviewer qualification state. This matches the repo's fail-closed posture. |
| F3 version repair | Retarget to `v2.29.0`. | `harness-maintenance` is a new user-facing skill; semver policy says new skill = MINOR. `2.28.2` is not the right release label for the follow-up hardening batch. |
| Execution mode | `/l5` posture with depth-0 control; use `engine implement-review` where viable, inline only if the new fail-closed gate blocks dogfooding before the repair exists. | The task is exactly about hardening the `/l5` engine path, but the current report includes repairs to that path itself. |

## L-1.5 Scope Completeness Audit

| Dimension | Coverage |
|-----------|----------|
| Source code + tests | Yes: `scripts/`, `.githooks/`, `bin/`, `src/engine`, `src/runners`, `hooks/tests`, hook handlers if F6 is fixed. |
| User-facing docs | Yes: `CHANGELOG.md`, `CLAUDE.md`, skill docs, architecture docs, Codex README if S5 is fixed. |
| API / interface reference | Yes: `bin/autopilot.js --help`, `/l5`/`/l6`, `level-front-door.md`. |
| Config templates/examples | Yes if reviewer qualification wording or Codex package payload expectations touch templates; otherwise N/A. |
| CHANGELOG entry | Yes: retarget current release to `v2.29.0` and record harness-maintenance plus hardening. |
| Version bump | Yes: sync all `2.28.2` tracked mirrors to `2.29.0` via `scripts/sync-version.js`. |
| Version sync verification | Yes: grep old version across tracked files after sync. |
| Migration guide / notes | No schema migration; CHANGELOG behavior-change note is sufficient. |
| Dependent repos / external consumers | Codex plugin payload consumers covered by mirror drift gate and docs. |
| Credit / attribution | External review was generated internally for this repo; no third-party OSS absorbed. |
| Dogfood target | Yes: the `engine implement-review` path is both modified and used/validated by this project. |

## Phases

| Phase | Scope | Acceptance |
|-------|-------|------------|
| P1 | F1 Codex mirror drift gate | `sync-codex-plugin-skills.sh --check`, negative drift test, pre-commit scoped block, `preflight-portability.sh`, codex package test. |
| P2 | F2 reviewer qualification fail-closed | CLI default blocks unqualified roster; escape hatch documented/tested; `/l5`/`/l6` docs consistent. |
| P3 | F3 release/version repair | `grep harness-maintenance CHANGELOG.md`; version mirrors sync; release preflight passes. |
| P4 | F4 architecture/front-door docs | `grep 'src/engine\|bin/autopilot'` hits required docs; doc drift/canonical gates pass. |
| P5 | Ride-alongs F5-F9/S1-S7 | Validators/hooks/docs fixes and tests, with any true non-goal deferred in BACKLOG. |
| P6 | Full acceptance and review loop | Focused tests, deterministic gates, `/l5`-style full diff review, merge-ready verdict. |

## Progress

| Item | Status | Notes |
|------|--------|-------|
| L-1.5 scope audit | Complete | Project tracking created from archived report; scope boundary recorded above. |
| L-1.6 skill routing | Complete | Invoked `l5`, `ceo-agent`, `dev-flow`, `team`; `test-strategy`, `quality-pipeline`, and `finish-flow` remain for validation/closeout phases. |
| P1 | Complete | Added `sync-codex-plugin-skills.sh --check`, pre-commit gating, preflight-portability check #13, and sandbox negative drift coverage. |
| P2 | Complete | CLI defaults to fail-closed reviewer qualification with `--allow-unqualified-reviewer` escape hatch; l5/l6/front-door docs synced. |
| P3 | Complete | Canonical version retargeted to `2.29.0`; CHANGELOG records `harness-maintenance`; previous project tracking notes release retarget. |
| P4 | Complete | Added engine-layer architecture section and CLI/src pointers. |
| P5 | Complete | Fixed F6-F9 plus S1/S2/S5; deferred S3/S4/S6/S7 as non-ship-blocking runtime semantics. |
| P6 | Complete | Final deterministic gates passed; full suite has 4/82 failures, all reclassified as pre-existing against session base `96d9349`; `/l5` full-diff review converged to `SHIP-AS-IS` after one reviewer-found fix. |
| L-5 finish-flow | Complete | Merged to `develop` in `ce3d79e`; post-merge doc-sync drift fixed in `2b895d2`; archived under `docs/projects/_archive/2026-07-02-engine-hardening/`. |

## Review Loop History

- 2026-07-02: Read-only explorer audited archived F1-F9/S1-S7 against current HEAD; confirmed the report remained applicable and listed additional acceptance checks. Depth-0 implemented the fixes inline to avoid overlapping write scopes.
- 2026-07-02: Focused tests passed: `autopilot-cli` 41 assertions, `autopilot-engine` 185, `review-runner` 25, `hook-normalizers`, `dispatch-review` 86, `codex-plugin-package` 65.
- 2026-07-02: Deterministic gates passed: `sync-codex-plugin-skills.sh --check`, `sync-version.js --check`, `preflight-portability.sh` 17/17, `validate.sh`, `check-canonical-invariants.sh`, JS/shell syntax checks. `preflight-release.sh` was 5/6 before commit; the remaining opt-in baseline guard requires the new version to exist in first-parent history.
- 2026-07-02: `/l5`-style full-diff review round 1 (`gpt-5.5`, xhigh) returned `FIX-THEN-SHIP`: `.githooks/pre-commit` did not trigger Codex payload mirror checks for the four doc files copied by `sync-codex-plugin-skills.sh`. Fixed in `1e928b6` by extending `CODEX_PAYLOAD_TRIGGER_RE` and adding a `codex-plugin-package` regression assertion.
- 2026-07-02: `/l5`-style full-diff review round 2 (`gpt-5.5`, xhigh) returned `SHIP-AS-IS`, findings `none`.
- 2026-07-02: Final deterministic gates passed after `1e928b6`: `sync-version.js --check`, `sync-codex-plugin-skills.sh --check`, `preflight-portability.sh` 17/17, `preflight-release.sh` 6/6, `validate.sh` 27/27, `check-canonical-invariants.sh`, `doc-drift-gate.js .`, `check-hook-inventory.js --check`, `completeness-scan.sh --range 96d9349..HEAD` (`clean:true`, 10 pre-existing findings), and `check-test-integrity.sh validate --range 96d9349..HEAD` (`ok:true`, warn mode).
- 2026-07-02: Final full suite `bash hooks/tests/run.sh` ended with 4/82 failing test files: `check-optin-changelog.test.sh`, `check-test-integrity-l1.test.sh`, `check-test-integrity.test.sh`, and `dispatch-hetero.test.sh`. Each returned `{"head":"fail","base":"fail","verdict":"PRE_EXISTING"}` via `scripts/verify-preexisting.sh --base 96d934994d57aa66ac1f9cef35b6ee696fe91cfa`.
- 2026-07-02: Post-merge doc-sync deterministic gate passed. Scoped discovery did not pass `dispatch-explore` read-probe, but its raw candidate findings were manually verified: `docs/architecture.md` misattributed `resolve-review-loop.sh` to `src/runners/`, and CLI docs/help omitted the accepted `--require-qualified-reviewer` flag. Both were fixed in `2b895d2`, with `autopilot-cli` now at 42 assertions and Codex payload mirror re-synced.
