# Wiring inventory: writer -> screen (mods band / pane / toast / review page)

Read-only. Main = /home/cookys/projects/autopilot (v2.36.116). MOD = `$OLD/wt-c/mods/live/*` (unshipped, `$OLD`=.../74f6f85f-.../scratchpad/p1c). RENDER-R = `$OLD/wt-r` (phase, unshipped). Anything I did not run is marked `unknown`.
Commands I ran (all read-only): grep/ls/sed over the repo; `node bin/autopilot.js status task --root-run-id hetero-1-2-ab --json` (rc: input unavailable); ls of ~/.autopilot, /run/user/1000/autopilot, /tmp/autopilot-*.

## 0. Headline
The watcher publishes a job page from **only two inputs**: the run rows and a `status task` poll. `src/status/runs-watch.js:394` hard-codes `task, progress: null, decision: null, planned: null, compare: []`. And the `status task` input has **no producer anywhere in the repo** (see 3). So on every watcher-published page: decision, progress, planned, compare, acceptance verdict and phase are always empty. On the band that makes `要你決定`, `完成待驗收`, the phase, `n done*` and `%` **unreachable today**. Only `疑似卡住`, `進行中`, `待命`, project, and elapsed can ever render. Elapsed is project-wide, not per job (gap 6).

Machine state right now: `~/.autopilot/live-pointer.json` absent, `~/.autopilot/review/` absent, `/run/user/1000/autopilot/runs/` holds only `paths/`, `/tmp/autopilot-task-status/` absent. The mods pipeline has never produced a real artifact on this host (evidence-discipline "wired but not firing" family).

## 1. Common chain: how a session gets any band at all
| link | code | fires in real use? | evidence |
|---|---|---|---|
| mod loaded | `hooks/hooks.json` has no `modules` key on develop (`grep modules` empty); the key lands in v2.37.0 (P1d D1 `14e44b46`, branch p1c/d1) | **no** (unshipped) | grep on hooks.json |
| pointer writer | `scripts/session-mode.js:541` `writeLivePointer()` and watcher start `runs-watch.js:534` | only after `/l3../l6` `set` | no pointer file on disk |
| watcher start | `session-mode.js:426-430` `startProjectWatcher` -> `startWatcherDetached({render:true})`, called from `cmdSet` (542) | **only** for `/l3 /l4 /l5 /l6` (skills l3:23, l4:24, l5:23, l6:22). dev-flow S/L/H/Fix and ceo-agent without a `/lN` never call `set`; no skill/hook/command anywhere starts `status runs --watch` (grep of skills/commands/hooks/agents/references: only docs) | grep |
| project resolution in the mod | `register.ts:67-92`: (1) session marker `<home>/session-mode/<sid>.json` with `project_key`; (2) else prefix match on `<live>/runs/paths/*.json`, which only a running watcher writes (`runs-watch.js:304-311`) | marker path: yes after `set`. Fallback: **chicken-and-egg**, no watcher -> no paths file -> `no project` | register.ts:80-91 |
| marker `root_run_id` | `session-mode.js:489` = `process.env.AUTOPILOT_ROOT_RUN_ID \|\| null`. Depth-0 exports it only at dispatch (l5 hetero-impl-loop.md:201, step 9), after `set` (step 6) | effectively always null -> the mod reads the project-wide envelope `runs/<key>.json` (register.ts:71,96) | docs + code order |
| envelope rows | `src/status/cli.js:155-176` `collectRuns` reads `/tmp/autopilot-dispatch-runs/*.json` manifests, via dispatch-hetero / dispatch-review / dispatch-author (`DISPATCH_RUNS_DIR` hits: 1 each). dispatch-consult / explore / batch / foreman write **no** manifest (0 hits). Filter: manifest `repo_identity` | rows exist only for dispatcher-launched leaves. Native `Agent()` foremen and inline work are invisible. Only 38 of 219 manifests on this host carry a `repo_identity` | grep; `ls`; `grep -l repo_identity` |
| root of a row | `dispatch-hetero.sh:1883-1906`: without `AUTOPILOT_PARENT_RUN_ID` the dispatch becomes **its own root** (`LINEAGE_ROOT="$DISPATCH_RUN_ID"`); `AUTOPILOT_ROOT_RUN_ID` is deliberately not read there. Manifests on disk show roots `campaign-v1-<hash>` and `mission-...` for campaign leaves | an ad-hoc dispatch from depth-0 is one job per dispatch (fragmentation); managed campaigns share a root | dispatch-hetero.sh:1898-1906; manifest grep |

