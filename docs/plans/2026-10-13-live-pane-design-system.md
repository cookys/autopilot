# Live pane design system — one IA, one visual vocabulary, enforced in code

Status: **draft for owner review** (2026-10-13). Plan only; no product code changed.
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
| 7 | `⏸` draws as a blue emoji box (screenshot 4) | U+23F8 has the Unicode `Emoji` property, and so do `⚙` U+2699 (dispatch) and `⚠` U+26A0 (hygiene chip 663-666). Checked with `\p{Emoji}`; a terminal may give any of them emoji presentation | §3.4 glyph rules |
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
| 派工 | Who is running, and how did the runs end? | running and stalled → finished (latest 5, rest collapsed) → review gates → snapshot note |
| 審查 | Can this be pushed, and what was decided for me? | code review → pre-push QC → decisions made for you → plan review (folded when stale) |
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

## 3. Tokens

### 3.1 Layout grid

Every body line starts at one of five columns (display cells; a CJK character is 2):

| Column | What starts there |
|---|---|
| 0 | section header, key of a key/value row, glyph of a list item or table row, the empty-state dash |
| 2 | text of a list item, table header, `more` toggle, standalone note, `└` of a detail line, `$` of a command |
| 4 | text of a detail or command line, including its wrapped continuation lines |
| 12 | value of a key/value row (`KEY_W` stays 12: zh labels up to 6 characters) |
| 14 | text of a list item nested in a value (a seat under `席位`) |

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

### 3.3 One mapping table from domain tokens to states

`ui.ts` exports `STATUS_MAP: Record<Domain, Record<string, StateId>>`, and `stateOf(domain, token)` is the only way a tab turns a token into a glyph. Case-insensitive matching on the whole token.

| Domain | Token → state |
|---|---|
| verdict | `decide`→need_you · `stalled`→stalled · `waiting`→done · `running`→running · `idle`→stopped |
| run (dispatch row) | `stall:true`→stalled · `rc 0`→done · `rc ≠ 0`→failed · `final_status reviewed / done / ok`→done · `failed / error / killed`→failed · no rc and fresh→running · no rc, not fresh→stopped |
| code-review seat verdict | `SHIP-AS-IS`→done · `FIX-THEN-SHIP`→findings · `BLOCK / REJECT`→failed · status `running`→running · status `reviewed` without verdict→done |
| plan-review seat / verdict | `READY / APPROVE / PASS`→done · `CONDITIONAL / STOP`→findings · `REJECT`→failed |
| review round | converged→done · open with any `findings` seat→findings · open with any running seat→running · stale (§2.5)→stopped |
| gate (`LiveGateRow.verdict`) | `pass / ok / accept / approved / converged`→done · `open / owed / needs*`→need_you · `fail / reject / block`→failed |
| QC (`QcView.state`) | `ok`→done · `owed`→need_you · `not_needed`→skipped · `unknown`→unknown |
| background item | exit marker 0→done · exit marker ≠ 0→failed · quiet ≤ 30 min→running · quiet > 30 min→stopped |
| task | `completed`→done · `in_progress`→running · `pending`→pending |
| load source / marketplace | `dev`, `directory`→done · `cache:*`, `missing`, any flag→need_you |

A raw token (`SHIP-AS-IS`, `reviewed`, `not_needed`, `[exited with code 0]`, `warn`) may appear **only** in a `detail` line, which the owner opens on purpose. Tokens that are identifiers, not states (run ids, engine and model ids, family names, shas, commands, paths), stay as they are: the i18n plan already keeps them untranslated. Residue classes (`dirty`, `clean-integrated`, `unintegrated-branch`, `missing-dir`) and the fuse mode get string-table labels (`有未提交變更`, `只提醒、不擋`).

### 3.4 Glyph rules

1. **No codepoint with the Unicode `Emoji` property, ever.** Banned in the vocabulary: `⏸ ⚙ ⚠ ✔ ✖ ▶ ⏹ ⏺ ▪ ▫`. The ui module's glyph table is checked with `/\p{Emoji}/u` in a test (§6, I5). Replacements: stalled `⏸` → `⊘`; dispatch count `⚙N` → `●N` (the running state, counted); the hygiene chip's `⚠` → `▲`.
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

Every component returns `PaneLine`s stamped with a `kind`, and the tests check per kind (§6). Examples are at 76 columns.

