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