## 2. Per displayed item
Legend: W writer / S storage / P publisher / R reader. "fires" = yes / no / tests-only / unknown.

### 2.1 Verdict word `要你決定` (and pane "awaited" section, review-page 需要你決定 / project-index count)
| link | code | fires | evidence |
|---|---|---|---|
| W | **none.** `--decision <file>` is parsed at `scripts/render-review-page.js:787,855`; no skill, script, hook or reference writes such a file (grep `--decision` over skills/references/scripts/src/hooks: only `next-pick.js --decision-id`, unrelated) | **no** | grep |
| S | would be an arbitrary caller-chosen path; no canonical location | no | n/a |
| P | watcher passes `decision: null` (`runs-watch.js:394`); no `--decision` plumbing exists in the watcher at all | **no** | runs-watch.js:394 |
| R | `model.ts:285-319` `readJobModel`, `model.ts:202` verdict precedence; `pane.tsx:39-41` | reader exists, never fed | MOD |
=> `要你決定` can never appear. A manual `render-review-page.js --decision` page would also be superseded by the next watcher publish (publish makes a new version with `decision: null`, `runs-watch.js:396-399`; inferred, not run).

### 2.2 Verdict word `疑似卡住` and reason line "最久的派工 Nm 沒有輸出"
| link | code | fires | evidence |
|---|---|---|---|
| W | `scripts/dispatch-status.js` `--run <id> --stall-secs 180` (log mtime age, line ~571-581), called by `cli.js:170` probe | yes for dispatcher leaves | code |
| S | row fields `stall`, `last_event_age_s` in the envelope (`runs-fields.js:143-162`) | yes | code |
| P | watcher envelope `writeScopeFiles` (`runs-watch.js:291-302`) | yes if watcher alive | code |
| R | `model.ts:184-190`, band | **yes** (only if a live dispatched leaf goes quiet; stall rows come from a bounded rotation of 8 probes per tick, `runs-fields.js:96-110`) | code |
This is the one of the four words that can really fire. unknown: whether a stall false-positive rate is acceptable (report-only per cli.js:179).

### 2.3 Verdict word `完成待驗收`
Needs `progress.frozen && done===total && acceptance not accepted/rejected && confirmed_live==0` (`model.ts:197-199`). Progress is null (2.5) -> **unreachable**. Even with progress, "驗收結論尚未出" is the only reason text.

### 2.4 Verdict words `進行中` / `待命`, counts, execution table, execution toast
W = dispatcher manifests + probes (1). P = watcher counts (`runs-watch.js:112-127,483`). R = `model.ts:328`, pane rows `model.ts:260`, toast `model.ts:334`. **Fires: yes** for dispatcher leaves, but only while a leaf is live; `待命` is the default for everything else (inline work, native Agent foremen, between dispatches). A dev-flow/l3/l4 session mostly shows `待命 · 沒有派工在跑` while working.

### 2.5 Progress `62.5%（5/8）` / `n done*`, and review-page 進度 section
| link | code | fires | evidence |
|---|---|---|---|
| W | `controller_progress_receipt` is built by `src/engine/controller-execution.js:451-498` and appended at `autopilot-engine.js:6533-6560` (initial), `campaign-composition.js:1225-1270` (per round), `autopilot-engine.js:9300-9335` (completion). Only the managed implementation **campaign** path (`/l5`/`/l6` managed schema-2). Not /l3, /l4, dev-flow | yes for managed campaigns | code |
| S | **embedded**, not a file: `controller.progress_receipts[]` inside `<git-common-dir>/autopilot/work-orders/campaign-v1-<hash>/<node>-aN.json` (checked a real file: `.controller.progress_receipts` length 2, last phase IMPLEMENTING). `status task` does not expose it (grep progress in src/status: none outside runs-watch) | file exists, no extractor | ran node on `.git/autopilot/work-orders/campaign-v1-b4ce.../next-touch-debt-retirement-a2.json` |
| P | watcher passes `progress: null` (`runs-watch.js:394`). `--progress-receipt <file>` only on the manual CLI (`render-review-page.js:850-853`), and nothing creates that file | **no** | code |
| R | `render-review-page.js:76-93` `buildProgress` (requires `receipt.root_run_id === job root`, line 78). Real receipt root = campaign id (`autopilot-engine.js:6220`), which equals the manifest root of campaign leaves (manifest grep shows `campaign-v1-...` roots) so the match is achievable once someone extracts and passes it. `model.ts:176-181,309`, band | reader fine, **never fed** | code |
=> for every work mode `—` today. `3 done*` / `%` never.

