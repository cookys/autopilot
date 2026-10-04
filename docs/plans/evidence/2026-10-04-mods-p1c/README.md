# mods P1b → P1c/P1d → P5 — state of play (2026-10-04)

Plan: `docs/plans/2026-10-03-mods-visible-dispatch.md` (R4.4). Read this first after a context clear.

## What shipped / what is where

| Unit | State | Evidence |
|---|---|---|
| P1a | shipped v2.36.115 (`97be7170`) | `../2026-10-04-mods-p1a/` |
| P1b (review page, host server, versioned jobs, republish triggers) | shipped **v2.36.116** (`7fc8efc5`) | `accepted-heads-p1b.txt`; combined review `review-1791066906-1806905-925d` SHIP-AS-IS |
| P1c C1 (interactive `/clear` + data-supply probes) | committed `2680228c`, branch `p1c/c` | `../2026-10-03-mods-spikes/S7-*` |
| P1c C2 (`mods/live` first version: runs-oriented band, pane, toast) | committed `2279e6d0`, SHIP-AS-IS `review-1791075406-3480737-bd5c` | `accepted-heads-p1c.txt` |
| P1c **C3** (band redesign, this document's owner decision) | dispatched; see "C3" below | `hand-c3-brief.md` |
| P1d D1 (inventory + mirrors understand `modules`; hooks.json comment keys removed) | committed `14e44b46`, branch `p1c/d1`, SHIP-AS-IS `review-1791067635-2965625-21f6` | `accepted-heads-p1c.txt` |
| v2.37.0 | **not shipped.** Lands P1c (C1+C2+C3) + P1d (D1 + the `modules` key). Needs: C3 accepted, then a landing foreman (fresh clone off `origin/develop`, full suite, ONE combined review, release, push). | — |
| P5 proxy-decision reminders | **not started**, tracked in the plan §P5 and BACKLOG | `c4-proxy-decision-research.md` |

Unpushed work lives in a throwaway clone (scratchpad of session `74f6f85f`):
`/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1c/clone` (worktrees `wt-c` = `p1c/c`, `wt-d1` = `p1c/d1`; base `0a642f8f`). A git bundle copy is at `~/.autopilot/handoff/mods-p1c.bundle` once C3 is committed.

## Owner decisions 2026-10-04 (binding)

1. The band answers the question of a human who left the computer: **which project · which phase · how long · progress %**, with a verdict word first (`要你決定 / 疑似卡住 / 完成待驗收 / 進行中`, precedence in that order) and a one-line reason. Cost and context move to the pane. Proposal page: `v237-band-redesign-proposal.html` (design only; text is illustrative).
2. Progress with an **unfrozen denominator** is shown as the count with a `*` and a dim style (`3 done*`), never as a percent. Percent only from a frozen `controller_progress_receipt`.
3. Option **B**: only the view and the reads change; the shipped `runs-live/1` and `review-job-model/1` contracts are not touched.
4. "Awaiting you" (review page `--decision` file) ships in C3. "Decided on your behalf" (decision ledger) is split out as **P5** and is not part of 2.37.0.

## Why P5 is separate (found 2026-10-04, `c4-proxy-decision-research.md`)

- Zero live decision ledgers exist on this machine; the only writer documented for `decision` rows (`skills/ceo-agent/references/depth0-control-loop.md:406`) has never produced a file. Building a reader first would be a feature that looks alive and shows nothing.
- Ledger rows carry no `root_run_id` / `repo_identity`; `round` is unique only within one file; there is no canonical ledger location; there is no "seen" mechanism.
- Order is therefore writer → publisher → display (plan §P5).

## C3

Brief: `hand-c3-brief.md` (sonnet hand in `wt-c`, one commit on top of `2279e6d0`). Open questions the hand must answer in its report: whether the P1b job model carries a human **phase** name (if not, the band shows `—`, and a producer field is a follow-up), and the real shape of the `decision` object. Depth-0 acceptance = diff review + per-row review + re-run of the 22 pre-existing import-aa reds on the base (they are identical on clean `0a642f8f`).

## Known pre-existing reds (not caused by this work)

L1 `scripts/import-aa-capabilities.test.js` (22/23 fail on a clean base), `hooks/tests/qualification-feed-adopt.test.sh`, `hooks/tests/qualification-scorecard-tools.test.sh`.
