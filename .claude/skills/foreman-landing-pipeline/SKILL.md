---
name: foreman-landing-pipeline
description: depth-0 wants to ship an autopilot plan or backlog bundle through background sonnet foremen and hetero hands, from probe to pushed release. Traditional-Chinese triggers — 派工頭做完發版, 平行工頭, 落地發版.
---

# foreman-landing-pipeline

Multi-foreman pipeline for shipping a plan or a BACKLOG bundle: probe → plan review → implement foreman → landing foreman → depth-0 verification between every stage → closeout foreman. depth-0 stays the only authority that accepts a claim; every foreman's output is evidence, never a verdict.

## 0. Pre-work (before any foreman exists)

- **Probe** any platform fact the plan depends on that you have not verified this session by URL or by running the real tool (see project CLAUDE.md "Don't" §). An unverified fact is a Spike candidate, not a fact — put it in the plan as one, or probe it first.
- **Write the plan**, then run it through the **plan review loop** (`autopilot:hetero-review` → `dispatch-plan-review`), not this skill's own judgment:
  - Frozen rubric per generation; a chair swap needs operator approval, not a foreman's initiative.
  - G1 dispositions are binding — every accepted item is in scope for the implement brief's Global Constraints, verbatim.
  - **At most G2.** If a rubric item is defeated at G1, replace it with a new logical id and ticket rather than resurrecting the old one.
  - Run the **freeze check** before treating the plan as implementable.
  - A **bounded repair** after freeze is allowed for defects the freeze check itself surfaces — not a reopening of already-adjudicated rubric items.

## 1. Implement foreman

Dispatch a background sonnet foreman (`Engine: sonnet` header — `dispatch-model-guard` denies a dispatch missing it) from `templates/implement-brief.md`. Judgment for the brief:

- **A clone, never the main checkout.** The clone carries a shadow commit ("PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode shadow, never land") so `dispatch-hetero.sh` doesn't refuse under Mission enforce. **Put the shadow commit in the brief itself, at setup, authored by depth-0 — never send it to the foreman as a follow-up message.** A follow-up message is not authorization; a refused or misapplied shadow commit is what wave-1b cost.
- **Stacked rows**: each row's hand base = the previous row's accepted head (its repair head if repaired). One hand commit per row, RED-first test, Verify runs the row's own suite plus every CONSUMER suite of the touched contract — not just the bundle suite.
- **Per-row review** happens here, but treat it as necessary and not sufficient — see §2's combined review.
- Rail failures (quota, 402, readiness, "Cannot use this model") are `RAIL-FAIL`, not a reason for the foreman to author code itself.

### 1b. Size the shape before dispatch (2026-10-02/03)

- **Independent rows run in parallel**, not stacked: one sonnet hand per row in its own worktree of one clone, from `templates/hand-brief-common.md`. Stack only true dependencies. Seven parallel S rows landed in ~1 h; a stacked cheap-hand bundle of the same size took ~3 h.
- **Hand choice**: rows that are large or touch signals/traps/sandboxing get a sonnet hand (`Agent`, model sonnet), not a cheap rail hand — 6/7 cheap-hand rows needed a repair round.
- **Never skip per-row review to save time**: v2.36.108 skipped it and three issues surfaced only at the combined review, each costing a landing round.
- **Consumer sweep incl. L1** is part of every hand's Verify (the template says how); a hand that runs only its bash suite pushes the failure to the landing gate.
- Tell the operator the estimated wall time at dispatch.

## 2. Landing foreman

Fresh brief from `templates/land-brief.md`, dispatched only after depth-0 has accepted every implement-foreman row from git evidence (diff, not self-report). Judgment for the brief:

- **A fresh clone off `origin/develop`, not the implement clone.** Set `git config core.hooksPath .githooks` in the very first setup line — a landing clone without it ships without the pre-push qc-gate ever running (v2.36.99 shipped a literal `<id>` trailer this way).
- **Cherry-pick hand commits only.** Never the shadow commit; grep `enforcement_mode` still says `enforce` after every pick.
- **The whole suite**, not a scoped slice — a change that touches a widely-consumed contract needs the full `hooks/tests/run.sh`. Rerun every red solo; anything still red gets compared at `origin/develop` in a throwaway worktree to separate pre-existing red from red the branch introduced.
- **ONE combined review** over `origin/develop..HEAD`, never a re-run of the per-row reviews. A combined review has caught what per-row review missed on this exact pipeline (multiplexer allow-bypass and five findings in one round — see Rules learned). STOP on any 🔴/🟠 in that verdict; do not self-adjudicate them away.
- **Release** only after gates are green and the verdict is SHIP-AS-IS: version bump, BACKLOG/CHANGELOG/INDEX, `preflight-release.sh`.
- **Trailers are filled from the review manifest's real review id** (the JSON the combined review actually produced), never left as a literal placeholder string. Push, then confirm with `git ls-remote origin develop`.

## 3. depth-0's duties between stages

- **Re-derive every refuted finding yourself.** ADR-0001 (verification over attestation): a foreman's "this finding is a false positive" is a claim, not a fact, until you re-derive it from the same diff.
- **Verify each push independently**: `git ls-remote` matches the reported SHA, the trailer holds a real review id (not `<id>`), governance still reads `enforce`, and no shadow commit landed.
- **Parked foremen do not wake themselves.** Use a background dead-man timer (`sleep <n>; echo WAKE-<tag>`) alongside the dispatch, plus a git-state check on wake, plus `SendMessage` to nudge a foreman that should have reported back and hasn't.

## 4. Closeout foreman

From `templates/closeout-brief.md`, on the real repo (not a clone — "nothing else runs here"). This step is **never skipped**, even for a small bundle:

- Scoped doc-sync on exactly the diff range that shipped — fix only real drift.
- A BACKLOG row for anything discovered mid-pipeline that wasn't in scope to fix now (e.g. a suspected-but-unconfirmed pollution incident).
- An evidence directory under `docs/plans/evidence/<date>-<slug>/` holding every brief, every REPORT, every review JSON, plus a short README naming the probes and the combined-review catches.
- HANDOFF update in its existing style (zh-TW conventions apply — see project CLAUDE.md).
- One commit, gated the same way as a landing commit if it touches a qc-protected path.

## Repair (when landing gates go red only on the release branch)

Use `templates/repair-brief.md` when the landing foreman's gate run finds suites red on the release branch but green at `origin/develop`. Bisect per cluster first — trust the bisect over the suspect guess. One repair hand per cluster, on a rebuilt shadow branch (never the release branch itself), reviewed the same way as an implement-foreman hand. At most one repair round per cluster; anything still red after that is `FAIL`, reported, not repaired by the foreman itself.

## Rules — canonical elsewhere (do not duplicate here)

This skill is the **checklist and the templates** (`templates/*.md`). The rules and their source events live in:
- `skills/l5/references/hetero-impl-loop.md` § "Sonnet foremen as Agent subagents": the shadow commit goes in the brief, a landing clone sets `core.hooksPath`, the trailer id comes from the manifest, and the landing foreman stops on 🔴/🟠.
- `references/evidence-discipline.md` §42–§44: an advisory channel existing is not proof it arrives; a per-row review cannot replace the combined review; a real-store diff is not proof of test pollution.
- Tool-guard gotchas: exec-boundary blocks destructive-shaped words even inside heredoc text, so write scripts to a file first; `pgrep -f`/`pkill -f` match themselves. These are in the operator's memory, not the repo.

When a new rule is learned, add it to those files, not here.
