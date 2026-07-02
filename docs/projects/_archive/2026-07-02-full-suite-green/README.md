# Full Suite Green Follow-Up

> Status: Merged to `develop`
> Created: 2026-07-02
> Branch: `fix/v2.29.0-full-suite-green`
> Session base: `d736a08e7a480a8d393e14f5098f2c50e4015adb`

## Objective

Drive the remaining v2.29.0 release train to ship readiness after the `/l5`/`/l6` engine integration and verifier-isolation remote sync:

- Make the hook test suite green from the reconciled `develop` base.
- Re-check the `dispatch-hetero` wrapper-commit backlog item and close it if the behavior is already covered.
- Run the release/portability gates again after fixes.
- Complete `/l5` loop review before merging.

## Known Starting Point

The previous hardening project shipped with release and portability gates green, but the full hook suite still had four residual failures classified as pre-existing against its session base. This follow-up intentionally takes ownership of those failures on the reconciled base.

Known failing tests to re-triage:

- `hooks/tests/check-optin-changelog.test.sh`
- `hooks/tests/check-test-integrity-l1.test.sh`
- `hooks/tests/check-test-integrity.test.sh`
- `hooks/tests/dispatch-hetero.test.sh`

## Work Plan

1. Reproduce each failing test individually and capture the real failure mode.
2. Fix only the implicated harness/script behavior.
3. Re-run focused tests after each fix.
4. Run the full hook suite until green.
5. Run release, portability, version, Codex mirror, doc-drift, and skill-structure gates.
6. Run `/l5` loop review on the full diff and repair any verified findings.
7. Merge back to `develop` and finish release readiness.

## Acceptance

- `bash hooks/tests/run.sh`
- `bash scripts/preflight-release.sh`
- `bash scripts/preflight-portability.sh`
- `node scripts/sync-version.js --check`
- `scripts/sync-codex-plugin-skills.sh --check`
- `bash scripts/validate.sh`
- `node scripts/doc-drift-gate.js .`

## Result

- Full hook suite is green: `82/82` test files passed.
- `dispatch-hetero` wrapper-commit fallback now covers net-new codex edits in repos without configured git author/committer identity.
- L0/L1 test-integrity harnesses are deterministic on machines without host-level pytest.
- `/l5` review converged in two rounds: round 1 found the committer-identity edge, round 2 returned `SHIP-AS-IS`.
- Merged to `develop` in `f9d1590542f435286aa708938e302db647376d52`.

## Notes

- Keep v2.29.0 as the active release train unless a new user-facing skill/agent is introduced.
- Do not downgrade the 27-skill manifest count; `harness-maintenance` is a user-facing skill.
- Treat implementer self-reports as non-authoritative; verify by artifacts and tests.