### 2.6 Phase (band and page chip `階段：…`)
| link | code | fires | evidence |
|---|---|---|---|
| W | RENDER-R `scripts/render-review-page.js` `buildPhase` (diff in wt-r `6e40bcc4`): (1) VALID terminal campaign entry of the task receipt, (2) first open deliverable of the progress receipt, else null. Live campaign phase is unreachable (campaign live state `<git-common-dir>/autopilot/implementation-campaign.jsonl`, keyed by hash id; no root->campaign mapping, per the evidence README "C3b") | both sources are empty today (2.5, 3) | wt-r diff |
| W (dev-flow L-1..L-5, plan P0..P4) | prose only; no writer. Adding one edits dev-flow SKILL.md (guidance change, needs eval evidence) | no | evidence README |
| P/R | model.json `phase` -> `model.ts:317-318`, `model.ts:220` | **band phase is `—` in every mode today** | derived |

### 2.7 Acceptance axis (`ACCEPTED / PENDING`, review-page conclusion, acceptance toast, 驗收結論 sentence)
| link | code | fires | evidence |
|---|---|---|---|
| W | `status task --root-run-id` (`src/status/cli.js:487`, `task-runtime.js:150-184`) reads an **input bundle** `${AUTOPILOT_TASK_STATUS_DIR:-$TMPDIR/autopilot-task-status}/<root>.json`. Docs say "the caller persists" it (depth0-control-loop.md:324, hetero-dispatch.md:313). **No code writes it**: grep for `autopilot-task-status` outside the reader finds only those two doc lines; docs/HANDOFF.md:103 states "that input bundle has no producer in the whole repo" and the BACKLOG row `two-l5-deliverables-...md:11` is open. `/tmp/autopilot-task-status/` does not exist; my own `status task` call returned `TASK_STATUS_INPUT_UNAVAILABLE` | **no** (finish-flow L-5.3 / session-mode clear also depend on it, so a human currently force-retires markers) | ran command; ls |
| P | watcher polls `callTaskStatus` each tick for roots with live runs (`runs-watch.js:329-348`, 15 s settled poll). rc!=0 -> digest `'unavailable'`, task null | polls fire, always fail | code |
| R | `render-review-page.js:71-74,150-160`; `model.ts:285-291`, `model.ts:340` acceptance toast | reader fine; acceptance is always `unknown` -> `PENDING`, the toast never fires (`previous.acceptance` never changes) | derived |
Note: the page text even says "無 receipt -> 本回合尚無驗收 verdict" (NO_VERDICT_SENTENCE), so the page is honest, but it will say that for every job.

### 2.8 Gate rows (`MATCH / 舊候選 / LIVE GATE · 未綁定候選`)
| link | code | fires | evidence |
|---|---|---|---|
| W | `scripts/hetero-review-loop.js:1262,1341` writes `<ledgerDir>/receipt-<phase>.json` (code loop of `/hetero-review`, /l5 /l6 review) | yes for runs that pass a ledger | code |
| S/P | joined through manifest `ledger` -> receipt dir (`render-review-page.js:386-409`); watcher re-renders when a receipt appears/changes mtime (`runs-watch.js:355`) | **yes**, but only manifests with a non-null `ledger`: 5 of 219 on this host | `grep -l ledger` |
| R | `render-review-page.js:95-127` `gateRow`; `model.ts:292-297`; `pane.tsx:44-45` | yes where ledgers exist. Without a task receipt every row reads `LIVE GATE · 未綁定候選` (by design) | code |

