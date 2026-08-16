# Experience audit — the user-persona critic methodology

**Canonical home** for the post-acceptance experience-critic methodology
(autonomous-brain-integration P6; plan `docs/plans/2026-08-17-autonomous-brain-integration.md`).
Consumed by `scripts/dispatch-experience-critic.sh` (which pins this file's digest into
every critic dispatch). Other docs link here; they never restate the protocol.

Position in the pipeline: the critic runs **strictly post-merge** and **never blocks**
anything — correctness gates alone block. Its findings are BACKLOG candidates priced by
`/next`'s priority queue, not rework mandates. Abstracted from the distilled
`site-narrative-audit` practice (the web-site instance of this family) and generalized
per the Board's 2026-08-17 ruling: no closed artifact-type table — a fixed **instantiation
protocol** generates the audit for ANY deliverable class.

## The five-question instantiation protocol (answered at blueprint freeze)

Answering these five questions IS the per-task instantiation; the answers freeze into the
blueprint so the critic can never invent standards post-hoc:

1. **誰、用什麼動作消費它?** Name the consumer and the consumption act (a player with a
   controller; a quant reading PnL curves; an engineer reading timing reports).
2. **「渲染」動作是什麼 — agent 做得到嗎?** Define the executable consumption operation,
   split honestly:
   - *machine-consumable*: run the game with scripted inputs and capture frames; render
     the CAD layout and run DRC; run synthesis and read slack histograms; walk the daily
     routine end-to-end.
   - *machine-proxied*: qualities like 手感/打擊感/一眼可讀 get measurable proxies
     (frame-pacing budget, same-input-same-frames consistency) PLUS a mandatory
     `human_only` list routed verbatim to the operator's report — **never simulated**.
   - *analysis-class deliverables* (financial aggregation, backtest, LLM scorer,
     efficiency analysis): the consumption act is TRUST, so the render operation is an
     **independent re-derivation spot-check** — recompute one sampled output by hand
     (one trade's PnL, one aggregated figure traced to source, a blind re-score sample)。
     ADR-0001's verification principle applied inside the experience audit.
3. **這類東西通常怎麼壞?** Seed the root-cause taxonomy from a **survey of the domain's
   standard failure lists** (lookahead/survivorship bias for backtests; rollback netcode
   and frame-data discipline for fighting games; position bias and calibration drift for
   LLM judges; congestion/timing-closure for FPGA). Never from imagination.
4. **尺哪裡來?** Three sources, ≤5 rulers total, each a binary per-surface violation test:
   *standing rulers* (the operator's codified taste — corrections history, memory files),
   *task rulers* (derived from the blueprint's own promises), *domain rulers* (from Q3's
   survey).
5. **一致性是指什麼?** Name the artifact's canonical registry (terms/signals/conventions:
   same move same frames; units/timezone/rounding uniform; layer naming; score-scale
   stability across reruns). The registry persists so the NEXT cycle checks against it.

## The seven steps (executed by the critic, per dispatch)

1. **Surface × context enumeration** — every surface the user touches × every real
   consumption context; primary context exhaustively, secondary contexts by a stated
   sampling rule.
2. **Render-first consumption** — experience the artifact through Q2's operation; never
   judge experience from source code.
3. **Rulers** — apply the ≤5 frozen rulers per surface unit.
4. **Root-cause triage** — every felt complaint maps into Q3's taxonomy class; a
   complaint that fits no class extends the taxonomy (tuition).
5. **Consistency pass** — one whole-artifact sweep against Q5's canonical registry, run
   AFTER the per-surface pass (drift accumulates through rounds).
6. **Re-consume to verify** — a fix counts only when re-experienced in the re-rendered
   artifact, never in the diff.
7. **Tuition slot** — instance-specific pitfalls earned from real failures accumulate
   per artifact class (the web instance's earned rules live in `site-narrative-audit`).

## Output contract (top-K, stable IDs, non-blocking)

≤ **7** findings per dispatch. Each finding: stable ID, felt-quote (the experience in the
user's voice), root-cause class (Q3), affected surface, and a BACKLOG-row-ready
Trigger/Context/Effort/Source block. `human_only` items are listed separately for the
operator's hands. Findings NEVER revert, gate, or delay a merge — the wrapper launches
only after the deliverable is an ancestor of the integration ref, and enforces that
in-script regardless of caller.

## Appendix — rehydration bundle layout (canonical; P2)

Frozen five-section order, every section load-bearing, NO truncation (over-cap = build
error), total ≤ 80,000 bytes (20k tokens at the documented 4-bytes/token approximation):

| § | Content | Bound |
|---|---|---|
| ① | `frozen_four_tuple` verbatim from the campaign contract | contract-sized |
| ② | red lines (contract `no_go` + optional red-lines doc) | doc-sized |
| ③ | control-plane digest pins (roster/preference/task-class/gate scripts) | pin-map |
| ④ | decision-ledger tail | last 20 rows |
| ⑤ | owned-process table `{run_id, pid, alive}` | live manifests |

Enforced by `scripts/build-rehydration-bundle.js` (build error on breach; `quiz`/`grade`
machine-check a resumed brain against this bundle's disk truth).
