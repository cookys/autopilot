# Dispatch unit contract gate

> Status: APPROVED / QUEUED — implementation has not started
> Target: v2.32.36
> Plan: [`../../plans/2026-07-15-dispatch-unit-contract-gate.md`](../../plans/2026-07-15-dispatch-unit-contract-gate.md)
> Origin: verification-author roster-gate dogfood and Board decision on 2026-07-15

## Goal

Make strict L5/L6 delegation a mechanically authorized unit of work. Depth-0 freezes the spec,
file boundary, dependencies, model role, acceptance, and budget; a deterministic checker alone may
return GO; workers execute only that contract; depth-0 QC accepts or rejects the returned artifact
from repository truth.

## Success criteria

- No strict write/author runner, endpoint, temp worktree, or quota spend starts without a valid
  contract and GO result.
- NO-GO, runtime STOP, and post-return REJECT are distinct states with no prose override.
- Contract path/diff/output budgets and required generated mirrors are checked before and after run.
- Active L5/L6 prompt-only dispatch is blocked while inactive legacy compatibility remains tested.
- Run status exposes non-secret contract, authorization, budget, and actual provenance.
- Release preflight does not start an unavailable or unapproved hard-coded model probe.

## Ownership boundary

| Layer | Owner | Output |
|---|---|---|
| Spec and unit contract | depth-0 CEO | Immutable contract + prompt details |
| GO / NO-GO | deterministic checker | Stable verdict, reasons, contract/spec hashes, resolved engine |
| Implementation / verification | dispatched worker | Declared commit, artifact, or verdict only |
| Acceptance | depth-0 QC host | Git-truth boundary result + executed acceptance |
| Independent review | configured heterogeneous panel | Findings/verdict over the frozen spec and actual diff |

The CEO may author a corrected or smaller contract, but may not override a NO-GO on the same hash.
The worker may ask for clarification, which produces STOP; it may not widen its own authorization.

## Progress

| Phase | State | Dependency | Exit evidence |
|---|---|---|---|
| P0 spec freeze and project bootstrap | complete | v2.32.35 design evidence | Plan records schema, authority, boundaries, GO/NO-GO/STOP/REJECT, file map, risks, and units |
| C1 schema/checker | pending | v2.32.35 pushed/reloaded | Focused GO/NO-GO oracle, stable hashes/exit codes, zero-runner negative proof |
| C2 write-rail preflight | pending | C1 | Strict hetero dispatch derives immutable base/timeout/tuple and blocks mismatch before start |
| C3 artifact boundary | pending | C2 | Git-truth allow/deny/file/diff/output/acceptance enforcement |
| C4 author rail | pending | C1, C3 | Verification-author contract composition and checkout containment proof |
| C5 observability/docs | pending | C2-C4 | Status/manifest provenance, canonical docs, mirrors, payload parity |
| C6 release-probe routing | pending | C1 | Unavailable/unapproved probe proves zero CLI spawn; no hard-coded fallback |
| C7 aggregate QC/release | pending | C1-C6 | Full suite, scans, payload/schema checks, dual-family review, finish-flow |

## Start gate

Implementation remains NO-GO until v2.32.35 is pushed, installed, reloaded, its l6 marker is cleared,
the new branch is based on that remote SHA, and C1 has a bounded contract with exact mirrors, RED
command, acceptance, roster tuple, and budgets. Model/quota selection must come from live readiness,
not conversation memory.

## Dispatch policy

- Root/depth-0 writes every unit spec and contract.
- Product implementation remains a leaf dispatch; verification authoring is a separate family.
- Each unit is one semantic decision plus mandatory mirrors, never the whole plan.
- Every unit gets focused RED/GREEN evidence and bounded review before the next dependency consumes it.
- Final QC and merge authority remain depth-0; worker self-report is never acceptance proof.

## Decisions

- This is a separate L-size project, not scope added to v2.32.35.
- Contract JSON is authorization; the prompt only explains the authorized task.
- GO is deterministic and pre-spend. NO-GO cannot be manually waived.
- STOP never auto-retries or widens. REJECT never silently promotes a forensic artifact.
- Direct model-spending launchers are part of the migration inventory even when they are not named
  `dispatch-*`; the release slash-probe incident is C6.

## Risks

- A giant contract recreates giant prompts. Unit budgets and one-decision scope must fail before run.
- Hidden mirror generation invalidates an apparently exact allowlist. Mirrors are declared atomically.
- Live quota/readiness changes after GO. A changed fact requires a fresh check/hash before retry.
- Legacy mode becomes an escape hatch. Active L5/L6 strictness gets a permanent regression oracle.