**`header(title, right?, fold)`** (kind `header`): `▾`/`▸` (subtle), the title (bold), optionally two spaces and a right-hand chip (a state, a count or a meter level), then a `subtle` rule to `cols - 1`. Every section uses it, and every section folds, 要你處理 included (it never starts folded), so `▾ ▸` always mean the same thing.

```
▾ 程式碼審查  △ 待修 ─────────────────────────────────────────────────────
▸ 計畫審查  ◌ 已停 · 27d 前 ──────────────────────────────────────────────
```

**`kv(key, …value)`** (kind `kv`): key dim, padded to 12 cells; value at column 12. An absent value is `—` followed by a dim reason.

```
輪次        R1 · 4abd667f..10c5c086
升級階梯    — 沒有紀錄
```

**`item(state, text, meta?, {at: 0 | 12, goto?, toggle?})`** (kind `item`): state glyph, the state word padded to the widest word in the list, the text, then dim meta after ` · `.

```
▲ 1 個 worktree 要你處理                                            殘留 ›
席位        ✓ 完成  s0 · anthropic
            △ 待修  s1 · zhipu
```

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

The tab strip and global header are the same on every tab. They are drawn in full for 現況 and shortened to `‹strip + header›` elsewhere. The active tab is shown as proposed in Q1: bold `claude` text with `━` under it in the strip's baseline, and no background. Data follows the owner's screenshots of 2026-10-13. Quota percentages, reset times and the residue row are illustrative.

### 5.1 現況

<!-- cols:76 -->
```
▸  現況   派工   審查   用量   殘留 ⚑1   ?
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
▸  現況   派工   審查   用量   殘留 ⚑1   ?
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
▾ 審查關卡 ────────────────────────────────────────────────────────────────
— 還沒有審查頁
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
▾ 審查關卡 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
— 還沒有審查頁
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
◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/workt…
◦ intent-17-2  Owner answered (supersedes intent-17-1): direction C …
◦ verify-17-1  verify node, no qualified verifier seat (engine-scorec…
未記錄      32 件派工沒有決策紀錄
升級階梯    — 沒有紀錄
▸ 計畫審查  ◌ 已停 · 27d 前 ───────────────────────────────────────────────
```

A decision opened by a press (`toggle` id `dec:<id>`):

<!-- cols:76 -->
```
▾ intent-17-1  可逆 · depth0
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
席位        ✓ 完成  s0 · anthropic        △ 待修  s1 · zhipu        ✓ 完成  s2 · minimax        ✓ 完成  s3 · alibaba
▾ 推送前 QC  ∅ 不需要 ─────────────────────────────────────────────────────────────────────────────────────────────────
範圍        5a2706ad..HEAD · 0 個受保護檔案
▾ 代你決定  3 件 · 0 件不可逆 ─────────────────────────────────────────────────────────────────────────────────────────
◦ intent-17-1  #17 direction: A (keep the native <repo>/.claude/worktrees root for hand/native worktrees, no Worktr…
◦ intent-17-2  Owner answered (supersedes intent-17-1): direction C = A plus moving the dispatch-rail worktrees (h…
◦ verify-17-1  verify node, no qualified verifier seat (engine-scorecard current --role verifier: none admissible…
未記錄      32 件派工沒有決策紀錄
升級階梯    — 沒有紀錄
▸ 計畫審查  ◌ 已停 · 27d 前 ───────────────────────────────────────────────────────────────────────────────────────────
```

At ≥ 110 columns, seat items flow across the value column in fixed-width cells. Opened, the stale plan review shows `計畫  blind-review-packet-2026-09-16 · △ 待修`, `輪次  ▰▱ R1／上限 2`, and its seats `✓ 完成 glm_architecture`, `△ 待修 codex_operations_skeptic`. The raw `CONDITIONAL`, `READY` and `STOP` sit in each item's detail.

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
▾ 外掛來源 ────────────────────────────────────────────────────────────────
▲ dev · v3.0.0-alpha.6 · 落後 upstream 54                           ▸
```

Expanding a group lists its items one line each; expanding an item shows its reason detail and its command:

```
▾ 已整合，可清理  12 個 · 280 MB
  ◦ agent-a242acf7…  0d · 24 MB                                    ▸
  ◦ agent-a3379d38…  0d · 22 MB                                    ▾
    └ clean · HEAD 已在 origin/develop
    $ git -C /home/u/proj worktree remove /home/u/proj/.claude/worktrees/agent-a3379d38…
  ▸ 還有 10 個
