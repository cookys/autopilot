# no-confidence qualification decay — replace the calendar

> **Target version**: v2.34.35
> **Plan**: [docs/plans/2026-08-22-no-confidence-decay.md](../../../plans/2026-08-22-no-confidence-decay.md)
> **Contract**: [references/strike-decay.md](../../../../references/strike-decay.md)
> **Run**: `nocon-decay-l4` (depth-1 foreman, worktree-isolated; depth-0 owns merge)

## Project Goal

> **Final goal**: qualification authority is decided by accumulated mechanical strikes during real
> work, and never by a calendar date.
>
> **Success criteria** (each with a threshold and a verification method):
> 1. Zero admission paths compare `now` against `expires` — verified by a grep-able contract
>    assertion in `hooks/tests/calendar-teeth-negative.test.sh` that goes red when the tooth is
>    re-introduced (demonstrated, not asserted).
> 2. A past-`expires` qualified row still routes, at its normal tier, with a GO — verified by one
>    planted negative per pulled tooth (projection / tier / admission).
> 3. Three ordinary strikes since the last passing administration project `would_requalify: true`
>    — verified by a fold unit test; under the default `shadow` flag `admission_status` stays
>    `qualified`, under `enforce` it becomes `requalify_required`.
> 4. One `critical_reexam_trigger` flips the seat immediately under the DEFAULT flag — verified by
>    a registry test.
> 5. At least one REAL production writer appends strikes on an existing mechanical fail-closed
>    path — verified end-to-end, and **deleting the wiring turns the test red**.
> 6. `bash hooks/tests/run.sh --parallel 8` green; `bash scripts/preflight-release.sh` 8/8.
>
> **Scope boundary**: IN — the strike store, the projection, all three roster calendar teeth, one
> production writer, the first-cut guards, tests, docs. OUT — official qualification defaults
> packaging (separate L project); re-exam scheduling automation; rate-based windows; liveness
> probes; detector anomaly quarantine; fleet circuit breaker (all recorded as BACKLOG rows); any
> trust machinery (ADR-0001); the exam suites themselves. Also OUT and explicitly noted:
> `provider_readiness_receipt_ttl_seconds` and the capability-claim TTLs are advisory today and
> were not converted in this cut.

## Scope completeness audit (dev-flow L-1.5)

| Dimension | Covered |
|-----------|---------|
| Source code + tests | Yes — P0-P5 (5 scripts, 3 updated suites, 2 new suites) |
| User-facing docs | Yes — `references/strike-decay.md` (new), `docs/scripts-inventory.md` rows |
| API / interface reference | Yes — new CLI subcommands documented in each script's usage text + the inventory rows |
| Config templates | N/A — the arming flag is an env var, documented in the reference doc, not a config file |
| CHANGELOG entry | Yes — v2.34.35 |
| Version bump | Yes — PATCH (behavior change to shipped scripts; no new skill or agent) |
| Version sync grep | Yes — `sync-version.js --check` via preflight gate 3 |
| Migration guide | Covered in the reference doc: history immutable, v1 rows keep feeding the brain fold, readers that read `status` alone still work |
| Dependent repos | None — `platforms/codex/plugin/` mirrors handled by `sync-all.sh` |
| Credit / attribution | The design is the repo's own seven-seat panel output; no external OSS absorbed |
| Dogfood target | Yes — this IS the roster machinery autopilot routes itself with |

## Phases

| Phase | Content | Status |
|-------|---------|--------|
| P0 | Strike store generalization (`engine-capability-state.js`, schema v2, registries, dedup, invalidation) | see progress log |
| P1 | Projection + tooth (a) in `engine-scorecard.js` | see progress log |
| P2 | Teeth (b) + (c): `resolve-review-loop.sh`, `dispatch-contract.js` | see progress log |
| P3 | Contract negative test (no admission path compares now vs expires) | see progress log |
| P4 | Real production writer in `dispatch-hetero.sh` `classify_outcome` | see progress log |
| P5 | Test suite incl. replay fixtures | see progress log |
| P6 | Docs, CHANGELOG, BACKLOG, version bump | see progress log |

## Progress log

Recorded in the run ledger `/tmp/autopilot-dispatch-runs/nocon-decay-l4.ledger.jsonl` and in the
commit series on the run's worktree branch. The authoritative QC verdict is held at depth-0.
