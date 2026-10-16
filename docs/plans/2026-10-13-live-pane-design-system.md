# Live pane design system — one IA, one visual vocabulary, enforced in code

Status: **frozen** (2026-10-13) after two plan-review generations (§10, §10.2, §10.3; receipts in [`evidence/2026-10-13-live-pane/plan-review/`](evidence/2026-10-13-live-pane/plan-review/README.md)). Ready for P0; no product code changed yet. Amended in place on 2026-10-16 by [§12](#12-revision-2026-10-16-the-semantic-palette) (colour and emphasis only; where §3.2, §3.4 and §3.6 differ from §12, §12 wins). The dispatch tree (formerly P6) moved to [`2026-10-13-dispatch-tree.md`](2026-10-13-dispatch-tree.md).
Scope: the live mod's pane (`mods/live/pane.tsx`, `mods/live/model.ts`) and the glyphs it shares with the band (`mods/live/band.tsx`).
Builds on the approved TUI v2 design: [`evidence/2026-10-10-tui-v2/ia.md`](evidence/2026-10-10-tui-v2/ia.md) (colour semantics, glyph vocabulary) and [`i18n.md`](evidence/2026-10-10-tui-v2/i18n.md).

## Why this plan exists

The owner on the current pane: 「你不會覺得這還是很亂嗎？想辦法講一致化的 IA / design system，TUI 應該也做得到吧？」

A design already exists. `ia.md` gives every theme key one meaning and every concept one glyph. The problem is that it lives only in a document. Tab builders call the raw primitives (`seg`, `row`, `rule`, `kv`) and pass colours, glyphs and indentation directly, so each feature added after 10-10 picked its own header form, its own indent, its own glyph and its own number format. A second document would drift the same way. This plan moves the vocabulary into one module that tab code must use, and adds a render test that fails when a tab breaks a rule.

## 1. Diagnosis

Checked against the code at `5a2706ad` and the owner's screenshots of 現況, 派工, 審查 and 用量 (2026-10-13). "Rule" points at the section of this plan that fixes the problem.

| # | Problem (what the owner sees) | Cause in code (`mods/live/model.ts` unless noted) | Rule |
|---|---|---|---|
| 1 | Three section-header forms: `▌ 待你處理`, `▾ 目前位置`, and bold lines with no header at all (`任務 39/39 完成`, `代你決定 3 件`) | `rule()` 1653 without `fold`; `section()` 1666; bold `PaneLine`s built in `buildSections` 1030/1042/1057. `buildSections` runs on the register tick with no `ctx`, so it **cannot** call `rule()`: `PaneSections` carries already-drawn lines | §4 header, §6 (sections become data) |
| 2 | The section accent `▌` is orange | `rule()` 1654 colours it `claude`, which `ia.md` reserves for "you are here" | §3.6 |
| 3 | Indentation off any grid: 1, 2 and 3 leading spaces | `review.no_verdicts` 2226 (2), `review.none_decided` 2260 (1), hygiene command 2340 (3), dispatch note 2183 (1), run id 2148 (1), recent body 1900 (2) | §3.1 grid |
| 4 | `●` means running, seat done, seat unknown and plan review active | `seatRows` 2208, `activityLines` 2012, the plan-review badge 2223 | §3.2 states |
| 5 | Every seat is a grey `●` whatever its verdict | `verdictMark` 1672 matches only `pass/ok/accept/…` and `open/fail/…`; `SHIP-AS-IS`, `FIX-THEN-SHIP`, `CONDITIONAL`, `READY`, `STOP` fall through to grey, so `seatRows` 2206 never sees "done" | §3.3 mapping table |
| 6 | `▲` means needs you, QC owed, open review and the 80 % tick | `needsYouLines` 1729, `tabBadges` 1686, review rule 2232, spend tick 2282 | §3.2 |
| 7 | `⏸` draws as a blue emoji box (screenshot 4) | U+23F8 has the Unicode `Emoji` property, and so do `⚙` U+2699 (dispatch) and `⚠` U+26A0 (hygiene chip 663-666). Checked with `\p{Extended_Pictographic}` (all three match; `\p{Emoji}` also matches them but is unusable as a rule, see §3.4); a terminal may give any of them emoji presentation | §3.4 glyph rules |
| 8 | Raw machine tokens on screen: `reviewed`, `SHIP-AS-IS`, `FIX-THEN-SHIP`, `CONDITIONAL`, `READY`, `STOP`, `not_needed`, `full`, `rc 0`, `warn` mode, `[exited with code 0]` | `runState` 2114 prints `final_status`; `seatRows` 2209; `reviewTabLinesRaw` 2224/2233/2243; `spend.mode` 2295; the background tail 2013 | §3.3 (raw tokens only in detail) |
| 9 | Decision rationales: walls of English text plus full veto command lines (審查) | `buildSections` 1046-1047 pushes every row's full text and its `vetoLine` | §2.4 collapse, §4 `more` and `detail` |
| 10 | A plan review from 2026-09-16 shows `● 進行中` | plan badge 2223 looks only at `p.terminal`; `updated_at` is read (1073) but never aged | §2.5 freshness |
| 11 | 16 background commands drawn as running (`●`, blue) 5-6 hours after they exited (6 rows plus 還有 10 項) | `scanBackground` 1945 ends a task only on a notification that carries `<status>`. These tasks never got one. Their output files end in `[exited with code 0]`, which shows in the tail. Likely cause, not verified: the end arrives without a status, or compaction dropped it. `activityLines` 2012 colours every row `suggestion` regardless | §2.5 (an exit marker or a long silence ends the row), separate scanner fix |
| 12 | 派工: 32 finished runs become ~220 lines | `dispatchLinesRaw` 2143-2155: when `tableW > ctx.cols` (always, with ~30-cell run ids) every run becomes a 6-7 line key/value block; finished runs are never collapsed | §4 `table`, §2.4 |
| 13 | Empty states: `沒有資料 · …` in the label column, twice in a row (目前位置) | `NO_DATA` 1567 is a whole line at column 0; `nowLinesRaw` 1763/1769 pushes two | §4 `empty` |
| 14 | Number formats: `117 %` vs `115%`; `8h5m`, `6h4m 前`; `39*`; `+$722.17` next to a "today" figure | `pct + ' %'` 2281 vs `pct + '%'` 1803; `ageText` 280 does not pad minutes; `progress.unfrozen` uses `*`; the `+$722.17` is `hourly.reduce` 2299 over a **rolling 24 h** window. The history file has yesterday's $993 day in that window, so the figure is correct but carries no window label | §3.5 formats |
| 15 | `suggestion` (= running) colours charts and toggles | brain share bar 2290-2291, sparkline 2302, recent `▸` 1896 | §3.6 |
| 16 | 現況 repeats 用量 and 帳號; the header differs between 現況 (verdict + reason + metrics) and the other tabs (metrics only) | `nowLinesRaw` 1749-1752 and 1799-1806; the other tabs push only `snap.header` (2122, 2219, 2271, 2315) | §2.2, §2.3 |
| 17 | The reason line is cut (`…32 件派工無決策紀`) and every rule runs to the right edge | `wrapLine` 1576 wraps any line wider than `cols`, and `rule()` 1656 stops one cell short of `cols`. Both symptoms fit `bodyColumns` being **at least 2 cells wider than the drawable area**. **[unverified]**: P0 measures it | §7 P0 |
| 18 | Two tabs look highlighted (派工 focused, 現況 active) | The d.ts (CC 2.1.296, `ButtonProps.plain`, ~line 1108) says "the focus and the pointer still invert it"; `$.ui.focus` (~2550) says "the engine's inverse marks it". The surface inverts the focused Button, so it reads like a second background next to the active tab's `subtle` background | §5 Q1 |
| 19 | 殘留 listed 17 lane worktrees as unintegrated although their commits were on `origin/develop` | the producer measured integration against the main checkout's local `develop`, 54 commits behind its upstream (`scripts/repo-residue-sweep.js`, default `integrationRef`). The producer is already fixed (`dc30d96c`, `793880e6`: the default target is the newer of the local branch and its remote-tracking upstream; the stale-develop case is in `hooks/tests/repo-residue-sweep.test.sh`). Not verified: whether the owner's screenshot predates that fix | §5.5, P5 |

Reading 18 against the code also explains a related trap: moving the focus ring onto the active tab would put the engine's inverse over a `subtle` background, and the 10-06 spike found that combination unreadable.

## 2. Information architecture

### 2.1 One question per tab, ordered by urgency

| Tab | The one question | Order inside the tab |
|---|---|---|
| 現況 | What do I need to do, and where is the work? | needs you → position → one row per other tab → live background work → unfinished tasks → recent prompts (history) |
| 派工 | Who is running, and how did the runs end? | running and stalled → finished (latest 5, rest collapsed) → one pointer row to 審查 (a projection, §2.6) → snapshot note |
| 審查 | Can this be pushed, and what was decided for me? | code review → pre-push QC → review pages (gates) → decisions made for you → plan review (folded when stale) |
| 用量 | How much have I spent, and how much is left? | limits (brain cap, 5 h, 7 d) → today's breakdown → last 24 h → account |
| 殘留 | What do I have to clean up? | needs you → automatic cleanup → plugin load source |
| ? | What does each mark mean? | states → structure glyphs → keys (generated from the token tables) |

Within every section the order is the same: things that need you, then live things, then finished things.

### 2.2 The global header: identical on every tab

```
✓ 完成待驗收  autopilot · 已進行 8h05m
工作階段 $100.72 · 本機今日 $216.44 · ctx 22%
```

Line 1 is the verdict glyph and word (bold, in the verdict's state colour), the project (bold) and the elapsed time (dim). Line 2 holds the metrics (dim). The two spend figures are typed projections of facts owned by 用量 (`spend.session`, `spend.local_today`, §2.6), drawn by the money formatter with their `fact` tag. At ≥ 110 columns, if both fit with a gap of at least 4 cells, they merge into one line with the metrics right-aligned. The verdict's reason does **not** go in the header. In 現況 it becomes the first item under 要你處理 (when it asks something of the owner) or the first row of 位置. A test asserts that the header lines are byte-identical across the five content tabs (§6, I9).

### 2.3 What 現況 keeps and what it hands off

| Today in 現況 | New home | 現況 keeps |
|---|---|---|
| 今日花費 section (spend bar) | 用量 | one 用量 row for the most-used of the three limits (brain cap, 5 h, 7 d): a 10-cell meter, the percent and the amount (one fact, `usage.limit_max`) |
| 帳號 section (account, org, quota windows) | 用量 (帳號, 額度) | nothing; the band's quota slot then opens 用量 instead of 現況 (`SLOT_TAB` 1548, `slotUnfolds` 1550) |
| 執行狀況: 派工 / 審查 rows | summary rows | 派工 › and 審查 › rows, one line each |
| background rows (all of them, live or not) | — | live rows only; ended ones behind `▸ N 項已結束` |
| task list with 39 `[x]` rows | — | unfinished tasks only; finished ones behind `▸ N 項已完成`; `[x]`/`[~]`/`[ ]` become state glyphs `✓`/`●`/`○` |
| reason line under the verdict | 要你處理 / 位置 | as an item, never a free line |

Each summary row is a key/value row whose key is the tab name plus `›`. Pressing it switches to that tab. This reuses the toggle Button path that `pane.tsx` already draws for `toggle` lines; the line gets a `goto: PaneTab` field and `pane.tsx` calls `onTab`. It needs no new surface capability.

Rule for 要你處理: **the verdict describes the work, the needs-you list describes your actions.** `完成待驗收` keeps its `✓` (the work is done), and the list carries `▲ 任務 39/39 都完成，等你驗收` (the owner has to act). See Q4.

### 2.4 Collapsing: what folds by default

Owner rule (2026-10-13): **by default every item is one short line, in a fixed order, in a fixed format; details open only when asked.** Concretely:

- One item = one line. A second line (`└` detail, `$` command, a reason in prose, a path) is never drawn by default; it sits behind the item's own `▸`.
- A list longer than 5 shows the 5 most urgent, then `▸ 還有 N …`. Items of the same kind and the same reason are grouped into one line with a count (`▲ 12 個 worktree 已整合，可清理 · 280 MB`) before the 5-cap applies.
- Within a section the order is fixed: needs you → live → finished, and inside each group newest first.
- Commands are detail. When a group has one action for all of its items, the group's detail shows one command for the group, not one per item.

| Thing | Shown | Behind a `more` toggle |
|---|---|---|
| finished dispatches | the latest 5 | the rest, `▸ 還有 27 筆已完成` |
| decisions made for you | one line each, clipped (id + first words) | full text and the veto command, per decision |
| finished tasks | none | all, `▸ 39 項已完成` |
| ended background work | none | all, `▸ 16 項已結束` |
| seats | one line each (state + id + family) | the raw verdict token and status |
| residue items | one line per group (state + kind + reason + count + size), at most 5 groups | per group: the items (one line each: name · age · size); per item: the reason detail and the cleanup command |
| plugin load source | one line (`✓ dev · v3.0.0-alpha.6`, or `▲ 落後 upstream 54` when behind) | marketplace, flags, cache dirs, live pids |

### 2.5 Freshness: when a live thing stops being drawn as live

The rules apply in the model, before any glyph is chosen. A line can only show `●` if the item is fresh.

| Item | Rule (data already published; `now` and every time in ms) | Drawn as |
|---|---|---|
| background command | its last output line matches `^\[exited with code (\d+)\]$` | `✓ 完成` (code 0) or `✗ 失敗` (non-zero), moved behind `▸ N 項已結束` |
| background command | no exit marker and `quietMs > 1_800_000` | `◌ 已停 · 6h04m 前有輸出`, behind the same toggle |
| plan review | not `terminal` and `now − updated_at > 86_400_000` (F2) | section header `◌ 已停 · 2d00h 前`, folded by default, moved to the bottom of 審查 |
| plan review | `terminal` and `now − updated_at > 604_800_000` | one dim line inside 審查's history; no section |
| plan review | not `terminal` and `now − updated_at > 604_800_000` (F6) | one dim line, `計畫審查 {id} 在 {ago}停下，沒有收尾`; no section (it stopped; it did not end) |
| code review | not converged and `now − at > 86_400_000` | `◌ 已停`, same treatment |
| dispatch row | finished (`rc` or `final_status` set) and `now − (started_at + elapsed_s·1000) > 21_600_000` | counted in the header chip only, not listed |

Every comparison is strict (`>`): an item exactly at its threshold is still fresh, one millisecond past it is stale. The six timed predicates are named F1 (background quiet, `FRESH_MS.quiet` = 1_800_000), F2 (non-terminal plan review, `FRESH_MS.planReview` = 86_400_000), F3 (terminal plan review, `FRESH_MS.terminalPlan` = 604_800_000), F4 (code review, `FRESH_MS.codeReview` = 86_400_000), F5 (finished dispatch, `FRESH_MS.dispatch` = 21_600_000, six hours since BL-0149) and F6 (non-terminal plan review untouched, `FRESH_MS.abandonedPlan` = 604_800_000); F3 and F6 happen to share a value but not a name. The exit marker is not a timed predicate: X0 (marker with code 0) and X1 (marker with a non-zero code) are two untimed branches. `classify` (§3.3) uses the same predicates, so the table and the classifier cannot disagree.

`FRESH_MS` lives in the ui module (§6), not in each tab.

### 2.6 Ownership: every fact has one home tab (answers G1 R2)

Each fact has exactly one **owner tab**, where its rows, its raw detail and its verdict live. Any other tab may show it only as a **projection**: a line that points to the owner, derives its state from the same `stateOf` call, and carries no detail of its own.

| Fact | Owner | May be projected on | Projection carries |
|---|---|---|---|
| run lineage, run state, age, engine and model (dispatch rows) | 派工 | 現況 | worst state, counts, last-ended age |
| code-review round, seat verdicts, pre-push QC, review pages (gates), plan review | 審查 | 現況, 派工 | worst state, a count, the round id. **Never** a seat row, a verdict word or a QC state. 現況's one review row is the code-review round (`review.round`): state, round id, count of seats with findings |
| decisions made for the owner, escalation ladder, undocumented dispatch count | 審查 | 現況 | a count |
| background commands, tasks, recent prompts, stage walk, needs-you list | 現況 | none | n/a |
| brain cap, 5 h and 7 d quota, hourly history, account | 用量 | 現況 | the most-used limit: percent and amount (`usage.limit_max`) |
| spend totals (`spend.session`, `spend.local_today`) | 用量 | the global header | the two totals only: no window label, no freshness stamp |
| residue groups, cleanup, plugin load source | 殘留 | 現況 | worst state, count, size |
| global header (verdict, project, elapsed, ctx) | `pane.tsx` | n/a | drawn once, above every tab; its spend segments are the projection above |

Rules:

1. A projection is a `kv` or `item` line with `goto` (§4) and a `fact` tag. A line whose `fact` is owned by another tab without `goto` is a defect.
2. A projection is one line per fact. It never lists the owner's rows.
3. 派工 draws no review verdict. Its former 「審查關卡」 section becomes one pointer row, `審查 ›  <the code-review round, from the same reviewPointer() as 現況; §12.8>`, in a section 其他分頁.
4. The 要你處理 list in 現況 is the one place that mixes owners; each of its items is either 現況's own (tasks) or a projection with `goto`.
5. The ownership table is data in `ui.ts` (`FACT_OWNER`), and invariant I17 checks it (§6.3).
6. **Granularity is the fragment.** A `FactId` names one value set (`spend.session`, `review.round`, `usage.limit_max`). A body line carries exactly one fact, and a line that would show two is two lines (so the review row of 現況 drops QC and the 用量 row drops the second window). The one multi-fact line is the global header's metrics line, where each spend figure is its own fragment with its own `FactId`; that exception is stated here and in `verdictHeader` (§4) and nowhere else.
7. **Fact identity is mandatory on everything that carries data.** `kv`, `item`, `bullet`, `table`, `meter`, `chart`, a `header` chip, a section `detail` note, every badge and every `verdictHeader` fragment take `fact: FactId` as a required argument (§4; an attached `detail` inherits its item's). Body-line builders use two typed constructors: `ownerRow(fact, …)` (type-checked against the tab) and `projection(fact, …, {goto})` (`goto` required; the header's spend segments use `headerProjection(fact)`). A line cannot be built without a fact, so the tag cannot be omitted to dodge I17.

## 3. Tokens

### 3.1 Layout grid

Every body line starts at one of four columns (display cells; a CJK character is 2):

| Column | What starts there |
|---|---|
| 0 | section header, key of a key/value row, glyph of a list item or bullet or table row, the empty-state dash |
| 2 | text of a list item, table header, `more` toggle, standalone note, `└` of a detail line, `$` of a command |
| 4 | text of a detail or command line, including its wrapped continuation lines |
| 12 | value of a key/value row (`KEY_W` stays 12: zh labels up to 6 characters), and a seat `item` under the valueless `席位` key (§5.3) |

Wrapped lines hang at the column their own text started at. No line is wider than `cols`. A table's internal columns are computed per table, but its first glyph is at 0 and its header at 2.

### 3.2 Status vocabulary: ten states

A state is one glyph, one theme key and one zh word. Glyph and theme key are always together. The word is drawn too, except in two compact forms named here and nowhere else: (a) `item {word:false}` under a header chip of the same state (I21); (b) count badges in the band (`●2`, `⊘1`, `⚑1`; the tab strip's badges were replaced by the tab name's colour, §12.5), built only by `badge(stated, n?)` in `ui.ts` (I14). Glyph and word are coloured; the rest of the line is not.

| State | Glyph | Theme key | zh | en | Meaning |
|---|---|---|---|---|---|
| `need_you` | `▲` | `warning` (mark only, not bold; §12) | 要你處理 | needs you | a person must act |
| `failed` | `✗` | `error` | 失敗 | failed | ended badly (rc ≠ 0, rejected) |
| `stalled` | `⊘` | `error` | 疑似卡住 | stalled | should be moving and is not |
| `findings` | `△` | default text (§12) | 待修 | to fix | ended with findings someone else will fix |
| `running` | `●` | `suggestion` | 執行中 | running | moving now, and fresh |
| `done` | `✓` | `success` | 完成 | done | ended well |
| `pending` | `○` | `inactive` | 未開始 | not started | queued or still to come |
| `stopped` | `◌` | `inactive` | 已停 | stopped | not moving, no verdict, or stale |
| `skipped` | `∅` | `inactive` | 不需要 | not needed | nothing is owed |
| `unknown` | `?` | `inactive` | 未知 | unknown | a token missing from the mapping table; its raw text goes in detail |

The empty-state dash `—` (inactive) is not a state: it marks missing data.

The band's verdict keeps its five owner-approved words and maps them onto states for glyph and colour: 要你決定 → `▲`, 疑似卡住 → `⊘` (was `⏸`), 完成待驗收 → `✓`, 進行中 → `●`, 待命 → `◌`.

### 3.3 One mapping table from domain objects to states (answers G1 R3)

A domain object can satisfy several conditions at once (a run with `stall`, `rc` and `final_status`; a review round with findings and a running seat; a load source that is `dev` and behind). So the mapping has two steps, and the first one is an ordered classifier, not a lookup.

```ts
type Domain = 'verdict' | 'run' | 'seat' | 'round' | 'gate' | 'qc' | 'background' | 'task' | 'loadSource'
            | 'attention' | 'residueGroup' | 'cleanup'
stateOf<D extends Domain>(domain: D, subject: Subject[D]): Stated   // Stated is branded; only stateOf and worst make one
worst(states: Stated[]): Stated                                       // aggregate under SEVERITY; [] -> skipped
```

`Subject[D]` is the structured object the model already has (a `LiveRunRow`, a `ReviewRound`, a `LoadSource`), or a bare token for the token-only domains (`seat`, `gate`, `qc`, `task`, `verdict`). Step 1: `classify<D>(subject)` returns one **atom** by walking the precedence list below top to bottom; the first condition that holds wins. Step 2: `STATUS_MAP[D][atom]` gives the `StateId`. Token normalisation happens once, in `classify`: `trim()` then upper-case, and a prefix class (`NEEDS*`, `CACHE:*`) becomes one atom. An atom that is not in the map is `unknown`; the raw text goes to `detail`. `stateOf` and `worst` are the only producers of `Stated`, and the components accept only `Stated` (§6.1), so a tab cannot pick a state by hand.

| Domain | Precedence (first match wins) → state |
|---|---|
| verdict | `DECIDE`→need_you · `STALLED`→stalled · `WAITING`→done · `RUNNING`→running · `IDLE`→stopped |
| run (dispatch row) | 1 `rc ≠ 0`, or `final_status` in `failed / error / killed`→failed · 2 `rc = 0`, or `final_status` in `reviewed / done / ok`→done · 3 `final_status` present but in neither set→unknown (raw text to detail; it beats `stall` and freshness) · 4 `stall:true`→stalled · 5 no `rc`, no `final_status`, fresh→running · 6 never probed and `now − started_at ≤ fresh_bound_s`→pending (`○ 未開始`; 2026-10-13 depth-0 代擁有者決定：未探測且啟動未滿 fresh_bound_s 畫 ○ 未開始) · 7 otherwise→stopped. An ended fact (1, 2) beats `stall`; failure beats success when `rc` and `final_status` disagree |
| seat (code or plan review) | code: `SHIP-AS-IS`→done · `FIX-THEN-SHIP`→findings · `BLOCK`, `REJECT`→failed. plan: `READY`, `APPROVE`, `PASS`→done · `CONDITIONAL`, `STOP`→findings (Q5) · `REJECT`→failed. No verdict: status `running`→running, status `reviewed`→done, otherwise→unknown |
| round (code or plan review) | 1 stale (§2.5) and not converged→stopped · 2 any seat running→running · 3 any seat failed→failed · 4 any seat findings→findings · 5 all seats done, or `converged`→done. A round with findings **and** a running seat is `running`: the round is not over, and the findings count rides in the header chip's meta (`● 執行中 · 1 席已有發現`) |
| gate (`LiveGateRow.verdict`) | `PASS / OK / ACCEPT / APPROVED / CONVERGED`→done · `OPEN / OWED / NEEDS*`→need_you · `FAIL / REJECT / BLOCK`→failed |
| QC (`QcView.state`) | `OK`→done · `OWED`→need_you · `NOT_NEEDED`→skipped · `UNKNOWN`→unknown |
| background item | 1 exit marker `≠ 0`→failed · 2 exit marker `0`→done · 3 `quietMs ≤ FRESH_MS.quiet`→running · 4 otherwise→stopped. The marker beats the quiet clock |
| task | `COMPLETED`→done · `IN_PROGRESS`→running · `PENDING`→pending |
| attention (a 要你處理 item) | built from its source: a projection takes the state of its source domain through `stateOf`; the one item of its own, task acceptance (every task `COMPLETED`, none accepted)→need_you |
| residueGroup (scanner `class`) | `dirty`, `clean-integrated`, `clean-unintegrated`, `unintegrated-branch`, `missing-dir`→need_you (a group is listed only while it is owed) · `live`→running · `unverifiable`→unknown |
| cleanup (automatic-cleanup history row) | any `error`→failed · else any deletion or archive→done · nothing done→skipped |
| loadSource (source + `behind` + flags) | 1 source `CACHE:*` or `MISSING`→need_you · 2 `behind > 0`, or any flag→need_you · 3 source `DEV` or `DIRECTORY`→done. So `dev` + behind is `need_you`, which is what the 殘留 mockup draws |

Aggregates (the 各分頁 summary rows, a header chip, a tab badge over several rows) are made only by `worst(...)`, which takes the **worst** state under one total order, defined once as `SEVERITY`: `need_you > failed > stalled > findings > running > stopped > pending > done > skipped > unknown`. `unknown` ranks last so a missing mapping never hides a real finding, and it is still counted in the chip so it is not silent.

A raw token (`SHIP-AS-IS`, `reviewed`, `not_needed`, `[exited with code 0]`, `warn`) may appear **only** in a `detail` line, which the owner opens on purpose. Tokens that are identifiers, not states (run ids, engine and model ids, family names, shas, commands, paths), stay as they are: the i18n plan already keeps them untranslated. Residue classes (`dirty`, `clean-integrated`, `unintegrated-branch`, `missing-dir`) and the fuse mode get string-table labels (`有未提交變更`, `只提醒、不擋`).

### 3.4 Glyph rules

1. **No glyph that a terminal may draw as an emoji.** The test is `\p{Extended_Pictographic}`, not `\p{Emoji}`: the `Emoji` property also matches every ASCII digit, `#` and `*` (keycap-sequence bases), which would reject the pane's own numbers. Measured in Node: `⏸ ⚙ ⚠ ✔ ✖ ▶ ⏹ ⏺ ▪ ▫` are Extended_Pictographic; every glyph in §3.2 and the structure/chart tables (`▲ ✗ ⊘ △ ● ✓ ○ ◌ ∅ ◦ › ▾ ▸ └ ─ ━ ▰ ▱ ◐ ⚑ ↺ ◆`) is not. The explicit `EMOJI_BANNED` list repeats the ten above so the rule still holds if a Unicode update moves a property. It is checked on the glyph table and on glyph segments only, plus a separate check for the emoji variation selector U+FE0F and the keycap mark U+20E3 anywhere (§6, I5). Replacements: stalled `⏸` → `⊘`; dispatch count `⚙N` → `●N` (the running state, counted); the hygiene chip's `⚠` → `▲`.
2. **One glyph, one meaning, across band and pane.** Glyphs fall into three groups and do not cross: state glyphs (§3.2), structure glyphs (`▾ ▸` fold, `─` rule, `└` detail, `$` command, `›` go to tab, `◦` neutral bullet), and chart glyphs (`▰ ▱` meter, `▁…█` sparkline, `◐` "you are here" in the stage walk). `⚑N` stays as the residue count in the band and on the 殘留 tab badge only (owner-approved 10-10); the pane body uses `▲`. The strip's `▸` "next" chip (`pane.tsx` `tabStrip`) is the one exception left; P5 replaces it with `›` so that `▸` means only "folded".
3. **The stage walk uses state glyphs for its nodes:** done `✓` success, current `◐` claude, to come `○` inactive (`✓─✓─◐─○─○`), in the pane and in the band alike (the band drew a green `●` until 2026-10-16). `●` (running) never means "done node".
4. **Width.** `◐ ● ○ ▲ △ ◆ ─ ━ └ · …` are East Asian *Ambiguous*: a CJK-locale terminal may draw them 2 cells wide (the `ⓘ` comment at `model.ts` 1461 records this happening for `ⓘ` on the owner's terminal). The owner's screenshots show `● ▲ ─ · └ ◆ ▰ ▱ ✓ ▾ ⚑ ↺` at one cell. Every glyph that is new to the vocabulary, fallbacks included, must pass the real-terminal check in P0 before it ships: `⊘ △ ○ ◌ ∅ ◦ › ━ ◐ ◍`.

### 3.5 Number, time and money formats

The ui module owns one formatter per kind. Tab code never concatenates a unit.

| Kind | Format | Examples |
|---|---|---|
| money | `$` + 2 decimals, `,` from 1,000 | `$175.33`, `$1,024.00` |
| money aggregate | the window is named in the same row or header: 今日 / 近 24 小時 / 工作階段 | `近 24 小時  $722.17` |
| percent | integer, floored, no space | `117%`, `79%` (79.9 stays uncoloured; thresholds use the raw ratio, as `spendColor` 1385 already does) |
| duration | at most two units, minutes zero-padded after hours: `29s`, `5m`, `8h05m`, `4d04h`; ≥ 7 d as `27d` | |
| relative time | duration + the string table's direction word | `6h04m 前`, `2h10m 後重置` |
| clock time | `HH:MM` today, `MM-DD` otherwise | `01:42`, `09-16` |
| size | 1 decimal below 10, integer above | `2.0 MB`, `14 MB`, `1.3 GB` |
| sha | 8 hex characters; ranges `a..b` | `4abd667f..10c5c086` |
| identifier too long | cut from the **left**, keeping the unique tail | `…2031601-0e0c` |
| prose too long | cut from the right with `…` | |
| count | number first, then the measure word from the string table; never `N*` | `已完成 39 項 · 沒有固定總數` |

### 3.6 Colour and emphasis

**Superseded in part by §12 (2026-10-16): the palette table, the bold whitelist and the once-per-surface rule there replace the bullets below wherever they differ.**

`ia.md`'s colour table stands, with four corrections that bring the code back to it:

- `claude` only marks "you are here": the current stage node and label, the current unit cell, the active tab. The section accent `▌` goes away, and fold glyphs are `subtle`.
- `suggestion` only goes with the `running` state. Charts use default text, with `inactive` for the remainder; recent-prompt toggles use `subtle`.
- `warning` / `error` appear on a state glyph and its word, or on a meter bar and its percent. They are never used for a whole sentence.
- Backgrounds: none in the body. For the active tab, see Q1.

Emphasis:

- **bold** is used for a section title, the verdict word and project, the text of a `need_you` item, and the one headline value of a meter, plus two owner-approved exceptions: the current stage node and label (§3.4 rule 3) and the active tab label (Q1), both tagged `here`. Nothing else.
- **dim** is used for keys, units, ages, hints, notes, commands, detail lines, every line of a `stopped` item, and empty states.
- Never bold and dim on one segment. Never more than one bold value per line outside the header (a `here` node and its label count as one).

## 4. Components: the only line builders tab code may call

Components are of two kinds. **Line builders** (`header`, `kv`, `item`, `bullet`, `table`, `meter`, `empty`, `more`, `command`, `detail`, `chart`, `blank`, `verdictHeader`) return `PaneLine`s stamped with a `kind`, and the tests check per kind (§6). **Inline fragments** (`meterValue`, `badgeFragment`, `stateLead`, and the formatter results such as the spend figures) are branded `Frag` values with a `frag` tag and no `kind`: they exist only as arguments of a builder (a `kv` value, the strip, the band, the header's metrics) and never as a line of their own, so nothing nests a `PaneLine` inside another. A `PaneLine` or `Frag` can only be made by these components (§6.1: branded, unexported constructors). Components take a `Stated` (from `stateOf`, §3.3), never a raw `StateId` or glyph. Examples are at 76 columns.

**`header(title, right?, fold, {fact?})`** (kind `header`; a chip makes `fact` required): `▾`/`▸` (subtle), the title (bold), optionally two spaces and a right-hand chip (a state, a count or a meter level), then a `subtle` rule to `cols - 1`. Every section uses it, and every section folds, 要你處理 included (it never starts folded), so `▾ ▸` always mean the same thing.

```
▾ 程式碼審查  △ 待修 ─────────────────────────────────────────────────────
▸ 計畫審查  ◌ 已停 · 2d00h 前 ───────────────────────────────────────────
```

**`kv(key, …value, {fact, goto?})`** (kind `kv`): key dim, padded to 12 cells; value at column 12. An absent value is `—` followed by a dim reason; a `kv` built with no value at all is a bare key that heads the `item` rows beneath it (`席位`). The value may lead with one state glyph and word taken from the line's own `stateOf` / `worst` result (the 現況 summary rows do), or with a `meterValue` fragment; I17 allows no other state segment. `fact` is required (§2.6 rule 7). With `goto`, the key gets a trailing ` ›` and the whole row is a press target; the summary rows in 現況 are these.

```
輪次        R1 · 4abd667f..10c5c086
範圍        5a2706ad..HEAD · 沒有改到受保護檔案
```

**`item(stated, text, meta?, {fact, at: 0 | 12, goto?, toggle?, word?})`** (kind `item`): state glyph, the state word padded to the widest word in the list, the text, then dim meta after ` · `. A `toggle` puts `▸`/`▾` at the right edge of the row. The state word is required, with one exception: `word: false` is allowed only inside a list whose section header chip already names the same state (the 要你處理 list under `▲ 要你處理`, the 殘留 groups under their chip), so the word is never lost, only not repeated on every line. I21 checks that the chip state equals the item state. `group` (the grouping key: kind plus reason) and `ts` (sort time) are required fields of the row spec that `list()` takes (below); tab code does not call `item` or `bullet` for list rows directly.

```
▲ 1 個 worktree 要你處理                                            殘留 ›
席位
            ✓ 完成  s0 · anthropic                                        ▸
            △ 待修  s1 · zhipu                                            ▸
```

**`bullet(text, meta?, {fact, toggle?})`** (kind `bullet`): a neutral `◦` at column 0 for a row that has no state (a decision made for the owner, a residue item), text at 2, dim meta after ` · `. With `toggle` the right edge shows `▸`; open, it shows `▾` and the row's `detail` and `command` lines follow it. An opened row keeps its own bullet line; there is no separate bespoke header row.

**`list(rows, {cap = 5})`** and **`section(id, …)`** (no kind of their own; they emit `item`, `bullet`, `table`, `more` and `header` lines): every list of rows goes through `list()` (running dispatches, finished runs, unfinished tasks, live and ended background work, recent prompts, seats, decisions, residue groups, cleanup items). Each row spec carries `group` and `ts` as required fields; `list()` groups equal `group` keys into one counted row, orders by `SEVERITY` state (needs-you, live, finished) then `ts` newest first, applies the cap to the grouped rows, and appends the `more` toggle. `section()` takes sections by id and emits them in `SECTION_ORDER[tab]`, the order of §2.1 as data in `ui.ts`, so tab code cannot reorder or skip the header. No list is exempt from the cap.

**`table(columns, rows, {fact})`** (kind `table`). Each column has `{head, min, priority, flex?, cut: 'left' | 'right'}`. If the table is too wide, the lowest-priority column is dropped first; then the `flex` column is cut to fit (an identifier from the left); the remaining columns are cut down to their `min`. It **never** falls back to key/value blocks. The first column is always the state glyph and word.

```
  狀態    編號           角色      引擎 / 模型                已跑  結束
✓ 完成  …2418470-c58e  reviewer  claude-native / claude-fa…  1m    5h40m 前
```

**`meter(key, value, cap, {cells, label, fact, reset?: atMs})`** (kind `meter`, a full row; the same bar and percent as a fragment are `meterValue(value, cap, {cells})`): key, bar, percent right-aligned in 4 cells, then the amount, then, when `reset` is given, the relative-time formatter's result (`2h10m 後重置`). The bar and percent take the meter level's colour (< 80 % success, ≥ 80 % warning, ≥ 100 % error). The level word (正常 / 接近上限 / 已超過) is used only as a header chip. The separate `▲` tick line goes away.

```
brain 今日  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00
```

**`empty(reason)`** (kind `empty`): `—` at column 0, dim reason at 2. At most one per section (I10); two reasons merge into one line.

```
— 這個工作階段沒有記錄階段和單元
```

**`more(n, noun, id)`** (kind `more`): a toggle at column 2, dim. Open, it reads `▾ 收起`.

```
  ▸ 還有 27 筆已完成
```

**`command(text)`** (kind `command`): `$` at 2, the command dim at 4. It wraps at spaces and `/` and hangs at 4. It is never cut, because the owner copies it.

```
  $ git -C /home/u/proj worktree remove --force
    /home/u/proj/.claude/worktrees/hands-x
```

**`detail(text, {attached} | {fact})`** (kind `detail`): `└` at 2 when it belongs to the item above (it inherits that item's fact), plain at 2 when it is a section note (it then needs its own `fact`); text dim at 4. Under an item at column 12 both move right by 12. This is the only kind allowed to carry raw tokens.

```
  └ SHIP-AS-IS · reviewed · 1m
```

**Badges** are fragments with no word (§3.2 b), made by exactly two constructors: `stateBadge(stated, n?)`, which accepts only the `BADGE_STATES` `need_you` (`▲`, no count), `running` (`●N`) and `stalled` (`⊘N`) and takes the state's theme key; and `residueBadge(n)` (`⚑N`, the structure glyph, `warning`). Any other state is a type error. The strip and the band both call them, and each badge carries a `fact`.

**`chart(…, {fact})`** (kind `chart`): the stage walk and the sparkline. Each is a two-line unit, value line plus caption, both starting at column 12.

**`verdictHeader`** (kind `verdict`): the global header (§2.2), drawn by `pane.tsx` above every tab rather than by the tab builders. Its metrics are fragments, and each spend figure is its own `Frag` carrying its `FactId` (`spend.session`, `spend.local_today`).

Blank lines are made by `blank()` (kind `blank`, no text): exactly one between the global header and the first section, none inside the body, where the header rules separate sections (I10).

## 5. Mockups

The tab strip and global header are the same on every tab. They are drawn in full for 現況 and shortened to `‹strip + header›` elsewhere; at 120 columns `‹strip + header›` stands for the merged one-line header drawn in the 現況 mockup (§2.2). The strip's leading chip is `›` (P5 replaces today's `▸` with it). The active tab is shown as proposed in Q1: bold `claude` text with `━` under it in the strip's baseline, and no background. Data follows the owner's screenshots of 2026-10-13. Quota percentages, reset times and the residue row are illustrative.

### 5.1 現況

<!-- cols:76 -->
```
›  現況   派工   審查   用量   殘留 ⚑1   ?
──━━━━━━───────────────────────────────────────────────────────────────────
✓ 完成待驗收  autopilot · 已進行 8h05m
工作階段 $100.72 · 本機今日 $216.44 · ctx 22%

▾ 要你處理  ▲ 2 ───────────────────────────────────────────────────────────
▲ 任務 39/39 都完成，等你驗收
▲ 1 個 worktree 要你處理                                            殘留 ›
▾ 位置 ────────────────────────────────────────────────────────────────────
— 這個工作階段沒有記錄階段和單元
進度        已完成 39 項 · 沒有固定總數
▾ 各分頁 ──────────────────────────────────────────────────────────────────
派工 ›      ✓ 完成  32 筆 · 沒有派工在跑
審查 ›      △ 待修  程式碼審查 R1 · 1 席待修
用量 ›      ▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00
殘留 ›      ▲ 要你處理  1 個 worktree · 2.0 MB
▾ 背景工作 ────────────────────────────────────────────────────────────────
— 沒有背景工作在跑
  ▸ 16 項已結束
▾ 任務  39/39 ─────────────────────────────────────────────────────────────
— 沒有未完成的任務
  ▸ 39 項已完成
▸ 最近對話 ────────────────────────────────────────────────────────────────
```

<!-- cols:120 -->
```
›  現況   派工   審查   用量   殘留 ⚑1   ?
──━━━━━━───────────────────────────────────────────────────────────────────────────────────────────────────────────────
✓ 完成待驗收  autopilot · 已進行 8h05m                                    工作階段 $100.72 · 本機今日 $216.44 · ctx 22%

▾ 要你處理  ▲ 2 ───────────────────────────────────────────────────────────────────────────────────────────────────────
▲ 任務 39/39 都完成，等你驗收
▲ 1 個 worktree 要你處理                                                                                        殘留 ›
▾ 位置 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
— 這個工作階段沒有記錄階段和單元
進度        已完成 39 項 · 沒有固定總數
▾ 各分頁 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
派工 ›      ✓ 完成  32 筆 · 0 執行中 · 0 疑似卡住 · 最近一筆 5h40m 前結束
審查 ›      △ 待修  程式碼審查 R1 · 1 席待修
用量 ›      ▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00
殘留 ›      ▲ 要你處理  1 個 worktree · 2.0 MB
▾ 背景工作 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
— 沒有背景工作在跑
  ▸ 16 項已結束
▾ 任務  39/39 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
— 沒有未完成的任務
  ▸ 39 項已完成
▸ 最近對話 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
```

With live work, the 背景工作 section reads `● 執行中  等 P2 collect 完成 · 2m 前有輸出`, with its last output line as an attached `detail`. A command quiet for 6 h reads `◌ 已停  …` (dim), behind the `more` toggle.

### 5.2 派工

<!-- cols:76 -->
```
‹strip + header›

▾ 執行中 ──────────────────────────────────────────────────────────────────
— 目前沒有派工在跑
▾ 已完成  ✓ 32 ────────────────────────────────────────────────────────────
  狀態    編號           角色      引擎 / 模型                已跑  結束
✓ 完成  …2418470-c58e  reviewer  claude-native / claude-fa…  1m    5h40m 前
✓ 完成  …2418466-4b3d  reviewer  claude-native / claude-fa…  1m    5h40m 前
✓ 完成  …2418471-f03b  reviewer  qoderclicn / Qwen3.8-Max-…  37s   5h41m 前
✓ 完成  …2031597-f2e4  reviewer  cc-shim / GLM-5.2           5m    6h02m 前
✓ 完成  …2031596-3077  reviewer  claude-native / claude-fa…  1m    6h04m 前
  ▸ 還有 27 筆已完成
▾ 其他分頁 ────────────────────────────────────────────────────────────────
審查 ›      △ 待修  程式碼審查 R1 · 1 席待修
  這是執行狀態，不是進度 · 快照 01:42
```

<!-- cols:120 -->
```
‹strip + header›

▾ 執行中 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
— 目前沒有派工在跑
▾ 已完成  ✓ 32 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  狀態    編號                            角色      引擎 / 模型                             已跑  結束
✓ 完成  review-1791803964-2418470-c58e  reviewer  claude-native / claude-fable-5-1        1m    5h40m 前
✓ 完成  review-1791803964-2418466-4b3d  reviewer  claude-native / claude-fable-5-1        1m    5h40m 前
✓ 完成  review-1791803964-2418471-f03b  reviewer  qoderclicn / Qwen3.8-Max-Preview        37s   5h41m 前
✓ 完成  review-1791801313-2031597-f2e4  reviewer  cc-shim / GLM-5.2                       5m    6h02m 前
✓ 完成  review-1791801313-2031596-3077  reviewer  claude-native / claude-fable-5-1        1m    6h04m 前
  ▸ 還有 27 筆已完成
▾ 其他分頁 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
審查 ›      △ 待修  程式碼審查 R1 · 1 席待修
  這是執行狀態，不是進度 · 快照 01:42
```

With a live run, the 執行中 table adds a `最後回報` column (priority 3) in place of `結束`, and a stalled run reads `⊘ 疑似卡住` in `error`. At 40 columns the table keeps state, 編號 (cut from the left) and 已跑; the other columns are dropped in priority order.

### 5.3 審查

<!-- cols:76 -->
```
‹strip + header›

▾ 程式碼審查  △ 待修 ──────────────────────────────────────────────────────
輪次        R1 · 4abd667f..10c5c086
席位
            ✓ 完成  s0 · anthropic                                        ▸
            △ 待修  s1 · zhipu                                            ▸
            ✓ 完成  s2 · minimax                                          ▸
            ✓ 完成  s3 · alibaba                                          ▸
▾ 推送前檢查  ∅ 不需要 ───────────────────────────────────────────────────
範圍        5a2706ad..HEAD · 沒有改到受保護檔案
▾ 我替你決定的事  3 件 · 0 件不可逆 ───────────────────────────────────────
◦ verify-17-1  verify node, no qualified verifier seat (engine-s…         ▸
◦ intent-17-2  Owner answered (supersedes intent-17-1): directio…         ▸
◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/w…        ▸
沒寫理由    32 次派工
  計畫審查 blind-review-packet-2026-09-16 在 27d 前停下，沒有收尾
```

A decision opened by a press (`toggle` id `dec:<id>`). The bullet row stays where it was and gains `▾`; the rationale is an attached `detail` (`└` at column 2, text from column 4; prose, so it may hold English text) and the veto is a `command` (I23 pins this render):

<!-- cols:76 -->
```
◦ intent-17-1  可逆 · depth0                                              ▾
  └ #17 direction: A (keep the native <repo>/.claude/worktrees root for
    hand/native worktrees, no WorktreeCreate takeover; rail worktrees
    carry the repo slug; …). Owner did not answer within 60s; A is
    reversible and the smallest surface.
  $ decision-ledger.js veto --ledger /home/cookys/projects/autopilot/.git/
    autopilot/ledger/decisions.jsonl --id intent-17-1
```

2026-10-13 依 P1 實作更正：veto 斷點依 ui.ts 寬度規則、席位無時間（producer 不提供）。決定列同日改為最新在前（§2.4 優先於舊 mockup 的帳本順序；超過 5 筆時收進 `more` 的是最舊的）。

<!-- cols:120 -->
```
‹strip + header›

▾ 程式碼審查  △ 待修 ──────────────────────────────────────────────────────────────────────────────────────────────────
輪次        R1 · 4abd667f..10c5c086 · 4 席
席位
            ✓ 完成  s0 · anthropic                                                                                    ▸
            △ 待修  s1 · zhipu                                                                                        ▸
            ✓ 完成  s2 · minimax                                                                                      ▸
            ✓ 完成  s3 · alibaba                                                                                      ▸
▾ 推送前檢查  ∅ 不需要 ───────────────────────────────────────────────────────────────────────────────────────────────
範圍        5a2706ad..HEAD · 沒有改到受保護檔案
▾ 我替你決定的事  3 件 · 0 件不可逆 ───────────────────────────────────────────────────────────────────────────────
◦ verify-17-1  verify node, no qualified verifier seat (engine-scorecard current --role verifier: none admissible…    ▸
◦ intent-17-2  Owner answered (supersedes intent-17-1): direction C = A plus moving the dispatch-rail worktrees (h…   ▸
◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/worktrees root for hand/native worktrees, no Worktr…  ▸
沒寫理由    32 次派工
  計畫審查 blind-review-packet-2026-09-16 在 27d 前停下，沒有收尾
```

Seats are a valueless `席位` key (`kv` with no value) followed by one `item` per seat at column 12, each with its own toggle, at every width. Opening the first seat (I18, I23) shows its raw verdict as an attached `detail`; a detail under an item at column 12 moves right by 12 cells (`└` at 14, text at 16):

```
席位
            ✓ 完成  s0 · anthropic                                        ▾
              └ SHIP-AS-IS · reviewed
            △ 待修  s1 · zhipu                                            ▸
            ✓ 完成  s2 · minimax                                          ▸
            ✓ 完成  s3 · alibaba                                          ▸
```

Seats stack one per line at every width (no horizontal seat row exists in the component set). Opened, the stale plan review shows `計畫  blind-review-packet-2026-09-16 · △ 待修`, `輪次  ▰▱ R1／上限 2`, and its seats `✓ 完成 glm_architecture`, `△ 待修 codex_operations_skeptic`. The raw `CONDITIONAL`, `READY` and `STOP` sit in each item's detail.

### 5.4 用量

<!-- cols:76 -->
```
‹strip + header›

▾ 額度  已超過 ────────────────────────────────────────────────────────────
brain 今日  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00
5 小時      ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱   42%  2h10m 後重置
7 天        ▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   18%  4d04h 後重置
  brain 到 80% 開始提醒 · 保險絲只提醒、不擋
▾ 今日花費 ────────────────────────────────────────────────────────────────
本機        $216.44  所有層
brain       $175.33  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
其他層      $41.11   ▰▰▰▰
工作階段    $100.72
▾ 近 24 小時  $722.17 ─────────────────────────────────────────────────────
brain       ▁▁▂▃▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▁▁  尖峰 $301.57／小時
            一格一小時，最右是這個小時
▾ 帳號 ────────────────────────────────────────────────────────────────────
帳號        cookys@stranity.com (cookys)
組織        cookys@stranity.com's Organization · admin
方案        claude max · 20x
```

<!-- cols:120 -->
```
‹strip + header›

▾ 額度  已超過 ────────────────────────────────────────────────────────────────────────────────────────────────────────
brain 今日  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00
5 小時      ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   42%  2h10m 後重置
7 天        ▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   18%  4d04h 後重置
  brain 到 80% 開始提醒 · 保險絲只提醒、不擋
▾ 今日花費 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
本機        $216.44  所有層
brain       $175.33  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
其他層      $41.11   ▰▰▰▰▰▰▰▰
工作階段    $100.72
▾ 近 24 小時  $722.17 ─────────────────────────────────────────────────────────────────────────────────────────────────
brain       ▁▁▂▃▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▁▁  尖峰 $301.57／小時 · 一格一小時，最右是這個小時
▾ 帳號 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
帳號        cookys@stranity.com (cookys) · 組織 cookys@stranity.com's Organization · admin · 方案 claude max · 20x
```

Meter bars are 20 cells below 100 columns and 40 at or above. The share bars use the same scale as each other, so `brain` and `其他層` compare by length.

### 5.5 殘留

<!-- cols:76 -->
```
‹strip + header›

▾ 要你處理  ▲ 17 · 313 MB ────────────────────────────────────────────────
▲ worktree  有未提交變更            1 個 · 2.0 MB                    ▸
▲ worktree  已整合，可清理         12 個 · 280 MB                   ▸
▲ worktree  未整合（分支還在）      4 個 · 31 MB                    ▸
▾ 自動清理 ────────────────────────────────────────────────────────────────
✓ 完成  3h 前刪 2 個 worktree、封存 1 條分支
▾ 外掛來源  ▲ 要你處理 ───────────────────────────────────────────────────
▲ dev · v3.0.0-alpha.6 · 落後 upstream 54                           ▸
```

Expanding a group keeps its `item` row (now `▾`) and lists its items as `bullet` rows beneath it; expanding an item shows its reason as an attached `detail` and its command (I23 pins this render). A group whose items share one action shows one group-level `command` instead; worktree removal differs per path, so here each command sits under its own item (I22):

```
▲ worktree  已整合，可清理         12 個 · 280 MB                   ▾
◦ agent-a242acf7 · 0d · 24 MB                                     ▸
◦ agent-a3379d38 · 0d · 22 MB                                     ▾
  └ clean · HEAD 已在 origin/develop
  $ git -C /home/u/proj worktree remove
    /home/u/proj/.claude/worktrees/agent-a3379d38
  ▸ 還有 10 個
```

At 120 columns the lines are the same; only the rules are longer, and an expanded command fits on one line. Worktree names are 14 cells and are never cut; a longer identifier is cut from the left (§3.5), and a command is never cut.

"已整合" is measured against the newer of `develop` and `origin/develop` (the same rule `session-mode.js` uses for `base_ref`). The 2026-10-13 screenshot showed 17 lane worktrees as `clean-unintegrated` although their commits were on `origin/develop`: the main checkout's `develop` was 54 commits behind. That is diagnosis 19: the producer is already fixed, this plan changes no classifier, and P5 only verifies the fix end to end (§7, §9).

### 5.6 ?

Generated from `STATES`, the structure-glyph table and the meter levels. It cannot drift, because it reads the same tables the tabs draw from. At 120 columns the lines are the same, only the rules are longer.

<!-- cols:76 -->
```
‹strip + header›

▾ 狀態 ────────────────────────────────────────────────────────────────────
▲ 要你處理    要你動手或看一眼
✗ 失敗        結束了但沒成功
⊘ 疑似卡住    應該在動卻沒有動
△ 待修        結束了，有發現要修，不需要你動手
● 執行中      正在動，資料是新的
✓ 完成        順利結束
○ 未開始      排隊中或還沒輪到
◌ 已停        沒在動，也沒有結論，或資料過舊
∅ 不需要      沒有欠什麼
? 未知        對照表沒有這個值，原文在展開的細節裡
— 沒有資料
▾ 結構與圖 ────────────────────────────────────────────────────────────────
▾ ▸         展開／收起一個區塊或一組項目
›           按下去切到那個分頁
└ $         細節與可複製的指令
▰▱          額度條：綠 80% 以下、黃 80% 起、紅 100% 起
✓─◐─○       階段圖：做完、目前所在、還沒到
●2 ⊘1 ⚑1    狀態列：執行中、疑似卡住、殘留件數
▾ 鍵盤 ────────────────────────────────────────────────────────────────────
Ctrl+x Tab 讓面板拿到鍵盤；Tab／方向鍵移動，Enter 按下
```

## 6. Mechanism: how the rules are enforced

This is a mechanism change (CLAUDE.md, 機制 vs 指引). Rules that `ia.md` already states get code that makes them hold. The new rules (states, grid, formats, IA) are the guidance part, and this plan asks the owner to approve them (§8).

### 6.1 Structure

- **`mods/live/ui.ts` (new)** owns: `STATES`, `STATUS_MAP` + `classify*` + `stateOf` + `worst` + `SEVERITY` + `FRESH_MS` (§2.5, §3.3), `GLYPHS` (state, structure and chart tables) + `EMOJI_BANNED`, `FRESHNESS` thresholds, `FACT_OWNER` (§2.6), `SECTION_DEFAULTS` (which sections start folded), `GRID = [0, 2, 4, 12]`, `KEY_W`, the formatters (`money`, `pct`, `dur`, `ago`, `clock`, `size`, `sha`, `idTail`, `count`) and the components in §4. `seg`, `row`, `padCells` and the `ThemeKey` strings exist only here and are not exported.
- **`mods/live/tabs.ts` (new)** holds the tab builders, moved out of `model.ts` (`nowLinesRaw`, `dispatchLinesRaw`, `reviewTabLinesRaw`, `spendTabLinesRaw`, `hygieneTabLinesRaw`, `legendLines`, `activityLines`, `accountLines`, `recentLines`, `needsYouLines`). It imports components and formatters from `ui.ts` and data types from `model.ts`. It never imports `seg`, `row` or theme keys, and it never writes a glyph literal.
- **`PaneLine` is opaque (answers G1 R4).** `kind` becomes a required field (`'verdict' | 'header' | 'kv' | 'item' | 'bullet' | 'table' | 'meter' | 'empty' | 'more' | 'command' | 'detail' | 'chart' | 'blank'`), and `PaneLine` gains `goto?: PaneTab`, `fact?: FactId`, `group?: GroupKey` and `ts?: number`; only `list()` sets `group` and `ts`, from required row-spec fields, and every data-bearing builder requires `fact` (§2.6 rule 7). `Frag` is a second branded type with the same `WeakSet` scheme (`isFrag`). Making one is possible only through `ui.ts`: the constructor `mk()` is not exported; it adds the line to a module-private `WeakSet` and the type carries a brand from a non-exported `unique symbol`, so `{kind:'kv', text:'x'}` neither type-checks nor passes at run time. `ui.ts` exports one read-only predicate, `isMade(line)`, for the tests. A `kind` field alone proved nothing (a hand-built object can carry it), which is why the brand and the `WeakSet` replace it as the evidence of "built by a component".
- **`buildSections` returns data, not lines.** `PaneSections` (`attention`, `waiting`, `tasks`, `decisions`, `foreman`) becomes `{ tasks: TasksView | null, decisions: DecisionsView | null, foreman: ForemanView | null, attention: AttentionView | null, notWired: … }`, and the tabs render it through components. Without this change, the tick path keeps producing hand-made bold lines that no rule can reach (diagnosis 1).
- **`pane.tsx`** draws the tab strip, the global header (`verdictHeader`) and the body lines. Its own Text props come from one `drawSeg` function in `ui.ts`, so `pane.tsx` itself carries no colour decisions.

### 6.2 Static check: `mods/live/ui-lint.test.js` (node `--test`, built-ins only, added to `run-tests.sh` next to `gen-locales.test.js`)

- L1: `tabs.ts`, `pane.tsx` and `band.tsx` contain no theme-key string literal (`'claude' 'warning' 'error' 'success' 'suggestion' 'inactive' 'subtle'`), no `color:`, `bold:` or `dim:` property, and no `backgroundColor` / `inverse`.
- L2: outside `ui.ts`, the source contains no codepoint in U+2190–U+2BFF or U+25A0–U+25FF. Glyphs come only from `GLYPHS`. String-table JSON files are checked too: a locale string may not carry a state or structure glyph. Strings that carry one today and must lose it (zh-TW and en alike): `state.no_project_wt` (`⚑`), `legend.hygiene` (`⚑`, `↓`), `legend.widths` (`⚙`, `⚑`), `now.see_hygiene` (`→`), and the `toast.*` arrows (`→`, kept as text `至` / `to`, or allowlisted as a non-state arrow). P5 lists the final set.
- L3: every `GLYPHS` entry fails `/\p{Extended_Pictographic}/u`, is not in `EMOJI_BANNED`, and contains no U+FE0F or U+20E3; the new-to-vocabulary entries carry a `verified: '<date> <terminal>'` field that P0 fills in. (`\p{Emoji}` is not used: it matches digits, `#` and `*`.)
- L4: `tabs.ts` does not import `seg`, `row`, `rule`, `kv`, `padCells` or `NO_DATA` from `model.ts` (after P5 these no longer exist there).
- L5: outside `ui.ts`, no source file builds a line by hand: no `kind:` property, no `as PaneLine`, no `: PaneLine = {`, no spread of a `PaneLine`. A static backstop for the run-time brand (I2); it fails on `{kind:'kv', text:'x'}` in `tabs.ts`.
- L6: `tabs.ts` carries no number formatting of its own: no `toFixed`, `toLocaleString`, `Math.round` / `Math.floor` next to a unit literal, and no string literal `'%'`, `' %'`, `'$'`, `' MB'`, `' GB'`, `'h'`, `'m'`, `'*'` used as a unit. Units come from the formatters.
- L7: `tabs.ts` carries no `StateId` string literal (`'need_you'`, `'failed'`, `'stalled'`, `'findings'`, `'running'`, `'done'`, `'pending'`, `'stopped'`, `'skipped'`, `'unknown'`) and no access to `GLYPHS` or `STATES`; a state arrives only as the `Stated` that `stateOf` returned.

### 6.3 Render invariants in `mods/live/live.test.ts`

These are pure calls of the tab builders over fixture snapshots; a mount is needed only for the strip, I9(b), I18 and I19 (presses). Matrix: fixtures {`richWorld` (existing), `busyWorld` (new), `emptyWorld` (new: every source missing)} × locale {zh-TW, en} × cols {40, 60, 76, 100, 120, 160}. `busyWorld` reproduces the owner's screenshots: 32 finished reviewer runs with ~30-cell ids, 4 code seats (3 × SHIP-AS-IS, 1 × FIX-THEN-SHIP), a plan review with `updated_at` 27 days before `NOW` (CONDITIONAL, seats READY / STOP), 3 decisions with long English rationales (`richWorld` has `rows: []`), 32 undocumented dispatches, brain 175.33 / 150, a 24-sample history crossing the day reset, 16 background shells whose tails are `[exited with code 0]`, 39/39 tasks, account plus two quota windows, 1 residue item, QC `not_needed`.

| Id | Assertion |
|---|---|
| I1 | `displayWidth(line.text) <= cols` for every line of every tab |
| I2 | every line is `isMade` (made by a component, §6.1) and has a `kind` |
| I3 | the first non-blank cell of every line is in `GRID`; for `kind:'kv'`, the value starts at exactly 12; a wrapped continuation starts at its line's hang, and the hang is in `GRID` |
| I4 | every `kind:'header'` line matches `^[▾▸] \S.*─+$`, has the width `cols - 1`, and starts at column 0; no line anywhere contains `▌`; a bold segment occurs only in `header`, `verdict`, `need_you` items, meter headline values, and `here` segments (the current stage node and label, the active tab); bold on any other chart or strip text is red (M56: a bold non-current stage label; M57: a bold inactive tab) |
| I5 | (a) every `GLYPHS` entry fails `/\p{Extended_Pictographic}/u` and is not in `EMOJI_BANNED`; (b) every glyph segment (components tag them `role:'glyph'`) is in `GLYPHS`; (c) no line of any kind contains U+FE0F or U+20E3, and no line outside `kind:'detail'` contains an Extended_Pictographic character. Digits, `#` and `*` are legal everywhere (they carry the `Emoji` property as keycap bases, but are not pictographs) |
| I6 | colour pairing: a glyph segment's colour equals `STATES[state].key`; `claude` appears only on segments tagged `here`; `suggestion` appears only on `running` glyphs and words; no segment has `backgroundColor` or `inverse` (extends `expectThemeOnly`, live.test.ts 2127) |
| I7 | no segment tagged `role:'state'` or `role:'value'` (i.e. not free text: decision rationales and task subjects are `role:'prose'` and exempt) outside `kind:'detail'` contains a `STATUS_MAP` raw token (whole word, **case-insensitive**, matching the normalisation in `classify`: `SHIP-AS-IS`, `FIX-THEN-SHIP`, `CONDITIONAL`, `READY`, `STOP`, `reviewed`, `not_needed`, …), `[exited with code`, or `/\brc \d/` |
| I8 | formats, one assertion per formatter kind of §3.5: money (`/\$[\d,]+\.\d\d/`), percent (no `/\d %/`), duration (`/\b\d+h\d\dm\b/`, never `/\b\d+h\dm\b/`), relative time, clock, size, sha (8 hex), `idTail` (a cut identifier starts with `…`), prose cut (ends with `…`), count (no `/\d\*/`); and every number in a non-prose, non-identifier segment must come from a segment the formatters tagged (`fmt:`), so a hand-typed `'12 MB'` is red |
| I9 | (a) no tab builder emits `kind:'verdict'` (pure, over the matrix): only `pane.tsx` draws the header; (b) mounted: for each `PaneTab`, the rendered lines between the strip and the first body line are byte-identical for the same snapshot. Part (a) is what stops a tab drawing its own header; (b) alone would compare one function with itself |
| I10 | at most one `kind:'empty'` line per section (consecutive or not); `沒有資料` text appears only in `empty` lines |
| I11 | freshness (`busyWorld`): for each of the six timed predicates F1-F6 of §2.5 three fixtures at `T−1 ms`, exactly `T` and `T+1 ms` (`T` from that predicate's own `FRESH_MS` constant); X0 and X1 are separate fixtures with no clock. At `T−1` and at `T` the item keeps its ordinary form; at `T+1` it takes the stale form: non-terminal plan review `◌` and folded; terminal plan review one dim history line, no section; non-terminal plan review untouched past F6 one dim line saying it stopped, no section; non-converged code review `◌`; finished dispatch counted in the chip, not listed; background quiet `◌ 已停`. Exit marker `0` -> `✓ 完成`, non-zero -> `✗ 失敗`, and never `●` for either; 現況's 背景工作 section is `empty` + one `more` |
| I12 | collapse (`busyWorld`, 76 cols): 派工 has ≤ 22 lines, 0 `kv` lines in the runs sections, exactly 5 finished `table` rows and 1 `more`; every run is one line at every width ≥ 40. The same five-row cap with one `more` is asserted for every list category by I18 |
| I13 | mapping coverage and precedence: every subject in the fixtures classifies to a state that is not `unknown`; a planted token `WEIRD` renders `? 未知`, and `WEIRD` itself appears only in a `detail` line; **pairwise conflict fixtures** pin each precedence row of §3.3: run `stall:true` + `rc 0` -> done, fresh `final_status WEIRD` with no `rc` and no stall -> unknown, `WEIRD` + `stall:true` -> unknown, `WEIRD` + `rc 0` -> done, `WEIRD` + `rc 1` -> failed, absent `final_status` + no `rc` + fresh -> running, `stall:true` + `rc 1` -> failed, `rc 0` + `final_status failed` -> failed; round with findings + a running seat -> running, with a failed seat + findings -> failed; background exit marker 0 + quiet 6 h -> done; loadSource `dev` + behind 54 -> need_you, `dev` + behind 0 -> done, `cache:x` + behind 0 -> need_you; lowercase and padded tokens classify like upper-case ones |
| I14 | the tab strip has exactly one active tab, no background (if Q1 is accepted); in both the strip and the band every badge is a `Frag` made by `stateBadge` or `residueBadge`, matches `^(▲|●\d+|⊘\d+|⚑\d+)$`, and its glyph colour is its state's theme key (`⚑`: `warning`, a count glyph in the structure table); a `done`, `findings` or `stopped` badge does not type-check and is red if forced |
| I15 | the `?` tab contains every `STATES` glyph followed by its word (the legend is generated) |
| I16 | 現況 at 76 cols (`busyWorld`) has no 今日花費 or 帳號 section, and each summary row carries `goto` |
| I17 | ownership (§2.6): every data-bearing line and fragment has a `fact` (a fixture builder that omits it does not type-check, and a hand-removed tag is red); every line whose `FACT_OWNER` is another tab is a projection: `kv` / `item` with `goto`, one derived state and no other `role:'state'` segment, and the only line for that fact on the tab; the global header's spend segments carry `spend.*` and no `goto`; 派工 emits no `spend.*` fact, no seat verdict word and no `review.*` line without `goto`; the (tab, fact) pairs of `busyWorld` equal a golden table, and the check covers every kind that carries data (`meter`, `chart`, header chips, section notes, badges, header fragments), not only `kv` / `item` / `bullet` / `table` |
| I18 | disclosure: in the default render no `detail` line and no `command` line is present, and no list shows more than 5 rows (every category through `list()`: running and finished runs, unfinished tasks, live and ended background, recent prompts, seats, decisions, residue groups); mounted: pressing an item or `more` toggle adds exactly its own `detail` / `command` / hidden items, pressing it again restores the default render |
| I19 | navigation and folding (mounted): pressing every `goto` line of `busyWorld` calls `onTab` with its tab; pressing a `header` flips its fold; the default fold of every header equals `SECTION_DEFAULTS` (要你處理 never starts folded; stale 計畫審查 and 最近對話 start folded) |
| I20 | vocabulary uniqueness and emphasis: no glyph character appears under two meanings across the state, structure and chart tables, and the ten `STATES` glyphs and words are pairwise distinct; no segment is both bold and dim; no line outside `header` and `verdict` has more than one bold value |
| I21 | uniform lists: an `item` with `word:false` sits in a section whose `header` chip state equals the item's state; every other `item` shows its state word |
| I22 | grouping and order (`busyWorld`): in every list no two rows share a `group` (grouped before capped); rows run in state order needs-you, live, finished and, inside one state, by `ts` newest first; an opened group shows at most one group-level `command`, and never the same command again under each item; per-item commands appear only in an opened item; every tab's sections appear in `SECTION_ORDER[tab]` (§2.1), and a row spec without `group` or `ts` does not type-check |
| I23 | expanded renders: the opened decision of §5.3 and the opened residue group with one opened item of §5.5, and the first opened seat of §5.3, equal their mockup lines at 76 columns (golden), and every line is `isMade` with the kinds drawn there (`bullet`, `detail`, `command`, `more`, `item`, and the toggled seat `item`) |

Mutation controls: every rule has its own named planted violation in the table of §6.4 (`references/evidence-discipline.md` §58). Record each red/green pair in the phase evidence, as the existing P1W cases do in the test file's header.

### 6.4 Rule to mechanism to negative control (answers G1 R4)

Every normative rule has an assertion and one named planted violation that must turn it red before its phase lands (`references/evidence-discipline.md` §58). Record each red/green pair in the phase evidence.

| Rule | Mechanism | Negative control (planted violation, must go red) |
|---|---|---|
| Tab code builds lines only through components (§6.1) | I2, L5 | M1: `tabs.ts` returns `{kind:'kv', text:'x'}` |
| Tab code never picks a state by hand (§3.3) | L7, I6 | M2: `item('done', …)` with a string literal; M3: a done row coloured `warning` |
| Tab code never formats numbers itself (§3.5) | L6, I8 | M4: `pct + ' %'`; M5: a hand-typed `'12 MB'`; M6: `8h5m` |
| No emoji-presentation glyph (§3.4 rule 1) | L3, I5 | M7: `GLYPHS.stalled = '⏸'`; M8: a line containing `⚙`; M9: a line containing `1` + U+FE0F + U+20E3. Control that must stay green: a line full of digits, `#` and `*` |
| One glyph, one meaning (§3.4 rule 2) | I20 | M10: `●` also entered in the structure table |
| Colour pairing and no background (§3.6) | I6 | M11: `seg('x','suggestion')` on a done row; M12: a `backgroundColor` on a tab |
| Bold / dim discipline (§3.6) | I4, I20 | M13: a bold + dim segment; M14: two bold values on one line |
| Grid and widths (§3.1) | I1, I3 | M15: a 1-space indented note; M16: a line `cols + 1` wide |
| Section header form, no `▌` (§4) | I4 | M17: `{text:'▌ x', kind:'header'}` |
| One global header on every tab (§2.2) | I9 | M18: a tab builder emitting `kind:'verdict'` |
| Raw tokens only in detail (§3.3) | I7, I13 | M19: `SHIP-AS-IS` in a `kv` value; M20: lowercase `ship-as-is` |
| Total mapping and precedence (§3.3) | I13 | M21: swap the `run` precedence so `stall` beats `rc`; M22: planted token `WEIRD` shown raw outside detail; M50: a fresh run with unrecognised `final_status` drawn `running` |
| Uniform-list state word (§4 `item`) | I21 | M23: `word:false` under a chip of another state |
| Freshness, every row of §2.5 | I11 | M24a-f: flip `>` to `>=` in F1-F6, one mutation each; M24g-l: remove F1-F6, one mutation each; M24m: X0 mapped to running; M24n: X1 mapped to done |
| Five-item cap and one-line items | I12, I18 | M25: restore the block fallback; M26: decisions list uncapped; M52a-e: running dispatches, unfinished tasks, live background, recent prompts and seats each uncapped; M53: a row spec built without `group` or `ts` |
| Details and commands hidden by default | I18 | M27: a `command` line in the default render |
| `goto` switches tab | I19 | M28: a `goto` line whose press handler is missing |
| Every section folds, with the declared default | I19 | M29: 要你處理 starting folded; M30: a header that ignores the press |
| One home per fact (§2.6) | I17 | M31: 派工 emitting a seat verdict `item` without `goto`; M36: a `kv` built without `fact`; M37: the same fact on two lines of one tab; M38: spend metadata back in the 派工 footer; M39: a 現況 review row that adds QC state; M51: a `meter`, a chip or a badge built without `fact` |
| Section order (§2.1) | I22 | M54: two sections of one tab swapped |
| Grouping before cap, fixed order, one command per group (§2.4) | I22 | M40: two same-reason items left ungrouped; M41: finished before live; M42: oldest first; M44: a per-item command under a group-level command |
| Expanded rows are producible (§4, §5.3, §5.5) | I23 | M45: the opened decision without its `└` mark; M46: the expanded residue group without its `▾` row; M55: the first seat without a toggle |
| Empty states (§4) | I10 | M32: two consecutive `empty` lines; M43: two non-adjacent `empty` lines in one section |
| Legend generated from the tables | I15 | M33: a state added to `STATES` but not rendered |
| Active tab and badge form | I14 | M34: two active tabs; M47: a badge with a hand-picked glyph colour; M48: a `done` badge; M49: `⚑N` drawn with `▲` |
| 現況 hands off 用量 / 帳號 | I16 | M35: 帳號 section back in 現況 |

## 7. Migration phases

Each phase ships on its own. Each runs `bash mods/live/run-tests.sh` alone (600 s) and ends with the rendered-screenshot check (memory `tui-verify-by-rendered-screenshot`: `capture-pane -e` → ansi2html → headless chrome → read the PNG) at 76 and 120 columns in zh-TW, with the owner's ssh + tmux in mind. Version stays on the 3.0.0 line (owner ruling 10-12: no bump without asking).

| Phase | Depends on | Ships | Tests that change |
|---|---|---|---|
| **P0 measure + tokens** | none | (a) Real-terminal measurement: draw a 1-cell ruler line of `cols` cells in the pane and compare `bodyColumns` with the visible width (diagnosis 17). Fix `paneWidth` if it is off. (b) Glyph check in the owner's terminal for `⊘ △ ○ ◌ ∅ ◦ › ━ ◐` and the Q2 fallback `◍` (the other fallback, ASCII `!`, needs no check), results written into `GLYPHS.verified`. (c) `ui.ts` with tokens, formatters, components, `mk` / `isMade`, `FRESH_MS`, and `classify*` / `stateOf` / `worst` (§3.3); `PaneLine.kind` optional and tab code not yet forced through `mk`. (d) Band glyph swap: `⏸`→`⊘`, `⚙N`→`●N`, hygiene `⚠`→`▲`; the existing hand-written legend lines get only those three swaps. The generated `?` tab is **not** shipped here: until P1-P4 and P5 move every legacy `●` / `▲` use, a legend declaring one glyph per meaning would be false | `RICH_209` / `RICH_MID` / `RICH_SMALL` / `RICH_NARROW`, the band colour case and the legend cases (live.test.ts ~2085-2195) change glyphs; new `ui-lint.test.js` with L3 only; I5 (a), I20 and the M7-M10 controls |
| **P1 審查** | P0 | `STATUS_MAP` and `classify*` for seats, rounds, gates and QC, with the pairwise conflict fixtures (I13); freshness for plan and code review (I11 rows); decisions as one-line items with `more`/`detail`; QC chip `∅ 不需要`. First toggles ship here, so the mounted I18 (decision and seat toggles), the header-fold part of I19 and the golden opened-decision case of I23 are enabled and named in the acceptance | review-tab cases asserting `● 進行中`, `▲ 未收斂`, raw verdict words, `沒有代你做過決定`; invariants I1-I8, I10, I13 enabled for 審查 |
| **P2 派工** | P0 | `table` with column priorities; live vs finished sections; latest 5 + `more`; the 審查關卡 section replaced by one pointer row to 審查 (§2.6); footer as a note with no spend stamps. First `more` row and first `goto` row of 派工 ship here: the mounted I18 (finished-runs `more`) and I19 (the pointer row's `onTab`) are enabled and named in the acceptance | the dispatch block-fallback cases are replaced; I12, I17 and I22 enabled for 派工 |
| **P3 用量** | P0 | meters (the tick line goes); account and quota move here; window labels; `pct` and `money` formatters; `SLOT_TAB.quota = 'spend'` | spend-tab cases (`117 %` becomes `117%`), the account/quota cases move from 現況 to 用量, and the band quota-press case now expects 用量 |
| **P4 現況 + global header** | P0-P3 | `buildSections` returns data; summary rows with `goto` and `fact`; background freshness (exit marker, 30 min); tasks show unfinished only; the reason becomes an item; `verdictHeader` in `pane.tsx` on every tab, its spend segments as header projections. The mounted I18 (tasks and background `more`) and the full I19 (`onTab` for every summary row) are enabled and named in the acceptance | the Now-tab cases (W3a tasks, attention, foreman rows, the activity cases) are re-pinned to the new lines; I9, I11, I16, I17 enabled |
| **P5 殘留 + strip + lock + legend** | P0-P4 | 殘留 on components (residue groups, cleanup and `loadSource` through `stateOf`); the tab strip active mark (per Q1) and `badge`; the generated `?` tab (I15), now that no legacy symbol remains; `kind` and `fact` become required in the type and every line must be `isMade`; `seg`/`row`/`rule`/`kv` removed from `model.ts`; L1, L2, L4, L5, L6, L7 switched on; every invariant over every tab, with the mounted I18/I19 for the residue toggles and the golden residue case of I23. Residue producer check (diagnosis 19): `bash hooks/tests/repo-residue-sweep.test.sh` stays green (its stale-develop case was red before `dc30d96c`), and on the owner's machine a fresh `reap --auto` no longer files an `origin/develop`-integrated worktree under 未整合 | `expectThemeOnly(tree, allowTabBackground)` loses the background allowance if Q1 is accepted; `isActiveTab` (live.test.ts ~2139) keys on the new mark; the legend cases move to the generated `?` tab |

P4 reads the review, dispatch and usage contracts of P1-P3, and its acceptance runs against exactly that predecessor state (P0-P3 merged, P5 absent). Every tab phase consumes `ui.ts` from P0, and P5's lint switches need every earlier tab already on components. A mounted control test is enabled in the phase that first ships its toggle, `more` row or `goto` row; a phase whose acceptance does not name it is not done.

The separate scanner defect (diagnosis 11: why `scanBackground` never ended these tasks) is a bug fix with its own red test, outside this plan. The freshness rule in P4 makes the pane right even while that bug exists.

The dispatch tree (the former P6 and §7.1: nested dispatch lineage across subagents, rails, loop-back Claude children and fleet) is a separate plan by owner ruling 2026-10-13: [`2026-10-13-dispatch-tree.md`](2026-10-13-dispatch-tree.md). This plan has no dependency on it.

## 8. Open questions for the owner

**Owner ruling 2026-10-13: all five as recommended.** Q5: plan-review `STOP` maps to `△ 待修`, not `▲ 要你處理`.

1. **Active-tab mark.** The surface inverts the focused Button (d.ts), so a `subtle` background on the active tab looks like a second highlight (screenshot 3). Putting the focus ring on the active tab would combine inverse and background, which the 10-06 spike found unreadable. **Recommendation:** drop the background. Mark the active tab with bold `claude` text plus a `━` segment under it in the existing baseline rule (no extra row). When the strip wraps on a narrow pane, it falls back to bold `claude` text alone. This needs one real-terminal look in P5.
2. **Glyph swaps.** Owner ruling 2026-10-13: 要你處理 keeps `▲`; the person-like candidates `♙` (U+2659) and `⚇` (U+2687) were mocked up and declined. `⊘` for stalled (replacing `⏸`), `●N` for the band and tab dispatch count (replacing `⚙N`), and new `△` 待修, `∅` 不需要 and `◦` bullet. **Recommendation:** approve them, subject to the P0 terminal check; any glyph that fails falls back to the next candidate in the `GLYPHS` table (`⊘`→`◍`, `△`→`!`).
3. **Account and quota move to 用量**, and 現況 keeps one 用量 summary row with the most-used quota window. **Recommendation:** yes. The band's quota slot then opens 用量.
4. **完成待驗收.** Keep the verdict `✓` (the work is done) and put `▲ 等你驗收` in 要你處理 (your action), or make the verdict itself `▲`? **Recommendation:** keep `✓` plus the `▲` item. The verdict words are owner-approved, and "state of the work" and "your next action" stay separate.
5. **Verdict mapping.** Plan-review `STOP` and `CONDITIONAL` → `△ 待修`; `REJECT` / `BLOCK` → `✗ 失敗`; code `FIX-THEN-SHIP` → `△ 待修`. **Recommendation:** accept them. Confirm especially `STOP`: if a STOP seat should halt the plan and call you, it maps to `▲ 要你處理` instead (one line in `STATUS_MAP`).

**Owner rulings 2026-10-14** (after P0-P5 merged):

6. **The overflow hint carries no arrow.** `下方還有 N 行` is text only. The `⇣` glyph (`GLYPHS.structure.overflow`), its `NEW_GLYPHS` entry, its pending-owner mark and its `?` legend row are removed. `↓` (behind upstream) stays with that one meaning (the meaning is settled; its one-cell width in the owner's terminal is still `pending-owner`). The hint's position, its condition and the way N is counted are unchanged.
7. **The band position slot reads `size·level·stage`.** The `▸` that joined level and stage is replaced by the band's `·` separator (the wide band still swaps it for the stage walk). `▸` now means only "folded", in band and pane alike (§3.4 rule 2). A band lint in `live.test.ts` fails if any band output draws `▸`; its negative control puts the arrow back.
8. **The three P5 trade-offs are approved as built, no code change:** (a) on a narrow column the low-priority columns go first; (b) durations are zero-padded (`1d00h`, `3h05m`, `Nd`); (c) no data reads `沒有資料`.

**Owner ruling 2026-10-16** (after the tab names went yellow): 「整個 panel 顏色盤點重整，考慮視覺重量跟顏色代表的意涵，盡量讓介面清楚明瞭，然後更新為預設開發 design pattern」. Resolved in §12: one colour, one meaning; bold is a whitelist; the owner's attention is drawn in yellow once per surface. This is the default design pattern for every mod surface from now on.

**Owner ruling 2026-10-16, Q1 revised** (decision `d-5723c838`, answered 「合併＋白字」 after comparing both renders): the active tab name is no longer orange. It is bold default text, or bold yellow when that tab needs the owner; orange (`here`) stays only on the `━` run under it. This replaces the 2026-10-13 Q1 mark wherever it says "bold `claude` text" (§3.6, §4, Q1 above, §9); §12.5 has the rule.

**Owner ruling 2026-10-16, 待決 tab** (answered in conversation): 「這個 IA 跟排版你調過又壞了? 完整盤點跟整理一下?」. Resolved in §12.6: the 待決 card gets a section header, a bold wrapping question and the pane's key/value rows, and the blank lines that were never drawn are drawn.

**Owner ruling 2026-10-16** (after the 殘留 tab was reshaped): 「殘留還是亂亂的」. Resolved in §12.7: two sections (what needs you / what can simply be cleared), every entry read where it stands, one count everywhere.

## 9. Unverified (each is checked in the named phase)

Verified as of 2026-10-14 (struck items below):
- ~~One-cell rendering of `⊘ △ ○ ◌ ∅ ◦ › ━ ◐`~~ confirmed by the owner in ssh + tmux on 2026-10-13 (`GLYPHS.verified`, `glyph-check.js`).
- ~~The `━` under-segment in a wrapped strip~~ the strip falls back to the bold name alone when it wraps (Q1; bold `claude` until 2026-10-16, bold default text since, §12.5); covered by `mods/live/now.test.ts` "hint: a tab strip that wraps" (a wrapped strip draws no `━`, the active label stays bold; 76-column unwrapped control alongside).

- Whether the owner's 殘留 screenshot (17 lane worktrees as unintegrated) predates the producer fix: awaiting confirmation on the owner's machine (P5 acceptance); the producer is fixed (`dc30d96c`, `793880e6`; stale-develop case in `hooks/tests/repo-residue-sweep.test.sh`).
- `bodyColumns` overstating the drawable width (P0 a).
- Why `scanBackground` misses the end of these tasks (separate bug; P4 makes the pane right regardless).
- The quota numbers, reset times and residue row in the mockups are illustrative, not from the screenshots.

## 10. G1 意見處理

Source: the G1 plan review (seats `sol_deep`, STOP, 10 findings; `minimax_consult`, CONDITIONAL, 4 findings). Every finding has one row. The owner's five answers in §8 (active-tab mark, glyph swaps, account and quota to 用量, 完成待驗收 keeping `✓`, and the verdict mapping including plan-review `STOP` → `△ 待修`) are unchanged. No finding conflicted with them: R3 asks for a precedence rule and the mapping table keeps `STOP` → `findings`; R5's strip-glyph point is about the leading `›` chip, not Q1's active-tab mark.

| # | Finding | Disposition | Where |
|---|---|---|---|
| 1 | sol R1: P6 undiagnosed, outside scope | adopted: moved to its own plan | [`2026-10-13-dispatch-tree.md`](2026-10-13-dispatch-tree.md) |
| 2 | sol R2: review facts have two homes | adopted: ownership table, projections, `FACT_OWNER`, I17 | §2.6, I17, P2 |
| 3 | sol R3: exact-token `stateOf` cannot express overlap | modified: two-step `classify` + `STATUS_MAP`, ordered precedence, `SEVERITY`, conflict fixtures | §3.3, I7, I13 |
| 4 | sol R4a: `Emoji` property matches digits, `#`, `*` | adopted with a changed repair: `Extended_Pictographic` plus `EMOJI_BANNED` | §3.4, L3, I5 |
| 5 | sol R4b: `PaneLine.kind` does not stop hand-built lines | adopted: branded type, unexported `mk()`, `WeakSet`, L5-L7 | §6.1, §6.2 |
| 6 | sol R4c: many rules have no failing mechanism | adopted: invariants I18-I20, rule-to-control table | §6.3, §6.4 |
| 7 | sol R5: mockups use components that do not exist | modified to the smallest addition: `kv {goto}`, `bullet`, uniform-list word rule (I21) | §4, §5 |
| 8-10 | sol R6, R7a, R7b: P6 shippability, guessed parent edges, marker identity | adopted by moving out with P6 | dispatch-tree plan |
| 11 | minimax R5a: 120-col header lines | not adopted as a defect: the mockup already shows the merged line; clarified | §5 introduction |
| 12 | minimax R5b: no horizontal seat row | adopted: seats stack one per line; unused grid column 14 removed | §3.1, §5.3 |
| 13 | minimax R5c: identifier cut from the right | modified: names shown whole, rule restated | §5.5 |
| 14 | minimax R7: `getSessionId()` unverified | adopted by moving out | dispatch-tree plan |

### 10.2 第二代意見（G1b, seats `sol_chair` and `minimax_consult`）

Seven blocking findings, four non-blocking. All were checked against the cited sections; all hold. The owner's five answers in §8 are unchanged.

| # | Finding | Disposition | Where |
|---|---|---|---|
| 1 | sol R1: residue classifier correction not in Diagnosis | adopted: diagnosis 19 (producer already fixed by `dc30d96c`), P5 acceptance, §9 item | §1, §7 P5 |
| 2 | sol R2: spend on every tab, stamps in 派工, review row too wide | adopted: spend owned by 用量 and projected into the header; 派工 stamps gone; rows cut to one fact | §2.2, §2.6, §5 |
| 3 | sol R3: vocabulary not closed, word-less exceptions | adopted: `attention`, `residueGroup`, `cleanup`, `worst()`; named compact forms | §3.2, §3.3 |
| 4 | sol R3: thresholds disagree | adopted: strict `>` ms predicates, `FRESH_MS`, T−1/T/T+1 | §2.5, I11 |
| 5 | sol R4: rules breakable while checks stay green | adopted: required `fact`, I22, per-section `empty` | §2.6, I10, I22 |
| 6 | sol R5: opened decision and residue group unproducible | adopted: redrawn, I23 | §5.3, §5.5 |
| 7 | sol R6: legend too early, mounted checks too late | adopted: legend to P5, per-phase mounted tests | §7 |
| 8-9 | minimax R5: expanded parent row; `kv` state lead | adopted | §5.5, §4 `kv` |
| 10-11 | minimax R6, R4: dependencies implicit; no positive exit-marker assertions | adopted | §7, I11 |

### 10.3 第三代（G2 收尾）意見

G2 is the last generation: depth-0 ruled on each finding, and this file is frozen after this revision. Twelve findings (eleven blocking, one non-blocking); all checked against the cited sections and all hold. The owner's five answers in §8 are unchanged.

| # | Finding | Disposition | Where |
|---|---|---|---|
| 1 | sol R2: fact granularity is not closed (header has two facts on one line; meters, charts, chips, badges, notes untagged) | adopted: fragment-level granularity, the header exception stated once, `fact` required on every data-bearing builder and fragment, I17 and its golden table widened, M51 | §2.6 rules 6-7, §4, I17 |
| 2 | sol R3: a fresh run with an unrecognised `final_status` becomes `running` | adopted: precedence step 3 maps it to `unknown` before stall and freshness; six new I13 fixtures; M50 | §3.3 run row, I13 |
| 3 | sol R3: badge vocabulary, constructor and I14 disagree (`⊘N`, `⚑N`) | adopted: `stateBadge` (need_you, running, stalled only) and `residueBadge`; I14 regex includes `⊘N`; M48-M49 | §3.2, §4, I14 |
| 4 | sol R4: group/ts optional, cap not universal, section order unpinned | adopted: `list()` and `section()` builders derive grouping, order, cap and `SECTION_ORDER`; I18 covers every category; I22 pins section order; M52-M54 | §4, §6.1, I18, I22 |
| 5 | sol R4: freshness matrix has five timed comparisons, not six, and four constants | adopted: F1-F5 each with its own constant, X0 and X1 as untimed branches, one mutation each (M24a-l) | §2.5, I11, §6.4 |
| 6 | sol R5: components cannot nest a meter or badge in a line; no blank builder | adopted: line builders versus branded `Frag` fragments (`meterValue`, `badgeFragment`, `stateLead`), `blank()` added | §4 intro, `kv`, `meter`, `blank` |
| 7 | sol R5: the first seat has no toggle and no producer | adopted (option b, with finding 11): valueless `席位` key, one toggled `item` per seat, opened-seat sketch, I18 and I23 cover the first seat; M55 | §3.1, §4 `kv`, §5.3, I23 |
| 8 | sol R5: stage node and active tab bold violate the bold rule | adopted as normative exceptions tagged `here`; I4 and I20 updated; M56-M57 | §3.6, I4, I20 |
| 9 | sol R6: P4 depends only on P0 but reads P1-P3 | adopted: P4 depends on P0-P3 and is accepted against that exact predecessor state | §7 |
| 10 | sol R6 (non-blocking): fallback glyph `◍` not in the P0 measurement | adopted: `◍` added to P0(b) and §3.4 rule 4; ASCII `!` needs no check | §3.4, §7 P0 |
| 11 | minimax R5: seats stacked under one `kv` value have no producer | adopted (option b), same change as finding 7 | §5.3, §4 |
| 12 | minimax R5: `meter` has no reset-time field although §5.4 shows one | adopted: `reset?: atMs` option renders the relative-time formatter after the amount | §4 `meter`, §5.4 |

## 11. Review log

- 2026-10-13, G1 attempt at 459dd869: terminal `required_seat_transport_exhausted`. The required chair (grok-4.6) returned HTTP 402 (xAI usage balance exhausted) on both attempts; `sol_deep` and `minimax_consult` completed, but their results stayed unratified, so §10 treats them as input, not as dispositions. The sealed state directory was moved aside with the suffix `.g1-transport-stop` (no seat produced a ratified result, so this is a legal reset). The re-run panel is `sol_chair` (codex gpt-5.6-sol, required), `kimi_deep` (kimi-code-k3), and `minimax_consult` (MiniMax-M3).
- 2026-10-13, G1b (`sol_chair`, `minimax_consult`): 7 blocking + 4 non-blocking findings, handled in §10.2.
- 2026-10-13, G2: the generation cap was reached, so depth-0 ruled on each finding and the plan is frozen after §10.3 (no further review is sent).
- The Kimi seat ended `precondition_failed` in both generations because the manifest carried a wrong model id (it should be `kimi-code/k3`).
- Both generations ran with only two model families (openai and minimax).

## 12. Revision 2026-10-16: the semantic palette

Owner ruling 2026-10-16 (see §8): 「整個 panel 顏色盤點重整，考慮視覺重量跟顏色代表的意涵，盡量讓介面清楚明瞭，然後更新為預設開發 design pattern」. This section is the default design pattern for the live mod's pane and band and for any mod surface written after it. It changes colour and weight only: no glyph shape changes, except the band's finished stage node (`●` to `✓`, §3.4 rule 3), and the worst-of aggregation (§3.3) is untouched. Two layout changes follow from the rules and are part of this revision: the tab strip no longer carries count badges (the tab name's colour says it, §12.5), and the `要你處理` section title shows a plain `N` where it showed `▲ N` (§12.2).

Method: every use of a theme key in `mods/live` was inventoried (file and line), each key was found to carry between two and seven meanings, and the table below gives each key exactly one.

### 12.1 The palette: one colour, one meaning

| Role (`PALETTE` in `ui.ts`) | Theme key | The one meaning | Used for |
|---|---|---|---|
| `attention` | `warning` (yellow) | the owner must look or act | the `need_you` mark `▲`, the top verdict `要你決定`, the name of a tab that needs the owner, QC owed (`QC▲`), residue to handle (`⚑`), a meter at 80% and above, a plugin source behind upstream |
| `here` | `claude` (orange) | you are here | the `━` run under the active tab (not its name, §12.5), the current stage node `◐`, the current unit cell |
| `broken` | `error` (red) | broken or probably broken | `failed`, `stalled`, a meter at 100% and above |
| `done` | `success` (green) | finished | `done` `✓`, QC `✓`, a finished stage node `✓` (pane and band) |
| `running` | `suggestion` (blue) | running now | `running` `●`, in the pane and in the band's `●N` |
| `idle` | `inactive` (grey) | nothing to do | `pending`, `stopped`, `skipped`, `unknown` marks, the empty part of a bar |
| `structure` | `subtle` (dark grey) | structure | section rules, fold marks, the strip baseline, the band `│` |
| `action` | `merged` (purple) | you can press this | a pressable `[ ... ]` button and a pressable option on a decision card (§12.9); never a state, never a value |
| (none) | default text | content | values, names, prose, the active tab name (bold), `findings` (`△ 待修`), a recommendation `★`, a meter below 80% |
| (weight) | `dim` | secondary | key columns, units, times, hints, inactive tab names, the `›` next-page button |

Consequences that were ambiguous before: `findings` is not the owner's to act on (the author fixes it), so it is default text and no longer yellow; a healthy meter says nothing, so a 2% bar is default text and no longer green; `★` is a recommendation, not a state, so it is default text and no longer blue; the `›` button is an action, not a place, so it is `dim` and no longer orange; the picked option and the send button on a decision card are bold default text and no longer green. `stalled` keeps the red of `failed` (the §3.2 vocabulary does not change).

### 12.2 The attention rule: once per surface

The owner's attention is drawn in yellow text once per surface. In the pane that is the top verdict line and the name of the tab that needs the owner; in the band it is the verdict word. Everywhere else a `need_you` item draws only its `▲` yellow, with its words in default text and not bold; the count on the `要你處理` section title is a plain number (no mark, no colour); `QC▲` and `⚑N` colour the mark only and leave the label and the number in default text.

### 12.3 Bold is a whitelist

Bold is allowed on exactly these: a section title, the verdict line, the active tab name, the name of a tab that needs the owner, a decision card's question, the picked option on a decision card, and the card's send button (`BOLD_USES` in `ui.ts`). Nothing else is bold, including a meter's percent, the text of a `need_you` row, `QC▲`, `⚑N`, the stage label and the current-stage node. This replaces the §3.6 bold bullet and the exemptions that grew around it in invariant I4.

### 12.4 Enforcement

- `PALETTE` in `ui.ts` is the only place in `mods/live` that names a theme key. Pane and band both draw through it, so one state is one colour on both. `ui-lint.test.js` L8 fails on a theme-key literal anywhere else (the negative control plants a prose segment painted `warning` and must go red); L9 pins the band's only bold to the verdict slot.
- Invariant I4 (`invariants.testkit.ts`) now checks the whitelist instead of a list of exemptions; I6 checks that a state's glyph and word carry exactly `STATES[id].key` / `wordKey`, including "no colour" for `findings`.
- The `?` tab is generated from the same tables; its strings describe the new meanings (`legend.*`, en and zh-TW).

### 12.5 Tab strip

The tab strip draws a tab that needs the owner as bold `attention` text, replacing the strip's count badges (§3.2 b), and the active tab as a bold name with an orange (`here`) `━` run under it. The active name is bold default text, or bold `attention` when that tab needs the owner: the need stays visible on the tab you are looking at, and orange appears in the strip only on the `━` run (owner 2026-10-16, decision `d-5723c838`, 「合併＋白字」; the first build of this revision kept the name orange, as the 2026-10-13 Q1 had it, and was compared side by side before the ruling). A strip that wraps draws no `━` and keeps the bold name alone; there an active tab that needs the owner looks like any other needing tab, and the top verdict line still says it.

The active label carries the `here` tag without the `here` colour: I4 reads the tag to tell the active name from a stray bold tab (`boldUseOf` in `ui.ts`; a bold tab name with neither the tag nor the attention colour, or one painted `claude`, is a violation, with a negative control in `ui.test.ts`). Tests find the active tab by the column of the `━` run, not by colour (`activeKeyOf` in `live.test.ts`).

### 12.6 The 待決 card

The owner reviewed the 待決 tab (76 columns, three questions) and found its IA and layout confused. The inventory found ten defects, and this section is the fix. A card used to be a `└` copy of the question under a cut headline, a run of unlabelled text, a `★` that appeared twice, a `補充 選填` label glued to its placeholder, two facts squeezed on one `卡住：… · 來源：…` line, the stall placed last, and no section header while every other tab has one.

**Layout.** The tab is one section, `▾ 待你回答  3 ───` (`en`: `Waiting for you`), built with `ui.header` like every other tab: open by default, id `sec:decide.cards`, the question count as a plain number on the right. Under it, per question:

```
▲ 1. P5 殘留分頁：請在你的機器上看一眼截圖，畫面正常就算活面板計畫驗收完成
  背景      P5 已審查通過並合併（bcaef0cc）。審查員指出計畫裡「殘留分頁截
            圖」只有資料產生端的證據，沒有你機器上的畫面，所以這一項改回待
            確認。
  卡住      活面板計畫無法標成完成
  選項      [ ] ★ OK  [ ] 有問題
  建議      OK：只差你肉眼確認，程式與測試都已過
  補充      （輸入框，提示字「選填，可留空」）

  [ 送出（已選 0/3） ]  答案會貼進這個對話送出
```

- **Question line** (`cardTitle`, kind `item`): `▲ n. question`, the whole text bold default text, the `▲` stays `attention`. A long question wraps and its continuation lines start at column 2; the question is never repeated under a `└`. A sent question keeps the `○ … · 已送出，等處理` form and is not bold.
- **Rows** (`cardRow`, `choiceRows`, `fieldRow`) use the pane's key/value grammar: the key (dim) at column 2, the value at column 12, continuation lines hung at column 12 (`GRID` is unchanged). Order: 背景 (value dim) → 卡住 (default text) → 選項 → 建議 → 補充. A row with nothing to say is not drawn. The option row keeps the Buttons, `[x]` bold when picked, `[ ]` otherwise; the picked option's description stays under it as dim text at column 12.
- **`★` has one meaning:** it marks the recommended option and is drawn on the option only. 建議 reads `<recommended option>：<reason>` in default text with no `★`; without a reason it is the option alone; a recommendation that matches no option is written as given.
- **補充** is the key, with the Input at column 12 and the placeholder `選填，可留空` (`optional`). A question with no options uses the key 回覆 and the old placeholder. A surface without Input keeps the "answer in the conversation" line.
- **來源** is not drawn: it is a code name for the assistant, and it stays in the decision file.
- **Send row**: `[ 送出（已選 n/m） ]` followed by a dim note, `答案會貼進這個對話送出` (`answers are pasted into this conversation`); a note that does not fit beside the button wraps below it at column 2. The button's behaviour is unchanged.

**Bold** gains one use, `question title` (`BOLD_USES`; `boldUseOf` accepts a segment of role `title` on an `item` line). I4 still reads only `boldUseOf`; a bold on a background value, or a title segment that lost its role, is flagged (negative controls in `decide.test.ts`).

**Blank lines are now drawn.** `blank()` had always been emitted (the header's trailing blank, and the one after each card), but `pane.tsx` drew it as an empty `<Text>`, which takes no row, so no blank was ever on screen, including the line §4 requires between the header and the first section. `pane.tsx` now draws a blank as a one-cell Text, on every tab, and `treeRowCount` counts every line as a row. The rule of §4 is unchanged except for one exception: a 待決 card is closed by one blank, so cards are told apart by a drawn empty row; the other tabs have no blank in the body.

**Wrapping.** `wrapPlain` no longer starts a continuation line with a closing mark (`）」』、。，；：！？`): the character before it goes down with it.

### 12.7 The 殘留 tab

The owner called the tab 「亂亂的」. Seven defects: (1) a worktree that is merged and safe to delete shared the yellow `▲` and the count of one that needs a decision, which inflated the tab name, 現況's row and summary and the band's `⚑N`; (2) an entry needed two folds (group, then item) to show its reason and command, and the fold mark sat at the right edge while section headers fold at the left; (3) an item was named by a tail cut of its path (`…390b66014e3cf`); (4) the reason was the producer's English (`1349 uncommitted path(s)`); (5) a group row repeated the item count of the rows under it; (6) the auto-cleanup row opened with `∅ 不需要`; (7) any `stale_cache_dirs` flag made the plugin source `▲`, twice (header and row), and raw codes (`dev`, `marketplace_not_directory`) said nothing about what to do.

**Two kinds, one table.** `ui.RESIDUE_KINDS` maps a producer class to `judge` (the owner decides: `dirty`, `clean-unintegrated`, `unintegrated-branch`, `unverifiable`, and any class the table does not name), `clean` (safe to clear: `clean-integrated`, `missing-dir`) or `live` (in use, never listed). Every count comes from `residueTally` (model.ts), which reads that table: the tab's chip, the tab name's attention (`tabNeeds`), 現況's `now.residue` row, 現況's summary row, and the band's `⚑N` (including the no-scope path that reads the auto-reap result file). The producer's list is capped at 20; an entry it counted but did not list is counted as `judge` (the safe side). A `clean` entry never counts as needing the owner. 現況's summary reads `1 個要你看 · 2 個可清 · 598 MB` (`en`: `1 to look at · 2 to clear · 598 MB`) and is not yellow when nothing is to judge.

**Sections**, in `SECTION_ORDER.hygiene`: `attention` (要你處理, `N · size` chip, the empty line when nothing is to judge), `cleanable` (可以直接清掉, the same chip, not drawn when empty; registered in `SECTION_DEFAULTS`, open), `auto`, `source`. At most 5 entries per section; the rest sit behind the shared `還有 N 項` row (`more:residue.attention` / `more:residue.cleanable`).

```
▾ 要你處理  1 · 285 MB ───────────────────────────────────────────────────
▲ agent-a16d390b66014e3cf                                    1d04h · 285 MB
  有 1349 個檔案沒提交，先看內容再決定要不要刪
  $ git -C '/home/cookys/projects/autopilot/.claude/worktrees/
    agent-a16d390b66014e3cf' status --short
▾ 可以直接清掉  2 · 313 MB ────────────────────────────────────────────────
◦ release-3.0.0                                              4d12h · 313 MB
  已合併，可以刪
  $ git -C '/home/cookys/projects/autopilot' worktree remove '...'
▾ 自動清理 ───────────────────────────────────────────────────────────────
上次        23h51m 前 · 沒有清掉東西
▾ 外掛來源 ───────────────────────────────────────────────────────────────
✓ 開發目錄 · /home/cookys/projects/autopilot · v3.0.0-alpha.6
  舊版快取 2.36.36 沒有程式在用，可以刪
  $ rm -rf /home/cookys/.claude/plugins/cache/autopilot/autopilot/2.36.36/
```

- **Entry** (`ui.residueRows`): a name row (the state's mark for `judge`, the neutral `◦` for `clean`; the last path segment whole, a branch by its name; too long, it is cut from the **tail** with `…`; dim `age · size` at the right edge), the reason at column 2 (dim, `residue.why.<class>` in both locales; `dirty` takes its number from `^(\d+) uncommitted` and falls back to a sentence without one; an unmapped class shows `residue.class_raw` and the producer's text), and the producer's `command` through `ui.command` (`$`, wrapped, never cut), omitted when there is none. Nothing folds.
- **Auto cleanup** is a key/value row, key `上次` (`last run`): `{age} 前 · 沒有清掉東西`, `{age} 前 · 刪了 {wt} 個 worktree、封存 {br} 條分支`, or `還沒跑過`. No state mark.
- **Plugin source**: the section header carries no state chip (§12.2: the attention is drawn once per surface). The row is a mark, the source's name (`dev` → 開發目錄, `cache:<v>` → 快取版 <v>, anything else → 讀不到外掛來源) and dim meta (the marketplace path for `dev`, the version). It is `▲` only when the owner would run the wrong copy: the source is not the dev directory, `marketplace_not_directory`, `marketplace_not_this_repo`, `dev_link_missing_or_stale`, or `behind_upstream > 0`; otherwise `✓`. A stale cache directory alone is information, not a request. One dim sentence per flag follows, with a command where there is a fix: a stale directory no live process uses → `舊版快取 {v} 沒有程式在用，可以刪` + `$ rm -rf {dir}/`; one with a live pid → `…還有程式在用（pid …），先不要刪` and no command; a marketplace or dev-link flag → the sentence + `$ bash {marketplace_path}/scripts/dev-setup.sh` (no command when the path is not absolute); `behind_upstream` → `落後遠端 {n} 個提交`; an unknown flag → `其他旗標：{flag}`. Nothing folds.
- **Tab name and the plugin source:** the 殘留 tab name reads the residue judge count and the shared `sourceStateOf` (tabs.ts): it turns yellow when something needs judgement or when the 外掛來源 row shows ▲, and not for an old cache copy alone. 現況's attention row and the band's `⚑N` stay residue-only; the band's source chip keeps its own text.

**Enforcement.** `mods/live/hygiene.test.ts` pins the owner's real data at 76 columns and each rule; each control breaks a rule on purpose (a `clean` class counted as `judge`; a stale-only source drawn `▲`) and the suite must go red. The command is now drawn in the default render of this tab only, so the "no command by default" check of `now.test.ts` exempts `hygiene` and keeps its control on the other tabs.

### 12.9 Buttons: safe actions are buttons, and a button looks like one (owner rulings 2026-10-16)

Owner: 「這邊應該不用顯示指令？直接給清理按鈕？整個 panel 邏輯應該都是這樣？」 and 「選項其實應該放固定位置？可以點擊或按的應該要有辦法標示？」

1. **A safe action is a button, not a printed command.** Where the pane can do a safe, re-checked action for the owner (clear a merged worktree), it draws a button and no `$ ` line. A command is printed only when the owner must run it by hand: the action failed (the failure note first, the command under it), the entry is yours to judge (a dirty worktree, an unmerged branch), no safe entry point exists for it, or the surface has no buttons (a phone). A button never builds a delete of its own: it calls the one entry point that classifies again at that moment (`repo-residue-sweep.js reap --yes --worktree <path>`), and an id that is not in the snapshot's current clearable list does nothing. An old plugin cache copy no program uses (the 外掛來源 row) follows the same rule through `scripts/prune-plugin-cache.js --version <v>`, which re-checks the path, the `.in_use` pids and the loaded copy before it deletes; `[ 全部清掉 ]` counts it with the worktrees. The `?` tab explains the colour (`legend.action`). The buttons run those two scripts through `$.process.run` (argument vector, no shell, no confirmation dialog; owner ruling 2026-10-16, d-7a7ee75c), and `ui-lint.test.js` allows `$.process` for exactly that whitelist and nothing else.
2. **Pressable is one colour.** Everything the owner can press is drawn in the `action` role (`merged`), text colour only: the `[ ... ]` button, a pressable option of a decision card (`[ ] label`, `[x] label`) and the send button. Explanatory text, the `★` recommendation and a sent card's options stay default text or dim. `action` means "you can press this" and nothing else (§12.1); a state never uses it.
3. **States of a button.** Not picked: `action` colour, regular weight. Picked: `action` colour, bold, `[x]` (the existing `picked option` bold use). Recommended: `★` in default text before the label. Cannot be pressed (nothing chosen yet, already sent): dim, no colour, no press id. The send button stays on the bold whitelist as `send button`; the residue buttons are regular weight, so §12.3 gains no entry.
4. **Fixed positions.** One kind of action sits in one place on every card and section: a decision card's options start at column 12 (the key `選項` at column 2) and its send button is the last row of the tab at column 2; a 殘留 entry's `[ 清掉 ]` is the entry's last row at column 2, and a section's `[ 全部清掉（N 個 · size） ]` is the section's first row at column 2 (drawn only when two or more entries can go; it never covers an entry to judge). After a press the button row is replaced in place by one dim line (`已清掉`, or `沒清掉：<why>` and the command).
5. **Keyboard.** The host draws the focus ring on a `Button`; the pane only keeps every pressable run one `Button` (consecutive segments of one press id) and the `›` chip first in focus order (§12.5, `legend.keys`). Whether a focused button is visibly marked is the host's; the mod has no focus state to draw (unverified: no focus API in `$` was found).

Enforcement: `hygiene.test.ts` (cleanup buttons: present, no command, batch is the section's first row and holds only clearable worktrees, negative control puts a judged class on the clearable list and the safety assertion goes red), `live.test.ts` (mounted: the press runs the sweep with `--worktree`, a kept worktree shows its reason and command), `decide.test.ts` (a picked option is `action` and bold), L8 (the new key is a PALETTE role only).

### 12.8 Dispatch, review and now: wording and one source (2026-10-16)

An audit of the three tabs found facts that were drawn from two places, words an owner has to translate, and states that said nothing. Six changes:

1. **No idle foreman line.** The dispatch tab no longer draws `工頭狀態：來源未接` when no foreman runs. The watcher deletes the foreman sidecar when it idles, so `null` means "no foreman now", not "not wired". `PaneSections.foremanNotWired` and the string `foreman.not_wired` are removed; a foreman line exists only while there is something to say.
2. **One review pointer.** The 其他分頁 `審查 ›` row on 派工 is now the same `reviewPointer()` (tabs.ts) as on 現況, with the same fact `review.round`. It no longer reads the job page's gates, so the old strings (`沒有審查回執`, `N 道審查關卡`, `還沒有審查頁`) are gone and the two tabs cannot disagree.
3. **`idTail` never starts with a separator.** The left cut of an identifier dropped its head and could leave `…-1349925-c899`; the leading `-`/`_`/`.` after the ellipsis is now removed (`…1349925-c899`). Negative control: without the strip the `idTail` test is red.
4. **審查 wording.** `推送前 QC` is `推送前檢查`; the scope row says `沒有改到受保護檔案` for zero and `改到 N 個受保護檔案` otherwise; `代你決定` is `我替你決定的事` (empty: `— 還沒有替你做決定`; the status line says `替你決定 N 件`); `未記錄 N 件派工沒有決策紀錄` is the dim kv `沒寫理由  N 次派工`; `升級階梯` is `卡關升級` and the row is not drawn when there is no record; `沒有 QC 狀態` is `沒有推送前檢查的狀態`. English follows.
5. **F6, an abandoned plan review.** A non-terminal plan review untouched for more than `FRESH_MS.abandonedPlan` (604_800_000, §2.5) used to stay a `◌ 已停` section forever. It now fades to one dim line, `計畫審查 {id} 在 {ago}停下，沒有收尾` (key `review.plan_abandoned`), as F3 does for a finished one; it is worded as stopped, because it did not end. The I11 fixtures at `T−1`, `T`, `T+1` pin it (the second still a section, the third one line).
6. **Progress without a total.** `progress.unfrozen` reads `已完成 {n} 項` (no `*`; §3.5 says never `N*`), on the status line too. 現況's `進度` row adds a dim ` · 沒有固定總數` when the total is not frozen, so the missing denominator is said in words; a frozen total is the percent and nothing after it.

Enforcement: `review.test.ts` (F6, the busy-world golden, which now shows the 27-day plan review as one line), `ui.test.ts` (`idTail`), `live.test.ts` (the 現況 progress row, the shared pointer, no idle foreman line).
