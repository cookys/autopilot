# P7 body — data contract and band grammar (alpha.2; the band and panel sections follow TUI v2, 2026-10-10)

Binding for the three P7 work packages: ① watcher data (`src/status/*`), ② mod (`mods/live/*`), ③ gate (`docs/plans/evidence/2026-10-04-mods-p1c/gate/*`). Spec source: plan `docs/plans/2026-10-06-dev-flow-stage-graph.md` §P7 + Owner addendum A1 (slot table, width table, tab list); owner design decisions: `docs/plans/evidence/2026-10-06-tui-band/README.md` (V4a, clean ⓘ, legend in panel, theme-key text colour only). Owner rulings 2026-10-09: spend = host-today **brain-tier** spend over the cost-fuse cap; `wt N` = **reapable** worktree residue only (**superseded 2026-10-09 by the residue auto-reap contract: `wt N` = `needs_human_count`**, see `docs/plans/evidence/2026-10-09-residue-auto-reap/contract.md` R4).

## ① Published facts (watcher → live dir)

All writes atomic (tmp + rename), small JSON, never block the tick; a failing source publishes nothing new (the old file stays) and logs one line.

| Id | File | Shape | Source of truth |
|---|---|---|---|
| D1 spend | `<live>/runs/<scope>.json` (runs-live envelope), two new optional top-level fields | `host_today_brain_usd: number\|null` (rounded to cents), `brain_cap_usd: number` | the SAME computation `hooks/cost-fuse.js` uses (`sumTodayTierSpend` over the costs file with the configured `tiers`, and its config resolution of `daily_usd_brain` incl. env override). Extract a shared module rather than re-implement; cost-fuse must use the shared module too. |
| D2 ladder | `<live>/runs/<scope>.decisions.json`, new field | `ladder: { rung: "U0".."U5", at: <iso> } \| null` = the latest `kind:"ladder"` row (by `at`/order) under the sidecar's existing repo+root filter | the ledgers the sidecar already reads |
| D3 residue | `<live>/runs/<project_key>.residue.json` | `{ schema:"autopilot.residue/1", project_key, at, reapable_worktrees:<int>, by_class:{<class>:<int>…}, source:"repo-residue-sweep scan" }`; `reapable_worktrees` = count of class `clean-integrated` + `missing-dir`; additive since alpha.3 (residue auto-reap R4): `needs_human_count`, `needs_human_bytes`, `needs_human[≤20]`, `auto_ran_at`, `auto_removed_count`, `auto_archived_count`, read from `<git-common-dir>/autopilot-residue-auto.json` | `scripts/repo-residue-sweep.js scan --json` (spawned off the tick, at most once per 60 s per project, never concurrently) |
| D4 stage walk | `<live>/stage/<sid>.json` per session marker of this repo | `{ schema:"autopilot.stage-walk/1", sid, size, urgent, bug, high_risk, units:<N\|null>, nodes:[…], walk:[…], entry, terminal, unit_kind, current:<marker.stage\|null>, stage_set_at, at }` | `scripts/stage-graph.js` logic (require its module; do not spawn per tick; do not re-implement graph rules). Rewritten only when the marker's (size, urgent, bug, high_risk, stage, unit) changes. |

Existing facts the mod must start consuming (already published): `<live>/runs/<project_key>.qc.json` (P7c, `readQc`), `<live>/load-source.json` (P7b, `readLoadSource`), `<live>/runs/<project_key>.review.json` (P7d, `readReview`), the session marker `<ah>/session-mode/<sid>.json` (§2.9 fields).

## ② Band grammar (one line, AbovePrompt) — TUI v2 (2026-10-10, owner-approved; supersedes the alpha.2 grammar below it in history)

Design record and mockups: `docs/plans/evidence/2026-10-10-tui-v2/` (information architecture, i18n plan, rendered PNGs). Every word comes from the string tables `mods/live/locales/{en,zh-TW}.json` (see "Locales"); glyphs, numbers, ids, paths, shas and commands are not translated.

Width budget = `e.props.bodyColumns`, measured in **display cells** (East Asian Wide/Fullwidth = 2; the glyphs below count as 1). Items inside a group are separated by one space, groups by ` │ ` (the `│` in theme key `subtle`); an empty slot is skipped entirely (no doubled separator). Zero counts are omitted. Slots in priority order:

