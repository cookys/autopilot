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
  `level` is `l3`-`l6` for an orchestrator session and `null` for a plain session (no orchestrator mode; it still carries a minted
  `root_run_id` `job-<ts>-<rand>` (PLAINROOT), and a campaign run stamps its campaign root instead); every mode gate reads `level: null` exactly like an absent marker; (2) else longest prefix of the real
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
  page's `model.json` (acceptance axis, gate rows, `needs_decision` / `decision` incl. `stale` / `age_s`, `progress`, `phase`). It never writes, never starts a program, never sends a prompt.
- **Band contract (P1c C3)**: for a person who left the computer, the band says which project, which phase, how long it has
  run and how far along, led by one of five verdict words. One entry, two lines: line 1 is `<mark> <verdict> <project> · <phase> ·
  <elapsed> · <progress>`, line 2 one short reason sentence (zh-TW, built from fields only). The state texts `no pointer`,
  `no project`, `stale`, `unavailable · run: …`, `unreadable` are unchanged and replace the whole entry.
  - Verdict words, first match wins: `▲ 要你決定` (job model `needs_decision === true`; reason = the decision question) >
    `⏸ 疑似卡住` (any envelope row with `stall: true`, reason = the quietest stalled row's `last_event_age_s` in minutes,
    no new threshold) > `✓ 完成待驗收` (envelope `confirmed_live === 0`, progress frozen with done = total, acceptance axis
    neither accepted nor rejected; reason `驗收結論尚未出`) > `● 進行中` (`confirmed_live > 0`; reason `<n> 個派工在跑`; since
    GATEFIX also a session task `in_progress` with no live run, reason `任務進行中：<current>`) >
    `◌ 待命` (the idle word, last: none of the four holds, i.e. nothing live, nothing awaited, not frozen-complete, no task in
    progress; reason `沒有派工在跑`). A decision awaited is drawn bold in the warning color, the other words bold, `待命` plain.
  - project: `scope.repo_identity` minus `git-common-dir:`, minus a trailing `/.git`, last path segment; a bare repo or any
    other shape falls back to the first 8 hex of the project key. Pure string work, never git.
  - phase: the job model's `phase.label` (an object `{ code, label, source }`; only a non-empty string `label` counts). The
    renderer fills it from a terminal campaign state of the task receipt (`source: campaign`) or else the first open
    deliverable (`source: deliverable`, `做 <id>`). Absent or malformed: `—`. A run still in progress with no frozen
    progress receipt shows `—` (the live campaign phase is not reachable by the renderer: follow-up). The process phase
    (`running` / `exited`) is never used as a phase.
  - elapsed: now minus the earliest `started_at` among the scope's envelope rows; `38m`, `2h14m`, `1d3h`, `—` when no row
    has a start.
  - progress: from the job model `progress`. Frozen: `62.5%（5/8）` (the model's percent verbatim). Not frozen: `3 done*`,
    drawn dim, no percent. No model or no count: `—`, never 0. Execution (runs) and progress (deliverables) are separate
    axes: progress never comes from run counts.
  - Moved to the pane: session cost, host cost and context % are the pane's header row (`session $0.42 · host $3.10 ·
    ctx 37%`, same sources and `—` rules as before). When `needs_decision`, the first section under the header lists
    what is awaited from the model's `decision` object (question, then `n. label — consequence` for each option that
    exists); the execution-status table, the gate rows and the review Link stay.
- **Every wired source (W3a)**: besides the above the mod reads, all through the live pointer's `live_base` (never computed
  in the mod): `tasks/<sid>.json` (`autopilot.session-tasks/1`), `attention/<sid>.json` (`autopilot.attention/1`) and `turn/<sid>.json`
  (`autopilot.session-turn/1`, mods P1W TURN: `state` `active` from the UserPromptSubmit, `ended` from Stop, removed at SessionEnd; written by
  `hooks/awaiting-owner.js` behind `AUTOPILOT_AWAITING_OWNER`, never by a subagent payload; ignored when its `since` is older than the 24 h marker TTL), all
  named by the *sanitised* sid (`[A-Za-z0-9_-]`, else `_`, 64 scalars; the context file too); the scope-checked sidecars
  `runs/<scope>.decisions.json` (`autopilot.decisions-sidecar/1`), `runs/<scope>.foreman.json`
  (`autopilot.foreman-activity/1`) and `runs/sources/<scope>.json` (`autopilot.sources/1`, fallback: the job model's
  `sources_manifest`); and, for a campaign root, `<git-common-dir>/autopilot/work-orders/<root>/*.json` (the common dir is the
  envelope's published `scope.repo_identity`; a root that is not a plain `[A-Za-z0-9._-]` segment is never joined into a path).
  A sidecar whose `scope` is not this project / root is an absent file.
  - Verdict precedence now: `要你決定` (attention `permission` / `question`, or an open decision; reason `等你批准：…（等了 N 分）`,
    `等你回答：…`, or the question plus `（已等 N 天）` when the model marks it stale and a whole day has passed) > `疑似卡住` >
    `完成待驗收` (frozen done = total, or every session task completed; both need nothing live and acceptance undecided; the
    campaign-terminal phase codes are not a separate rule) > `進行中` (a live run, a session task in progress, or an active turn; reason: the run, else the task, else `回合進行中（N 分）`) > `待命` (attention `idle` appends `停在等你指示 N 分`).
    `待命` means the turn ended (or no turn file) and nothing else is going on. The turn file closes the former gap (a mid-turn session with no
    task and no run read `待命`): an `active` turn is `進行中` until Stop. A crashed session's leftover `active` file is ignored after 24 h.
    `awaiting_disposition` is never `要你決定`.
  - elapsed = start of this piece of work, chosen by campaign-vs-session rather than by whether the marker has a root (every
    plain session has one): the earliest progress receipt bound to the root (the receipt's own `root_run_id`; a file with a
    different file-level root is unbound), else the tasks `first_created_at`, else the marker `started_at`, else the earliest
    run, else `—`. A dev-flow or fresh /l3–/l4 session with no dispatch and no receipt therefore shows its session age.
  - Line 2 tail, only when non-zero: `代你決定 m 件（k 件不可逆）`, then `僅 <writers_wired> 自動裁決` (or `決策寫入端未接` for an empty list;
    no label when `next-pick`, the depth-0 writer, is wired), then `n 件派工無決策紀錄`.
  - Not wired vs empty (sources manifest; no manifest = the old inference, an em dash): phase slot `來源未接` only when
    `phase`, `progress` and `task_status_input` writers are all off; progress slot (when the job model has none and there are no
    tasks) `來源未接` when `progress` and `tasks` are off, else `—`; with no tasks file the pane says `任務工具未開 · 設
    CLAUDE_CODE_ENABLE_TODO_TOOLS=1 …` (writer live) or `任務：來源未接`; `代你決定：來源未接` (both ledger writers off, no
    sidecar); `等待狀態：來源未接`; `ctx 來源未接` (no usable context value and `context` off). A value the data really carries
    is always shown. Unknown is never 0. A task count with no frozen denominator reads `n done*` (dim).
  - Pane sections after the gate rows: tasks (`任務 m/n 完成 · 進行中 k`, current, up to 8 rows), decisions (one row each plus the
    real veto verb `decision-ledger.js veto --ledger <ledger> --id <decision_id>`, no id = no veto), foreman activity (description,
    label, age from `last_activity_at` against now; `stale` dimmed and marked `久未動`; `binding: session` stated; stage line), or
    `工頭狀態：來源未接` when the sidecar is absent. An attention awaiting the human is the first section.
  Toasts compare consecutive fresh snapshots of one scope: the execution axis from the envelope `counts`, the
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

## Known limitations (W4 gate pilot, 2026-10-05)

- **Attention outlives an approved permission until the tool finishes.** No hook event fires between the human approving a
  permission and the approved tool's `PostToolUse`, so `attention/<sid>.json` (kind `permission`) stays and the band keeps
  saying `要你決定` for the whole run of a long foreground tool (observed: 72 s). Not fixable from hooks; to see `進行中` in a
  gate cell use a live dispatch run or an in-progress task, not a long Bash.
- **A dialog covers the band row.** While a permission or AskUserQuestion dialog is open only the top-right panel shows the
  verdict (`要你決定` + reason); the gate kit's `capture.sh` records it in `panel.txt` and `check.js` judges it (`surface: panel`).

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
  active l3-l6 marker byte-for-byte; an expired one is replaced with a NEW root). A plain session is one job: its marker
  carries a `root_run_id` minted by the same rule as `set --level` (explicit > `AUTOPILOT_ROOT_RUN_ID` > `job-<ts>-<rand>`), and
  the watcher keeps that root as a scope while it has a live signal (unexpired marker, live run, open decision file, tasks/attention
  update inside the idle window) and drops it with its live files (not the review pages) after one idle window. On UserPromptSubmit the opt-in is read without
  spawning git (knob, config files, this session's marker), so a repo that is not opted in costs no process per prompt. The idle-exit also treats a session as live while
  `<live>/tasks/<sid>.json` or `<live>/attention/<sid>.json` of the project has `updated_at` inside the idle window;
  plain-session markers do not count as live sessions. SessionEnd does not stop the watcher; idle-exit does.
- A watcher launched from CC's Bash tool outlived `claude -p` (S5b). CC sandbox on, interactive `/exit`, and
  desktop are unverified.
- Stop: `autopilot status runs --stop --project <key>` (checks `/proc/<pid>/cmdline` before signalling).
