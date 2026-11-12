# Tear down test tmux sockets and claude processes after tests (BL-0433)

Evidence: on 2026-11-12 hangar found a modscroll repro harness still running on the program PM host after 25 days: tmux socket
`modscrollfix`, claude 2.1.302 whose exe had been deleted, its --plugin-dir worktree gone. hangar stopped it on PM go.

Ask: any skill, script or test that starts a dedicated tmux socket or a claude process must tear both down when the test
ends (trap on exit, `kill-server` on its own `-L` socket, kill only the recorded PID). The runbooks that drive a live
claude in tmux (mods live tests, TUI screenshot verification) must state it. Consider a reaper check that lists tmux
sockets and claude processes older than N hours started by autopilot test tooling.

Reported by PM (the program PM session) via hangar, 2026-11-12.
