# Dispatch tree step 3d — plan review receipts

Plan: [`docs/plans/2026-10-13-dispatch-tree.md`](../../../2026-10-13-dispatch-tree.md), step 3d (BL-0176)
Logical plan id / ticket: `dispatch-tree-3d-2026-10-15`

| File | What it is |
|------|------------|
| `manifest.json` | Seats: sol (codex, chair), MiniMax-M3 (cc-shim, deep), GLM (consult); three families. |
| `rubric.md` | Frozen rubric R1–R7 for this ticket. |
| `g1.out.json` / `g1-disp.json` | Generation 1 artifact (CONDITIONAL; sol STOP, MiniMax and GLM CONDITIONAL; 6 findings) and depth-0 dispositions (2 `accepted_blocker`, 3 `accepted_nonblocking`, 1 `rejected`). Folded in `c5c21dae`. |
| `g2.out.json` / `g2-disp.json` | Generation 2 artifact (CONDITIONAL at the generation cap; sol STOP, MiniMax CONDITIONAL, GLM READY; 6 findings) and depth-0 dispositions (2 `accepted_blocker`: the foreman `--env-passthrough` route and the probe's `--version` calls; 4 `accepted_nonblocking`). Folded in the commit that adds this file. |

Freeze check, run against the bytes generation 2 reviewed (`git show c5c21dae:docs/plans/2026-10-13-dispatch-tree.md`):

```
node scripts/check-phase-review-receipt.js --plan-artifact g2.out.json --dispositions g2-disp.json --plan-file <c5c21dae plan bytes> --rubric-file rubric.md
rc=0
```

Negative control: the same command with the first disposition removed exits 1 (`Finding '2e8d1ebc…' in plan-artifact missing in dispositions`).
