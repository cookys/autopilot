# Mods — packaging, data supply, lifecycle, watcher launch

Index-shaped reference for the Claude Code mod surface autopilot ships (live band / pane / toast fed by the
project watcher). Canonical design: `docs/plans/2026-10-03-mods-visible-dispatch.md` (§2.8 pointer, §4 P1a/P1c).
Every fact below was measured in the P0 spikes and the P1c probes: `docs/plans/evidence/2026-10-03-mods-spikes/` (S1, S2, S4,
S5a, S5b, S7, S8; `README.md` there is the verdict table). A mod is CC-only; non-Claude-Code harnesses ignore all of this.

## Packaging (S1)

- A plugin ships a mod through `hooks/hooks.json`, top-level key `modules`: a list of module paths, **relative to
  `hooks.json`** (`"modules": ["../mods/<name>/register.ts"]` is accepted). Source lives under `mods/<name>/`.
- The mod co-loads with the classic hooks: one `claude -p` session produced both the mod line and the classic
  `cost-tracker` row. A module that does not parse logs `hooks module did not load: ... does not parse` and every
  classic hook still runs.
- The mod sandbox has no Node: it cannot `require` repo libs. It reads files and the two literal env names
  `$.env.get("HOME")` and `$.env.get("XDG_RUNTIME_DIR")`; nothing else is derived in the mod.
- Validate with `claude plugin validate .claude-plugin/plugin.json` (pointing at the repo root only checks the
  marketplace). `hooks.json` already carries `"//"` comment keys that log one ERROR-level line per start
  (tracked in BACKLOG).

## Surface degradation (S4, plan §P1c)

| Surface | Band / status line | Pane | Toast | Image | Verified |
|---------|--------------------|------|-------|-------|----------|
| terminal | yes | yes (auto-open only fullscreen and >= 144 cols) | yes | **no for the owner**: `Image {file}` is read by the terminal on the client machine, so over ssh + tmux it draws a blank box and tmux drops the graphics protocol; screenshot comparison goes through the browser review page | `claude -p`, `plugin test` and an interactive tmux session (S7: fs/env/pointer reads; S8: band, pane and toast drawn by the `live` mod) |
| desktop (Code tab) | yes | same content, no `Image` in the tree | yes | not used | not reachable from the dev host; unverified |
| `claude -p` | read-only data path works | not drawn | not drawn | n/a | S2 ran here |

## Data supply (S2, plan §2.8)

- **Pointer**: `<autopilot_home>/live-pointer.json` = `{schema: "autopilot.live-pointer/1", live_base,
  autopilot_home, written_at}`, written atomically by `src/status/live-pointer.js:writeLivePointer()` (called by
  `session-mode.js set` and by the watcher start). The mod knows only `$HOME`; every other path comes from here.
- **Resolution order** for project and root: (1) the session marker `<autopilot_home>/session-mode/<sid>.json`
  (`project_key`, `root_run_id`, `expires_at`; `sid` from `$.session.id()`). The marker is the per-session record:
  `level` is `l3`-`l6` for an orchestrator session and `null` for a plain session (no orchestrator mode, `root_run_id`
  null); every mode gate reads `level: null` exactly like an absent marker; (2) else longest prefix of the real
  cwd against `<live_base>/runs/paths/*.json`; (3) else none (the band shows no data, it never borrows another
  session). `project_key` = first 16 hex of sha256(`repo_identity`), computed only in
  `src/status/project-key.js`.
- **`$.fs` semantics**: relative paths resolve against `$.session.cwd()` with **no project-root confinement**;
  `~` is **not** expanded (build paths from `$.env.get("HOME")`); a failed read is a `HooksError` with **no
  `code`** (errno only in the message), so a mod distinguishes "missing" by catching, not by code.
