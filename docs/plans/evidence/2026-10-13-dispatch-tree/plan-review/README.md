# Dispatch tree — plan review receipts

Plan: [`docs/plans/2026-10-13-dispatch-tree.md`](../../../2026-10-13-dispatch-tree.md)
Logical plan id / ticket: `dispatch-tree-2026-10-13`

| File | What it is |
|------|------------|
| `manifest.json` | Seats: sol (codex, chair), Kimi (deep), MiniMax (consult). The Kimi seat carries the same model-id spelling (`kimi-code-k3`, not `kimi-code/k3`) that failed it in the live-pane review; both generations ran with two families (openai, minimax). |
| `rubric.md` | Frozen rubric for this ticket. |
| `g1.out.json` / `g1-disp.json` | Generation 1 artifact (CONDITIONAL; sol STOP, MiniMax CONDITIONAL; 11 findings) and depth-0 dispositions. Folded in `ef414b90`, then the plan was trimmed under the growth ceiling in `23ecfcd2` (fleet step deferred to the backlog). |
| `g2-growthstop.out.json` | The first generation-2 run: `plan_growth_hard_stop` with zero seats dispatched (the G1 fold had grown the plan past 1.5× the 16,387-byte baseline). The plan was shrunk and the state reopened per the procedure in the `scripts/dispatch-plan-review.js` header; nothing was moved into other files. |
| `g2.out.json` / `g2-disp.json` | Generation 2 artifact (CONDITIONAL at the generation cap; sol STOP, MiniMax READY; 5 blockers) and depth-0 dispositions (all five `accepted_blocker`). Folded in `589f7953`. |

Freeze check, run against the bytes generation 2 reviewed (`git show 23ecfcd2:docs/plans/2026-10-13-dispatch-tree.md`):

```
node scripts/check-phase-review-receipt.js --plan-artifact g2.out.json --dispositions g2-disp.json --plan-file <23ecfcd2 plan bytes> --rubric-file rubric.md
rc=0
```

Negative control: the same command with the last disposition removed exits 1 (`Finding 'f2eb5a77…' in plan-artifact missing in dispositions`).
