# BL-0194 qualification registry move: plan review, generation 1

Plan: `docs/plans/2026-10-16-bl0194-qualification-registry-move.md` (ticket `bl0194-g1`, logical plan id `bl0194-qualification-registry-2026-10-16`).

| File | What it is |
|------|------------|
| `manifest.json` | Four seats, four families: fable_chair (claude-native), glm_deep (cc-shim, endpoint glm), qwen_consult (qoderclicn), sol_consult (codex, gpt-6.1-sol, effort low). |
| `rubric.md` | Frozen rubric R1-R9. |
| `run.sh` | Re-run command (`bash run.sh 1`). Loads endpoint credentials through `scripts/load-endpoints-env.sh`, `--timeout 20m`, three `--context-file` sources. `engine-scorecard.js` was left out (126 KB, over the 64 KB cap). |
| `g1.out.json` | Generation 1 artifact: CONDITIONAL, 34 findings, 0 dispositions yet. |
| `g1.stderr.log` | Dispatcher stderr (topology fallbacks added; rc=0). |

Seat verdicts: fable CONDITIONAL, GLM CONDITIONAL, Qwen CONDITIONAL, sol STOP. No dispositions written; depth-0 adjudication is pending.

## Generation 2

`plan.as-reviewed-g1.md` = plan bytes generation 1 reviewed (12623 B). `g1-disp.json` = depth-0 dispositions (13 accepted_blocker, 21 accepted_nonblocking). `run-g2.sh` re-runs generation 2 with the same manifest, rubric and context files. `g2.out.json`: CONDITIONAL at the generation cap (terminal, 14 blocker candidates, 12 non-blocking); fable CONDITIONAL, GLM CONDITIONAL, Qwen READY, sol STOP. Revised plan 12437 B (ratio 0.985).
