> Survey of mods candidate items (session report, 2026-10-07).
> Not an eval arm; owner chose option b, items folded into plan addendum A1 (stage-graph plan).

# Mod candidates for autopilot (research, read-only; 2026-10-06)

Baseline facts. The mod is a pure reader of watcher/hook-written files: pointer, runs envelope, context, tasks, attention and the decisions/foreman sidecars (`mods/live/register.ts:1-17`). It ticks every 5 s (`register.ts:33`) and already toasts on dispatch-count and acceptance changes (`register.ts:303-316`). The pane opens at >=144 columns (`register.ts:35`). The band today is a 2-line strip with the verdict precedence in `model.ts:556-592`. The pane header already shows session $, host $ and ctx (`model.ts:655-657`). The mod sandbox has no Node and cannot `require` repo code (memory `mods-surface-element-facts`). So every new widget needs a published file. Hooks already write such files: `<live>/context/<sid>.json`, `attention/`, `tasks/`, `advisory-queue/` (`hooks/cost-tracker.js:190-238`). The watcher writes `runs/<scope>.decisions.json` and `.foreman.json` (`src/status/decisions-sidecar.js:3-20`). Cheapest design: add ONE more sidecar, `<live>/runs/<scope>.widgets.json`, plus one `<live>/advisories/<sid>.jsonl` written by hooks. The mod stays a dumb reader.

## 1. Inventory

Effort: S <= 0.5 d, M ~ 1-2 d, L > 2 d. "band" = band widget, "pane" = pane tab.

