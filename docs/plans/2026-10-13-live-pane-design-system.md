# Live pane design system — one IA, one visual vocabulary, enforced in code

Status: **draft for owner review** (2026-10-13), revised once after the G1 plan review (§10). Plan only; no product code changed. The dispatch tree (formerly P6) moved to [`2026-10-13-dispatch-tree.md`](2026-10-13-dispatch-tree.md).
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

Line 1 is the verdict glyph and word (bold, in the verdict's state colour), the project (bold) and the elapsed time (dim). Line 2 holds the metrics (dim). At ≥ 110 columns, if both fit with a gap of at least 4 cells, they merge into one line with the metrics right-aligned. The verdict's reason does **not** go in the header. In 現況 it becomes the first item under 要你處理 (when it asks something of the owner) or the first row of 位置. A test asserts that the header lines are byte-identical across the five content tabs (§6, I9).

### 2.3 What 現況 keeps and what it hands off

| Today in 現況 | New home | 現況 keeps |
|---|---|---|
| 今日花費 section (spend bar) | 用量 | one 用量 row: brain amount / cap, a 10-cell meter, the percent, and the most-used quota window |
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

| Item | Rule (data already published) | Drawn as |
|---|---|---|
| background command | its last output line matches `^\[exited with code (\d+)\]$` | `✓ 完成` (code 0) or `✗ 失敗` (non-zero), moved behind `▸ N 項已結束` |
| background command | no exit marker, quiet > 30 min (`quietMs`) | `◌ 已停 · 6h04m 前有輸出`, behind the same toggle |
| plan review | not `terminal` and `updated_at` older than 24 h | section header `◌ 已停 · 27d 前`, folded by default, moved to the bottom of 審查 |
| plan review | `terminal` and older than 7 d | one dim line inside 審查's history; no section |
| code review | `at` older than 24 h and not converged | `◌ 已停`, same treatment |
| dispatch row | finished (`rc` or `final_status` set) and ended (`started_at + elapsed_s`) more than 24 h ago | counted in the header chip only, not listed |

Thresholds live in one table in the ui module (§6), not in each tab.

### 2.6 Ownership: every fact has one home tab (answers G1 R2)

Each fact has exactly one **owner tab**, where its rows, its raw detail and its verdict live. Any other tab may show it only as a **projection**: a line that points to the owner, derives its state from the same `stateOf` call, and carries no detail of its own.

| Fact | Owner | May be projected on | Projection carries |
|---|---|---|---|
| run lineage, run state, age, engine and model (dispatch rows) | 派工 | 現況 | worst state, counts, last-ended age |
| code-review round, seat verdicts, pre-push QC, review pages (gates), plan review | 審查 | 現況, 派工 | worst state, a count, the round id. **Never** a seat row or a verdict word |
| decisions made for the owner, escalation ladder, undocumented dispatch count | 審查 | 現況 | a count |
| background commands, tasks, recent prompts, stage walk, needs-you list | 現況 | none | n/a |
| brain cap, 5 h and 7 d quota, spend, hourly history, account | 用量 | 現況 | the most-used window, percent, amount |
| residue groups, cleanup, plugin load source | 殘留 | 現況 | worst state, count, size |
| global header (verdict, project, elapsed, metrics) | `pane.tsx` | n/a | drawn once, above every tab |

Rules:

1. A projection is a `kv` or `item` line with `goto` (§4) and a `fact` tag. A line whose `fact` is owned by another tab without `goto` is a defect.
2. A projection is one line per fact. It never lists the owner's rows.
3. 派工 draws no review verdict. Its former 「審查關卡」 section becomes one pointer row, `審查 ›  <count of review pages or 還沒有審查頁>`, in a section 其他分頁.
4. The 要你處理 list in 現況 is the one place that mixes owners; each of its items is either 現況's own (tasks) or a projection with `goto`.
5. The ownership table is data in `ui.ts` (`FACT_OWNER`), and invariant I17 checks it (§6.3).

## 3. Tokens

### 3.1 Layout grid

Every body line starts at one of four columns (display cells; a CJK character is 2):

| Column | What starts there |
|---|---|
| 0 | section header, key of a key/value row, glyph of a list item or bullet or table row, the empty-state dash |
| 2 | text of a list item, table header, `more` toggle, standalone note, `└` of a detail line, `$` of a command |
| 4 | text of a detail or command line, including its wrapped continuation lines |
| 12 | value of a key/value row (`KEY_W` stays 12: zh labels up to 6 characters), and a list item nested in a value (the second and later seats under `席位`) |

Wrapped lines hang at the column their own text started at. No line is wider than `cols`. A table's internal columns are computed per table, but its first glyph is at 0 and its header at 2.

### 3.2 Status vocabulary: ten states

A state is one glyph, one theme key and one zh word, always together. Glyph and word are coloured; the rest of the line is not.

| State | Glyph | Theme key | zh | en | Meaning |
|---|---|---|---|---|---|
| `need_you` | `▲` | `warning`, bold | 要你處理 | needs you | a person must act |
| `failed` | `✗` | `error` | 失敗 | failed | ended badly (rc ≠ 0, rejected) |
| `stalled` | `⊘` | `error` | 疑似卡住 | stalled | should be moving and is not |
| `findings` | `△` | `warning` | 待修 | to fix | ended with findings someone else will fix |
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
stateOf<D extends Domain>(domain: D, subject: Subject[D]): Stated   // Stated is branded; only stateOf makes one
```

`Subject[D]` is the structured object the model already has (a `LiveRunRow`, a `ReviewRound`, a `LoadSource`), or a bare token for the token-only domains (`seat`, `gate`, `qc`, `task`, `verdict`). Step 1: `classify<D>(subject)` returns one **atom** by walking the precedence list below top to bottom; the first condition that holds wins. Step 2: `STATUS_MAP[D][atom]` gives the `StateId`. Token normalisation happens once, in `classify`: `trim()` then upper-case, and a prefix class (`NEEDS*`, `CACHE:*`) becomes one atom. An atom that is not in the map is `unknown`; the raw text goes to `detail`. `stateOf` is the only producer of `Stated`, and the components accept only `Stated` (§6.1), so a tab cannot pick a state by hand.

| Domain | Precedence (first match wins) → state |
|---|---|
| verdict | `DECIDE`→need_you · `STALLED`→stalled · `WAITING`→done · `RUNNING`→running · `IDLE`→stopped |
| run (dispatch row) | 1 `rc ≠ 0`, or `final_status` in `failed / error / killed`→failed · 2 `rc = 0`, or `final_status` in `reviewed / done / ok`→done · 3 `stall:true`→stalled · 4 no `rc`, fresh→running · 5 otherwise→stopped. An ended fact (1, 2) beats `stall`; failure beats success when `rc` and `final_status` disagree |
| seat (code or plan review) | code: `SHIP-AS-IS`→done · `FIX-THEN-SHIP`→findings · `BLOCK`, `REJECT`→failed. plan: `READY`, `APPROVE`, `PASS`→done · `CONDITIONAL`, `STOP`→findings (Q5) · `REJECT`→failed. No verdict: status `running`→running, status `reviewed`→done, otherwise→unknown |
| round (code or plan review) | 1 stale (§2.5) and not converged→stopped · 2 any seat running→running · 3 any seat failed→failed · 4 any seat findings→findings · 5 all seats done, or `converged`→done. A round with findings **and** a running seat is `running`: the round is not over, and the findings count rides in the header chip's meta (`● 執行中 · 1 席已有發現`) |
| gate (`LiveGateRow.verdict`) | `PASS / OK / ACCEPT / APPROVED / CONVERGED`→done · `OPEN / OWED / NEEDS*`→need_you · `FAIL / REJECT / BLOCK`→failed |
| QC (`QcView.state`) | `OK`→done · `OWED`→need_you · `NOT_NEEDED`→skipped · `UNKNOWN`→unknown |
| background item | 1 exit marker `≠ 0`→failed · 2 exit marker `0`→done · 3 quiet ≤ 30 min→running · 4 otherwise→stopped. The marker beats the quiet clock |
| task | `COMPLETED`→done · `IN_PROGRESS`→running · `PENDING`→pending |
| loadSource (source + `behind` + flags) | 1 source `CACHE:*` or `MISSING`→need_you · 2 `behind > 0`, or any flag→need_you · 3 source `DEV` or `DIRECTORY`→done. So `dev` + behind is `need_you`, which is what the 殘留 mockup draws |

Aggregates (the 各分頁 summary rows, a header chip over several rows) take the **worst** state under one total order, defined once as `SEVERITY`: `need_you > failed > stalled > findings > running > stopped > pending > done > skipped > unknown`. `unknown` ranks last so a missing mapping never hides a real finding, and it is still counted in the chip so it is not silent.

A raw token (`SHIP-AS-IS`, `reviewed`, `not_needed`, `[exited with code 0]`, `warn`) may appear **only** in a `detail` line, which the owner opens on purpose. Tokens that are identifiers, not states (run ids, engine and model ids, family names, shas, commands, paths), stay as they are: the i18n plan already keeps them untranslated. Residue classes (`dirty`, `clean-integrated`, `unintegrated-branch`, `missing-dir`) and the fuse mode get string-table labels (`有未提交變更`, `只提醒、不擋`).

### 3.4 Glyph rules

1. **No glyph that a terminal may draw as an emoji.** The test is `\p{Extended_Pictographic}`, not `\p{Emoji}`: the `Emoji` property also matches every ASCII digit, `#` and `*` (keycap-sequence bases), which would reject the pane's own numbers. Measured in Node: `⏸ ⚙ ⚠ ✔ ✖ ▶ ⏹ ⏺ ▪ ▫` are Extended_Pictographic; every glyph in §3.2 and the structure/chart tables (`▲ ✗ ⊘ △ ● ✓ ○ ◌ ∅ ◦ › ▾ ▸ └ ─ ━ ▰ ▱ ◐ ⚑ ↺ ◆`) is not. The explicit `EMOJI_BANNED` list repeats the ten above so the rule still holds if a Unicode update moves a property. It is checked on the glyph table and on glyph segments only, plus a separate check for the emoji variation selector U+FE0F and the keycap mark U+20E3 anywhere (§6, I5). Replacements: stalled `⏸` → `⊘`; dispatch count `⚙N` → `●N` (the running state, counted); the hygiene chip's `⚠` → `▲`.
2. **One glyph, one meaning, across band and pane.** Glyphs fall into three groups and do not cross: state glyphs (§3.2), structure glyphs (`▾ ▸` fold, `─` rule, `└` detail, `$` command, `›` go to tab, `◦` neutral bullet), and chart glyphs (`▰ ▱` meter, `▁…█` sparkline, `◐` "you are here" in the stage walk). `⚑N` stays as the residue count in the band and on the 殘留 tab badge only (owner-approved 10-10); the pane body uses `▲`. The strip's `▸` "next" chip (`pane.tsx` `tabStrip`) is the one exception left; P5 replaces it with `›` so that `▸` means only "folded".
3. **The stage walk uses state glyphs for its nodes:** done `✓` success, current `◐` claude bold, to come `○` inactive (`✓─✓─◐─○─○`). `●` (running) no longer means "done node".
4. **Width.** `◐ ● ○ ▲ △ ◆ ─ ━ └ · …` are East Asian *Ambiguous*: a CJK-locale terminal may draw them 2 cells wide (the `ⓘ` comment at `model.ts` 1461 records this happening for `ⓘ` on the owner's terminal). The owner's screenshots show `● ▲ ─ · └ ◆ ▰ ▱ ✓ ▾ ⚑ ↺` at one cell. Every glyph that is new to the vocabulary must pass the real-terminal check in P0 before it ships: `⊘ △ ○ ◌ ∅ ◦ › ━ ◐`.

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

`ia.md`'s colour table stands, with four corrections that bring the code back to it:

- `claude` only marks "you are here": the current stage node and label, the current unit cell, the active tab. The section accent `▌` goes away, and fold glyphs are `subtle`.
- `suggestion` only goes with the `running` state. Charts use default text, with `inactive` for the remainder; recent-prompt toggles use `subtle`.
- `warning` / `error` appear on a state glyph and its word, or on a meter bar and its percent. They are never used for a whole sentence.
- Backgrounds: none in the body. For the active tab, see Q1.

Emphasis:

- **bold** is used for a section title, the verdict word and project, the text of a `need_you` item, and the one headline value of a meter. Nothing else.
- **dim** is used for keys, units, ages, hints, notes, commands, detail lines, every line of a `stopped` item, and empty states.
- Never bold and dim on one segment. Never more than one bold value per line outside the header.

## 4. Components: the only line builders tab code may call

Every component returns `PaneLine`s stamped with a `kind`, and the tests check per kind (§6). A `PaneLine` can only be made by these components (§6.1: branded, unexported constructor). Components take a `Stated` (from `stateOf`, §3.3), never a raw `StateId` or glyph. Examples are at 76 columns.

**`header(title, right?, fold)`** (kind `header`): `▾`/`▸` (subtle), the title (bold), optionally two spaces and a right-hand chip (a state, a count or a meter level), then a `subtle` rule to `cols - 1`. Every section uses it, and every section folds, 要你處理 included (it never starts folded), so `▾ ▸` always mean the same thing.

```
▾ 程式碼審查  △ 待修 ─────────────────────────────────────────────────────
▸ 計畫審查  ◌ 已停 · 27d 前 ──────────────────────────────────────────────
```

**`kv(key, …value, {goto?, fact?})`** (kind `kv`): key dim, padded to 12 cells; value at column 12. An absent value is `—` followed by a dim reason. With `goto`, the key gets a trailing ` ›`, the whole row is a press target, and `fact` names the projected fact (§2.6); the summary rows in 現況 are these.

```
輪次        R1 · 4abd667f..10c5c086
升級階梯    — 沒有紀錄
```

**`item(stated, text, meta?, {at: 0 | 12, goto?, toggle?, word?, fact?})`** (kind `item`): state glyph, the state word padded to the widest word in the list, the text, then dim meta after ` · `. A `toggle` puts `▸`/`▾` at the right edge of the row. The state word is required, with one exception: `word: false` is allowed only inside a list whose section header chip already names the same state (the 要你處理 list under `▲ 要你處理`, the 殘留 groups under their chip), so the word is never lost, only not repeated on every line. I21 checks that the chip state equals the item state.

```
▲ 1 個 worktree 要你處理                                            殘留 ›
席位        ✓ 完成  s0 · anthropic
            △ 待修  s1 · zhipu
```

**`bullet(text, meta?, {toggle?})`** (kind `bullet`): a neutral `◦` at column 0 for a row that has no state (a decision made for the owner, a residue item), text at 2, dim meta after ` · `. With `toggle` the right edge shows `▸`; open, it shows `▾` and the row's `detail` and `command` lines follow it. An opened row keeps its own bullet line; there is no separate bespoke header row.

**`table(columns, rows)`** (kind `table`). Each column has `{head, min, priority, flex?, cut: 'left' | 'right'}`. If the table is too wide, the lowest-priority column is dropped first; then the `flex` column is cut to fit (an identifier from the left); the remaining columns are cut down to their `min`. It **never** falls back to key/value blocks. The first column is always the state glyph and word.

```
  狀態    編號           角色      引擎 / 模型                已跑  結束
✓ 完成  …2418470-c58e  reviewer  claude-native / claude-fa…  1m    5h40m 前
```

**`meter(value, cap, {cells, label})`** (kind `meter`): key, bar, percent right-aligned in 4 cells, then the amount. The bar and percent take the meter level's colour (< 80 % success, ≥ 80 % warning, ≥ 100 % error). The level word (正常 / 接近上限 / 已超過) is used only as a header chip. The separate `▲` tick line goes away.

```
brain 今日  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00
```

**`empty(reason)`** (kind `empty`): `—` at column 0, dim reason at 2. At most one per section; two reasons merge into one line.

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

**`detail(text, {attached})`** (kind `detail`): `└` at 2 when it belongs to the item above, plain at 2 when it is a section note; text dim at 4. This is the only kind allowed to carry raw tokens.

```
  └ SHIP-AS-IS · reviewed · 1m
```

**`chart`** (kind `chart`): the stage walk and the sparkline. Each is a two-line unit, value line plus caption, both starting at column 12.

**`verdictHeader`** (kind `verdict`): the global header (§2.2), drawn by `pane.tsx` above every tab rather than by the tab builders.

Blank lines: one between the global header and the first section; none inside the body, where the header rules separate sections.

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
審查 ›      △ 待修  程式碼審查 R1 · 1/4 席待修 · QC 不需要
用量 ›      ▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00 · 5 小時 42%
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
審查 ›      △ 待修  程式碼審查 R1 · 4abd667f..10c5c086 · 1/4 席待修 · QC 不需要 · 代你決定 3 件
用量 ›      ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  117%  $175.33 / $150.00 · 5 小時 42% · 7 天 18%
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
審查 ›      還沒有審查頁
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
審查 ›      還沒有審查頁
  這是執行狀態，不是進度 · 快照 01:42 · 工作階段花費截至 01:41 · 本機花費截至 01:40
```

With a live run, the 執行中 table adds a `最後回報` column (priority 3) in place of `結束`, and a stalled run reads `⊘ 疑似卡住` in `error`. At 40 columns the table keeps state, 編號 (cut from the left) and 已跑; the other columns are dropped in priority order.

### 5.3 審查

<!-- cols:76 -->
```
‹strip + header›

▾ 程式碼審查  △ 待修 ──────────────────────────────────────────────────────
輪次        R1 · 4abd667f..10c5c086
席位        ✓ 完成  s0 · anthropic
            △ 待修  s1 · zhipu
            ✓ 完成  s2 · minimax
            ✓ 完成  s3 · alibaba
▾ 推送前 QC  ∅ 不需要 ─────────────────────────────────────────────────────
範圍        5a2706ad..HEAD · 0 個受保護檔案
▾ 代你決定  3 件 · 0 件不可逆 ─────────────────────────────────────────────
◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/w…        ▸
◦ intent-17-2  Owner answered (supersedes intent-17-1): directio…         ▸
◦ verify-17-1  verify node, no qualified verifier seat (engine-s…         ▸
未記錄      32 件派工沒有決策紀錄
升級階梯    — 沒有紀錄
▸ 計畫審查  ◌ 已停 · 27d 前 ───────────────────────────────────────────────
```

A decision opened by a press (`toggle` id `dec:<id>`). The bullet row stays where it was and gains `▾`; the rationale is a `detail` line (prose, so it may hold English text) and the veto is a `command`:

<!-- cols:76 -->
```
◦ intent-17-1  可逆 · depth0                                              ▾
    #17 direction: A (keep the native <repo>/.claude/worktrees root for
    hand/native worktrees, no WorktreeCreate takeover; rail worktrees
    carry the repo slug; …). Owner did not answer within 60s; A is
    reversible and the smallest surface.
  $ decision-ledger.js veto --ledger /home/cookys/projects/autopilot/
    .git/autopilot/ledger/decisions.jsonl --id intent-17-1
```

<!-- cols:120 -->
```
‹strip + header›

▾ 程式碼審查  △ 待修 ──────────────────────────────────────────────────────────────────────────────────────────────────
輪次        R1 · 4abd667f..10c5c086 · 4 席
席位        ✓ 完成  s0 · anthropic
            △ 待修  s1 · zhipu
            ✓ 完成  s2 · minimax
            ✓ 完成  s3 · alibaba
▾ 推送前 QC  ∅ 不需要 ─────────────────────────────────────────────────────────────────────────────────────────────────
範圍        5a2706ad..HEAD · 0 個受保護檔案
▾ 代你決定  3 件 · 0 件不可逆 ─────────────────────────────────────────────────────────────────────────────────────────
◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/worktrees root for hand/native worktrees, no Worktr…  ▸
◦ intent-17-2  Owner answered (supersedes intent-17-1): direction C = A plus moving the dispatch-rail worktrees (h…   ▸
◦ verify-17-1  verify node, no qualified verifier seat (engine-scorecard current --role verifier: none admissible…    ▸
未記錄      32 件派工沒有決策紀錄
升級階梯    — 沒有紀錄
▸ 計畫審查  ◌ 已停 · 27d 前 ───────────────────────────────────────────────────────────────────────────────────────────
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

Expanding a group lists its items one line each; expanding an item shows its reason detail and its command:

```
▾ 已整合，可清理  12 個 · 280 MB
  ◦ agent-a242acf7  0d · 24 MB                                     ▸
  ◦ agent-a3379d38  0d · 22 MB                                     ▾
    └ clean · HEAD 已在 origin/develop
  $ git -C /home/u/proj worktree remove
    /home/u/proj/.claude/worktrees/agent-a3379d38
  ▸ 還有 10 個
```

At 120 columns the lines are the same; only the rules are longer, and an expanded command fits on one line. Worktree names are 14 cells and are never cut; a longer identifier is cut from the left (§3.5), and a command is never cut.

"已整合" is measured against the newer of `develop` and `origin/develop` (the same rule `session-mode.js` uses for `base_ref`). The 2026-10-13 screenshot showed 17 lane worktrees as `clean-unintegrated` although their commits were on `origin/develop`: the main checkout's `develop` was 54 commits behind. That classifier fix is a separate bug with its own red test, like diagnosis 11.

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

- **`mods/live/ui.ts` (new)** owns: `STATES`, `STATUS_MAP` + `classify*` + `stateOf` + `SEVERITY` (§3.3), `GLYPHS` (state, structure and chart tables) + `EMOJI_BANNED`, `FRESHNESS` thresholds, `FACT_OWNER` (§2.6), `SECTION_DEFAULTS` (which sections start folded), `GRID = [0, 2, 4, 12]`, `KEY_W`, the formatters (`money`, `pct`, `dur`, `ago`, `clock`, `size`, `sha`, `idTail`, `count`) and the components in §4. `seg`, `row`, `padCells` and the `ThemeKey` strings exist only here and are not exported.
- **`mods/live/tabs.ts` (new)** holds the tab builders, moved out of `model.ts` (`nowLinesRaw`, `dispatchLinesRaw`, `reviewTabLinesRaw`, `spendTabLinesRaw`, `hygieneTabLinesRaw`, `legendLines`, `activityLines`, `accountLines`, `recentLines`, `needsYouLines`). It imports components and formatters from `ui.ts` and data types from `model.ts`. It never imports `seg`, `row` or theme keys, and it never writes a glyph literal.
- **`PaneLine` is opaque (answers G1 R4).** `kind` becomes a required field (`'verdict' | 'header' | 'kv' | 'item' | 'bullet' | 'table' | 'meter' | 'empty' | 'more' | 'command' | 'detail' | 'chart' | 'blank'`), and `PaneLine` gains `goto?: PaneTab` and `fact?: FactId`. Making one is possible only through `ui.ts`: the constructor `mk()` is not exported; it adds the line to a module-private `WeakSet` and the type carries a brand from a non-exported `unique symbol`, so `{kind:'kv', text:'x'}` neither type-checks nor passes at run time. `ui.ts` exports one read-only predicate, `isMade(line)`, for the tests. A `kind` field alone proved nothing (a hand-built object can carry it), which is why the brand and the `WeakSet` replace it as the evidence of "built by a component".
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
| I4 | every `kind:'header'` line matches `^[▾▸] \S.*─+$`, has the width `cols - 1`, and starts at column 0; no line anywhere contains `▌`; a bold segment occurs only in `header`, `verdict`, `need_you` items and meter headline values |
| I5 | (a) every `GLYPHS` entry fails `/\p{Extended_Pictographic}/u` and is not in `EMOJI_BANNED`; (b) every glyph segment (components tag them `role:'glyph'`) is in `GLYPHS`; (c) no line of any kind contains U+FE0F or U+20E3, and no line outside `kind:'detail'` contains an Extended_Pictographic character. Digits, `#` and `*` are legal everywhere (they carry the `Emoji` property as keycap bases, but are not pictographs) |
| I6 | colour pairing: a glyph segment's colour equals `STATES[state].key`; `claude` appears only on segments tagged `here`; `suggestion` appears only on `running` glyphs and words; no segment has `backgroundColor` or `inverse` (extends `expectThemeOnly`, live.test.ts 2127) |
| I7 | no segment tagged `role:'state'` or `role:'value'` (i.e. not free text: decision rationales and task subjects are `role:'prose'` and exempt) outside `kind:'detail'` contains a `STATUS_MAP` raw token (whole word, **case-insensitive**, matching the normalisation in `classify`: `SHIP-AS-IS`, `FIX-THEN-SHIP`, `CONDITIONAL`, `READY`, `STOP`, `reviewed`, `not_needed`, …), `[exited with code`, or `/\brc \d/` |
| I8 | formats, one assertion per formatter kind of §3.5: money (`/\$[\d,]+\.\d\d/`), percent (no `/\d %/`), duration (`/\b\d+h\d\dm\b/`, never `/\b\d+h\dm\b/`), relative time, clock, size, sha (8 hex), `idTail` (a cut identifier starts with `…`), prose cut (ends with `…`), count (no `/\d\*/`); and every number in a non-prose, non-identifier segment must come from a segment the formatters tagged (`fmt:`), so a hand-typed `'12 MB'` is red |
| I9 | (a) no tab builder emits `kind:'verdict'` (pure, over the matrix): only `pane.tsx` draws the header; (b) mounted: for each `PaneTab`, the rendered lines between the strip and the first body line are byte-identical for the same snapshot. Part (a) is what stops a tab drawing its own header; (b) alone would compare one function with itself |
| I10 | no two consecutive `kind:'empty'` lines; `沒有資料` text appears only in `empty` lines |
| I11 | freshness (`busyWorld`, one fixture pair per row of §2.5, each at the threshold and just past it): a non-terminal plan review at 24 h -> `◌` and folded; a terminal plan review at 7 d -> one dim history line, no section; a non-converged code review at 24 h -> `◌`; a finished dispatch ended 24 h ago -> counted in the chip, not listed; a background task with an exit marker is never `●`; quiet 30 min -> `◌ 已停`; 現況's 背景工作 section is `empty` + one `more` |
| I12 | collapse (`busyWorld`, 76 cols): 派工 has ≤ 22 lines, 0 `kv` lines in the runs sections, exactly 5 finished `table` rows and 1 `more`; every run is one line at every width ≥ 40. The same five-item cap with one `more` is asserted for every capped list (decisions, residue groups, finished tasks, ended background work) by I18 |
| I13 | mapping coverage and precedence: every subject in the fixtures classifies to a state that is not `unknown`; a planted token `WEIRD` renders `? 未知`, and `WEIRD` itself appears only in a `detail` line; **pairwise conflict fixtures** pin each precedence row of §3.3: run `stall:true` + `rc 0` -> done, `stall:true` + `rc 1` -> failed, `rc 0` + `final_status failed` -> failed; round with findings + a running seat -> running, with a failed seat + findings -> failed; background exit marker 0 + quiet 6 h -> done; loadSource `dev` + behind 54 -> need_you, `dev` + behind 0 -> done, `cache:x` + behind 0 -> need_you; lowercase and padded tokens classify like upper-case ones |
| I14 | the tab strip has exactly one active tab, no background (if Q1 is accepted), and each badge matches `^(▲|●\d+|⚑\d+)$` |
| I15 | the `?` tab contains every `STATES` glyph followed by its word (the legend is generated) |
| I16 | 現況 at 76 cols (`busyWorld`) has no 今日花費 or 帳號 section, and each summary row carries `goto` |
| I17 | ownership (§2.6): every line with a `fact` whose `FACT_OWNER` is another tab is a `kv` or `item` with `goto`, carries no `role:'state'` segment other than its single derived state, and is the only line for that fact on the tab; 派工 emits no seat verdict word and no line of fact `review.*` without `goto` |
| I18 | disclosure: in the default render no `detail` line and no `command` line is present, and no list shows more than 5 items (decisions, residue groups, finished runs, finished tasks, ended background; the seats of one round are counted separately); mounted: pressing an item or `more` toggle adds exactly its own `detail` / `command` / hidden items, pressing it again restores the default render |
| I19 | navigation and folding (mounted): pressing every `goto` line of `busyWorld` calls `onTab` with its tab; pressing a `header` flips its fold; the default fold of every header equals `SECTION_DEFAULTS` (要你處理 never starts folded; stale 計畫審查 and 最近對話 start folded) |
| I20 | vocabulary uniqueness and emphasis: no glyph character appears under two meanings across the state, structure and chart tables, and the ten `STATES` glyphs and words are pairwise distinct; no segment is both bold and dim; no line outside `header` and `verdict` has more than one bold value |
| I21 | uniform lists: an `item` with `word:false` sits in a section whose `header` chip state equals the item's state; every other `item` shows its state word |

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
| Bold / dim discipline (§3.6) | I20 | M13: a bold + dim segment; M14: two bold values on one line |
| Grid and widths (§3.1) | I1, I3 | M15: a 1-space indented note; M16: a line `cols + 1` wide |
| Section header form, no `▌` (§4) | I4 | M17: `{text:'▌ x', kind:'header'}` |
| One global header on every tab (§2.2) | I9 | M18: a tab builder emitting `kind:'verdict'` |
| Raw tokens only in detail (§3.3) | I7, I13 | M19: `SHIP-AS-IS` in a `kv` value; M20: lowercase `ship-as-is` |
| Total mapping and precedence (§3.3) | I13 | M21: swap the `run` precedence so `stall` beats `rc`; M22: planted token `WEIRD` shown raw outside detail |
| Uniform-list state word (§4 `item`) | I21 | M23: `word:false` under a chip of another state |
| Freshness, every row of §2.5 | I11 | M24: remove each freshness check in turn (six variants) |
| Five-item cap and one-line items | I12, I18 | M25: restore the block fallback; M26: decisions list uncapped |
| Details and commands hidden by default | I18 | M27: a `command` line in the default render |
| `goto` switches tab | I19 | M28: a `goto` line whose press handler is missing |
| Every section folds, with the declared default | I19 | M29: 要你處理 starting folded; M30: a header that ignores the press |
| One home per fact (§2.6) | I17 | M31: 派工 emitting a seat verdict `item` without `goto` |
| Empty states (§4) | I10 | M32: two consecutive `empty` lines |
| Legend generated from the tables | I15 | M33: a state added to `STATES` but not rendered |
| Active tab and badge form | I14 | M34: two active tabs |
| 現況 hands off 用量 / 帳號 | I16 | M35: 帳號 section back in 現況 |

## 7. Migration phases

Each phase ships on its own. Each runs `bash mods/live/run-tests.sh` alone (600 s) and ends with the rendered-screenshot check (memory `tui-verify-by-rendered-screenshot`: `capture-pane -e` → ansi2html → headless chrome → read the PNG) at 76 and 120 columns in zh-TW, with the owner's ssh + tmux in mind. Version stays on the 3.0.0 line (owner ruling 10-12: no bump without asking).

| Phase | Ships | Tests that change |
|---|---|---|
| **P0 measure + tokens** | (a) Real-terminal measurement: draw a 1-cell ruler line of `cols` cells in the pane and compare `bodyColumns` with the visible width (diagnosis 17). Fix `paneWidth` if it is off. (b) Glyph check in the owner's terminal for `⊘ △ ○ ◌ ∅ ◦ › ━ ◐`, results written into `GLYPHS.verified`. (c) `ui.ts` with tokens, formatters, components, `mk` / `isMade` and the `classify*` functions (§3.3); `PaneLine.kind` optional and tab code not yet forced through `mk`. (d) The `?` tab generated from `STATES` (I15). (e) Band glyph swap: `⏸`→`⊘`, `⚙N`→`●N`, hygiene `⚠`→`▲`. | `RICH_209` / `RICH_MID` / `RICH_SMALL` / `RICH_NARROW` and the band colour case (live.test.ts ~2085-2195) change glyphs; legend cases; new `ui-lint.test.js` with L3 only; I5 (a), I20 and the M7-M10 controls |
| **P1 審查** | `STATUS_MAP` and `classify*` for seats, rounds, gates and QC, with the pairwise conflict fixtures (I13); freshness for plan and code review; decisions as one-line items with `more`/`detail`; QC chip `∅ 不需要` | review-tab cases asserting `● 進行中`, `▲ 未收斂`, raw verdict words, `沒有代你做過決定`; invariants I1-I8, I10, I13 enabled for 審查 |
| **P2 派工** | `table` with column priorities; live vs finished sections; latest 5 + `more`; the 審查關卡 section replaced by one pointer row to 審查 (§2.6); footer as a note | the dispatch block-fallback cases are replaced; I12 and I17 enabled |
| **P3 用量** | meters (the tick line goes); account and quota move here; window labels; `pct` and `money` formatters; `SLOT_TAB.quota = 'spend'` | spend-tab cases (`117 %` becomes `117%`), the account/quota cases move from 現況 to 用量, and the band quota-press case now expects 用量 |
| **P4 現況 + global header** | `buildSections` returns data; summary rows with `goto`; background freshness (exit marker, 30 min); tasks show unfinished only; the reason becomes an item; `verdictHeader` in `pane.tsx` on every tab | the Now-tab cases (W3a tasks, attention, foreman rows, the activity cases) are re-pinned to the new lines; I9, I11, I16 enabled |
| **P5 殘留 + strip + lock** | 殘留 on components; the tab strip active mark (per Q1); `kind` becomes required in the type and every line must be `isMade`; `seg`/`row`/`rule`/`kv` removed from `model.ts`; L1, L2, L4, L5, L6, L7 switched on; every invariant over every tab | `expectThemeOnly(tree, allowTabBackground)` loses the background allowance if Q1 is accepted; `isActiveTab` (live.test.ts ~2139) keys on the new mark |


The separate scanner defect (diagnosis 11: why `scanBackground` never ended these tasks) is a bug fix with its own red test, outside this plan. The freshness rule in P4 makes the pane right even while that bug exists.

The dispatch tree (the former P6 and §7.1: nested dispatch lineage across subagents, rails, loop-back Claude children and fleet) is a separate plan by owner ruling 2026-10-13: [`2026-10-13-dispatch-tree.md`](2026-10-13-dispatch-tree.md). This plan has no dependency on it.

## 8. Open questions for the owner

**Owner ruling 2026-10-13: all five as recommended.** Q5: plan-review `STOP` maps to `△ 待修`, not `▲ 要你處理`.

1. **Active-tab mark.** The surface inverts the focused Button (d.ts), so a `subtle` background on the active tab looks like a second highlight (screenshot 3). Putting the focus ring on the active tab would combine inverse and background, which the 10-06 spike found unreadable. **Recommendation:** drop the background. Mark the active tab with bold `claude` text plus a `━` segment under it in the existing baseline rule (no extra row). When the strip wraps on a narrow pane, it falls back to bold `claude` text alone. This needs one real-terminal look in P5.
2. **Glyph swaps.** Owner ruling 2026-10-13: 要你處理 keeps `▲`; the person-like candidates `♙` (U+2659) and `⚇` (U+2687) were mocked up and declined. `⊘` for stalled (replacing `⏸`), `●N` for the band and tab dispatch count (replacing `⚙N`), and new `△` 待修, `∅` 不需要 and `◦` bullet. **Recommendation:** approve them, subject to the P0 terminal check; any glyph that fails falls back to the next candidate in the `GLYPHS` table (`⊘`→`◍`, `△`→`!`).
3. **Account and quota move to 用量**, and 現況 keeps one 用量 summary row with the most-used quota window. **Recommendation:** yes. The band's quota slot then opens 用量.
4. **完成待驗收.** Keep the verdict `✓` (the work is done) and put `▲ 等你驗收` in 要你處理 (your action), or make the verdict itself `▲`? **Recommendation:** keep `✓` plus the `▲` item. The verdict words are owner-approved, and "state of the work" and "your next action" stay separate.
5. **Verdict mapping.** Plan-review `STOP` and `CONDITIONAL` → `△ 待修`; `REJECT` / `BLOCK` → `✗ 失敗`; code `FIX-THEN-SHIP` → `△ 待修`. **Recommendation:** accept them. Confirm especially `STOP`: if a STOP seat should halt the plan and call you, it maps to `▲ 要你處理` instead (one line in `STATUS_MAP`).

## 9. Unverified (each is checked in the named phase)

- `bodyColumns` overstating the drawable width (P0 a).
- One-cell rendering of `⊘ △ ○ ◌ ∅ ◦ › ━ ◐` in the owner's ssh + tmux terminal (P0 b).
- Why `scanBackground` misses the end of these tasks (separate bug; P4 makes the pane right regardless).
- The `━` under-segment staying aligned with a tab label in a wrapped strip (P5; fallback defined in Q1).
- The quota numbers, reset times and residue row in the mockups are illustrative, not from the screenshots.

## 10. G1 意見處理

Source: the G1 plan review (seats `sol_deep`, STOP, 10 findings; `minimax_consult`, CONDITIONAL, 4 findings). Every finding has one row. The owner's five answers in §8 (active-tab mark, glyph swaps, account and quota to 用量, 完成待驗收 keeping `✓`, and the verdict mapping including plan-review `STOP` → `△ 待修`) are unchanged. No finding conflicted with them: R3 asks for a precedence rule and the mapping table keeps `STOP` → `findings`; R5's strip-glyph point is about the leading `›` chip, not Q1's active-tab mark.

| # | Finding | Disposition | Where |
|---|---|---|---|
| 1 | sol R1: P6 is undiagnosed and outside the declared scope | adopted by moving it out: P6 and old §7.1 are now their own plan, with a pointer line here | [`2026-10-13-dispatch-tree.md`](2026-10-13-dispatch-tree.md) §1; §7 pointer line |
| 2 | sol R2: review facts have two homes; no ownership matrix | adopted: field-level ownership table, projections defined as non-owning `goto` lines, 派工 gates become one pointer row, invariant I17 | §2.1, §2.6, §4 `kv`/`item`, §6.3 I17, §6.4 M31, P2 |
| 3 | sol R3: exact-token `stateOf` cannot express overlapping states | modified: two-step `classify` + `STATUS_MAP` over structured subjects with an ordered precedence per domain, a `SEVERITY` total order for aggregates, case folding once, pairwise conflict fixtures; I7 made case-insensitive. The mockup of `dev` + behind now follows the loadSource rule | §3.3, §6.3 I7 and I13, §6.4 M19-M22, P1 |
| 4 | sol R4a: the `Emoji`-property invariant matches digits, `#`, `*` | adopted with a changed repair: `Extended_Pictographic` (measured in Node) plus an explicit `EMOJI_BANNED` list, checked on the glyph table and glyph segments; U+FE0F and U+20E3 checked everywhere; digits stay legal | §3.4 rule 1, diagnosis 7, §6.2 L3, §6.3 I5, §6.4 M7-M9 |
| 5 | sol R4b: `PaneLine.kind` does not stop hand-built lines | adopted: branded type, unexported `mk()`, module-private `WeakSet`, `isMade` in I2, static L5, L6 (formatter bypass), L7 (`stateOf` bypass) | §6.1, §6.2 L5-L7, §6.3 I2, §6.4 M1-M6 |
| 6 | sol R4c: many rules have no failing mechanism; no named control per rule | adopted: five-item cap for every list (I18), details hidden by default (I18), `goto` presses (I19), section folds and defaults (I19), freshness for every §2.5 row (I11), glyph uniqueness and bold/dim (I20), one assertion per formatter kind (I8), and a rule-to-control table with 35 named controls | §6.3, §6.4 |
| 7 | sol R5: mockups use components that do not exist, bare `▲`, a bespoke `▾` row, `▸` in the strip, and a tree | modified to the smallest addition: `kv {goto}` and a `bullet` component added, state word required except in uniform-state lists (I21), the opened decision keeps its bullet row, the strip chip drawn as `›`, `外掛來源` gets its chip; the tree line is not added here because P6 left | §4 `kv`/`item`/`bullet`, §5 mockups, §6.3 I21 |
| 8 | sol R6: P6 is not shippable on its own; acceptance does not cover producers | adopted by moving it out; the new plan orders probe, producers, then renderer and gives each producer its own acceptance command | dispatch-tree plan §4 |
| 9 | sol R7a: parent edges are guessed (subagent rails, loop-back, old records, fleet) | adopted by moving it out; the new plan requires a two-sided edge and groups everything else as untracked | dispatch-tree plan §3 |
| 10 | sol R7b: a child's marker can be written into the parent's session state | adopted by moving it out; the new plan separates write identity from lineage and fails closed on a parent-equal id | dispatch-tree plan §6 |
| 11 | minimax R5a: 120-column mockups draw a two-line header although §2.2 merges at ≥ 110 | not adopted as a defect: the one 120-column mockup that draws the header (現況) already shows the single merged line at 119 cells; the other tabs write `‹strip + header›`. Clarified in the §5 introduction so the abbreviation cannot be read as two lines | §5 introduction |
| 12 | minimax R5b: no component produces a horizontal seat row | adopted, by changing the mockup (fewest additions): seats stack one per line at every width. The grid's column 14 entry, which this exposed as unused by any mockup, is removed; the nested seat starts at 12 | §3.1, §5.3 |
| 13 | minimax R5c: identifier cut from the right in the 殘留 mockup | modified: the 14-cell worktree names fit, so they are shown whole; the rule is restated (a longer identifier is cut from the left; a command is never cut), and the expanded command is shown wrapped and complete | §5.5 |
| 14 | minimax R7: `getSessionId()` inheritance is not on the unverified list | adopted by moving it out; the new plan names the check and gives it a phase | dispatch-tree plan §6, §7 |

## 11. Review log

- 2026-10-13, G1 attempt at 459dd869: terminal `required_seat_transport_exhausted`. The required chair (grok-4.6) returned HTTP 402 (xAI usage balance exhausted) on both attempts; `sol_deep` and `minimax_consult` completed, but their results stayed unratified, so §10 treats them as input, not as dispositions. The sealed state directory was moved aside with the suffix `.g1-transport-stop` (no seat produced a ratified result, so this is a legal reset). The re-run panel is `sol_chair` (codex gpt-5.6-sol, required), `kimi_deep` (kimi-code-k3), and `minimax_consult` (MiniMax-M3).
