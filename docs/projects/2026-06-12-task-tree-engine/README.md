# Task-Tree Engine v1 — delegated orchestration core

> **Status**: In progress (Phase 5 of research-to-ship — execution per dev-flow)
> **Branch**: `feat/task-tree-engine`
> **Plan**: [`docs/plans/2026-06-12-task-tree-engine.md`](../../plans/2026-06-12-task-tree-engine.md) (R1 dialectic converged, 10 binding amendments)
> **Spec**: [`docs/plans/2026-06-12-task-tree-engine-design-spec.md`](../../plans/2026-06-12-task-tree-engine-design-spec.md) (Board-approved)
> **Mode**: CEO (involvement 3); graduation of verification authority is explicitly a Board decision, NOT within CEO DOA.

## Intent (this README owns intent only — per plan amendment 7, execution state will move into the tree once P1 ships; until then the phase table below is transitional)

**OKR**: manager context grows with decisions, not work.

- KR1: dogfooded project ships with zero manager work-reads on the happy path — measured by post-hoc transcript audit (not self-report), reported as a delta against the P4 shadow-period baseline.
- KR2: substrate survives concurrency/crash torture (parallel emits, kill -9 mid-line with truncated-tail detection, index rebuild) with zero silent event loss.
- KR3: calibration produces ≥50 agreement samples INCLUDING a ≥10-case known-bad ground-truth corpus; panel false-pass on known-bad 🔴 = 0; H1 replay experiment run. No authority shift before the data exists; graduation checkpoint fires at 50 samples or 30 days, Board decides.
- KR4: report-contract validator rejects every malformed/unevidenced report in its matrix (incl. binary/line-drift/moved-file pointer cases).
- KR5: zero behavior change for non-opted-in users.

**Scope boundary**: see plan §7 (no wholesale skill rewrite; no daemons; no cross-machine sync; depth policy unchanged in v1). Constraints: files+bash universal core; portability per `references/multi-agent-portability.md`; all research numbers are factory defaults pending local calibration.

## Phases (transitional tracking — see plan §4 + R1 amendments for full acceptance)

| Phase | Size | Summary | Status |
|-------|------|---------|--------|
| P0 | S | Spikes: CC native task persistence; `agy -p` judge mode | pending |
| P1 | L | Tree substrate (`scripts/tree.sh`, append-only JSONL, auto-rebuild index, torture test) | pending |
| P2 | S | Contracts + validator (`references/tree-contracts.md`, `check-node-report.sh`) | pending |
| P3 | S | DOA presets (`resolve-doa.sh`, four-tier table, dual-track trust) | pending |
| P4 | L | Interrogation QC panel, shadow-wired with liveness assertion + cost visibility | pending |
| P5 | S | Calibration harness + ground-truth corpus + graduation forcing function | pending |
| P6 | L | First consumer: ceo-agent tree adapter; KR1 transcript audit | pending |
| P7 | S | Docs, wire-in, memory-rule evolution (post-P5-data only) | pending |

## Decision log

- 2026-06-12: research-to-ship Phases 0-4 completed in one arc (brainstorm spec → survey with skeptic corrections → plan → R1 dialectic HIGH-consensus downgrade → 10 binding amendments → this project). Execution (Phase 5) begins in a fresh session per the externalized-state philosophy this project itself implements.
