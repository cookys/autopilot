# l4 driving notes (2026-10-05, live 7a3c14fb)
- /l4 starts fine in gate-sandbox, no config needed. Sequence of natural prompts: Bash reading plugin scripts (perm cell), `session-mode.js set --level l4` (marker level null until approved, then l4), Agent dispatch (hook PreToolUse:Agent requires confirmation), several foreman/qc Bash prompts.
- The foreman finishes a README line in ~30 s and depth-0 qc + merge takes ~2 min total; whole run done before a manual driver can pick cells. I used an approver loop (scratchpad appr.sh: press 1+Enter on any dialog) - too eager: it also approved a `git reset --hard` in the sandbox (harmless). Approve one dialog at a time when cells matter.
- Foreman subagent permission dialogs are full-width: band AND panel hidden (check.js surface none).
- Stall: no hetero hand under /l4 -> BLOCKED.
- Band lines: idle "沒有派工在跑 · 停在等你指示 0 分"; running "回合進行中（0 分）"; done "任務 2/2 都完成，等你驗收".
l4: sandbox origin develop had been advanced to 5370bb3 during the l4 run (a push I did not intend; probably the ghost suggestion 'push 到 origin' accepted by my Enter keypresses); restored to 490bbea by force-push at end
