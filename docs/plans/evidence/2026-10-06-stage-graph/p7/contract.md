# P7 body — data contract and band grammar (alpha.2)

Binding for the three P7 work packages: ① watcher data (`src/status/*`), ② mod (`mods/live/*`), ③ gate (`docs/plans/evidence/2026-10-04-mods-p1c/gate/*`). Spec source: plan `docs/plans/2026-10-06-dev-flow-stage-graph.md` §P7 + Owner addendum A1 (slot table, width table, tab list); owner design decisions: `docs/plans/evidence/2026-10-06-tui-band/README.md` (V4a, clean ⓘ, legend in panel, theme-key text colour only). Owner rulings 2026-10-09: spend = host-today **brain-tier** spend over the cost-fuse cap; `wt N` = **reapable** worktree residue only.

## ① Published facts (watcher → live dir)

All writes atomic (tmp + rename), small JSON, never block the tick; a failing source publishes nothing new (the old file stays) and logs one line.

| Id | File | Shape | Source of truth |
|---|---|---|---|
| D1 spend | `<live>/runs/<scope>.json` (runs-live envelope), two new optional top-level fields | `host_today_brain_usd: number\|null` (rounded to cents), `brain_cap_usd: number` | the SAME computation `hooks/cost-fuse.js` uses (`sumTodayTierSpend` over the costs file with the configured `tiers`, and its config resolution of `daily_usd_brain` incl. env override). Extract a shared module rather than re-implement; cost-fuse must use the shared module too. |
| D2 ladder | `<live>/runs/<scope>.decisions.json`, new field | `ladder: { rung: "U0".."U5", at: <iso> } \| null` = the latest `kind:"ladder"` row (by `at`/order) under the sidecar's existing repo+root filter | the ledgers the sidecar already reads |
| D3 residue | `<live>/runs/<project_key>.residue.json` | `{ schema:"autopilot.residue/1", project_key, at, reapable_worktrees:<int>, by_class:{<class>:<int>…}, source:"repo-residue-sweep scan" }`; `reapable_worktrees` = count of class `clean-integrated` + `missing-dir` | `scripts/repo-residue-sweep.js scan --json` (spawned off the tick, at most once per 60 s per project, never concurrently) |
| D4 stage walk | `<live>/stage/<sid>.json` per session marker of this repo | `{ schema:"autopilot.stage-walk/1", sid, size, urgent, bug, high_risk, units:<N\|null>, nodes:[…], walk:[…], entry, terminal, unit_kind, current:<marker.stage\|null>, stage_set_at, at }` | `scripts/stage-graph.js` logic (require its module; do not spawn per tick; do not re-implement graph rules). Rewritten only when the marker's (size, urgent, bug, high_risk, stage, unit) changes. |

Existing facts the mod must start consuming (already published): `<live>/runs/<project_key>.qc.json` (P7c, `readQc`), `<live>/load-source.json` (P7b, `readLoadSource`), `<live>/runs/<project_key>.review.json` (P7d, `readReview`), the session marker `<ah>/session-mode/<sid>.json` (§2.9 fields).

## ② Band grammar (one line, AbovePrompt)

Width budget = `e.props.bodyColumns`, measured in **display cells** (East Asian Wide/Fullwidth = 2; the glyphs below count as 1 — verify in the colored screenshot). Slots in priority order, joined by ` │ ` (the `│` in theme key `subtle`); an empty slot is skipped entirely (no doubled separator). Zero counts are omitted.

