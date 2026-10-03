# Row R4 — project watcher `src/status/runs-watch.js` (TWO commits: R4a then R4b)
Worktree: /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/wt-r4  Branch: p1a/r4  Base: c51f901f (= R2 ce5398b1 + R3 picks e0ea329a, c51f901f; already checked out)
EXCEPTION to the common brief's one-commit rule: this row makes exactly TWO commits, R4a then R4b, each with its own
RED-first tests and full Verify, because depth-0 reviews them separately. Do not squash.
Plan text (binding, read fully): §4 P1a bullets "watcher `src/status/runs-watch.js`", "watcher 生命週期", "鎖的前提與退路"
(incl. the R4.2 correction — lock form (ii) is chosen, see common brief), "誰起 watcher" (ONLY the manual `--watch` path; the
`session-mode.js set` launch is R5), the runs-watch parts of "驗收" and "負對照"; §2.8 bullet 2 item (3) (`runs/paths/<project_key>.json`)
and the pointer write at watcher start. NOT in scope: `--render` (P1b), the review server (P1b), idle declarations (P3),
`session-mode.js set` launching the watcher (R5).

Already on your base: `src/status/project-key.js` (projectKey, scopeFromCwd), `src/status/live-pointer.js` (writeLivePointer —
autopilot_home = parent of AUTOPILOT_SESSION_MODE_DIR when set, else $HOME/.autopilot), `src/status/runs-fields.js` + cli.js
`status runs` fields/selectors/rotation. Reuse them; switch R3's inline 16-hex computation in runs-fields/cli to `projectKey()`.

## R4a — writer, lock, envelope, files, heartbeat, stop
`autopilot status runs --watch --project <key> --interval 10 [--idle-exit 3600] | --stop --project <key>`: lock form (ii)
(`sh -c 'exec 9>"$LOCK"; flock -n 9 || exit 75; exec node …'` — when `--watch` is invoked without already holding the lock,
re-exec itself under that wrapper; exit 75 → print holder pid from the existing envelope + `writer_busy`, exit 0); `flock`
missing → `flock_unavailable` exit 2, no lock file left. Envelope `autopilot.runs-live/1` with scope, published_at,
valid_for_s 180, writer {pid, session_id, started_at}, runs (from the R3 collector); per-scope files
`<live>/runs/<project_key>.json` + one per observed root `<project_key>--<root_run_id>.json`; SSD fallback copies under
`<autopilot_home>/review/<project_key>/live/runs.<scope_key>.json`; `<live>/runs/paths/<project_key>.json` from
`git worktree list --porcelain` (own project only); atomic tmp+rename everywhere; publish on change, else 60 s heartbeat that
moves only published_at (observed_at only on a real re-query); writeLivePointer() at start; `--stop` reads envelope pid,
checks `/proc/<pid>/cmdline` contains `status runs --watch` and the same `--project`, then SIGTERM; final publish
`writer:null, exit_reason:"stopped"`; startup failure → non-zero, stderr one line, lock released; log
`<autopilot_home>/review/<project_key>/live/watcher.log`. Make interval/clock injectable for tests (fake clock).
Tests: `hooks/tests/runs-watch-lock.test.sh` (kill -9 writer → `flock -n` free within 1 s; writer spawns a long-lived child
then is killed → lock still released (fd 9 not inherited); `/proc/locks` pid == envelope writer.pid; PATH without flock →
exit 2, no lock file; second watcher same project → writer_busy exit 0; envelope pid swapped to another process → `--stop`
refuses) and `hooks/tests/runs-watch.test.sh` part 1 (9 live fixtures probed within 2 ticks; two roots in one repo →
two scope files + two SSD files with correct scope; two projects' watchers 10 heartbeats → both paths files intact and
longest-prefix lookup of both realpaths works; fake clock 300 s idle → published_at advances, payload unchanged; reader
mismatch of envelope.scope = missing; startup failure → non-zero and lock free).
Commit: `feat(status): project watcher writes scoped runs-live envelopes under a single flock writer (mods P1a R4a)`

## R4b — counts, cost aggregation, idle-exit
`counts {confirmed_live, exited, unknown, fresh_bound_s}` exactly per the plan formula (computed once by the watcher; sum ==
runs.length; unprobed rows in unknown); `sessions{<sid>:{session_usd, as_of}}`, `host_today_usd`, `host_today_as_of` aggregated
from costs.jsonl (path: `${CLAUDE_CONFIG_DIR:-~/.claude}/metrics/costs.jsonl` — confirm against hooks/cost-tracker.js and use the
same resolution; tests use a fixture file); `--idle-exit N`: exit 0 with final `writer:null, exit_reason:"idle_exit"` only after N s
of confirmed_live = 0 and unknown = 0 AND no unexpired session-mode marker with the same project_key (unexpired = exists,
parses, expires_at > now; marker dir resolution identical to scripts/session-mode.js).
Tests appended to runs-watch.test.sh (part 2): counts sum; formula; cost sums per session and today; heartbeat 30 s late
→ still fresh; producer stopped > 180 s → stale; `--idle-exit 1` no marker → exit 0 + writer null; unexpired marker → keeps running;
manifest says not terminal but probe says exited → rc null, phase exited, counted exited.
Commit: `feat(status): watcher counts, session and host cost, and marker-aware idle exit (mods P1a R4b)`

Allowed files: src/status/runs-watch.js (new), src/status/cli.js, src/status/runs-fields.js, bin/autopilot.js (only if the
`status` dispatch needs it), codex mirrors, the two new suites. Consumer sweep includes status-runs-fields, status-cli,
dispatch-lineage, project-key, live-pointer and every hit for the symbols you touch.
