# l3 driving notes (2026-10-05, live 4868c1e1)
- `/l3 在 README 加一行測試字` -> natural permission prompt on `session-mode.js set --level l3`; marker level null until approved, then l3 (root_run_id changes on the switch).
- dispatch-model-guard rejected the first Agent call (prompt line 1 "Engine: hands (sonnet)"), the retry worked: depth-0 self-corrected.
- Order used: perm, idle (turn done, no tasks, 65 s), AskUserQuestion, tasks in_progress, tasks done, stall (hetero codex hand, kill -STOP, ⏸ within 3 min).
- Band lines: idle "沒有派工在跑 · 停在等你指示 1 分"; running "任務進行中：任務A"; done "任務 2/2 都完成，等你驗收"; stall "最久的派工 3m 沒有輸出 · 1 件派工無決策紀錄".
- After the AskUserQuestion answer the l3 session lost context of A/B (it asked what they meant) - session quirk, not gate-related.
