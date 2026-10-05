# l6b driving notes (2026-10-05, gate-sandbox6, FF9)
- Launch 16:33:30Z, trust dialog Down+Enter. Goal sent ~16:34:00Z. Dialogs approved by box text: read-only ls/cat of S; read of sb6-probe + head README; combined sed->unit-verify-sb6.json + session-mode set --level l6 + dispatch-contract check; heredoc prompt under S; dispatch-author --strict-contract (matched dispatch-author.sh and --strict-contract); two read-only tail/ls log checks. No dialog denied; no sandbox write.
- Depth-0 ended its turn after launching the background author; author finished in 38 s (truncated/frame_missing). Depth-0 did not rerun. A ghost suggestion "同一份 contract 再重跑一次" sat in the prompt box; I never pressed Enter on it (typed /exit over it).
- /exit showed an "Exit and stop tasks" dialog (a background dead-man shell); tmux session killed from outside. Marker file left in place (not deleted).
- origin develop e1316d0 unchanged; sandbox status clean.