| # | Slot (group) | Text | Colour (theme key, text only) | Empty when |
|---|---|---|---|---|
| 1 | verdict (own group) | `<glyph> <word>`: ▲ 要你決定 / Needs you, ⏸ 疑似卡住 / Stalled, ✓ 完成待驗收 / Awaiting acceptance, ● 進行中 / Running, ◌ 待命 / Idle. At >= 160 columns a 要你決定 / 疑似卡住 verdict carries its one-phrase reason after the word (dim): the attention summary, the decision question, the quietest dispatch, the foreman's silence; clipped to 48 cells and to the room left, drawn only when >= 8 cells of room remain | warning / error / success / suggestion / inactive (bold except idle); reason dim | never |
| 2 | position (own group) | `<size>[!]·<level> ▸ <stage>`; at >= 160 `<size>[!]·<level> <walk> <stage> ◷<age>` with the stage walk `●─●─◐─○─○` (stage.json `walk`; the marker stage is the `◐`; done nodes `●`, later `○`; no walk drawn with < 2 or > 9 nodes or when the stage is not on it: then `▸ <stage> ◷<age>`); `·<level>` omitted when level is null | stage `claude` bold, `●` success, `◐` claude bold, `○` inactive, `─` subtle, `▸` and `◷age` dim | no marker stage |
| 3 | unit (own group) | `<bar> <k>/<N>` + ` ·<n>族` (en `·<n>fam`); bar: k−1 done cells `▰` (success), the current cell `▰` (claude), remaining `▱` (inactive); N > 10 → 10 cells, current cell `ceil(k*10/N)` | as stated; the families word dim | no `marker.unit` |
| 4 | dispatch + review (ONE group) | `⚙<live>` + ` ⏸<stalled>`, then ` ⟲R<n>` (`⟲` dim; n = code round, else plan generation) + ` QC✓` / ` QC▲` (`QC▲` = protected diff without evidence: it awaits a person) | ⚙ default, ⏸ error, QC▲ warning bold, QC✓ success | both parts empty |
| 5 | decisions (own group) | `◆<proxy>` + ` ?<undocumented>` + ` <rung>` | `◆` default (claude is reserved for "you are here"), `?` inactive, rung default | all absent |
| 6 | spend (own group) | `$<brain today> <bar> <pct>%` : amount rounded to an integer, bar cells = `round(ratio*n)` filled in the state colour, the rest `▱` inactive, pct = `round(ratio*100)` (dim) | state colour: success below 80 % of the cap, warning from 80 %, error from 100 % (amount plain below 80 %) | `host_today_brain_usd` null |
| 7 | hygiene (own group) | load-source chip (`dev`, `dev↓3` with the arrow dim, `dev ⚠`, `cache <v> ⚠`, `src ? ⚠`) + ` ⚑<n>` (n = residue.json `needs_human_count`, n > 0 only) | chip `warn` → warning; `⚑N` warning bold | no load-source fact and n = 0 |
| 8 | ⓘ | Button, `plain`, `autoFocus`, NO `hotkey`; opens/raises the pane | default | never |

Width table (the bar sizes and the dropped parts are part of the contract):

| Columns | Drawn |
|---|---|
| >= 160 | everything: the stage walk and age, families, decisions, the 10-cell spend bar with its percent, the load-source chip, the verdict's reason |
| 120–159 | verdict, `<size>·<level> ▸ <stage>`, unit bar + `k/N`, `⚙ ⏸ ⟲R QC`, `$<n>` + 5-cell bar, `⚑N` |
| 80–119 | verdict, unit bar (no `k/N`), `⚙N ⏸N QC▲/QC✓` (no round), `$` + 3-cell bar (no amount), `⚑N` |
| < 80 | verdict, `⚙N ⏸N`, `⚑N` |

**Overflow fallback** (as implemented in `mods/live/model.ts` `layoutBand`): if the line is still wider than the budget, the position slot's stage text is cut with `…` (never below 2 cells), then, in order and stopping as soon as it fits: remove the unit bar slot; remove the `⏸<stalled>` count (the dispatch part goes with it if nothing is left); remove the `⚙<live>` count; shorten the verdict WORD with `…` (the glyph alone when fewer than 2 cells remain). The verdict glyph, the `⚑N` owner reminder and the ⓘ are never removed. The reason phrase is added last, with whatever room is left. The line never exceeds the budget in display cells, in either locale.

Non-ok snapshot (no project, error, stale): one dim line `<reason>` + ` │ ` + ⓘ (a residue reminder in the no-project line reads `⚑N`). The former second band line (reason / proxy tail) lives in the panel's Now tab.

### Locales

`mods/live/locales/en.json` (source of truth) and `zh-TW.json`, compiled to `locales.ts` by `node mods/live/gen-locales.js` (a hooks module imports only code files); `--check` fails on drift, a missing id, differing placeholders, an id the code uses that en lacks, an unused en id, or a key-column label wider than 12 cells (it runs first in `mods/live/run-tests.sh`). Locale choice, resolved on every tick: `~/.autopilot/config.json` `ui.locale` (`en` | `zh-TW` | `auto`) > `AUTOPILOT_LOCALE` > the Claude Code language setting (the `/config` row `language`, verified on Claude Code 2.1.296: `$.config.list()` returns it as a `text` row holding e.g. `正體中文台灣用語`; else `language` in `~/.claude/settings.json`; a value naming a Traditional-Chinese / 台灣 / zh-TW variant is zh-TW, anything else en) > `LC_ALL` / `LANG` (`zh_TW*` is zh-TW) > en.

