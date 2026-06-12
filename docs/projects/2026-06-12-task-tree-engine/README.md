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
| P0 | S | Spikes: CC native task persistence; `agy -p` judge mode | done (2026-06-12 — both recorded in portability §7) |
| P1 | L | Tree substrate (`scripts/tree.sh`, append-only JSONL, auto-rebuild index, torture test) | done (2026-06-12 — 45ee431 + 4 review rounds; full torture matrix green, see hooks/tests/tree-engine.test.sh) |
| P2 | S | Contracts + validator (`references/tree-contracts.md`, `check-node-report.sh`) | done (2026-06-12 — 3 review rounds, 75-assertion matrix) |
| P3 | S | DOA presets (`resolve-doa.sh`, four-tier table, dual-track trust) | done (2026-06-12 — fail-closed verified) |
| P4 | L | Interrogation QC panel, shadow-wired with liveness assertion + cost visibility | done (2026-06-12 — 3 review rounds; live e2e: 6/6 judges, first disagreement sample captured) |
| P5 | S | Calibration harness + ground-truth corpus + graduation forcing function | done (2026-06-12 — baseline separation; known-bad breakout; Board checkpoint in BACKLOG + session task) |
| P6 | L | First consumer: ceo-agent tree adapter; KR1 transcript audit | done (2026-06-12 — adapter ships GATED: dual-run default, activation requires board_signoff decision=="graduate"; KR1 audit deferred to first post-signoff run, this session's manager-read pattern = P4-era baseline per amendment 9) |
| P7 | S | Docs, wire-in, memory-rule evolution (post-P5-data only) | done (2026-06-12 — v2.16.0; memory rule feedback_verify-reviewer-claims UNCHANGED: only 1 shadow sample exists, far below the ≥50 evolution threshold) |

## L-1.5 Scope completeness audit (2026-06-12, execution session)

| Dimension | Verdict | Coverage |
|-----------|---------|----------|
| Source code + tests | yes | P1–P5 each ship script + `hooks/tests/*.test.sh` (plan §5 script-gated; stubbed judges, no network) |
| User-facing docs | yes | P7: CLAUDE.md inventory rows for 5 new scripts; SKILL.md edits ride P4 (quality-pipeline) / P6 (ceo-agent) review loops |
| API / interface reference | yes | P2: `references/tree-contracts.md` is the canonical interface doc (incl. amendment-7 intent/state boundary table) |
| Config file templates | yes | P3: `project-config-template/doa-config.md` + model-routing extension |
| CHANGELOG entry | yes | P7 |
| Version bump (semver) | yes | P7; minor bump (new opt-in feature, KR5 zero behavior change) |
| Version sync grep | yes | P7 + `preflight-release.sh` at finish-flow L-5.5 |
| Migration guide | N/A for v1 | Schema starts at v1; `schema_version` per event + lazy `migrations/` pattern reserved (plan §6 row 1). No existing data to migrate; no breaking change to any current user surface |
| Dependent repos / external consumers | yes | Tree is opt-in (KR5); cross-agent surface = portability doc §7 (P0 + P7). No `agents/*.md` edits planned → no agent-body sync; if that changes, `sync-agent-bodies.sh --check` gates at pre-commit anyway |
| Credit / attribution | yes — **gap found, folded into P7** | Survey-absorbed prior art (Beads/Yegge postmortem, TaskMaster incidents, Temporal evolvability, LangGraph schema lesson, PoLL small-judge-panel evidence) must land in README Inspired By at P7 |
| Dogfood target | yes | P6 dogfood is a phase; this project itself migrates execution state into the tree once P1 ships (amendment 7 note above) |
| Skill `description:` fields | watch | P4/P6 may touch SKILL.md descriptions — already inside L flow with review loop (autopilot rule: description change = routing change) |

## Decision log

- 2026-06-12 (execution session): P0–P7 all shipped in one CEO-mode session. Manager (Fable, depth 0) dispatched sonnet implementers in worktrees + blind sonnet reviewer rounds per phase group (P1: 4 rounds; P2+P3: 3; P4/5/6: 3); all integration verified by artifacts (cherry-pick + rerun), never self-report. Dogfood: this project's own execution state lives in `tree/events.jsonl` (P0–P7 nodes, verdicts with commit-anchored evidence pointers). First live panel run disagreed with the authoritative reviewer (panel fail / reviewer pass — strict extras interpretation): recorded as calibration sample #1, baseline=self_report. Graduation checkpoint: docs/BACKLOG.md + session task; Board-only.
- 2026-06-12: research-to-ship Phases 0-4 completed in one arc (brainstorm spec → survey with skeptic corrections → plan → R1 dialectic HIGH-consensus downgrade → 10 binding amendments → this project). Execution (Phase 5) begins in a fresh session per the externalized-state philosophy this project itself implements.
