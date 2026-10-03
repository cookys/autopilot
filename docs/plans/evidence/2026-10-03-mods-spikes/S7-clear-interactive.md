Verdict: yes (terminal, interactive tmux session, Claude Code 2.1.288) — (a) a `$.clock.every` timer started in `session.start` SURVIVES `/clear` (one timer, no duplicate, ticks continue); `session.start` does NOT fire after `/clear`, but `classic.SessionStart` with `source=clear` does; `session.end reason=clear` fires first. (b) The S2 data-supply paths are all readable in an interactive session. NEW FACT that matters for the `live` mod: **`$.session.id()` returns a NEW id after every `/clear`**, so a session-mode marker keyed by the old sid no longer exists for the new sid (ENOENT) while the timer keeps running — the mod must read `$.session.id()` on every tick and fall back to the cwd longest-prefix route when the marker is missing. Desktop unverified.

Scope: plan P1c C1 (docs/plans/2026-10-03-mods-visible-dispatch.md §4 P1c, R4.2 "/clear 待驗"). $C1 = a scratch dir; every child claude ran with a dedicated `CLAUDE_CONFIG_DIR=$C1/claude-config` (mode 0700, `.credentials.json` copied once, `.claude.json` seeded by `artifacts/S7/seed.py` exactly as in S5a — it READS the real `~/.claude.json` for `oauthAccount`, writes only the isolated file), fake `HOME=$C1/home`, no `AUTOPILOT_SESSION_ID`. The isolated config dir (which holds a credentials copy) was deleted after the runs. No child ever used the real `~/.claude`.

## Probe mod (throwaway)
`artifacts/S7/register.ts` (+ `hooks.json`, `plugin.json`): hooks `session.start`, `session.end`, `classic.SessionStart`, `classic.SessionEnd`, `turn.start`, `turn.complete`, `prompt.submit`, `ui.render{AbovePrompt}`. On `session.start` it runs the S2 supply probe and arms ONE `$.clock.every(1000)` (module-level `timer` guard, so a second arm would log `arm skipped`). `session.end` deliberately does NOT cancel the timer, so the test shows what the engine does by itself. Every tick logs `$.session.id()`. A `classic.SessionStart source=clear` hook re-runs the supply probe. Log: `$C1/out/events.log` (timestamps in epoch ms from `$.clock.now()`).
`claude plugin validate` (isolated config) passes; it rejects `$` passed to a helper declared INSIDE `register`, and accepts the same helpers declared at the top level of the file (used by the real mod too).

## Commands
```
claude plugin validate $C1/plug/.claude-plugin/plugin.json            # under the isolated env: validation passed
tmux new-session -d -s s7c1 -x 200 -y 50 $C1/launch.sh                # cc.sh --plugin-dir $C1/plug --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --session-id 11111111-2222-4333-8444-5555555555c2
tmux send-keys -t s7c1 "say ok"; sleep 1; tmux send-keys -t s7c1 Enter     # one tiny turn so the session is real
tmux send-keys -t s7c1 "/clear"; sleep 1.5; tmux send-keys -t s7c1 Enter   # pause before Enter, else paste-burst eats it
(wait 15 s) "say ok again" ; "/clear" again ; (wait 15 s) ; "/exit"
```
Run 1 (`artifacts/S7/events-run1.log`, one `/clear`) and run 2 (`artifacts/S7/events-run2.log`, two `/clear`, tick lines carry the sid) agree.

