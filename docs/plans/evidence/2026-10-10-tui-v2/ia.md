# Live TUI — information architecture (design proposal, no product code changed)

Source facts: `mods/live/{model,band,pane,register}` and `p7/contract.md` in the release-3.0.0 worktree (read only). Visual comparison: `mockup.html` / `mockup.png`.

## Problems found in the current look
1. One colour (`claude`, orange) means stage, decisions count AND the current bar cell; `warning` means needs-you, QC owed, spend >= 80 % and the load-source chip. Colour carries no stable meaning.
2. Every band slot has the same weight, and `│` separates EVERY item, so `⚙2 │ R2 ⟲ · QC owed │ ◆3 ?1 U2` reads as five unrelated things. At 209 columns only ~104 cells are used; the rest is empty.
3. The panel is eight tabs of dotted text lines (`a · b · c · d`). Now spreads one idea over five rows (position, unit, progress, phase, verdict); Dispatch is one 9-field line per run, cut at the pane edge; Graph is a text arrow chain; nothing is a bar or a table.
4. Languages are hard-coded and mixed (band words zh, panel en, one bilingual caption).
5. No tab says whether it holds something for the owner, so every tab has to be opened.

## Visual tools that actually exist (checked in `claude-code.d.ts`)
- `Text`: `color` (theme key or raw colour), `bold`, `dimColor`, `italic`, `underline`, `strikethrough`, `inverse`, `backgroundColor`, `wrap` (d.ts ~12010). We use only `color` (theme key), `bold`, `dimColor`. `inverse` and `backgroundColor` exist but are banned by owner decision 5.
- `Box`: flexDirection, flexWrap, gap/columnGap/rowGap, width/minWidth, margin*/padding*, justifyContent, `borderStyle` + `borderColor` + `borderDimColor` (d.ts ~826), `display`. Borders render correctly over ssh+tmux (spike); CJK aligns in fixed-width columns when widths are display widths.
- `Button` (`plain`, `dimColor`, `bold`, `hotkey`, `autoFocus`), `Link`, `Raster` (cell grid; needs truecolor under tmux, skipped), `Image` (kitty/Ghostty only: not viable), `Client`.
- Not usable: backgrounds/inverse (banned), Svg on terminal, Image over ssh+tmux.
- So the whole infographic vocabulary is Unicode text + theme-key colour: `▰▱` bars, `●─◐─○` step diagram, `──` rules, aligned columns, count badges. The mockup draws everything that way. `Box borderStyle` would also work, but text rules wrap and clip predictably and cost no layout rows.

