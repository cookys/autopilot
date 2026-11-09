# Unattended lane startup

A lane unit that starts `claude ... --dangerously-load-development-channels server:fleet` inside a detached tmux session stops at Claude Code's startup dialog "WARNING: Loading development channels". Claude Code 2.1.319 has no setting, env var or flag to pre-accept it, and the acceptance is not remembered. [`scripts/accept-dev-channel-prompt.sh`](../../scripts/accept-dev-channel-prompt.sh) answers it from the unit.

```ini
[Service]
ExecStart=/usr/bin/tmux new-session -d -s lane -n main 'claude --dangerously-load-development-channels server:fleet'
ExecStartPost=/path/to/autopilot/scripts/accept-dev-channel-prompt.sh --pane lane:main.0 --timeout 90
```

The script polls `tmux capture-pane` and sends one `Enter` only when the screen holds both "Loading development channels" and "I am using this for local development" (option 1 is the default focus). It sends at most one key per run. Exit 0 means accepted, 1 means the text never appeared within `--timeout` (nothing was sent), 2 is a usage error. Each run writes one line (pane, outcome, seconds waited) to stderr and, when `logger` exists, to the journal under `accept-dev-channel-prompt`; screen text is never logged.

Risks:

- Only the exact text is accepted. A different dialog (folder trust, login) gets no key.
- One key only. It never types anything else and never retries after sending.
- If a new Claude Code version rewords the dialog, the script stops sending and the unit fails visibly (exit 1) instead of guessing.
- Auto-accepting means the machine consents to loading the development channel on the operator's behalf; use it only for lanes the operator already approved.
- The pane target must be fixed and known (name the tmux session and window in the unit); a missing pane is polled until the timeout, then fails.
