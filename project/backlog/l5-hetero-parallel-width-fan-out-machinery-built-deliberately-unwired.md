# `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a **concrete, repeated** need to fan a single batch out across multiple *heterogeneous* (agy/Gemini) workers in parallel — i.e. real `/l5` task-supply where the cost-arbitrage of a second engine actually pays, AND the base-correctness + engine-variance risks are acceptable for that workload.
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out. The deterministic rails for the hetero-parallel path **already exist** — `dispatch-batch.sh reap` is the SIGTERM-to-pgroup parallel-kill trap built for shell-dispatched workers (setsid-verified), and `dispatch-hetero.sh` is the single-unit hetero dispatcher. What's unbuilt is the loop that fans `dispatch-hetero.sh` across N units under `dispatch-batch.sh`'s verify/merge-back/reap. It was **cut at plan time** (the weakest leg: base-correctness × engine-variance × *rarest* task-supply — speculative on speculative). S0.a then confirmed wide task-supply is already thin even homogeneously, so this is one-day-to-wire-IF-needed, not a gap. `/l4` homogeneous is the value path.
- **Effort**: S (wire existing rails) — only if the trigger fires.
- **Source**: 2026-06-23 `docs/plans/_archive/2026/06/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).


## Trigger revised 2026-10-18 (owner card d-759c89f1)

Four months (2026-06-23 to 2026-10-18) brought no need to send one batch to several engine families at once. The two parallel runs that did happen (4 kimi foremen; 6 sonnet foremen with grok hands) used `skills/l5/references/hetero-impl-loop.md` Parallel units: one `git clone` and one foreman per unit. So the trigger now has two added conditions:

1. The need must be one that clone-per-unit cannot serve, and the request has to say why.
2. Wiring `dispatch-batch.sh` worktree fan-out must first deal with the one-rail-per-`.git` limit: `lib/main-checkout-boundary.sh` rejects a second foreman on the same `.git` as `main_checkout_mutated`. This is inferred from the recipe, not run, so the old "Effort S" is likely low.

`dispatch-batch.sh` and `dispatch-hetero.sh` are still present and maintained (last touched by 657ad3fdd, 2cf9f6b65).
