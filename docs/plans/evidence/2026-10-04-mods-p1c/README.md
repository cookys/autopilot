# mods P1b → P1c/P1d → P5 — state of play (2026-10-04)

> ## IN FLIGHT (2026-10-05 ~16:30, session df52a188) — read first after a context clear
> - **Main checkout = landing head 2160351c** (owner-approved FF; the main checkout IS the live plugin via `~/.claude/plugins/cache/autopilot/autopilot/dev` symlink; rollback `git reset --hard 33360bc3`, local only). Not pushed, no version bump. Landing clone `$OLD/p1c/land` (branch `land/v2.37.0`, rebased onto develop; pre-rebase ref `land/v2.37.0-pre-rebase`). Every accepted head + review id: `accepted-heads-p1w.txt`.
> - **Gate is agent-driven** (owner: 「這些你無法處理嗎?」): rules `gate/DRIVER.md`, cells `gate/RUNBOOK.md`, results `gate/runs/RESULTS.md`, sandbox repo `~/projects/gate-sandbox` (origin `~/projects/gate-sandbox-origin.git`). Cell 0 PASS (this session's UPS autostarted the watcher). dev-flow pilot: 6 PASS, findings → **GATEFIX** row in flight on `$OLD/p1c/land` (brief `briefs-p1w/w-row-gatefix.md`, report `$OLD/p1c/run-w/land/GATEFIX.md`): 進行中 while the session works (band said 待命), 完成待驗收 needs no live run, capture/check read the panel under dialogs, runbook fixes, 疑似卡住 via `kill -STOP` of a hand.
> - **Next**: review GATEFIX (`git -C $OLD/p1c/clone fetch $OLD/p1c/land land/v2.37.0:land/v2.37.0` before rv.sh) → FF main checkout to the new land head (same owner approval scope; rebase land onto develop first, verify non-docs diff) → re-run dev-flow failed cells → modes /l3 + ceo-agent → /l4 → /l5 → /l6 (one sonnet hand per mode per DRIVER.md; cap ~40 USD total; BLOCKED cells recorded, owner decides) → owner eyeballs a few captures → release commit MINOR 2.37.0 (check `git show origin/develop:.claude-plugin/plugin.json`; CHANGELOG, INDEX, plan graduation archives the plan + profiles chain; preflight-release) → ask before push.
> - **Cleanup owed** (after the gate): gate-sandbox worktrees `/tmp/hetero-gate-stall*` + branches `gate-stall*`; `/home/cookys/projects/gate-hand-prompt.txt`, `gate-author-prompt.txt`; `~/.claude/projects/-tmp-gate-scratch-repo`; gate session markers/scopes listed in `gate/runs/*/created.txt`; test temp-dir growth in /dev/shm and /tmp (prefixes lsh-, d0gate-, ctxbud-, runappr-, w2f-, hh-).
> - Known limitation (doc only): after a permission is approved the band keeps 要你決定 until the approved tool finishes.
> - Blueprint page https://claude.ai/artifact/6GwARh7XpbLsMSy7BwG6tE (progress section current to INT5).

> ## HANDOFF (2026-10-05) — read this block first
> Plan `docs/plans/2026-10-03-mods-visible-dispatch.md` R5.4, §4 P1W table is the single source (FROZEN after G1+G2; later rulings R5.3/R5.4 in Review log).
> **Accepted (wave 1, per-row reviewed, depth-0 re-checked)**: see `accepted-heads-p1w.txt` — W1a `5118dcfd`, W1i `c6af5401` (both on `p1c/r`), W1b `250b2576`, W1c `fcdfa106`, W1de `7713fbed`, W1f `1b5a3af4`, W1h `9a98e993`, W2f `4cc9933f`; earlier C1–C3b on `p1c/c` (`734365c1`), D1 `p1c/d1` (`14e44b46`), C3b-R `p1c/r` (`6e40bcc4`). EVALX `ebb70af3` (`w/evalx`, harness E1–E5, fail-closed tmpfs) accepted.
> **Where the code is**: clone `$OLD/p1c/clone` (`$OLD`=`/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad`), branches `w/*`, `p1c/*`; verified bundle `~/.autopilot/handoff/mods-p1c.bundle` (all branches). Row briefs: `briefs-p1w/`; per-row reports `$OLD/p1c/run-w/<row>/REPORT.md`; acceptance script pattern: per-row `dispatch-review.sh` over base..head with spec = w-common + row section + plan G1 folds.
> **Next, in order**:
> 1. Integration branch off current develop: cherry-pick in order p1c/r(6e40bcc4) → W1a → W1i → W1c → W1de → W1b → W1f → W1h → W2f → EVALX; resolve hook counts (W1c + W1de both add hooks: recompute via sync-version, README counts, hook-classes, profile-catalog hash, codex sync), codex mirror conflicts (W1b/W1h both touch autopilot-engine.js), runs-watch.js (W1a then W1c hunk). Run the full suite ONCE, reds solo, compare at develop.
> 2. Wave 2 mechanism rows from the integration branch, file-disjoint hands in parallel: (a) watcher inputs W1g + W2a-m + W2e-m + W2d publisher + W1i's missing **sources manifest** (all in runs-watch.js); (b) W2b-m `session-mode.js set --phase`; (c) **perf row** — awaiting-owner PostToolUse `.*` ~63 ms/tool call and UserPromptSubmit autostart ~120 ms/prompt: fold into the existing multiplexer or zero-spawn bail, exclude Task/Agent, skip locks when nothing pending; (d) reclassified mechanism rows W2g, W2c, W2e-g (R5.3: make the existing text actually happen by code, no SKILL.md edit).
> 3. Eval for W2a-g, W2b-g, W1b trigger 2 (owner: run now): add each helper's pack (freeze-pack command in EVALX REPORT), smoke 2 cells per row, then batches per `eval-design-guidance-rows.md` §4 (~120 cells, ~40M tokens est.). Thresholds frozen in `evals/skill-onoff/prereg/`.
> 4. W3a mod integration on `p1c/c` (reads tasks/attention/work-order phase/planned/decisions sidecar/sources manifest; round-trip the hook-written context file `model: {}`; 任務工具未開 hint).
> 5. W1f-b (hetero child job root; claim-semantics design) — separate design + review.
> 6. W4: one landing (fresh clone off origin/develop, cherry-pick, full suite, ONE combined review, release v2.37.0 — check origin version first), then the owner's ssh+tmux scripted real-run gate per the W4 cell table.
> Known pre-existing reds: L1 import-aa-capabilities (22), qualification-feed-adopt, qualification-scorecard-tools. Nothing of P1W is pushed; local develop has docs commits ahead of origin.

> **Current work: plan §4 P1W (R5).** Owner 2026-10-04: do not drop fields; every gap is a P1W row, parallel where independent. In flight: W0a+W0b spike (brief `briefs-p1w/spike-s10.md`, output `$OLD/p1c/s10/REPORT.md`) and wave 1 rows W1a W1b W1c W1f W1h W1i (briefs `briefs-p1w/`; worktrees `$OLD/p1c/wt-w1*`, branches `w/w1*` in the `p1c/clone`; reports `$OLD/p1c/run-w/<row>/REPORT.md`). `$OLD` = `/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad`. Next after acceptance: W1d/W1e (after spike), W1g (after W1a), wave 2 (guidance rows need eval first), W3a mod integration, W4 landing + owner tmux real-run gate.

> **v2.37.0 is BLOCKED (2026-10-04, after the wiring inventory).** `wiring-inventory.md` shows the band's sources are mostly unwired: the watcher publishes `progress/decision/planned/compare` as null (`src/status/runs-watch.js:394`), nothing writes a decision file or the task-status input bundle, the watcher starts only from `/l3`–`/l6`. Landing as built would ship a band where `要你決定` and `完成待驗收` never fire, phase and progress are always empty, and dev-flow shows `no project`. Owner asked for one holistic design first; the proposal (page copy `v237-band-redesign-proposal.html`) awaits the owner's answers. Depth-0 verified: campaign manifest roots equal work-order dir names 5/5; work-order `controller.progress_receipts[].phase` mixes casing (`IMPLEMENTING`, `awaiting_disposition`, `boundary_rejected`). The C3b "live campaign phase unreachable" conclusion was wrong for `/l5`/`/l6`: the root IS the campaign id.

Plan: `docs/plans/2026-10-03-mods-visible-dispatch.md` (R4.4). Read this first after a context clear.

## What shipped / what is where

| Unit | State | Evidence |
|---|---|---|
| P1a | shipped v2.36.115 (`97be7170`) | `../2026-10-04-mods-p1a/` |
| P1b (review page, host server, versioned jobs, republish triggers) | shipped **v2.36.116** (`7fc8efc5`) | `accepted-heads-p1b.txt`; combined review `review-1791066906-1806905-925d` SHIP-AS-IS |
| P1c C1 (interactive `/clear` + data-supply probes) | committed `2680228c`, branch `p1c/c` | `../2026-10-03-mods-spikes/S7-*` |
| P1c C2 (`mods/live` first version: runs-oriented band, pane, toast) | committed `2279e6d0`, SHIP-AS-IS `review-1791075406-3480737-bd5c` | `accepted-heads-p1c.txt` |
| P1c **C3** (band redesign, this document's owner decision) | committed `48be3ecd` on `p1c/c`, SHIP-AS-IS `review-1791114987-3893506-5b74`; depth-0 re-checked scope (8 files, all allowed), trailer, negative grep, 17/17 mutation outputs red | `hand-c3-brief.md`, `accepted-heads-p1c.txt` |
| P1c **C3b** (phase + 待命) | **R** `6e40bcc4` on branch `p1c/r` (renderer, based on `origin/develop` 1b549997) and **M** `734365c1` on `p1c/c`; both SHIP-AS-IS | `accepted-heads-p1c.txt` |
| P1d D1 (inventory + mirrors understand `modules`; hooks.json comment keys removed) | committed `14e44b46`, branch `p1c/d1`, SHIP-AS-IS `review-1791067635-2965625-21f6` | `accepted-heads-p1c.txt` |
| v2.37.0 | **not shipped.** Lands P1c (C1+C2+C3+C3b-M) + the renderer commit C3b-R from `p1c/r` + P1d (D1 + the `modules` key). C3 is accepted; next is the landing foreman (fresh clone off `origin/develop`, full suite, ONE combined review, release, push). | — |
| P5 proxy-decision reminders | **not started**, tracked in the plan §P5 and BACKLOG | `c4-proxy-decision-research.md` |

Unpushed work lives in a throwaway clone (scratchpad of session `74f6f85f`):
`/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1c/clone` (worktrees `wt-c` = `p1c/c`, `wt-d1` = `p1c/d1`; base `0a642f8f`). A git bundle of `p1c/c`, `p1c/d1` and `p1c/r` (verified) is at `~/.autopilot/handoff/mods-p1c.bundle`; `git clone`/`git fetch` from it recovers both branches if the scratchpad is gone.

## Owner decisions 2026-10-04 (binding)

1. The band answers the question of a human who left the computer: **which project · which phase · how long · progress %**, with a verdict word first (`要你決定 / 疑似卡住 / 完成待驗收 / 進行中`, precedence in that order) and a one-line reason. Cost and context move to the pane. Proposal page: `v237-band-redesign-proposal.html` (design only; text is illustrative).
2. Progress with an **unfrozen denominator** is shown as the count with a `*` and a dim style (`3 done*`), never as a percent. Percent only from a frozen `controller_progress_receipt`.
3. Option **B**: only the view and the reads change; the shipped `runs-live/1` and `review-job-model/1` contracts are not touched.
4. "Awaiting you" (review page `--decision` file) ships in C3. "Decided on your behalf" (decision ledger) is split out as **P5** and is not part of 2.37.0.

## Why P5 is separate (found 2026-10-04, `c4-proxy-decision-research.md`)

- Zero live decision ledgers exist on this machine; the only writer documented for `decision` rows (`skills/ceo-agent/references/depth0-control-loop.md:406`) has never produced a file. Building a reader first would be a feature that looks alive and shows nothing.
- Ledger rows carry no `root_run_id` / `repo_identity`; `round` is unique only within one file; there is no canonical ledger location; there is no "seen" mechanism.
- Order is therefore writer → publisher → display (plan §P5).

## C3 (accepted 2026-10-04)

Brief: `hand-c3-brief.md` (sonnet hand in `wt-c`, one commit on top of `2279e6d0`). Open questions the hand must answer in its report: whether the P1b job model carries a human **phase** name (if not, the band shows `—`, and a producer field is a follow-up), and the real shape of the `decision` object. Depth-0 acceptance = diff review + per-row review + re-run of the 22 pre-existing import-aa reds on the base (they are identical on clean `0a642f8f`).

## Known pre-existing reds (not caused by this work)

L1 `scripts/import-aa-capabilities.test.js` (22/23 fail on a clean base), `hooks/tests/qualification-feed-adopt.test.sh`, `hooks/tests/qualification-scorecard-tools.test.sh`.

### C3 facts and open items for the owner
- The P1b job model has **no human phase field**: the band shows `—` for phase. A producer-side phase name is a follow-up (needs a source, e.g. the campaign phase from a receipt).
- Frozen progress prints the model percent verbatim (`62.5%（5/8）`); integer rounding is a one-line change if wanted.
- Idle case (nothing live, nothing awaited, nothing frozen-complete) draws `○ <project> · …` with no verdict word; the four-word list does not cover it.
- `needs_decision: true` with a decision object lacking a string `question`: the band says `要你決定`, the pane omits the awaited section.
- No real tmux capture of the redesign exists (S9 uses test-kit trees); a real-session look is part of landing acceptance.

### C3b (accepted 2026-10-04): phase and idle word
- Phase source, in order: terminal campaign phase from a VALID `task_status_receipt` campaign entry, else the first open deliverable of the progress receipt (`做 <id>`), else `—`. zh-TW labels live in `scripts/render-review-page.js` (`PHASE_LABEL`). The renderer change is additive (`model.json` `phase`, review-page chip `階段：…`) and ships in the same release as the mod.
- **Live campaign phase is unreachable**: the live state sits in `<git-common-dir>/autopilot/implementation-campaign.jsonl`, keyed by a hash campaign id; no `root_run_id` → campaign id mapping exists and the task receipt validates only terminal campaigns. A run in progress with no frozen progress receipt therefore shows `—`. Follow-up in BACKLOG.
- dev-flow stages (L-1…L-5) and the plan's own phases (P0…P4) are prose only; nothing records "currently at X". Adding a writer means editing dev-flow `SKILL.md`, a guidance change that needs eval evidence first (CLAUDE.md scorecard-first). Not done.
- Fifth verdict word `待命` (idle), last in precedence.
- Mutation outputs: `$OLD/p1c/c3/mut-b-*.txt` (10 for M) and the renderer's five in the hand report.

### Probe outcomes (2026-10-04, classification per the frozen table)
- W2c: **guidance** — no code path writes /l4 foreman liveness; only prose (`level-front-door.md:270-272`). Needs eval before a writer step. Interim pane text: 工頭狀態：來源未接. Evidence `probe-w2c-w2f.md`.
- W2f: **mechanism** — hook payloads carry `transcript_path`; last-usage tokens equal the status-line file (delta 0, one sample); extend `hooks/context-budget.js` (PostToolUse, ~0.75 ms tail read) to write `<live>/context/<sid>.json` when the status line does not, with `window_source`; percent withheld when the window is unknown. Evidence `probe-w2c-w2f.md`.
- W0a/W0b spike report: `spike-s10-s11.md`.