### 2.9 Elapsed (`38m`)
`model.ts:159-171` = now minus the **earliest `started_at` of every row in the scope's envelope**. With root=null (the normal case, 1) the scope is the whole project and includes exited rows; manifests are never aged out by the watcher (`dispatch-status.js --reap` default 7 d, manual only; unknown whether any hook runs it). So elapsed can read "2d5h" meaning "oldest manifest of this project", not "this job". Fires: yes, wrong meaning (gap 6).

### 2.10 Project name
`model.ts:148-156` from `repo_identity` (`git-common-dir:/.../name/.git`). Fires: yes when envelope exists (`runs-watch.js:474-476` backfills identity). A worktree gives the common-dir repo name, fine.

### 2.11 Cost and context (pane header)
| link | code | fires | evidence |
|---|---|---|---|
| W cost | `hooks/cost-tracker.js` (default-on since v2.35.15, hooks.json:191) appends `~/.claude/metrics/costs.jsonl` (live row for this session at 23:16 today) | yes | tail of file |
| P cost | `runs-watch.js:152-205` incremental read -> envelope `sessions{}` for sessions active in 24 h or holding a marker, plus `host_today_usd` (all projects) | yes while a watcher lives | code |
| W context | `<live>/context/<sid>.json` written **only** by the user's `statusLine` command: codeforge here (`~/.claude/settings.json`), or `scripts/statusline-live-tee.js` if the user wires it (opt-in; hooks/README.md:299-319). Files exist on this host (`/run/user/1000/autopilot/context/*.json`) | yes here; **unknown / no on a host with another status line** (shows `ctx —`) | ls |
| R | `model.ts:236-258`; reads `.../context/<sid>.json` with 120 s staleness bound (`CONTEXT_MAX_AGE_MS`) | yes here | MOD |
Cost is shared (any CC host with the default-on hook); context is host-config dependent.

### 2.12 Link to the job page
`register.ts:159-169` `jobOf`, `findJobDate`, `reviewLink`; `model.ts:358-361`. Needs the job dir to exist under `<home>/review/<key>/<date>/<job>/`: written by the watcher render (`runs-watch.js:360-411`) and the review server (`ensureReviewServer`, started by the watcher `runWriter:739`, requires python3 + flock, port 8787 default). Before the first render the link degrades to the project index. Fires: yes after a root exists. Mismatch: link = job of the **most recently started row** (`model.ts:346-356`), while counts/elapsed are project-wide (gap 6).

### 2.13 Review-page `--planned` list and `--compare` images, review-page conclusion
- planned: W none (no skill/script writes a planned list; grep). P `planned: null` (`runs-watch.js:394`). R `render-review-page.js:174,252-256` ("沒有規劃清單輸入"). **no**.
- compare: W none for `compare-record.json` (schema `schemas/compare-record.schema.json` exists; only the renderer and tests mention it, references/review-page.md describes an "image-review seat" procedure but no skill executes it). P `compare: []` (`runs-watch.js:394`). R `render-review-page.js:260-282,411-454`. **no**. Plan also records images are blank over ssh+tmux (references/mods.md), so this is a browser-only surface.
- conclusion: always the fixed no-verdict sentence (2.7).

### 2.14 Gap in "decided on your behalf" (P5, not built)
`skills/ceo-agent/references/depth0-control-loop.md:406` is the only writer of `decision` rows and has never produced a file (evidence README, c4 research). Rows carry no `root_run_id` / `repo_identity`; no canonical location; no seen-mechanism. Reader planned, writer absent (already known). Same family as 2.1: **two** reader-with-no-writer chains, not one (2.1 is the other).

