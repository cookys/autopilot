# Skill-transport implementer arm

> Status: COMPLETE — H1 confirmed; independent final QC passed
> Owner: depth-0 CEO; initial L4 foreman was interrupted after bounded no-progress and depth-0 retained the same worktree/lineage
> Plan: [`docs/plans/2026-08-02-skill-transport-implementer-arm.md`](../../plans/2026-08-02-skill-transport-implementer-arm.md)
> Historical source: [`docs/plans/2026-07-15-skill-transport-payoff-ab.md`](../../plans/2026-07-15-skill-transport-payoff-ab.md)

## Goal

Close the only remaining skill-transport evidence gap by running the pre-registered implementer pack/no-pack experiment over eight fixed S-size repositories, then apply the frozen H1 rules without changing production defaults.

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `skill-transport-implementer-arm` | complete | 8/8 base-red; 16/16 terminal cells; 8/8 valid pairs; deterministic decision `h1_confirmed_keep_off`; three-family final QC passed |

## Result

| Measure | Exact result |
|---------|--------------|
| Seed | `20260802` |
| Implementer | `codex / gpt-5.3-codex-spark / high` for all 16 cells |
| Independent reviewer | `agy / Gemini 3.6 Flash (High) / high` for all 16 cells |
| Terminal cells | 16 completed; 0 infra; 0 invalid |
| Valid task pairs | 8/8 |
| Frozen oracle | 14 pass; 2 fail (both arms of `t1-fix-with-decoy`) |
| Defects | nopack 1; pack 1; `D = 0` |
| Comparable cost | `null` — dispatcher exposed no reliable per-cell usage |
| Decision | **H1 confirmed; keep implementer skill transport off** |

The pack produced no defect reduction on the frozen task set. The pre-registered `D <= 0`
rule therefore closes the measurement item without a production wiring follow-up. Missing cost
telemetry blocks a cheapness claim but does not weaken this rule, which depends only on defects.

Evidence is committed under `evals/skill-transport/results/implementer-*`; raw model, oracle,
and review logs remain in the private run store.

## Fixed scope

- 8 tasks, 2 arms, 16 terminal cells.
- Codex `gpt-5.3-codex-spark` implementer; one fixed non-OpenAI reviewer.
- Additive evaluation harness, committed aggregate evidence, docs/backlog closure.
- No pack edits, production wiring, release, push, or publication.

## Execution ledger

| Date | Event | Result |
|------|-------|--------|
| 2026-08-02 | Backlog selection | Highest actionable CEO-owned triggered item; Tree-engine Board decision excluded from CEO scope |
| 2026-08-02 | Task qualification | `t1,t3,t4,t7,t8,t11,t13,t15` all base-red; unexpected base-green = 0 |
| 2026-08-02 | Plan/rubric freeze | Frozen before any live experiment cell or L4 worktree effect |
| 2026-08-02 | No-spend mechanics | 29/29 controls passed, including digest drift, base-green, arm bytes, dispatch-effect metadata, exact-key resume, fail-closed rows, stdin isolation, and decision math |
| 2026-08-02 | Seat freeze | Spark exact model ready; Opus primary unavailable before cell 1; registered Gemini fallback ready and frozen |
| 2026-08-02 | Harness restart | First attempt exposed inherited schedule stdin in agy capture; row quarantined privately, stdin isolated, regression passed, full arm transparently restarted at the same seed |
| 2026-08-02 | Matrix complete | 16/16 completed, 8/8 valid pairs, defects 1 vs 1, `D=0` |
| 2026-08-02 | Decision | H1 confirmed; keep off; backlog item removed; no wiring/default follow-up |
| 2026-08-02 | Repository gate | `AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh`: all 260 test files passed; timing scaling used the repository-supported control after the same wall-clock-only failures reproduced at the untouched base under exceptional host load |
| 2026-08-02 | Independent final QC | gpt-5.5, Gemini 3.6 Flash (High), and Claude Fable each returned `SHIP-AS-IS`; no MUST-FIX survived verification. A Sonnet capability-store Major was refuted because frozen KR4/Phase 3/R9 explicitly require persistent capability-state recording |

## Completion criteria

- [x] 16/16 unique terminal cells and 8/8 valid pairs.
- [x] Independent oracle/reviewer evidence and exact report math.
- [x] Depth-0 authoritative QC passes after foreman completion.
- [x] Backlog and project lifecycle state match the terminal decision.
