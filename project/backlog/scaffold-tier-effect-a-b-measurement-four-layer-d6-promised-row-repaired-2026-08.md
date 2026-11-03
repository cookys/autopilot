# Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred. Four-layer plan D6（docs/plans/_archive/2026/08/2026-08-16-four-layer-redesign.md:269）recorded this row as added, but it was never created; repaired by dev-flow-contract-card P0. Design can reuse the `evals/skill-onoff/` 3-arm instrument pattern（tier as the manipulated variable, dispatched-leaf channel）.
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.