## 3. Key questions, answered
1. Who writes `--decision`? Nobody. Does the watcher pass anything? Only `task` (`runs-watch.js:391-394`); `decision/progress/planned/compare` are literals null/[]. `要你決定` can never appear.
2. `controller_progress_receipt`: produced inside managed `/l5 /l6` campaigns only (`autopilot-engine.js:6533`, `:9320`, `campaign-composition.js:1235`), stored inside work-order JSON, root = campaign id. Neither the watcher nor `status task` extracts it. /l3, /l4, dev-flow: never produced (no engine). So `n done*` / `%` never.
3. `task_status_receipt`: watcher polls (`runs-watch.js:329`) but the input bundle has no producer, so every poll fails today. A job has a `root_run_id` whenever any dispatcher manifest exists (own id if no parent, `dispatch-hetero.sh:1906`); session-mode marker root is null in practice (`session-mode.js:489`). Fraction of normal work with a job page: only work that launches `dispatch-hetero/review/author` (and whose manifest carries `repo_identity`). dev-flow S/L inline, /l3, native-Agent /l4: no job page; the band shows `待命` or `no project`.
4. `--planned` / `--compare` writers: none.
5. `sessions{}` cost: yes (watcher + default-on hook). Context file: written by the host `statusLine` only (codeforge here; `statusline-live-tee.js` opt-in elsewhere).
6. Watcher autostart for a normal session: no. Only `session-mode.js set` (l3-l6) starts it; where nobody ran `set`, a session has no pointer/paths file and the band shows `no pointer` or `no project` (register.ts:136-148). `session-mode.js set` also needs `flock(1)`.

## 4. Matrix: band fields per work mode (today = develop + MOD + RENDER-R; "once-hooked" = if hooks.json gets `modules`)
| work mode | band shown at all? | verdict word | project | phase | elapsed | progress | reason |
|---|---|---|---|---|---|---|---|
| dev-flow S/L inline, no `/lN` | no: no marker, no watcher -> `no pointer` / `no project` | never | never | never | never | never | `no project · run: autopilot status runs --watch` |
| /l3 inline (marker, watcher up, no dispatches) | yes | `待命` | real | `—` | `—` (no rows) | `—` | 沒有派工在跑 |
| /l4 native Agent foreman, no script dispatch | yes | `待命` (foreman invisible) | real | `—` | `—` | `—` | 沒有派工在跑 |
| /l4 or /l3 that calls dispatch-review / dispatch-author | yes | `進行中` while a leaf runs, `疑似卡住` if quiet >180 s, else `待命`; roots fragment: each ad-hoc dispatch = its own job | real | `—` | project-wide oldest-manifest age | `—` | N 個派工在跑 / Nm 沒有輸出 |
| /l5 managed campaign | yes | `進行中` / `疑似卡住` / `待命`; never `完成待驗收` or `要你決定` | real | `—` (live campaign phase unreachable; deliverable phase needs progress receipt, not passed) | project-wide | `—` | as above |
| /l6 managed campaign | same as /l5 | same | real | `—` | project-wide | `—` | same |
Review page for every mode: header + 派工 table (real), gate rows (only where a manifest has a `ledger`), conclusion = fixed "尚無驗收 verdict", progress = "沒有 receipt", planned = "沒有規劃清單輸入", compare = "沒有 compare-record", decision = "知會：目前沒有待你決定的事項" (a false-calm message: the page cannot know).