| # | Feature | Today | Proposed | Data source (existing / missing) | Refresh | Value | Eff | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Stage / size / level / unit k/N / review families (P7 core) | `phase` text; stage model not yet shipped | band: `L·l5 ▸ verify` + `▰▰▱ 2/4` + `·3族` + age; pane: graph, current node highlighted | marker fields `size, level, stage, stage_set_at, unit{kind,index,total,label}, review_families` (plan §2.9 `docs/plans/2026-10-06-dev-flow-stage-graph.md:159-190`; schema in release worktree `schemas/session-marker.schema.json`; writer `scripts/stage-advance.js:1-12`, release-3.0.0 only). Mod reads the marker via the `session-mode/<sid>.json` path (`register.ts:9`) | 5 s tick | High | M | Exists only on release/3.0.0. `unit.total` unfrozen -> dim. Plan P7 `:404-415` |
| 2 | Verdict word (decide / stalled / done / running / idle) | band line 1 | band slot 1, keep glyph table | `model.ts:556-592`; attention, decisions, stall rows | 5 s | High | S | Already built |
| 3 | Live dispatches and stalls | `⚙ n` / `⏸ n` in band; `autopilot status runs` | band `⚙2 ⏸1`; pane Dispatch tab (rows) | runs envelope: `counts.confirmed_live`, `rows[].stall`, `last_event_age_s` (`model.ts:211`; producers `src/status/runs-fields.js:1-15`, `scripts/dispatch-status.js`, `DEFAULT_STALL_SECS` 180) | 5 s | High | S | Already in snapshot |
| 4 | Hetero code-review loop rounds | none live (loop prints to depth-0 only) | band chip `R2 ⟲ 3族`; pane Review tab: round, seat, verdict | per-phase dir `<ledger>/review-<phase>/` (`scripts/hetero-review-loop.js:468`) + receipt derive `scripts/lib/review-chain-derive.js` -- **missing**: a published summary (round n, seats done/total). `review_families` (row 1) is the only live piece | event (after each round) | Med | M | Add to widgets sidecar; do not parse the ledger in the mod |
| 5 | Plan-review panel status | CLI JSON, `state.json` | pane Review tab: generation 1/2, seats n/m, verdict READY/CONDITIONAL/STOP | `~/.autopilot/plan-review/<session_key>/state.json` and `generation-NN.json` (`scripts/dispatch-plan-review.js:938, 1388`) -- exists; `$.fs.read` the file directly | 5 s while a review runs | Med | S | State schema [unverified] beyond `terminal`, `terminal_verdict` (`:21-41` header) |
| 6 | QC gate verdict | `QC-Verdict: PASS` trailer checked at push (`.githooks/pre-push:63`); `.qc/<sha>.verdict.json` artifact | band chip `QC ✓` / `QC ✗ owed`; toast on change | `scripts/resolve-qc-gate.sh:18` (mode/evidence); HEAD trailer or `.qc/<sha>.verdict.json`. **Missing**: a deterministic "QC owed for protected-path diff at HEAD" publisher (the owed state from the alpha.1 no-verify push is currently only a docs note) | on commit / 5 s | High | M | Verdict is a claim (ADR-0001): chip text "claimed PASS", never "verified" |
| 7 | cost-fuse (brain-tier daily $) | `additionalContext` to the MODEL, once per threshold multiple (`hooks/cost-fuse.js:368-386`); deny when mode=block | band chip `$41/150` colored by multiple; toast on crossing. Model-facing nudge stays but shortens (see 3.) | `~/.claude/metrics/costs.jsonl` (`cost-fuse.js` header; `scripts/cost-digest.js --today --json`) -- exists; the mod cannot parse JSONL cheaply, so the watcher already publishes `host_today_usd` (`model.ts:657`) | per Stop | Med | S | Brain-tier slice is not in the envelope [unverified]; codeforge shows 5h/7d only -> no overlap |
| 8 | cost-tracker cache-read advisory | enqueued, drained into model context at next prompt (`hooks/cost-tracker.js:190-238`, `hooks/advisory-relay.js:89`) | toast + pane Spend tab; stop injecting | same queue file; advice text is human-addressed ("consider splitting") | on Stop | Med | S | Pure noise to the model |
| 9 | Context budget T1/T2 | T1: stderr + `additionalContext` (`hooks/context-budget.js:243-249`, `:292-299`); T2 exit 2 to model (`:250-253`) | band: NO ctx% (codeforge owns it). Toast at T1 only | live ctx file (`model.ts:638-652`) | 5 s | Low | S | Overlaps codeforge ctx%; do not draw a bar |
| 10 | depth0-delegate-gate nudge | `additionalContext` (`hooks/depth0-delegate-gate.js:251-258`), deny on guarded model | leave as is | -- | -- | -- | -- | Model must act |
| 11 | Unknown-ladder rung and budget | ledger rows; `probe-unknown.js report` | band chip `U1 1/2`; pane row | ledger path `$AUTOPILOT_LADDER_LEDGER` default (`scripts/probe-unknown.js:49-61`): `budget:{u1,u2,u3,used}` is in `classify` output, not a file -> **missing** publisher | on ledger append | Low | M | Rarely non-zero; pane only until it is hot |
| 12 | "Decided on your behalf" count | `◆ n` / `? n` in V4a spec | band `◆4 ?1` (exists in `model.ts`); pane: list with veto id | `runs/<scope>.decisions.json` (`decisions-sidecar.js:3-20`; counted kinds decision/dispatch/pick/refreeze) | 5 s | High | S | Veto is `decision-ledger.js veto`; a pane Button running it is a write -> keep read-only for now |
| 13 | Backlog next-pick | `next-pick.js` CLI (writes a ledger pick) | pane Next tab (read-only preview) | `scripts/next-pick.js` writes rows; no read-only "peek" [unverified] | on open | Low | M | Do not run a picker from a render path (it writes) |
| 14 | Version drift / plugin load source | SessionStart `additionalContext` (`hooks/version-drift-check.js:60-84`); reload-watch (`hooks/reload-watch.js:95-100`) | band chip `dev@a1b2 ↓3` or `cache 2.36.36 ✗` (red when a stale cache shadows dev) | version-drift computes behind-count from `CLAUDE_PLUGIN_ROOT` (`:36`); stale-cache fact = memory `plugin-cache-version-dir-shadows-dev`; mod can read its own plugin path + `plugin.json` [unverified: mod API for its own root] | once + on `/reload-plugins` | High | S | Cheap, catches the real 2.36.36 incident |
| 15 | Campaign deliverable progress | frozen controller receipt, `done*` | band `▰▰▱ 3/5` (same slot as row 1 `unit`); pane Gantt | `<git-common-dir>/autopilot/work-orders/<root>/*.json` (`register.ts:14-15`), `src/status/planned-input.js` | 5 s | High | S | Per-deliverable timing source unverified (README open question) |
| 16 | Background agents / foremen liveness | `watch-foreman.js` via Monitor; `agent-liveness-check.js` facts | band merged into `⚙`/`⏸`; pane Foreman rows | `runs/<scope>.foreman.json` (`model.ts:503-520`) | 5 s | High | S | Already wired (FOREMAN_STALL_S) |
| 17 | Worktree / branch residue | `repo-residue-sweep.js scan --json` | pane Hygiene tab; band chip `wt 9` only when > threshold | `scripts/repo-residue-sweep.js scan --repo <dir> --json` (slow; run in watcher, publish count) | every ~5 min | Med | M | Never run `scan` from the render loop |
| 18 | Handoff / compaction state | SessionStart injection (`hooks/session-start.js` `HANDOFF_LABEL`); state-checkpoint | toast "handoff written" (`~/.autopilot/handoff/`) | `hooks/session-handoff.js`, `hooks/state-checkpoint.js` outputs | event | Low | S | Keep model injection (it restores context) |
| 19 | Eval campaign progress | per-campaign scripts (`evals/brain-campaign-state.js` [unverified content]) | pane Eval tab | none unified -- **missing** | -- | Med (during campaigns) | L | Defer |
| 20 | Review page (localhost:8787) | HTML via `render-review-page.js`, served by `src/status/review-server.js` | keep; pane `Link` to it (exists, `model.ts` link) | -- | -- | -- | -- | Owner uses a reverse proxy; keep |
| 21 | `ask-decision` / awaiting-owner | attention file | band `▲` + toast | `attention/<sid>.json` (`hooks/awaiting-owner.js` header) | event | High | S | Already wired |
| 22 | Skills list (30 skills) | catalog in model context | leave as is | -- | -- | -- | -- | A command palette mod is possible but low value |

