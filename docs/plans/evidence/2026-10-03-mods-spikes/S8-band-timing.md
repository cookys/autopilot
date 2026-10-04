Verdict: yes (KR1 time budget met in 3 of 3 trials) — with the `live` mod loaded in a REAL interactive Claude Code 2.1.288 session (tmux), a REAL per-project watcher (`autopilot status runs --watch --project <key>`, default 10 s interval) and a manifest dropped at T0, the band went from `running N-1` to `running N` in 11.5 s, 4.2 s and 12.5 s (target <= 20 s). The producer is the real watcher; the run itself is a fixture manifest held alive by a real `flock` holder, not a real `/l5` round (see "Does not prove").

Scope: plan P1c acceptance "KR1" (docs/plans/2026-10-03-mods-visible-dispatch.md §4 P1c). Commit under test: this commit's `mods/live/` (via the copy wrapper below) on base `0a642f8f` (P1a watcher; no review renderer or review server yet).

## Setup (all isolated; `$P` = the scratch dir)
- Fixture git repo `$P/c3/repo` (`git init` + one empty commit); `project_key=2b55919cb4ad4d0d`.
- Watcher: `artifacts/S8/wenv.sh node bin/autopilot.js status runs --watch --project 2b55919cb4ad4d0d` started with `setsid nohup`, cwd = the fixture repo, env = fake `HOME=$P/c3/home`, `AUTOPILOT_LIVE_DIR=/dev/shm/autopilot-kr1-XXXXXX` (mktemp -d, mode 0700), `AUTOPILOT_DISPATCH_RUNS_DIR=$P/c3/runs` (fixture manifest dir), `AUTOPILOT_COSTS_FILE=$P/c3/costs.jsonl`. It wrote the pointer (`artifacts/S8/live-pointer.json`), `runs/<key>.json` (`artifacts/S8/final-envelope.json`) and `runs/paths/<key>.json` (`artifacts/S8/final-paths.json`).
- Wrapper plugin (named `autopilot`, `hooks/hooks.json` = `{"modules": ["../mods/live/register.ts"]}`, `mods/` = a COPY of the worktree's `mods/`; a symlink is refused by `claude plugin validate`: "resolves outside the plugin's folder", and so is a relative module path leaving the plugin dir: "The module path leaves the plugin directory").
- Child: `artifacts/S8/launch.sh` = `claude --plugin-dir <wrapper> --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --session-id 22222222-3333-4444-8555-6666666666a1`, cwd = the fixture repo, isolated `CLAUDE_CONFIG_DIR` (credentials copy, deleted after the run), fake `HOME`, in tmux `kr1` 200x50. No session marker exists, so the mod resolved the project through the cwd route (`runs/paths/<key>.json` longest prefix), which is the route a session without `/l3-/l6` takes.
- Each trial: `artifacts/S8/trial.sh` starts `flock <lock> sleep 600` (a live run), waits 0.5 s, records T0 (`date +%s%N`), writes the manifest with `lock_path` = that lock, then polls `tmux capture-pane -p` every second (epoch-ns timestamps) for the band text until it shows `running <n>`.

## Results (`artifacts/S8/capture.{1,2,3}.log`, `trial.*.result`)
| trial | position of T0 in the watcher interval | band first shows | delta |
|---|---|---|---|
| 1 | not controlled | `running 1 · oldest 07:00 · …` | 11544 ms (capture.1.log last line minus `trial.1.result` T0; computed in the shell, ns timestamps) |
| 2 | not controlled (started right after trial 1's capture ended) | `running 2 · oldest 07:00` | 4165 ms |
| 3 | not controlled (started 7 s after trial 2's capture ended) | `running 3 · oldest 07:00` | 12505 ms |

Band before T0: `running 0 · oldest — · stalled 0 (telemetry) · last rc unknown · $— / host $0.01 · ctx —` (the session had no cost row yet, shown as `$—`, never 0; a row appended later turned it into `$0.01`). Worst case observed 12.5 s against the plan's bound of about 15-20 s (watcher 10 s + mod 5 s + publish).

## Other things seen in the same session
- The pane opened by itself (tmux child, 200 columns, fullscreen layout): dispatch line `kr1-run · implementer · codex/m · started 07:00 · elapsed 7s · phase run…`, the "execution status, not progress" caption, the gate section (`no review page published yet · gate rows —`, because the base has no renderer) and the Link text `open the review page`.
- A toast box appeared when `running` moved (execution axis).
- `/clear` in this live session: the band kept updating (timer survived), `running 3` stayed (cwd route after the marker-less sid change) and the session cost went from `$0.01` to `$—` (new sid, no row; not borrowed from the old sid).
- Port: the base has no review server, so there is no `<live>/review/server.json`; the Link uses the 8787 default (the page behind it does not exist at this base).

## Does not prove
- A real `/l5` round (the plan's wording). The producer path is real; the dispatch is a fixture manifest + a live flock holder. A real round exercises the same watcher fields.
- Desktop / vscode / mobile; a heavily loaded host; more than three trials (the spread is wide because the delay is dominated by where the drop falls in the 10 s watcher interval, so 4-13 s is the range to expect, not a distribution).
- `ctx` (no status line feed in the fixture: `ctx —`), a session-marker route (this run used the cwd route; the marker route is covered by `live.test.ts`), the acceptance axis / gate table against a real review page (needs the P1b renderer).
- Isolation caveat: the child ran under an isolated config dir and fake HOME; nothing of the real `~/.autopilot` was touched (stat evidence in the commit report).
