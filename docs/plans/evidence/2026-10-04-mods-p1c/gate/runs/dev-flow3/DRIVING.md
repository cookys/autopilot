# dev-flow3 (GATEFIX2) driving notes (2026-10-05, live 7a3c14fb)
- Same mechanics as dev-flow/DRIVING.md (private tmux -L gate, env -i, `-t df3:`, helpers in scratchpad).
- GOTCHA: watcher processes started before the plugin update keep running old code (idle-exit 3600). First df3-running FAILed (phase "—", no job page). Check `ps -eo pid,lstart,args` for `status runs --watch --project <key>` older than the last plugin commit; kill it by PID after `readlink /proc/<pid>/cwd`; a new one is respawned within seconds (by the session/mod) running current code.
- Escape test needs a session with NO in_progress task, otherwise 進行中 stays correct. Use /clear for a fresh session id (73d5ecae-...), then a long no-tools essay prompt, Escape after 8 s.
- turn-effective file: {"state":"ended","reason":"interrupted","ended_at":...,"published_at":...} appears ~5-8 s after Escape in $XDG_RUNTIME_DIR/autopilot/turn-effective/<sid>.json.
- Band lines: running "● 進行中 gate-sandbox · 做：任務A · 3m · 0 done*" / "任務進行中：任務A"; escape "◌ 待命 gate-sandbox · — · 0m · —" / "沒有派工在跑".
