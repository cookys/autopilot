# Plan — Learnable items from gstack + superpowers v6 (and the standalone TDD gap)

**Date**: 2026-06-24
**Status**: CONVERGED v2 (post-dialectic Round 1 — Architect/Ops/Skeptic independently convergent)
**Source**: verified survey of `obra/superpowers` v6.0.3 (2026-06-18) + `garrytan/gstack` (2026-06-21), GitHub-API-confirmed.

> **Round-1 dialectic verdict (unanimous):** same thin-slice shape as the prior two same-genre studies. The
> "convergent signal" behind L2+L3 was **selection bias** — gstack and addyosmani are both UI/product-oriented
> repos, so two UI repos flagging UI/runtime gaps is one bias sampled twice, NOT evidence autopilot's
> backend/tooling users need it (cf. the `measure-representative-population` rule). Real yield: **2 small inline
> items + 1 doc-honesty fix + 1 backlog spike.** The original L1-L5 are preserved below the line as the rejected
> record with kill reasons.

## Converged scope

### E1 — suppression / severity-coaching dispatch-prompt check  · Effort L (test harness first)
**What**: catch the *controller-corrupts-reviewer-within-one-dispatch* class: a dispatcher telling the reviewer
to ignore something or pre-rating severity ("call it Minor at most", "don't treat the null-deref as a defect",
"ignore the error handling"). VERIFIED genuinely uncovered: `check-redispatch-prompt.sh` only catches severity
tiers *tied to a prior round* (`<severity> ... from/in round/previous`), not round-free suppression coaching.
**🔴 Landing correction (R1 Architect)**: do NOT silently bolt this onto `check-redispatch-prompt.sh` — that
script runs **round-2+ only**, but suppression coaching happens on the **round-1** dispatch too. Either generalize
that script to run on all dispatches (rename + re-wire, not a silent append) with a new suppression class, or a
new tiny sibling check wired into `blind-dispatch.md`'s pre-flight for *every* dispatch.
**🔴 Prerequisite (R1 Ops — the plan's "it has a test" was FALSE)**: `check-redispatch-prompt.sh` has **no test**.
Write `hooks/tests/check-redispatch-prompt.test.sh` FIRST (positive: coaching caught; negative: legit prompts
pass), wired into the runner. Empirically reproduced FP risk: the existing linter already false-positives on
honest prompts; the new class MUST anchor to imperative-suppression grammar (`(call|rate|mark|treat) (it|this)
(as )?(at most )?<severity>`, `do not (flag|report|treat)`) — NOT bare severity-word proximity — with
reviewer.md's own "don't over-flag minor nits" calibration language as a **negative** fixture.
**Note**: L1(b) "can't-verify-from-diff verdict" is CUT — already covered by the Three Red Lines (fact-driven +
exhaustiveness); making it explicit is at most a 1-line reviewer.md clause, not part of this item.

### E2 — verbatim Global Constraints block → `references/plan-template.md`  · Effort S
**What**: a plan-level **Global Constraints** section (version floors / dep limits / exact values) **copied
verbatim** into every downstream implementer + reviewer dispatch, so "implementer A used a different value than
reviewer B" can't cause a fix round. VERIFIED gap: the six-element Task Prompt (planner.md:57-64) is *per-task*;
there is no plan-level verbatim-propagated global invariant.
**Scope discipline (R1 Architect + Skeptic)**: ship the Global Constraints half only. The per-task **Interfaces
block is CUT** as a parallel block — fold it as ONE bullet that sharpens the existing `input`/`output` elements
("what you consume from the producer task / produce for consumer tasks"), keeping a single canonical statement
(CLAUDE.md "no second canonical statement" rule). Do NOT import superpowers' "1 vs 2-4 fix rounds" metric as
autopilot's expected yield (vendor self-report, per `verify-reviewer-claims`).
**Landing**: `references/plan-template.md` (canonical). The planner contract *references* it — **no `planner.md`
body edit** (avoids the `sync-agent-bodies.sh` gate; keeps it truly free).

### E3 (doc-honesty, not a build item) — make the standalone TDD gap explicit  · Effort S
**What**: one sentence in `skills/test-strategy/SKILL.md` Coexistence + README scenario B: *standalone mode does
not ship a native red-green-refactor TDD loop; install `superpowers` for `test-driven-development`.* Settled
decision (R1 unanimous): do NOT build a native `skills/tdd/` — it would duplicate superpowers when present and
violate `skill-refactor-rules` (skill #24 for a capability the ecosystem already provides). Currently README
scenario B implies full standalone coverage, which is the actual inaccuracy.

### BACKLOG spike — dialectic-depth calibration
The strongest external evidence in the whole survey: superpowers **deleted** its subagent spec/plan-review loop
after measuring it "doubled execution time (~25 min) with identical quality scores (5×5 trials)." Spike: are
autopilot's default dialectic/think-tank rounds latency for no quality delta on some decision classes? (The last
three studies each converged by round 2 — suggestive.) Trigger-conditioned BACKLOG line, not a build item.

---
---
## REJECTED RECORD (original L1-L5 — kept for reasoning, do not build)

## Framing

Two same-genre repos surveyed against autopilot. Autopilot is AHEAD on dispatch machinery
(git-artifact verification, worktree isolation, /l3-l5 CEO loop, hetero/batch, task-tree, blind
re-dispatch) — import none of that. The learnable surface is narrow and concentrated in **review-integrity
methodology** + **a verification modality autopilot lacks (runtime/browser)**. A **convergent signal** matters
most: two independent repos (gstack AND the earlier addyosmani study) both flag the SAME autopilot blind spots —
runtime/browser verification + a UX/design axis. Convergence = real gap, not one repo's taste.

This plan lists candidates pre-dialectic; expect the dialectic to prune hard (the last two studies converged to
1-3 small items). Each item names its autopilot landing site + effort.

---

## Candidate items

### L1 — SDD anti-gaming reviewer contract  · Effort S→L · (superpowers v6.0.0)
**What**: superpowers' `subagent-driven-development` review now bans two controller-corrupts-reviewer moves:
(a) **the controller can't tell a reviewer what to ignore / can't pre-rate severity** (caught real runs where a
controller coached "call it Minor at most" and shipped the flaw); the reviewer prompt self-checks for
"do not flag" / "don't treat X as a defect" language and stops. (b) A **third verdict "can't verify from the
diff"** for requirements living in *untouched* code — bounced back to the controller to self-check rather than
silently passed.
**Why it fits / the gap**: autopilot's `scripts/check-redispatch-prompt.sh` lints *round-cycle leakage* (prior
verdicts re-fed on re-review) — it does NOT catch **severity-coaching / suppression** (a dispatcher pre-rating
or telling the reviewer to ignore something). That's a **distinct adversarial class**. And autopilot reviewers
cite file:line on what they SEE — an explicit "requirement real but invisible in this diff → escalate, don't
assume-pass" verdict is cleaner than the current implicit handling.
**Landing**: extend `scripts/check-redispatch-prompt.sh` (add a suppression/severity-coaching phrase class) +
a clause in `references/blind-dispatch.md` and/or `agents/reviewer.md` for the "can't-verify-from-diff" verdict.
**Note**: this is thematically adjacent to the v2.24.0 refute pass + the just-shipped E1 doubt-theater clause.