### Theme keys
Verified present in Claude Code 2.1.289 (spike README, 2026-10-06): `claude, permission, planMode, ide, promptBorder, text, inactive, subtle, suggestion, remember, success, error, warning`. The d.ts says only that colour is "a theme key or a raw colour" and cites `promptBorder`, `inactive`, `permission` as examples (~line 2052); it does NOT list keys or RGB values. The mod already uses seven (`claude warning error success suggestion inactive subtle`) and the proposal uses exactly those plus default text, bold and dim; no new key. The hex values in the mockup are my approximations of the dark theme (warning #ffc107, error #ff6b80, success #4eba65, suggestion #b1b9f9, claude #d77757, inactive #999, subtle #505050), cross-checked only against colours visible in the existing PNG captures. Light / ansi / daltonized themes differ, so meaning never depends on hue alone: glyph and position carry it too.

## Colour semantics (one meaning per key)
| State | Theme key | Meaning | Where |
|---|---|---|---|
| needs you / attention | `warning` (bold in tier 1) | a person must act or look | `▲` verdict, `QC▲` owed, `⚑N` residue, tab badge, spend bar >= 80 % |
| blocked / broken | `error` | stalled, over cap | `⏸` verdict and count, spend >= 100 % |
| ok / done | `success` | finished, evidence present, within budget | `✓`, done bar cells and walk nodes, spend < 80 %, `pass` |
| running | `suggestion` | executing now | `●` verdict, `● run` rows, reviewing seat |
| you are here | `claude` (bold) | the single current position: current stage, current bar cell, active tab | nothing else (`◆` decisions drop to default) |
| idle / absent / not yet | `inactive` | zero, empty, future, no data | `◌`, `○` future nodes, `▱`, `?N` |
| chrome | `subtle` | structure only | separators, `──` rules |
| money / info | default text | values are not states; money turns `warning`/`error` only by threshold | `$60`, counts |
| label / hint | `dimColor` | field names, units, commands | key column, `ago`, commands |
| tier-1 emphasis | `bold` | the one thing to read first | verdict, headline value |

## Glyph vocabulary (one glyph per concept, same on band and panel)
| Concept | Glyph | Note |
|---|---|---|
| needs you (verdict, tab badge, QC) | `▲` | one glyph for "awaits a person" everywhere |
| stalled | `⏸` | unchanged |
| done / ok | `✓` | unchanged |
| running / idle | `●` / `◌` | unchanged |
| residue that needs you | `⚑N` | replaces `wt N`. **[unverified]** `⚑` U+2691 is 1 cell in the owner's font; fallback `wt N` is already shipped |
| position / age | `▸` / `◷` | unchanged |
| unit progress | `▰▰▰▱▱ k/N` | unchanged (green done, orange current, grey to come) |
| stage walk | `●─●─◐─○─○` | NEW. done green, current `◐` orange bold, later `○` grey. **[unverified]** `◐` width in the owner's font |
| dispatch | `⚙N`, `⏸N` | unchanged |
| review / QC | `⟲R2`, `QC✓`, `QC▲` | no spaces or dots; `QC owed` (8 cells) becomes `QC▲` (3) |
| decisions | `◆N` `?N` `U2` | `◆` default colour now; rung is a 6-step bar in the panel |
| spend | `$60` + `▰▱` bar + `%` | bar colour = threshold state |
| legend | `ⓘ` | unchanged |

## Band (one line)
Groups instead of equal slots: items in a group are separated by one space, groups by ` │ `:
`[verdict (+ reason at 209)] │ [size·level, walk, stage, age] [unit bar k/N] │ [⚙ ⟲ QC] │ [◆ ? rung] │ [$ bar %] │ [dev↓ ⚑] │ ⓘ`

- Tier 1, never dropped: verdict glyph+word, `ⓘ`, `⚑N` when N > 0 (keeps the contract's "owner reminder survives narrowing").
- Tier 2: unit bar, `⚙N`, `QC▲/✓`, spend bar.
- Tier 3: walk diagram, age, families, decisions/rung, load-source chip, percentages, the reason phrase after the verdict.

Width table (proposed; today's thresholds are kept in spirit, priorities re-ordered):
| Cols | Kept |
|---|---|
| >= 160 (mockup shows 209) | everything: walk, 10-cell spend bar + %, reason phrase |
| 120-159 | verdict, `size·level ▸ stage`, unit bar + k/N, `⚙ ⟲ QC`, 5-cell spend bar, `⚑N` |
| 80-119 | verdict, unit bar, `⚙N QC▲`, 3-cell spend bar, `⚑N` |
| < 80 | verdict, `⚙N`, `⚑N`, `ⓘ` (existing overflow fallback order retained) |

Two changes vs today: spend and QC survive down to 80 columns (today they vanish at <140 / <120 although spend >= 100 % is among the most urgent facts), and `QC owed` -> `QC▲`. The mockup's cell counts are computed by the generator (`build-mockup.js`), and every proposed line fits its budget (the generator reports overflow).

## Panel, tab by tab
Tab strip: 5 content tabs + `?`. Merges: Graph -> Now (walk diagram), Decisions -> Review, Legend -> `?`. Each tab may carry a badge (`▲` needs you, `⚑N` residue, `⚙N` live runs), so the owner sees which tab to open without opening any. **Owner decision:** 8 tabs -> 6; if rejected, Graph/Decisions stay as tabs with the same drawings.

The `session $ · host $ · ctx %` header becomes one dim line (today bold on every tab, competing with content).

| Tab | Tier 1 (glance) | Tier 2 (scan) | Tier 3 (on demand) |
|---|---|---|---|
| Now | verdict + project + elapsed; "Needs you" section (question + options, or a green `✓ nothing waits`) | walk diagram with labels, unit bar + label, hands / review / QC line, cost bar | families, age, snapshot time |
| Dispatch | `⚙ N running · ⏸ N stalled · ✓ N done` | run table (run, role, engine/model, state glyph, elapsed, last seen); gates as 2 lines + seat strip | rc, phase, foreman rows, review-page link |
| Review | round bar `▰▰▱ R2 of 3`, open/converged | seats (id, family, status glyph), pre-push QC | range shas, protected files; decisions `◆ made / ? undocumented`, ladder rung as a 6-step bar + age |
| Spend | brain-tier bar vs cap with 80 % tick | host today split brain / other tiers, session $ | fuse mode. A sparkline is **not drawable: no time series is published** |
| Hygiene | `⚑ N need you · size`, load-source verdict | one row per item: glyph, kind, short target, class, age, size | dim exact command (wraps), auto-reap summary, stale cache dirs |
| ? | glyph / colour table generated from the same tables the band uses | width table, keys | |

Key/value layout: key column dim and a fixed 12 cells (display width, so zh labels up to 6 characters fit); value column default colour. Section rules `── Title ───── badge ──` in `subtle` with a bold title.

## Data that is missing or weak for the best design
1. Spend time series (brain spend per hour or per call): a sparkline `▁▂▃▅▇` is impossible; only today's total and the cap are published (`host_today_brain_usd`, `brain_cap_usd`). Cheapest fix: the watcher appends `{at, brain_usd}` per tick to a rolling 24-sample file.
2. Per-tier split: the mockup derives "other tiers" as `host_all - brain`. Both numbers are published but from different files (session cost vs costs file), so they can be skewed in time.
3. Stage labels / ordinal: `walk[]` node ids are published; human labels (en / zh-TW) are not, so the locale file maps ids and unknown ids fall back to the raw id.
4. Verdict reason on the band: `decision.question` exists on the job model; the band shows only the word. Showing it at wide widths needs only the width-aware clip helper, no new data.
5. Code-review `max_generations`: only plan review publishes it, so `R2 of 3` for code review has no denominator today.
6. Dispatch row state: rows carry `rc` / `final_status` / `phase` as free fields; one state glyph (`● run`, `✓ rc0`, `✗ rcN`, `⏸ stalled`) is client-side logic, but the stalled threshold lives in the watcher, not in the row.
7. "How many things need me" is not published as one number; `▲N + ⚑N` would be derived in the mod from decision + residue + QC owed, so the rule must live in one place.

## Open points for the owner
- 8 -> 6 tabs.
- Whether the walk diagram (~12 cells) is worth it next to the unit bar at >= 160 columns (two progress notions: coarse stage walk, fine unit bar).
- `⚑` and `◐` need one real check in the owner's ssh+tmux terminal before implementation (the earlier spike notes headless chrome draws `⏸` / `▰` smaller than a real terminal, so legibility of the mockup bars is a lower bound).