## 5. Gap list (ordered by impact on the owner's goal)
| # | broken link | owner sees | smallest fix | side | size | SKILL.md / guidance? |
|---|---|---|---|---|---|---|
| 1 | `status task` input bundle has no producer (`task-runtime.js:150`; HANDOFF.md:103; no `/tmp/autopilot-task-status`) | acceptance always PENDING, no `完成待驗收` ever (also blocks `session-mode clear`, finish-flow L-5.3) | a script/engine step that writes the bundle at campaign terminal / each deliverable transition (the shape `buildTaskStatus` already defines) | writer | M | mechanism (finish-flow already asks for the bundle; making it actually happen is mechanism per CLAUDE.md) |
| 2 | watcher publishes `progress/decision/planned/compare = null/[]` (`runs-watch.js:394`) and nothing extracts the progress receipt from `work-orders/campaign-v1-*/*.json` | `—` progress and phase for /l5 /l6 even though the engine computed them; no `n done*`/% | publisher: reader that picks `controller.progress_receipts[-1]` for the root (match `receipt.root_run_id`) and passes it to `assemble` as `progress` (+ a `decisions` hook point, see 3) | publisher | M | code only |
| 3 | no writer of the `--decision` file (and none of P5's decision rows) | `要你決定` never; page says "知會：目前沒有待你決定的事項" falsely calm | define ONE file `<review job dir or ledger>/decision.json` + a depth-0 writer step; watcher reads it into `assemble({decision})`. Decide this together with P5 (same "writer first" order); one canonical path serves both | writer + publisher | M | writer step in ceo-agent / level-front-door prose = guidance change, needs eval evidence; a `scripts/` helper the existing "ask the owner" gate calls would be mechanism |
| 4 | no phase writer: dev-flow stages / campaign live phase not recorded (README "C3b") | phase `—` everywhere; owner cannot tell "implementing vs reviewing" | live campaign phase: add a `root_run_id -> campaign_id` lookup in the publisher and read the controller `phase` field of the newest work-order (it exists: `progress_receipts[-1].phase`, e.g. IMPLEMENTING) | publisher | S-M | code only (dev-flow stage writer would edit SKILL.md = guidance) |
| 5 | watcher only started by `/l3-/l6` `set`; modules would draw `no project` in dev-flow and plain sessions | in the most common mode the band is a hint line, not a status | also start the watcher from a SessionStart hook (default-on is a cost decision) or have the mod fall back to a `status runs --watch` hint with the one-liner; worktree sessions still need a paths file | publisher/hook | M | hook = mechanism; touches hook inventory |
| 6 | band scope mismatch: counts/elapsed from the project-wide envelope, job model from the most recently started row (`model.ts:193-230,346-356`); elapsed = oldest manifest of the project, never aged out; each ad-hoc dispatch is its own root (`dispatch-hetero.sh:1906`) | elapsed like `2d5h` for a fresh task; jobs fragment into one page per dispatch | reader: elapsed from the newest root's rows or only live+recent rows; publisher: have depth-0 export one `AUTOPILOT_ROOT_RUN_ID`+`PARENT` for ad-hoc work (marker root is null, `session-mode.js:489`) | reader / writer | S (reader) | code only |
| 7 | `--planned`, `--compare` have no writers (compare-record shipped as schema + renderer only) | page sections permanently "沒有…" | decide whether they stay manual-only; if the owner wants them, one writer each, else drop from the page to avoid dead sections | writer | S each | image-review seat is a prose procedure, guidance |
| 8 | stall words only from dispatcher manifests; native Agent / inline work is invisible | `待命` while a foreman is working | no cheap fix: needs a heartbeat source (e.g. foreman writes a liveness file `watch-foreman.js` already reads?) unknown | writer | L | n/a |
| 9 | context file only from the host's statusLine | `ctx —` off this machine | document `statusline-live-tee.js` in the mod pane hint | reader (hint) | S | docs |

## 6. Built but unconsumed / future-connection risks
- `render-review-page.js` flags `--decision --planned --compare --progress-receipt --task-receipt`: tested (hooks/tests/render-review-page.test.sh) but have **no real caller**; the watcher is the real caller and uses none (`only-in-tests`).
- `buildProgress` per-deliverable table, `renderCompare`, planned list: no real input path (above).
- Acceptance toast (`model.ts:340`): unreachable until gap 1.
- Mod ignores `status task` failures silently: `pollTask` caches `'unavailable'` (runs-watch.js:333-336) and the page just shows the no-verdict sentence; nothing tells the owner the verdict source is broken (looks like "not yet", is actually "never").
- P5 decision ledger: row has no `root_run_id`/`repo_identity`; the page's `decision` model is a different object (open question). Plan §P5 order (writer, publisher sidecar, display) is the right one; connect it to gap 3's file so one `needs decision` path exists.
- P4 work-round: `status work-round` (plan line 157) wants `controller_progress_receipt`; today that data exists only inside work-order JSON, so gap 2's extractor is shared with P4. Build it once as a function in `src/status/` and have the watcher and P4 both call it.
- Review-page "unbound" job (`runs-watch.js:363`) collects rows with no root; the mod's `jobOf` maps to it only when no row has a root.
- `reap` of old dispatch manifests is not wired to the watcher; elapsed (gap 6) and counts grow with history.

## 7. unknown
- Whether `/l4` foremen call dispatch scripts often enough to give `進行中` in practice: unknown (no live run observed).
- Real tmux rendering of the band: unknown (S9 uses test-kit trees per the evidence README).
- Whether any existing hook auto-reaps `/tmp/autopilot-dispatch-runs`: unknown (not found in grep of hooks; `--reap` is manual).
- Whether v2.37.0 will pass `--task-receipt` or add a task-input producer: not in plan rows I read.
