# Two hook suites are already red on the depth-0 postmerge tree

BL-0274. Recorded from the 2026-10-21 dmech postmerge note. Not re-run in this docs closeout.

hooks/hook-hosting.test.js, two failures:

- ups fast path, dead watcher pid
- awaiting-owner knob off still runs autostart

Red at 3a44dd784, c722c250c and 9aa45ce1b on the depth-0 postmerge worktree. Green in the foreman clone. Suspected to depend on a watcher already running on this host.

hooks/tests/hooks-live-state-misc.test.sh: 22 pass, 2 fail on the base.

Trigger-Type ready. Effort S.
