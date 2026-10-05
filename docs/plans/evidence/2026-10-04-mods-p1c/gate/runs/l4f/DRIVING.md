# l4f driving notes (2026-10-05, live 7f14319a)
- /l4 first tries read-only exploration of plugin refs (dialog); I denied once (Esc) then told depth-0 to skip it. Later runs: put "不要讀 plugin 內部檔案" in the prompt.
- First dispatch always rejected by dispatch-model-guard (Engine: claude vs model: sonnet), depth-0 retries with Engine: sonnet.
- The harness backgrounds the foreman even when told "foreground"; depth-0 ends its turn ("Waiting for 1 background agent"). Esc at depth-0 idle does not touch a background foreman.
- Foreman running gate-wait.sh as `bash ...; echo "EXIT=$?"` does not match the allow rule, so a dialog appears (approved once; attention.json cleared right after approval in run 3, no 5-min permission confound observed).
- Stamps (agents/<sid>/<agent>.json) are written at PostToolUse only: a foreman whose first tool is the long gate-wait has NO stamp while it runs (run 2: band 待命 for 5 min). Run 3 had a quick git status first -> stamp -> band "工頭在跑".
- Foreman.json prefers context_tasks (age ~1 s all the time) over the stamp, so band never reaches 疑似卡住 (check.js derives it from the stamp: FAIL).
- Foreman in run 1 returned after launching gate-wait in background; SubagentStop fired (ended_at) while its shell was still running; the later resumed foreman wrote no new stamp (ended_at kept).
- Never run foreground wait loops > ~110 s in my own Bash: the harness moves them to background at 120 s.
