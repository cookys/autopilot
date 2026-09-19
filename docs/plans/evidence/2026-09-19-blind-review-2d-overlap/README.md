# Evidence — blind review 2-D plan hetero loop (frozen g2, 2026-09-19)

- R0 authored at depth-0 from the 2-C §1.3 candidates and an Explore pass over the station order, wall arithmetic and
  snapshot code (facts in plan §0). Rubric R1–R7 frozen with the manifest (GLM-5.2 architecture seat, claude-fable-5-1
  operations skeptic with a MiniMax-M3 fallback), `logical_plan_id: blind-review-2d-overlap-2026-09-19`.
- G1 (`g1-artifact.json`, `g1-dispositions.json`, `plan.as-reviewed-g1.md`): both seats CONDITIONAL; 4 blockers
  (join primitive + supplement placement, KR2 gate unnamed, snapshot write-after-claim crash window + digest storage,
  D2 touched assertions beyond the two allowed) + 4 non-blocking; all accepted and folded. The fold chose
  write-before-claim + unlink-on-rejection to avoid the crash window.
- G2 (`g2-artifact.json`, `g2-dispositions.json`, `plan.as-reviewed-g2.md`): GLM-5.2 READY; claude-fable-5-1 CONDITIONAL
  with 3 blockers all on R4 — the unlink design contradicted the frozen rubric and is unsafe under two racing intakes
  (A creates, B accepts+claims, A rejected → unlinks B's file). Terminal at the cap; depth-0 adjudication: all seven
  accepted; the plan now writes after a successful claim, defines the claim-without-file resume rule, and names
  drifted fields from a live rebuild. Frozen g2 with zero unaddressed blockers and zero deferred.
- Growth: R0 15.5 KB → G1 fold 19.3 KB (1.24×) → G2 fold 22.8 KB (1.47×). Over the 1.25 warn line; the cap was already
  reached so no dispatch was blocked, but the next cut starts leaner (narrative to the evidence dir).
- Next: implementation as two managed campaigns (D1 `verify-panel-overlap` L, D2 `snapshot-contract` S) via /l5; the
  KR1 live proof (`saved_seconds > 0`) is recorded one lineage late (evidence-discipline §38).