## ② Panel (pane `autopilot-live`, opened by ⓘ; also auto-opened as today at >= 144 columns fullscreen) — TUI v2

Hand-built tab strip (Buttons), six tabs in this order: **Now · Dispatch · Review · Spend · Hygiene · ?** (zh-TW: 現況 · 派工 · 審查 · 用量 · 殘留 · ?). Merges: the stage walk lives in Now, the decisions in Review, the glyph legend is the `?` tab. ⓘ opens on **Now** and each further press shows the next tab (the `?` is last, then Now again). The active tab is bold on a `subtle` background (the one background the panel uses: legible over ssh + tmux in truecolor and 256 colours, spike 2026-10-10; `inverse` stays banned), a `subtle` rule under the strip is its baseline. A tab that holds something for the owner carries a badge: `⚙N` live dispatches on Dispatch, `▲` on Review when pre-push QC is owed, `⚑N` on Hygiene.
- Now: hero row (verdict · project · time since start), the verdict reason (dim), the `session $ · host $ · ctx %` header (dim). Sections with rule lines `── Title ───`: **Needs you** (first when something awaits: the decision question and options, an attention reason, `⚑N worktrees need you → Hygiene`; else `✓ nothing waits for you right now`), **Where you are** (the stage-walk diagram with labels, then key/value rows stage / unit / progress / phase), **Working now** (dispatch counts, review round + QC, the session's tasks), **Cost today** (brain-tier bar against the cap).
- Dispatch: `⚙ N running · ⏸ N stalled · ✓ N done`; a run table (run, role, engine / model, state glyph, elapsed, last seen), columns as wide as their widest cell in display cells; review gates; the waiting / foreman lines; the review-page link; the snapshot note.
- Review: plan review and code review (round bar, range, seats), pre-push QC, the decisions made on your behalf (counts, the ladder rung as a six-step bar, the per-decision rows with their veto commands).
- Spend: brain-tier cap bar with an 80 % tick, the host-today split (brain vs other tiers), session, cost-fuse mode.
- Hygiene: load-source detail, then the residue that needs a person (summary, one row per item, the exact command wrapping under it).
- `?`: the glyph legend (drawn from the same vocabulary as the band), the keys, the width table.
Key/value rows: a dim key column of exactly 12 display cells (zh labels up to 6 characters), values in default colour. A missing fact renders an explicit "no data" line, never an empty tab.

## ③ Gate (after ② is frozen)

- `capture.sh`: add `capture-pane -e` (keep `-p`), copy D1–D4 files plus qc/review/load-source facts; window widths 209, 120, 80 (`tmux resize-window -x`).
- `check.js`: re-derive every rendered slot independently from the copied facts (shares no code with `mods/live`), judge it field by field; print one line per slot and a final `PASS <mode> fields=<n>` / `FAIL <mode> fields=<n> failed=<list>`; a slot that the width table removed is judged as "absent" at that width.
- Colored screenshot step: `ansi2html.py` (`docs/plans/evidence/2026-10-06-tui-band/ansi2html.py`) → headless chrome → `band-<width>.png` per capture.

## Implementation notes (①)

What the shipped watcher side of ① actually does (moved here from `references/mods.md`, which is a frozen guidance-manifest file). Every file is written by the watcher as tmp + rename into `<live>`; a failing source leaves the old file in place and logs one line.

- **Brain spend (D1).** The runs envelope carries optional `host_today_brain_usd` (cents; `null` when the costs file is unreadable) and `brain_cap_usd`. Both come from `scripts/lib/brain-spend.js`, the same computation `hooks/cost-fuse.js` runs: configured tiers, UTC day, cap from `cost_fuse.daily_usd_brain` and `AUTOPILOT_COST_FUSE_DAILY_USD`.
- **Ladder rung (D2).** The decisions sidecar has `ladder: { rung, at } | null`, taken from the latest `kind:"ladder"` row. Ladder rows stay out of `count`.
- **Residue (D3).** `src/status/residue.js` publishes `runs/<project_key>.residue.json` (`autopilot.residue/1`). It runs `repo-residue-sweep.js scan` on the main worktree asynchronously, at most once per 60 s and never two at once. `reapable_worktrees` = `clean-integrated` + `missing-dir`.
- **Stage walk (D4).** `src/status/stage-walk.js` publishes `stage/<sid>.json` (`autopilot.stage-walk/1`) using `scripts/stage-graph.js` `buildWalk`, for each unexpired marker that has a `size`. A file is rewritten only when size / urgent / bug / high_risk / stage / stage_set_at / unit change. A file whose marker vanished is removed by the watcher that wrote it; files left by an earlier watcher process are not swept.
