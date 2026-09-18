# Evidence — mission `blind-review-panel-station-2026-09-18` (blind review redesign cut 2-C; in progress)

- Plan: `../../2026-09-18-blind-review-panel-station.md` (base `9a0dac5b` = v2.36.67; frozen after G2).
  `base-suites-9a0dac5b.txt`: the thirteen §4.1 commands at base, detached checkout.
- Plan hetero loop (GLM-5.2 architecture + claude-fable-5-1 skeptic, MiniMax-M3 fallback): G1 `g1-*` (GLM STOP, 1
  blocker folded — hardlinks are not isolation; claude seat → MiniMax fallback READY); G2 `g2-*` terminal at the cap
  (GLM READY, claude CONDITIONAL, 7 folded — station budgeted like the terminal panel, legacy snapshot = single,
  newline-safe batched hashing, seat-qualified colliding ids, separate build/hash counts, evidence outside the
  campaign, red-<suite>.txt per case). Receipts rc 0. Growth 1.17×.
- **Two lineages from one plan.** The graph checker maps each source plan id to exactly one node, and one plan file
  is one id, so the plan's two deliverables ship as two sequential lineages sealing the same plan bytes:
  `scratch/freeze-c2c.js` with `NODE=station` (this graph, `panel-review-station`, digest `ed90f54a…`) and, after the
  station merge, `NODE=packet` (`blind-review-shared-packet-2026-09-18`, node `shared-packet`). Each graph claims all
  eight rubric ids — a coverage rule of the checker, not the node's acceptance (`acceptance_ids` are per node).
