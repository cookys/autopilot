# Plan — hook test harness determinism

> Status: FROZEN FOR EXECUTION
> Owner: depth-0 CEO with one worktree-isolated L4 foreman
> Size: L (one grouped Fix batch)
> Source: `docs/BACKLOG.md` output-quiescence flake trigger plus live finish-flow evidence on 2026-08-02

## Context

The previously deferred `dispatch-output-quiescence.test.sh` flake triggered during the
2026-08-02 finish flow. On unchanged `develop`, under a host load average of about 49 on
32 CPUs, the test failed three wall-clock-only assertions while preserving every semantic
status assertion: genuine empty took 9 seconds against a 5-second ceiling, immediate
content took 11 against 5, and large output took 10 against 6. The same test passes when
the repository-supported timing factor is raised, so the evidence points to test timing,
not a dispatcher classification defect.

The same interactive run exposed a second test-harness defect in
`session-start.test.sh`: its one direct Node invocation inherits the caller's stdin instead
of using the `run_hook` helper's `/dev/null` discipline. With stdin held open, unchanged
`develop` timed out after 3 seconds before reaching the assertions.

These are one delivery unit: hook-test execution must be independent of ambient scheduler
pressure and interactive stdin. They are implemented and reviewed as a bundle, with no
per-file QC gate between them.

## Objective and measurable result

Make both tests deterministic without weakening their behavioral oracles and without
changing production hook or dispatcher behavior.

- Output-quiescence assertions validate logical grace/stability/deadline behavior using
  deterministic instrumentation or a load-normalized control, not raw end-to-end seconds.
- A deliberately slow semantic control still fails, proving the revised oracle is not
  vacuous.
- `session-start.test.sh` completes when the parent stdin remains open and still validates
  the no-`CLAUDE_PLUGIN_ROOT` output.
- The two focused tests pass at timing factor 1 under the currently saturated host; the
  full hook suite passes with the repository-supported contention factor.
- The exact triggered backlog entry is removed only after independent depth-0 review and
  final verification.

## Change-policy decisions

- **Compatibility impact**: `internal-only` — test harness and tracking docs only.
- **Dependency decision**: `platform/stdlib` — Bash, Node, and existing repository helpers;
  no new package or runtime dependency.
- **Production boundary**: no changes to `scripts/dispatch-author.sh`,
  `scripts/lib/output-quiescence.sh`, `hooks/session-start.js`, hook manifests, version
  mirrors, release artifacts, or external state.

## File-structure map

| Path | Responsibility |
|------|----------------|
| `hooks/tests/dispatch-output-quiescence.test.sh` | Replace load-sensitive absolute upper bounds with a discriminating semantic oracle |
| `hooks/tests/session-start.test.sh` | Close stdin for the direct Node path and prove held-open-parent behavior |
| `hooks/tests/lib.sh` | Optional shared test-only helper if the cleanest implementation needs one |
| `docs/BACKLOG.md` | Remove only the triggered quiescence-flake entry after terminal evidence |
| `docs/projects/2026-08-02-hook-test-harness-determinism/` | Execution evidence and lifecycle record |
| `docs/projects/INDEX.md` | In-progress and completed project routing |

## Deliverable contract

### Output-quiescence oracle

Preserve all existing classification assertions for late flush, genuine empty, immediate
content, drip writer, runner timeout, and multi-KB output. Replace only assertions whose
authority is raw host wall time. The replacement must observe the intended polling/grace
semantics directly or subtract a same-path control measured in the same run. A one-line
increase to `5`, `6`, or the global timing factor is rejected.

At least one planted negative control must prove the new timing oracle fails when the
quiescence path exceeds its declared logical budget. Instrumentation must remain test-only,
must not skip the real `dispatch-author.sh` path, and must not turn semantic lower-bound
checks into unconditional passes.

### Session-start stdin isolation

The direct `node "$HOOKS_DIR/session-start.js"` invocation used without
`CLAUDE_PLUGIN_ROOT` must receive explicit EOF. A regression exercise must run that path
while the parent test stdin remains open and prove bounded completion plus the existing
`additional_context` assertion. Killing the hook after a timeout is a failure, not a pass.

### Verification and closure

Run the two focused tests at factor 1 under the observed host load, then the complete hook
suite with `AUTOPILOT_TEST_TIMING_FACTOR=3`, followed by the repository deterministic sync
and validation gates. The L4 foreman's self-test and first-pass review are advisory;
authoritative verification belongs to an independent depth-0 verifier reading the full
candidate diff.

After all acceptance items pass, update the project record, remove the exact backlog item,
and locally merge to `develop`. Do not push, publish, bump a version, open a PR, or alter
unrelated backlog entries.

## Risks and mitigations

- **Vacuous timing test**: broad ceilings can make every implementation green. Mitigation:
  a planted over-budget control must be rejected by the same oracle.
- **Test shim contamination**: a fake clock/sleep can accidentally change runner stubs.
  Mitigation: scope instrumentation to the quiescence poll signature and retain real-path
  classification cases.
- **Hidden stdin inheritance**: a normal CI `/dev/null` run cannot expose it. Mitigation:
  explicitly keep parent stdin open during the regression exercise.
- **Host saturation**: unrelated CPU-intensive jobs are outside this mission. Mitigation:
  do not stop them; make focused oracles independent of their scheduling delay and use the
  supported suite contention factor for the broad regression.

## Out of scope

- Production quiescence algorithm or timeout tuning.
- Changes to session-start production semantics.
- General test-runner redesign, CI worker-count policy, or unrelated timing tests.
- Version bump, release, push, PR, remote branch, or external publication.

## Open questions

None. The user delegated bounded CEO execution through `/l4`, and both observed defects
have a test-only repair boundary.

## Review log

- R0 2026-08-02: frozen from two live base reproductions before L4 admission or feature
  worktree creation. Plan review is disabled by project config; one bundled first-pass
  review and one authoritative depth-0 review occur after implementation.