## 2. Band layout (209 cols, one line, V4a-compliant)

One line, theme-key text colour only, no background or inverse. Use a `Box flexDirection="row"` with fixed `width` cells (CJK measured by display width) and `│` separators in `subtle`. Size to `e.props.bodyColumns` (not the terminal width; a docked pane narrows it). One line is enough: the reason sentence moves behind ⓘ as V4a already says (`README.md` decision 2/4). A second row would only be justified for a pending decision, and V4a rejects it.

| Slot | Content (example) | Width | Drops at |
|---|---|---|---|
| A verdict | `▲ 要你決定` | 12 | never |
| B position | `L·l5 ▸ verify ◷12m` | 22 (16 without age) | age at <120 |
| C unit | `▰▰▱▱ 2/4 ·3族` | 15 | `·3族` at <100 |
| D dispatch | `⚙2 ⏸1` | 8 | never (zero omitted) |
| E review | `R2 ⟲ · QC ✓` | 14 | <120 |
| F decisions + ladder | `◆4 ?1 U1` | 10 | <140 |
| G spend | `$41/150` | 9 | <140 |
| H hygiene | `dev ↓3 · wt 9` | 14 | <160 |
| ⓘ | `ⓘ` | 2 | never |

Widths sum to about 106 plus separators (~27) = ~133. That leaves ~75 spare columns at 209, so the age and unit-label slots can grow (e.g. unit label up to 24). At 120: A B(no age) C D E ⓘ. At 80: A, D, C (bar only), ⓘ, and B truncated to `l5 ▸ verify`. Behind ⓘ (pane tabs): Legend, Now (reason, decision options), Graph (stage node highlight), Dispatch table, Review (rounds, plan-review seats, QC), Decisions (ledger), Spend (per-tier), Hygiene (residue, drift, load source). The pane header keeps session / host $ and ctx.

## 3. Hook advisories: stop injecting vs keep

Stop injecting into model context once a human-facing surface shows it (token and noise savings; the model cannot act on these):
- `cost-tracker` queued advice (`hooks/cost-tracker.js:190-238`, relayed by `advisory-relay.js:89`): the text is addressed to the human ("consider splitting").
- `version-drift-check` SessionStart text (`:60-84`): the fix is a human `git pull` + `/reload-plugins`.
- `context-budget` T1 (`hooks/context-budget.js:243-249`): already visible on stderr; the `additionalContext` copy is redundant. Move to a toast.
- `suggest-compact` (counts Write/Edit; header): it asks for a `/compact`, a human action.
- `dirty-protected-paths` already uses `systemMessage` (human only, `:220`). It is a ready model for the others.

Must stay model-facing (the model has to act):
- `context-budget` T2 (`:250-253`, "write a handoff NOW").
- `cost-fuse` warn: keep a one-line nudge (the model should brief and dispatch to hands); the human sees the chip as well. Shorten the text.
- `depth0-delegate-gate` (`:251-258`), `foreman-guard` (`:517-523`), `dispatch-model-guard`, `failure-escalation`, `reload-watch` (`:95-100`, if the agent can invoke the reload per its plan title), and the SessionStart handoff snapshot (restores context).

Mechanism: a hook that stops injecting writes the same line to `<live>/advisories/<sid>.jsonl` (`{id,kind,severity,text,at}`), and the mod toasts / chips from it. Fail-open: if no mod is loaded, the human sees nothing, so keep a stderr copy and a per-hook knob to restore injection. This is a MECHANISM change under CLAUDE.md's rule only if the wording is untouched; moving text is mechanism, rewording is guidance.

## 4. Top 5 recommendations

1. **P7 band on the stage-graph fields (rows 1-3, 15, 16, 21).** Smallest step: refactor `band.tsx` into slots A-D as fixed-width cells reading the existing snapshot, and add the ⓘ button. The stage fields wait for alpha.1.
2. **Advisory bridge (section 3).** Smallest step: `cost-tracker` and `version-drift-check` write to `advisories/<sid>.jsonl` and drop their `additionalContext`; the mod toasts it. Measure the token saving on one session.
3. **Plugin-load-source chip (row 14).** Smallest step: show `plugin.json` version + `dev|cache` in slot H. It catches the stale-cache incident for free.
4. **QC chip (row 6).** Smallest step: a watcher publisher for "protected-path diff at HEAD has/lacks QC-Verdict trailer", shown as `QC ✓/owed`. It closes the "QC owed before alpha.1" gap visibly.
5. **Review tab: plan-review and hetero loop (rows 4-5).** Smallest step: read `~/.autopilot/plan-review/*/state.json` directly in the pane (`dispatch-plan-review.js:938`); publish a loop summary for rows 4 later.

Coordination: codeforge owns model, git, 5h/7d and ctx%. Agree a band-row budget with it before slots E-H ship (README decision 6). Colours must be verified from a rendered screenshot, as in `tui-verify-by-rendered-screenshot`.
