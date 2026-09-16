# R2 — Closure review

> Scope is strictly limited to R1 finding closure and regressions introduced by the single consolidation repair. No new enhancement topics are permitted.

## Closure matrix

| R1 finding | Closure evidence in repaired plan | Result |
|---|---|---:|
| R1-F1 executable target missing | Sections 2–5 define files, CLI, report schema, four fixtures, commands, and oracles. | CLOSED |
| R1-F2 manual inventory duplicates generator truth | Existing Codex/OpenCode generators own new read-only `--report-json`; conformance consumes their output. | CLOSED |
| R1-F3 no useful Option-0 deliverable | Option 0 must still ship the conformance tool and evidence report. | CLOSED |
| R1-F4 host/worker conflation | State-owner table and capability model distinguish host surfaces from Pi worker duplex capability; unsupported is typed. | CLOSED |
| R1-F5 recovery scenario vague | F2 pins four effect boundaries, call counters, Git ancestry, and a planted broken reconciler. | CLOSED |
| R1-F6 no lifecycle ceiling | Section 2.3 fixes all new process/protocol/store/dependency/package counts at zero. | CLOSED |
| R1-F7 larger phases lack trigger | Supervisor and Pi/DSH runtime work are re-entry-only under Section 7. | CLOSED |
| R1-F8 false universal parity | Report uses supported/degraded/unsupported_by_design with evidence pointers. | CLOSED |
| R1-F9 review churn | Section 9 hard-caps R1 + one repair + R2; no third generation. | CLOSED |
| R1-F10 wrong maintainability metric | F1 separates generated paths/bytes from manual semantic owners and duplicates. | CLOSED |

## Command/regression verification

The repaired plan now uses the repository's real command shapes:

```bash
node scripts/validate-json-schema.js --schema <schema> --document <document>
bash hooks/tests/run.sh host-conformance
bash scripts/sync-all.sh --check
```

The previous invalid positional schema-validator invocation and `node scripts/sync-all.sh` invocation are gone.

The generator inventory design does not introduce a second projection manifest: `--report-json` remains owned by each existing generator, and the current default/`--check` behavior is explicitly frozen.

## Architecture safety verification

- No daemon, RPC, bridge, service manager, new primary UI, or session owner is authorized.
- Existing root CLI/core, Mission state, Git receipts, runner logs, and worker integrations remain authoritative.
- Pi duplex control is tested at the worker boundary.
- OpenCode is not falsely promoted to a full lifecycle front door.
- Production extraction, if Option A is later selected by evidence, requires another approved plan.

## Practicality verification

The plan now produces a reusable tool even when the architecture decision is “keep current”:

```text
Autopilot Host Conformance
  -> projection inventory
  -> host capability matrix
  -> deterministic recovery matrix
  -> fail-closed root/package parity
  -> Pi worker-control proof
  -> typed architecture decision
```

Every normal gate is local and credential-free. Each positive path has a negative oracle: planted projection drift, planted broken reconciler, malformed reviewer output, and repeated abort/unsupported duplex behavior.

## Final result

VERDICT: SHIP-AS-IS

UNRESOLVED CRITICAL/MAJOR FINDINGS: none

SMALLEST SUFFICIENT OPTION: implement the conformance tool under Option 0; permit bounded Option A only when the resulting report names a deletable manual semantic duplicate.

NO-GO:

- local supervisor service;
- host bridge architecture;
- standalone Pi/DSH primary runtime;
- any third review generation.

The plan is ready for implementation of the conformance tool. It is not authorization to change the production runtime architecture.