### L2 — Runtime / browser diff-aware QA rail  · Effort L→H · (gstack /qa + addyosmani browser-testing — CONVERGENT)
**What**: drive the *real running app*, screenshot, read the console, test only the pages the diff touches, and
**codify each fix into a regression test**. gstack's `/qa` + addyosmani's `browser-testing-with-devtools` both
ship this; autopilot has NONE — it verifies via git artifacts + the project's existing test suite only, never
runtime behavior.
**Why it fits**: the diff-aware angle (test only what changed, per the git diff) matches autopilot's existing
diff-scope philosophy (`diff-scope-report.sh`, `check-disjointness.sh`). It would extend `quality-pipeline`
beyond unit tests into runtime behavior — the single biggest hole both surveys flagged.
**Scoping question (for dialectic)**: autopilot is a *methodology/orchestration* plugin, not a test-runner. Is
this a new skill that *prescribes* a runtime-QA methodology (portable, tool-agnostic), or does it hard-depend on
Playwright/devtools (CC-only, heavy)? The portable-methodology framing is more autopilot-shaped.
**Landing**: candidate new skill `skills/runtime-qa/` (methodology) and/or a `quality-pipeline` optional stage.

### L3 — UX / design review axis  · Effort L · (gstack /design-review + addyosmani frontend-ui — CONVERGENT)
**What**: a rubric-scored design/UX review (rate N dimensions 0-10, audit a live site against a checklist, fix
loop). autopilot's reviewer is correctness/security-oriented with **no UX/visual axis at all** — a real blind
spot for any UI-touching work.
**Why it fits**: same convergent signal as L2 (both repos have it). Borrow the *rubric-and-fix-loop pattern*,
not the YC-startup framing.
**Scoping question (for dialectic)**: does autopilot's user base do enough UI work to warrant it, or is this
out-of-domain for a backend/tooling-oriented lifecycle plugin? Could be a thin `reviewer.md` axis extension
(like the E2 LLM-threats one) rather than a new skill.
**Landing**: a UX axis in `agents/reviewer.md` (lightweight) OR a new skill (heavyweight).