```

At 120 columns the lines are the same; only the rules are longer, and an expanded command fits on one line.

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

- **`mods/live/ui.ts` (new)** owns: `STATES`, `STATUS_MAP` + `stateOf`, `GLYPHS` (state, structure and chart tables), `FRESHNESS` thresholds, `GRID = [0, 2, 4, 12, 14]`, `KEY_W`, the formatters (`money`, `pct`, `dur`, `ago`, `clock`, `size`, `sha`, `idTail`, `count`) and the components in §4. `seg`, `row`, `padCells` and the `ThemeKey` strings exist only here and are not exported.
- **`mods/live/tabs.ts` (new)** holds the tab builders, moved out of `model.ts` (`nowLinesRaw`, `dispatchLinesRaw`, `reviewTabLinesRaw`, `spendTabLinesRaw`, `hygieneTabLinesRaw`, `legendLines`, `activityLines`, `accountLines`, `recentLines`, `needsYouLines`). It imports components and formatters from `ui.ts` and data types from `model.ts`. It never imports `seg`, `row` or theme keys, and it never writes a glyph literal.
- **`PaneLine.kind`** becomes a required field (`'verdict' | 'header' | 'kv' | 'item' | 'table' | 'meter' | 'empty' | 'more' | 'command' | 'detail' | 'chart' | 'blank'`), and `PaneLine` gains `goto?: PaneTab`. Only components set `kind`, so a line without one shows that code went around the components.
- **`buildSections` returns data, not lines.** `PaneSections` (`attention`, `waiting`, `tasks`, `decisions`, `foreman`) becomes `{ tasks: TasksView | null, decisions: DecisionsView | null, foreman: ForemanView | null, attention: AttentionView | null, notWired: … }`, and the tabs render it through components. Without this change, the tick path keeps producing hand-made bold lines that no rule can reach (diagnosis 1).
- **`pane.tsx`** draws the tab strip, the global header (`verdictHeader`) and the body lines. Its own Text props come from one `drawSeg` function in `ui.ts`, so `pane.tsx` itself carries no colour decisions.

### 6.2 Static check: `mods/live/ui-lint.test.js` (node `--test`, built-ins only, added to `run-tests.sh` next to `gen-locales.test.js`)

- L1: `tabs.ts`, `pane.tsx` and `band.tsx` contain no theme-key string literal (`'claude' 'warning' 'error' 'success' 'suggestion' 'inactive' 'subtle'`), no `color:`, `bold:` or `dim:` property, and no `backgroundColor` / `inverse`.
- L2: outside `ui.ts`, the source contains no codepoint in U+2190–U+2BFF or U+25A0–U+25FF. Glyphs come only from `GLYPHS`. String-table JSON files are checked too: a locale string may not carry a state or structure glyph. Strings that carry one today and must lose it (zh-TW and en alike): `state.no_project_wt` (`⚑`), `legend.hygiene` (`⚑`, `↓`), `legend.widths` (`⚙`, `⚑`), `now.see_hygiene` (`→`), and the `toast.*` arrows (`→`, kept as text `至` / `to`, or allowlisted as a non-state arrow). P5 lists the final set.
- L3: every `GLYPHS` entry fails `/\p{Emoji}/u`, and the new-to-vocabulary entries carry a `verified: '<date> <terminal>'` field that P0 fills in.
- L4: `tabs.ts` does not import `seg`, `row`, `rule`, `kv`, `padCells` or `NO_DATA` from `model.ts` (after P5 these no longer exist there).

### 6.3 Render invariants in `mods/live/live.test.ts`

These are pure calls of the tab builders over fixture snapshots; no mount is needed except for the strip. Matrix: fixtures {`richWorld` (existing), `busyWorld` (new), `emptyWorld` (new: every source missing)} × locale {zh-TW, en} × cols {40, 60, 76, 100, 120, 160}. `busyWorld` reproduces the owner's screenshots: 32 finished reviewer runs with ~30-cell ids, 4 code seats (3 × SHIP-AS-IS, 1 × FIX-THEN-SHIP), a plan review with `updated_at` 27 days before `NOW` (CONDITIONAL, seats READY / STOP), 3 decisions with long English rationales (`richWorld` has `rows: []`), 32 undocumented dispatches, brain 175.33 / 150, a 24-sample history crossing the day reset, 16 background shells whose tails are `[exited with code 0]`, 39/39 tasks, account plus two quota windows, 1 residue item, QC `not_needed`.

| Id | Assertion |
|---|---|
| I1 | `displayWidth(line.text) <= cols` for every line of every tab |
| I2 | every line has a `kind` |
| I3 | the first non-blank cell of every line is in `GRID`; for `kind:'kv'`, the value starts at exactly 12; a wrapped continuation starts at its line's hang, and the hang is in `GRID` |
| I4 | every `kind:'header'` line matches `^[▾▸] \S.*─+$`, has the width `cols - 1`, and starts at column 0; no line anywhere contains `▌`; a bold segment occurs only in `header`, `verdict`, `need_you` items and meter headline values |
| I5 | every glyph segment (components tag them `role:'glyph'`) is in `GLYPHS`; no character in any line outside `kind:'detail'` matches `/\p{Emoji}/u` |
| I6 | colour pairing: a glyph segment's colour equals `STATES[state].key`; `claude` appears only on segments tagged `here`; `suggestion` appears only on `running` glyphs and words; no segment has `backgroundColor` or `inverse` (extends `expectThemeOnly`, live.test.ts 2127) |
| I7 | no segment tagged `role:'state'` or `role:'value'` (i.e. not free text: decision rationales and task subjects are `role:'prose'` and exempt) outside `kind:'detail'` contains a `STATUS_MAP` raw token (whole word, case-sensitive: `SHIP-AS-IS`, `FIX-THEN-SHIP`, `CONDITIONAL`, `READY`, `STOP`, `reviewed`, `not_needed`, …), `[exited with code`, or `/\brc \d/` |
| I8 | formats: no `/\d %/`; every `$` amount matches `/\$[\d,]+\.\d\d/`; every duration matches the `dur` grammar (`/\b\d+h\d\dm\b/`, never `/\b\d+h\dm\b/`); no `/\d\*/` |
| I9 | (a) no tab builder emits `kind:'verdict'` (pure, over the matrix): only `pane.tsx` draws the header; (b) mounted: for each `PaneTab`, the rendered lines between the strip and the first body line are byte-identical for the same snapshot. Part (a) is what stops a tab drawing its own header; (b) alone would compare one function with itself |
| I10 | no two consecutive `kind:'empty'` lines; `沒有資料` text appears only in `empty` lines |
| I11 | freshness (`busyWorld`): the plan-review header is `◌` and folded; no `item` line with `●` belongs to a background task whose tail is an exit marker; 現況's 背景工作 section is `empty` + one `more` |
| I12 | collapse (`busyWorld`, 76 cols): 派工 has ≤ 22 lines, 0 `kv` lines in the runs sections, exactly 5 finished `table` rows and 1 `more`; every run is one line at every width ≥ 40 |
| I13 | mapping coverage: every token in the fixtures maps to a state that is not `unknown`; a planted token `WEIRD` renders `? 未知`, and `WEIRD` itself appears only in a `detail` line |
| I14 | the tab strip has exactly one active tab, no background (if Q1 is accepted), and each badge matches `^(▲|●\d+|⚑\d+)$` |
| I15 | the `?` tab contains every `STATES` glyph followed by its word (the legend is generated) |
| I16 | 現況 at 76 cols (`busyWorld`) has no 今日花費 or 帳號 section, and each summary row carries `goto` |

Mutation controls (`references/evidence-discipline.md`). Each invariant gets one planted violation that must turn it red before the phase that introduces it lands: a builder pushing `{text:'▌ x', kind:'header'}` (I4), a raw `seg('x','suggestion')` on a done row (I6), `pct + ' %'` (I8), removing the freshness check (I11), restoring the block fallback (I12), and so on. Record each red/green pair in the phase evidence, as the existing P1W cases do in the test file's header.

## 7. Migration phases

Each phase ships on its own. Each runs `bash mods/live/run-tests.sh` alone (600 s) and ends with the rendered-screenshot check (memory `tui-verify-by-rendered-screenshot`: `capture-pane -e` → ansi2html → headless chrome → read the PNG) at 76 and 120 columns in zh-TW, with the owner's ssh + tmux in mind. Version stays on the 3.0.0 line (owner ruling 10-12: no bump without asking).

| Phase | Ships | Tests that change |
|---|---|---|
| **P0 measure + tokens** | (a) Real-terminal measurement: draw a 1-cell ruler line of `cols` cells in the pane and compare `bodyColumns` with the visible width (diagnosis 17). Fix `paneWidth` if it is off. (b) Glyph check in the owner's terminal for `⊘ △ ○ ◌ ∅ ◦ › ━ ◐`, results written into `GLYPHS.verified`. (c) `ui.ts` with tokens, formatters and components; `PaneLine.kind` optional for now. (d) The `?` tab generated from `STATES` (I15). (e) Band glyph swap: `⏸`→`⊘`, `⚙N`→`●N`, hygiene `⚠`→`▲`. | `RICH_209` / `RICH_MID` / `RICH_SMALL` / `RICH_NARROW` and the band colour case (live.test.ts ~2085-2195) change glyphs; legend cases; new `ui-lint.test.js` with L3 only |
| **P1 審查** | `STATUS_MAP` for seats, plan and code verdicts, gates and QC; freshness for plan and code review; decisions as one-line items with `more`/`detail`; QC chip `∅ 不需要` | review-tab cases asserting `● 進行中`, `▲ 未收斂`, raw verdict words, `沒有代你做過決定`; invariants I1-I8, I10, I13 enabled for 審查 |
| **P2 派工** | `table` with column priorities; live vs finished sections; latest 5 + `more`; gates as items; footer as a note | the dispatch block-fallback cases are replaced; I12 enabled |
| **P3 用量** | meters (the tick line goes); account and quota move here; window labels; `pct` and `money` formatters; `SLOT_TAB.quota = 'spend'` | spend-tab cases (`117 %` becomes `117%`), the account/quota cases move from 現況 to 用量, and the band quota-press case now expects 用量 |
| **P4 現況 + global header** | `buildSections` returns data; summary rows with `goto`; background freshness (exit marker, 30 min); tasks show unfinished only; the reason becomes an item; `verdictHeader` in `pane.tsx` on every tab | the Now-tab cases (W3a tasks, attention, foreman rows, the activity cases) are re-pinned to the new lines; I9, I11, I16 enabled |
| **P5 殘留 + strip + lock** | 殘留 on components; the tab strip active mark (per Q1); `kind` becomes required in the type; `seg`/`row`/`rule`/`kv` removed from `model.ts`; L1, L2, L4 switched on; every invariant over every tab | `expectThemeOnly(tree, allowTabBackground)` loses the background allowance if Q1 is accepted; `isActiveTab` (live.test.ts ~2139) keys on the new mark |

| **P6 派工樹** (scheduled after the 2026-10-13 backlog wave; owner ruling 2026-10-13) | The 派工 tab shows every piece of work under the session as one tree (§7.1). Built on the identity hand-offs in §7.1 step 2–4, which ship first as their own commits | dispatch-tab cases gain nested rows; new fixtures for a loop-back (`claude -p` started by a rail) and for an untracked process |

The separate scanner defect (diagnosis 11: why `scanBackground` never ended these tasks) is a bug fix with its own red test, outside this plan. The freshness rule in P4 makes the pane right even while that bug exists.

### 7.1 Dispatch tree (P6)

Owner ask (2026-10-13): when dispatched work dispatches again — including a shell that starts a harness that starts Claude Code again — can every piece be followed from the session? Evaluated before planning (evaluation notes: session scratchpad `nested-dispatch-tracking-eval.md`; facts below carry their own pointers).

**What exists today**

| Path | Record | Link to parent | After the fact | While running |
|---|---|---|---|---|
| Subagent → subagent | `~/.claude/projects/<proj>/<session>/subagents/agent-<id>.meta.json`, all depths in one directory | `parentAgentId` (depth ≥ 2), `toolUseId` matches the parent transcript's `tool_use.id`; already read by `hooks/cost-tracker-lib.js:182-194` `readAgentTree` and `scripts/cost-digest.js --tree` | yes (a few old records lack `parentAgentId`) | partly: liveness stamps under `<live>/agents/<sid>/` carry no parent |
| Session or subagent → rail (codex, kimi, grok, agy, opencode, cursor) | run manifest `<run_id>.manifest.json`, `dispatch-branches.jsonl` | manifest `parent_run_id` / `root_run_id` / `depth` via `AUTOPILOT_PARENT_RUN_ID` / `AUTOPILOT_ROOT_RUN_ID` / `AUTOPILOT_DISPATCH_DEPTH`; the manifest has no `session_id` (the branch ledger does) | rail→rail yes; session→rail only by joining the session marker's `root_run_id` | yes (`dispatch-status.js --list`, the runs watcher) |
| Loop-back: rail → `claude -p` / cc-shim / claude-native | the child's own transcript; with a dedicated `CLAUDE_CONFIG_DIR` it lands there; cc-shim deletes its scratch HOME, transcript included (`dispatch-review.sh:1531-1536`, `dispatch-author.sh:1194`) | none structured. Measured: `CLAUDE_CODE_SESSION_ID` is replaced by a new id; every `AUTOPILOT_*` variable is inherited unchanged | weak (time window + cwd); cc-shim: nothing | weak |
| fleet dispatch | `message_id`, reply `meta.reply_to` | one request/reply pair; no root, parent or depth; the far side's records are on the far machine | one hop | one hop |
| Process started with `nohup` / `setsid` / `&`, no rail | none | `/proc/<pid>` ppid and environ while alive; `setsid` breaks the ppid chain | no | partly |

The 派工 tab reads none of the subagent records today; only cost tracking does.

**Identity hand-offs (ship before P6, cheapest first)**

1. Read-only merged view from existing fields: subagent tree (`parentAgentId`) + rail tree (`parent_run_id`) + session→rail via the marker's `root_run_id`. No behaviour change.
2. Add `session_id` (`$CLAUDE_CODE_SESSION_ID`) to the run manifest, so session→rail no longer depends on an unexpired marker (24 h TTL).
3. Loop-back: every rail that starts `claude` exports `AUTOPILOT_PARENT_SESSION_ID=$CLAUDE_CODE_SESSION_ID` (a dedicated name; `AUTOPILOT_SESSION_ID` would hijack the child's marker), and the child writes it into its marker as `parent_session_id`. The rail also records the child's `CLAUDE_CONFIG_DIR` in the manifest so a transcript outside `~/.claude/projects` can be found. cc-shim keeps the child transcript (copy it out before deleting the scratch HOME).
4. fleet: the dispatch body carries `root_run_id` / `parent_run_id` by convention; the receiver adopts them with `session-mode.js --root-run-id`. One hop is all the local machine can show.
5. Which subagent started a rail: Claude Code gives a subagent's Bash no agent id. A PreToolUse hook (its payload has `agent_id`, `hooks/awaiting-owner.js:76`) can prefix the id onto Bash commands. Until then, rails a subagent starts hang directly under the session.

**Cannot be traced, by nature** — shown, not hidden: a process started outside any rail after it exits; the far side of a fleet dispatch; cc-shim children from before step 3. The tree ends those branches with one note line (`◦ 之後的工作沒有紀錄`) so a missing branch never reads as "nothing happened".

**Display** follows §2.4: one line per top-level piece of work, children folded behind `▸ N 個子工作`; live branches open by default, finished ones closed; depth shown by indent, not by a column.

**Unverified (checked in P6):** whether a `claude -p` child runs the SessionStart hook (decides where step 3 writes `parent_session_id`); whether `claude -p --session-id <uuid>` can pre-assign the child id; how `lib/cleanroom-launch.sh` treats the environment; nested rail manifests (every local manifest is depth 0, so the nested path is read from code only).

**Found during the evaluation, fixed separately (not P6):** rails pass every `AUTOPILOT_*` variable to a `claude` child, `AUTOPILOT_SESSION_ID` included (`dispatch-foreman.sh:339-353` allow-lists the prefix). `session-mode.js:170-173` reads that variable first, so a child launched from a session that has it set writes its marker under the parent's session id. Today only caller discipline prevents it; the rails should unset it. Fixed on `lane/p2-session-id-leak` (dispatch rails and `profile-runtime.js` `invokeClaude`). Two cases its review left for P6 step 3:

- `scripts/probe-engine-capability.sh:456,462` starts `claude -p` without unsetting it. It is not a dispatch rail, and the marker hook keys on its own session id (`hooks/runs-watch-autostart.js:265`), so no parent marker is overwritten today.
- Children still inherit `CLAUDE_CODE_SESSION_ID`, the second source in `getSessionId()` (`session-mode.js:171`). A non-claude runner that calls `session-mode.js` inside its child process may resolve to the parent's id (not measured). Design it together with `AUTOPILOT_PARENT_SESSION_ID`; campaign intake relies on `CLAUDE_CODE_SESSION_ID`, so it cannot simply be unset.

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