- **`$.session.id()` changes on `/clear`** (S7): the session-mode marker is keyed by sid, so after a `/clear` the marker for the
  new sid does not exist (ENOENT) while the mod's timer keeps running. A mod reads the sid on **every tick** (never caches it),
  falls back to the cwd longest-prefix route when the marker is missing, and shows `—` for per-sid numbers it cannot find
  (never the old sid's, never 0).
- Envelopes (`runs/<project_key>.json`, per-root `runs/<project_key>--<root>.json`) are `autopilot.runs-live/1`;
  a reader checks `scope` and `published_at`/`valid_for_s` (`readEnvelope` in `src/status/runs-watch.js`).

## Lifecycle (S5a)

- Editing a module file hot-reloads it: the old `clock.every` timer stops (about 126 ms), exactly one new timer
  runs, and the reload **re-fires `session.start`**. `session.end` cancels timers; nothing survives `/exit`.
- **`/clear` (S7, interactive terminal)**: a `$.clock.every` timer started in `session.start` **survives** it: one timer, the
  tick counter never restarts, no duplicate. The events are `classic.SessionEnd reason=clear` -> `session.end reason=clear`
  (+8 ms) -> `classic.SessionStart source=clear` (+142 ms); **no `session.start` fires**. So no re-arm from `ui.render` is
  needed; the `live` mod only cancels its timer on a `session.end` whose reason is not `clear`, and keeps an "arm only when no
  timer is held" guard because a hot reload re-fires `session.start` in a fresh environment.
- Desktop lifecycle is unverified.

## The `live` mod (mods/live, plan P1c)

- Files: `register.ts` (all `$` calls: pointer, marker / paths resolution, envelope, context, job model, tick, toast, pane
  open), `model.ts` (pure parsing / formatting, no `$`), `band.tsx` and `pane.tsx` (pure views over the surface's element
  table), `live.test.ts`. State between a tick and a render is a module variable plus `$.ui.invalidate('ui.render')`: a
  `$.state` ref makes `claude plugin validate` demand a `types` contract named in the plugin manifest, and the mod is wired by
  the `hooks.json` `modules` key alone.
- Reads only: `$HOME/.autopilot/live-pointer.json`, the session marker, `<live_base>/runs/paths/*.json`, the scoped envelope
  (SSD copy as fallback), `<live_base>/context/<sid>.json`, `<live_base>/review/server.json` (port, default 8787) and the job
  page's `model.json` (acceptance axis, gate rows). It never writes, never starts a program, never sends a prompt.
- Band text is built only from the envelope / context file by the session's own sid; `running` is `counts.confirmed_live`,
  `—` marks anything missing, and the state words are `no pointer`, `no project`, `stale`, `unavailable · run: …`,
  `unreadable`. Toasts compare consecutive fresh snapshots of one scope: the execution axis from the envelope `counts`, the
  acceptance axis from the job model.
- **Band time budget (S8, KR1)**: the band shows a new run <= 20 s after its manifest drops. Chain: watcher tick 10 s + mod
  tick 5 s + publish; measured 11.5 s, 4.2 s and 12.5 s in a real interactive session with a real watcher.
- **Validate constraints**: a helper that is passed `$` must be declared at the top level of the file that calls it (declared
  inside `register`, `claude plugin validate` refuses); keep every `$.` call in `register.ts` and give the `.tsx` views the
  element table, not `$`. A `key` prop on a `Text` is not kept in the drawn tree (a `Button` keeps it): tests find a `Text` by
  `type` and shown text.
- **Testing**: `claude plugin test <plugin dir>` finds `*.test.ts` under `mods/` too. The kit has no fs, so a test serves the
  mod's reads with bottom `on('fs.read' | 'fs.list' | 'fs.stat')` hooks over an in-memory tree: a bottom hook that throws is a
  rejected read to the mod (message `no implementation for fs.read`), which is how a fixture says "file missing". The bottom
  also needs `on('session.start')` (`{ cwd }`), `on('session.end')`, `on('ui.toast' | 'ui.open' | 'ui.invalidate')`;
  `mock.clock` and `mock.env` do time and `$HOME`. A plugin named `autopilot` is required for the repo's own module name.
- **Loading it before it is wired**: `claude plugin validate` refuses a module path that leaves the plugin directory and a
  symlink that resolves outside it, so a scratch wrapper plugin (name `autopilot`, `hooks/hooks.json` =
  `{"modules": ["../mods/live/register.ts"]}`) holds a **copy** of `mods/`; re-copy after each edit.

## Watcher launch (S5b, plan §4 P1a "鎖的前提", R4/R5)

- One watcher per project is the only writer of the live projection. `session-mode.js set` starts it when the
  marker has a non-null `project_key`; `autopilot status runs --watch --project <key>` is the same code path run
  in the foreground. Both build the command from one definition, `watchLaunchArgv()` in
  `src/status/runs-watch.js`; the detached start is `startWatcherDetached()`.
- **Lock form (ii)**: `sh -c 'exec 9>"$LOCK"; flock -n 9 || exit 75; exec node <bin> status runs --watch ...'`.
  `exit 75` means the lock is held. The node process keeps fd 9, so `writer.pid` is the holder. Probe children
  spawned by node get stdio 0-2 only and never inherit the lock.
- **Verify the holder by fd, not by `/proc/locks`**: `/proc/locks` names the pid of the already-exited
  `flock 9` helper that took the lock on the shared open file description. Check
  `readlink /proc/<writer.pid>/fd/9` equals the lock path.
- `set` probes in the foreground first (`flock -n <live_base>/runs/<project_key>.lock true`): held prints one
  stderr line with the holder pid (from the envelope's `writer.pid`) and starts nothing; free launches detached
  (`nohup`, own session, stdio to `<autopilot_home>/review/<project_key>/live/watcher.log`). A detached
  `flock -n` that loses is silent, which is why the probe is foreground. Crash recovery rests on one fact: when
  the writer dies (even SIGKILL) the kernel releases the lock and `flock -n` succeeds at once.
- Fail-open: no `flock(1)` on PATH, an unwritable live dir, or any spawn error produces one stderr line;
  `set`'s exit code and marker are unchanged. There is no lockfile fallback (a plain lockfile survives a crash).
- **Autostart switch**: `AUTOPILOT_RUNS_WATCH_AUTOSTART=0` disables the start. `hooks/tests/lib.sh` exports it
  for every suite; any test that runs `session-mode.js set` without sourcing lib.sh sets it itself. Only
  `hooks/tests/session-mode-watcher.test.sh` turns it on.
- **Hook autostart (W1c)**: `hooks/runs-watch-autostart.js` (SessionStart + UserPromptSubmit) starts the same watcher for
  dev-flow and plain sessions, only in an opted-in repo (`.claude/*-config.md` present, or an unexpired marker, or
  `AUTOPILOT_RUNS_WATCH_AUTOSTART=1`; `=0` disables). On SessionStart in an opted-in repo it also ENSURES this session's plain
  marker (`level: null`; created only when no unexpired marker exists, never overwritten, so `compact`/`resume` keep an
  active l3-l6 marker byte-for-byte; an expired one is replaced). On UserPromptSubmit the opt-in is read without
  spawning git (knob, config files, this session's marker), so a repo that is not opted in costs no process per prompt. The idle-exit also treats a session as live while
  `<live>/tasks/<sid>.json` or `<live>/attention/<sid>.json` of the project has `updated_at` inside the idle window;
  plain-session markers do not count as live sessions. SessionEnd does not stop the watcher; idle-exit does.
- A watcher launched from CC's Bash tool outlived `claude -p` (S5b). CC sandbox on, interactive `/exit`, and
  desktop are unverified.
- Stop: `autopilot status runs --stop --project <key>` (checks `/proc/<pid>/cmdline` before signalling).