### L4 — Standalone TDD gap  · Effort S→L · (confirmed in autopilot's own files)
**What**: in standalone mode (no superpowers) autopilot has **no native TDD red-green-refactor skill** —
`test-strategy` explicitly declares itself orthogonal/NOT-equivalent. 11 references point to
`superpowers:test-driven-development`.
**Decision (for dialectic)**: (a) add a native `skills/tdd/` (own the coding loop standalone), or (b) keep the
documented superpowers-dependency but make the standalone limitation explicit in `test-strategy` + README
scenario B (currently scenario B implies full standalone coverage). Option (b) is the cheaper, honest fix;
option (a) is real net-new scope.

### L5 — Plan-carried Global Constraints + per-task Interfaces block  · Effort S · (superpowers v6 writing-plans)
**What**: superpowers' `writing-plans` now embeds a **Global Constraints block** (version floors / dep limits /
exact values, copied VERBATIM so they reach every downstream implementer+reviewer) and a **per-task Interfaces
block** (what each task consumes/produces, so a context-isolated implementer knows its neighbors' contracts).
Reported: 1 fix round vs 2-4 for control.
**Why it fits**: autopilot's six-element Task Prompt (goal/scope/input/output/acceptance/boundaries) covers most
of this per-task, but verbatim-propagated global invariants + an explicit producer/consumer interface contract
are a sharper formalization than `references/plan-template.md` currently mandates.
**Landing**: `references/plan-template.md` + the planner agent's contract.

---

## Calibration evidence (not a build item — a meta-note)

superpowers v5.0.6 **deleted** its subagent spec/plan-review loop after measuring it "doubled execution time
(~25 min) without measurably improving plan quality" (identical scores across 5×5 trials), replacing it with an
inline self-review checklist ("3-5 real bugs in ~30s"). This is external evidence relevant to autopilot's
think-tank / dialectic loop depth — a data point that *some* review-loop depth is pure latency. Worth weighing
when deciding how many dialectic rounds a given decision actually needs (the last two studies converged in 2).

## Do NOT import (anti-scope)

- gstack/superpowers dispatch machinery (weaker than autopilot's on every axis it cares about).
- gstack's role-as-cognitive-mode framing (= autopilot's reviewer/debugger/planner + think-tank, already
  dispatch-verified) and its scope modes (= /l3-l5 presets — independent convergence, no new info).
- gstack's `/freeze`/`/careful`/`/guard` safety surface (DOA + worktree + qc-gate already cover it harder).

## Open decisions for dialectic

1. L2 runtime-QA: portable methodology skill vs Playwright-hard-dependency? In-scope for autopilot's domain?
2. L3 UX axis: lightweight reviewer.md axis vs new skill vs out-of-domain entirely?
3. L4 TDD: build native `skills/tdd/` vs just document the standalone limitation honestly?
4. Is the convergent signal (L2+L3) strong enough to override autopilot's "not a UI/runtime plugin" identity?
5. Which of L1/L5 (the cheap review-integrity items) is worth shipping regardless of the L2/L3 scope debate?
