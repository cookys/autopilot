# l4g driving notes (2026-10-05, live 67b6747e / FF5)
- gate-wait.sh as foreman's first tool, byte-identical: no dialog. Stamp written at SubagentStart (last_tool_name null), band 工頭在跑 at +60 s, 疑似卡住 at +249 s (4 分沒有動作).
- Foreman finished its commit 2.4 s after gate-wait; commit dialog (README echo/git add/commit) came right after gate-wait ended; approved. Foreman ended at once, so no separate recover cell; l4g-foreman-dialog captured the dialog (surface panel, pending[1], agent a5df...).
- qc reviewers raised 2 parallel dialogs; attention pending had 2 entries; after approving one, pending = the other only (verified 30 s later). Depth-0 then asked a merge dialog (git merge --no-ff ... ), approved (local sandbox merge only).
- TaskStop on foreman 2: no dialog; gate-wait.sh died, but NO SubagentStop/ended_at; band stayed 進行中 工頭在跑 then 疑似卡住 after 4 min for a dead foreman.
- Ghost prompt suggestions ("push develop", "清掉那個 worktree 和分支") appeared at depth-0 idle; never pressed Enter on them.
- /exit shows an "Exit and stop tasks" menu; Enter on option 1.