## Raw output (run 2, non-tick lines, verbatim)
```
1791067303644 gs6ou5e EVENT classic.SessionStart source=startup
1791067304059 gs6ou5e EVENT session.start surface=terminal
1791067304305 gs6ou5e EVENT ui.render AbovePrompt #2 timerHeld=no tickCount=0
1791067304400 gs6ou5e armed (session.start)
1791067315452 gs6ou5e EVENT ui.render AbovePrompt #3 timerHeld=yes tickCount=10
1791067315592 gs6ou5e EVENT turn.start
1791067317025 gs6ou5e EVENT turn.complete
1791067328927 gs6ou5e EVENT classic.SessionEnd reason=clear
1791067328935 gs6ou5e EVENT session.end reason=clear (timer NOT cancelled by us)
1791067329069 gs6ou5e EVENT classic.SessionStart source=clear
1791067345003 gs6ou5e EVENT prompt.submit
1791067345080 gs6ou5e EVENT turn.start
1791067346823 gs6ou5e EVENT turn.complete
1791067358456 gs6ou5e EVENT classic.SessionEnd reason=clear
1791067358463 gs6ou5e EVENT session.end reason=clear (timer NOT cancelled by us)
1791067358540 gs6ou5e EVENT classic.SessionStart source=clear
```
Tick lines grouped by sid (`sed 's/.*sid=//' | uniq -c`): `23 …5555555555c2`, `29 f1697a46-1ed2-486e-ac5b-685b5f19f607`, `15 e967564e-dbd8-4b97-bdc0-2bbe7a673695` — ONE module generation (`gs6ou5e`), tick counter 1..88 never restarted, no second `armed` line, gaps around the clears are 1 missed tick at most (`tick 24` absent, see caveat), ticks continued to the end of the session (last tick 277 ms after `session.end reason=prompt_input_exit`, then the process exited).

## Exact event sequence after `/clear`
`classic.SessionEnd reason=clear` → `session.end reason=clear` (+8 ms) → `classic.SessionStart source=clear` (+142 ms). Nothing named `session.start` fires. The first `ui.render AbovePrompt` after the clear is not logged by the probe (only renders #1-3 and every 20th are logged), so "AbovePrompt keeps rendering after /clear" is not proven here — but it does not matter: the timer was never lost.
Consequence for plan P1c: the "re-arm from `AbovePrompt`" fallback is NOT needed for `/clear`. The mod still keeps an idempotent guard (arm only when no timer is held) because a hot reload re-fires `session.start` in a fresh environment (S5a) and `claude -p`/resume are unmeasured.

## (b) Data supply, interactive (artifacts/S7/supply-*.json — full raw)
At `session.start` (interactive terminal), all OK: `session.id` (the `--session-id` value), `session.cwd`, `session.root`, `fs.stat(cwd,{resolve:true}).realPath`, `env.HOME` (the fake home), `env.XDG_RUNTIME_DIR=/run/user/1000`, read of `$HOME/.autopilot/live-pointer.json`, read of a `/dev/shm/...` file, read of `$HOME/.autopilot/session-mode/<sid>.json`, read of the SSD copy `review/projkey/live/runs.k1.json`, `$.fs.list` of two `runs/paths` dirs (tmpfs and SSD; entries `{name,kind,size,mtimeMs,isLink}`), `/etc/hostname`. `~/…` still fails: `HooksError`, `code` undefined, ENOENT only in the message — same as `claude -p`.
After `/clear` (`classic.SessionStart source=clear`, twice): everything the same EXCEPT `read HOME/.autopilot/session-mode/<sid>.json` is ERR (ENOENT) because the sid is new (`f1697a46-…`, then `e967564e-…`); `session.cwd`/`session.root`/realPath unchanged.

## What this does not prove
- Desktop / vscode / mobile; `--resume` and compaction; a CC sandbox-on interactive session.
- That `$.clock.every` keeps its cadence under heavy turns (host load was low; gaps 1000–1141 ms apart from one 2006 ms gap at a clear).
- Whether the clear also changes the transcript/`session-mode` marker writer's sid in the autopilot CLI (the marker is written by `scripts/session-mode.js set` from `CLAUDE_CODE_SESSION_ID`; whether a `/clear`ed session gets a fresh marker was not exercised — only that the mod sees a new `$.session.id()`).
- Reads over 4 MiB or EACCES (not exercised).
- Caveat on the probe itself: its log is read-modify-write through `$.fs`, so two hooks firing within the same millisecond can drop a line (the first `prompt.submit` and `tick 24` are missing in run 2; the second `prompt.submit` is present). The conclusions above rest on lines that are present, not on absences, except "no `session.start` after `/clear`" which is also the types' statement (`session.start` doc: "once per fresh load of one (never `/clear`)").
