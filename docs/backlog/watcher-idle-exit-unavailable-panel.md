# Live watcher idle-exit, log flood and residue git failure (BL-0327, BL-0328, BL-0329)

Reported by cookys/openclaw/fleet--claude (fleet message 01M628K0GA63KYQY11GERK89KW, repo ~/projects/fleet, autopilot 0023a24fa, 3.0.0-alpha.6) after the owner pasted a live panel line reading "unavailable; run: autopilot status runs --watch --project 85b67b66a34373df". depth-0 asked for a read-only look (message 01M6207V5WJB8RVV323X1DM4F4) and answered the report (message 01M628KJBMWHK5Y16QHJG2KV8B), 2026-10-29. Searched docs/BACKLOG.md and docs/backlog/ for idle_exit, watcher.log, worktree list failed, status task unavailable: no existing entry.

## BL-0327 timeline: watcher idle-exits during a long tool-only stretch

- Watcher log 2026-10-28T19:40:21Z `exit idle_exit`; the next UserPromptSubmit at 22:01:15Z logged `start pid=1519391`. About 2h20m with no watcher; the panel showed unavailable.
- At the 19:36Z prompt the watcher was still alive, so the hook spawned nothing. After that the session kept running tools (commits, gates) with no new prompt.
- The session marker was plain (level null). Watcher liveness ignores plain markers; with no live_base tasks file and an empty attention directory, nothing told the watcher a session was still working.
- Code (confirmed at HEAD 45edf93da): src/status/runs-watch.js lines 745-754 (sessionLive from markers plus recentSessionFiles at line 193, which reads only tasks/ and attention/ updated_at; idle_exit return at line 754); mods/live/register.ts line 337 (no envelope found gives the unavailable state); mods/live/model.ts line 1027 (unavailable text built with RUNS_HINT, which tells the user to run the command); the text itself is the state.unavailable key at mods/live/locales.ts line 56 (en) and line 373 (zh-TW), and mods/live/locales/zh-TW.json line 52; hooks/runs-watch-autostart.js and its row in hooks/README.md (ensure only on SessionStart and UserPromptSubmit).

Two fix directions, to choose later:
1. Count recent activity of this project's sessions as liveness: use a live file that is already written on tool calls, so a long tool-only stretch keeps the watcher up.
2. Do the ensure inside an existing per-tool-call hook (PostToolUse group in hooks/hooks.json): probe only, spawn only when the lock is free.

Wording: replace the instruction to run a command with plain text such as "watcher idle-exited; it restarts with your next message".

## BL-0328 watcher.log flood

~/.autopilot/review/85b67b66a34373df/live/watcher.log reached 12.8 MB, of which 147159 lines are `render-review-page: status task unavailable for review-... (rc 1)`. The line comes from scripts/render-review-page.js line 557 (callTaskStatus, line 550), polled by src/status/runs-watch.js pollTask (around line 458) on each tick for a root whose task status cannot be read. No rotation, no de-duplication. Candidate fixes: log once per root per state change; cap or rotate the file.

## BL-0329 residue git worktree list failure

`residue: cannot resolve the main worktree (git worktree list failed); keeping the previous file` appeared 528 times, earliest 2026-10-24T18:59Z, yet running git worktree list by hand in the repo returns rc=0. Source: src/status/residue.js line 172; the paths-file counterpart is src/status/runs-watch.js lines 322-333 and 432-433. Suspect: the detached watcher environment differs (cwd, PATH, GIT_* variables) so the call fails there; the residue file is therefore never refreshed. First step: capture stderr and the environment of the failing call inside the watcher, then compare with a shell.
