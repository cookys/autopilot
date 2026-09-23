# gemini-3.8-flash-low implementer — QUALIFIED 24/24 (2026-09-23)

Re-sit of the 2026-09-03 cell on the current rail. Model id is still
`gemini-3.8-flash-low` (`agy models`, agy 1.2.8). Corpus pins are unchanged
(`impl-eval-generator.js` / corpus / `sha256("cgroup-live-rail-v1")`). Harness
is `dispatch-hetero:bece9e5d`, the first 8 hex of sha256(`scripts/dispatch-hetero.sh`).

| | |
|---|---|
| outcome | qualified 24/24, both trials 12/12 |
| scorecard event | 17 |
| evidence event | 60 |
| wall | 349 s |
| integrity / fabricated / contract / oracle miss | 0 / 0 / 0 / 0 |
| expires | 2026-12-22 |

Stage-0 probe committed (`probe-receipts.jsonl`, rc 0). Same construct as the
2026-08-22 suite: contract-obedient commit production on the dispatch-hetero rail.