| # | Slot | Text | Colour (theme key, text only) | Empty when |
|---|---|---|---|---|
| 1 | verdict | `<glyph> <word>` (▲ 要你決定 / ⏸ 疑似卡住 / ✓ 完成待驗收 / ● 進行中 / ◌ 待命) | warning / error / success / suggestion / inactive | never |
| 2 | position | `<size>[!]·<level> ▸ <stage>` + ` ◷<age>` (age of `stage_set_at`, same formatter as elapsed); `·<level>` omitted when level is null | stage `claude`, rest default | no marker stage |
| 3 | unit | `<bar> <k>/<N>` + ` ·<n>族` (n = `review_families.length`, omitted when 0); bar: k−1 done cells `▰` (success), the current cell `▰` (claude), remaining `▱` (inactive); N > 10 → scale to 10 cells | as stated | no `marker.unit` |
| 4 | dispatch | `⚙<live>` + ` ⏸<stalled>` | ⚙ default, ⏸ error | both 0 |
| 5 | review | `R<n> ⟲` (from `reviewSlot`) + ` · QC ✓` / ` · QC owed` (`qcChip`) | QC owed `warning`, ✓ `success` | no review and no qc fact |
| 6 | decisions | `◆<proxy>` + ` ?<undocumented>` + ` <rung>` | ◆ `claude`, ? `inactive`, rung default | all absent |
| 7 | spend | `$<brain_today>/<cap>` (integers) | `warning` at ≥ 80 % of cap, `error` at ≥ 100 % | `host_today_brain_usd` null |
| 8 | hygiene | `hygieneChip` text + ` · wt <n>` (n > 0 only) | chip `warn` → `warning` | no load-source fact and n = 0 |
| 9 | ⓘ | Button, `plain`, `autoFocus`, NO `hotkey`; opens/raises the pane | default | never |

Narrow widths (A1 table), applied cumulatively until the line fits: `< 160` remove hygiene; `< 140` also remove spend and decisions; `< 120` also remove the ◷ age and review; `< 80` keep only verdict, dispatch, the unit **bar** (no k/N, no 族) and ⓘ. If it still does not fit, truncate the position slot's stage text with `…`, never the verdict or ⓘ.

Non-ok snapshot (no project, error, stale): one dim line `<reason>` + ` │ ` + ⓘ. The former second band line (reason / proxy tail) moves to the panel's Now tab — the band is ONE line.

## ② Panel (pane `autopilot-live`, opened by ⓘ; also auto-opened as today at ≥ 144 columns fullscreen)

Hand-built tab strip (Buttons), in this order: **Legend · Now · Graph · Dispatch · Review · Decisions · Spend · Hygiene**. ⓘ opens on Legend.
- Legend: every glyph/indicator of the band with its meaning (table above), theme colours as on the band.
- Now: project, `size·level ▸ stage` with age, unit k/N + label, the verdict reason, attention lines, the awaited decision (moved from today's Dispatch tab top).
- Graph: the D4 walk as `node → node → …`, current node in `claude` bold, done nodes `success`, later nodes `subtle`; entry/terminal marked; size/flags line above.
- Dispatch: today's dispatch rows + gate rows + foreman (minus what moved to Now).
- Review: today's Review tab (P7d) + QC fact detail.
- Decisions: proxy-decision list/counts, undocumented dispatches, latest ladder rung + time.
- Spend: session $, host today all-tier $, host today brain-tier $ / cap, fuse mode.
- Hygiene: load source detail (version, dev/cache, behind upstream) + residue by class.
A missing fact renders an explicit "no data" line, never an empty tab.

## ③ Gate (after ② is frozen)

- `capture.sh`: add `capture-pane -e` (keep `-p`), copy D1–D4 files plus qc/review/load-source facts; window widths 209, 120, 80 (`tmux resize-window -x`).
- `check.js`: re-derive every rendered slot independently from the copied facts (shares no code with `mods/live`), judge it field by field; print one line per slot and a final `PASS <mode> fields=<n>` / `FAIL <mode> fields=<n> failed=<list>`; a slot that the width table removed is judged as "absent" at that width.
- Colored screenshot step: `ansi2html.py` (`docs/plans/evidence/2026-10-06-tui-band/ansi2html.py`) → headless chrome → `band-<width>.png` per capture.
