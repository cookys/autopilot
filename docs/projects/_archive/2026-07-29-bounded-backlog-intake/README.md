# Bounded Backlog Intake

## Project Goal

> **Final goal**: turn the triggered Mission Convergence follow-ups into a bounded MVP portfolio.
>
> **Success criteria**: one four-family review round covers C1–C11 exactly once, produces at most
> three implementation-plan boundaries, and records a dependency DAG, objective oracles, and
> trigger-bearing follow-ups in one review artifact.
>
> **Scope boundary**: review and prioritization only; no candidate implementation, release, push,
> scheduler expansion, or malicious-worker authority work.

## User requirements ledger

| Requirement | Coverage |
|---|---|
| Use Kimi K3, GLM 5.2, MiniMax 3, and Qwen 3.8 Max because Opus quota is unavailable; replace Qwen with Grok 4.5 after the re-logged account proved credit-blocked. | Four independent authored review seats inside the single deliverable; Qwen failure remains recorded and is not a no-finding. |
| Replace unbounded defect finding with a cut list and minimum version. | Frozen rubric R4, R6, R9, R10. |
| Require proof for genuine no-finding. | Frozen rubric R8 and final artifact gate. |
| Score sub-items and form an MVP union. | Frozen rubric R1–R7 and R11. |
| Automatically retain follow-ups in backlog. | Final artifact emits trigger-bearing follow-up dispositions; admission does not implement them. |
| Review before opening implementation plans. | This project authorizes review output only. |

## Scope completeness

| Dimension | Decision |
|---|---|
| Source code and tests | Out of scope: no implementation. |
| User-facing docs | One local review artifact and this tracker only. |
| API/config/version/migration | Out of scope. |
| External consumers/publish | Out of scope. |
| Dogfood | The intake uses the repository's Mission admission and heterogenous review rails. |

## Executable deliverables

| Deliverable | Dependencies | Status | Output |
|---|---|---|---|
| `bounded-backlog-intake` | none | COMPLETE — bounded MVP selected | `reviews/joint-review.md` |

Reviewer seats, transport attempts, synthesis, and validation consume this deliverable's single
gate; they are not phases.

## Verification contract

Objective verification:

```bash
test -s docs/projects/_archive/2026-07-29-bounded-backlog-intake/reviews/joint-review.md
```

The report must additionally enumerate C1–C11 exactly once and record all four engine outcomes.

## Links

- [Frozen intake](../../../plans/2026-07-29-bounded-backlog-intake.md)
- [Frozen rubric](../../../plans/2026-07-29-bounded-backlog-intake.rubric.md)
