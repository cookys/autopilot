# Unattended lane startup

A lane unit that starts `claude ... --dangerously-load-development-channels server:fleet` inside a detached tmux session stops at Claude Code's startup dialog "WARNING: Loading development channels". Claude Code 2.1.319 has no setting, env var or flag to pre-accept it, and the acceptance is not remembered. [`scripts/accept-dev-channel-prompt.sh`](../../scripts/accept-dev-channel-prompt.sh) answers it from the unit.

```ini
[Service]
Type=forking
ExecStart=/usr/bin/tmux new-session -d -s lane -n main 'claude --dangerously-load-development-channels server:fleet'
ExecStartPost=/path/to/autopilot/scripts/accept-dev-channel-prompt.sh --pane lane:main.0 --timeout 90
TimeoutStartSec=120
```

`tmux new-session -d` exits right away while the tmux server daemonizes, so the unit needs `Type=forking`: systemd waits for `ExecStart` to exit, then runs `ExecStartPost`, and the tmux server stays in the unit's cgroup. `TimeoutStartSec` must be larger than the script's `--timeout` (120 against 90 here), or systemd kills the unit while the script is still polling.

If `ExecStartPost` fails (the dialog never appeared, or the send failed), the unit is marked failed, and with `Type=forking` systemd then stops the unit and kills its cgroup, which takes the tmux server and the lane with it. That is the recommended behaviour: a lane that is up but stuck on a dialog nobody sees looks healthy and does nothing, while a failed unit shows in `systemctl status` and the journal and can be restarted by `Restart=` or the operator. If you would rather keep the lane up showing the dialog so you can answer it by hand, prefix the line with `-` (`ExecStartPost=-/path/...`); the failure is then only logged, and you must watch the journal for `outcome=not_seen`.

The script polls `tmux capture-pane` and sends one `Enter` only when the screen holds both "Loading development channels" and "I am using this for local development" (option 1 is the default focus). It sends at most one key per run. Exit 0 means accepted, 1 means the text never appeared within `--timeout` (nothing was sent), 2 is a usage error. Each run writes one line (pane, outcome, seconds waited) to stderr and, when `logger` exists, to the journal under `accept-dev-channel-prompt`; screen text is never logged.

Risks:

- Only the exact text is accepted. A different dialog (folder trust, login) gets no key.
- One key only. It never types anything else and never retries after sending.
- If a new Claude Code version rewords the dialog, the script stops sending and the unit fails visibly (exit 1) instead of guessing.
- Auto-accepting means the machine consents to loading the development channel on the operator's behalf; use it only for lanes the operator already approved.
- The pane target must be fixed and known (name the tmux session and window in the unit); a missing pane is polled until the timeout, then fails.
