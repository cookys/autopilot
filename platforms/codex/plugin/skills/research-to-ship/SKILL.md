---
name: research-to-ship
description: >
  Pinned participatory pipeline — research industry best-practice → write a plan → bounded,
  rubric-frozen plan review (maximum two generations) → expand into a tracked project → execute per
  dev-flow. Each phase ends at a human approval gate. Use when: "research best practice on X then
  build it properly", "查業界 best practice 寫成 plan、有限 review 後展開成 project 照 dev-flow 跑",
  "把這個主題做成正式專案", "spec it out then ship it the rigorous way". Not for: full hands-off
  autonomy (→ ceo-agent), a quick fix / already-known implementation (→ dev-flow), research with no
  build (→ survey / deep-research), or a single irreversible decision (→ think-tank-dialectic).
---

# research-to-ship — a topic → researched, reviewed, shipped

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer human-gated pipelines over full autonomy).

A **pinned** chain that fixes the *sequence* and the *human gates*; the real work is delegated to
existing autopilot skills. It exists because that exact sequence (best-practice research → plan →
**bounded** plan-readiness gate → project → dev-flow) is a recurring ritual worth one command instead
of re-typing each time.

## Dispatch Chains (auto-injected)
!`cat .claude/dispatch-config.md 2>/dev/null || true`

## Input — the topic
The objective/topic is whatever the user passed after the command. If it is empty, ask for it in one
line before starting. Derive a kebab-case `<slug>` from it for the plan/project filenames.

## The pipeline (Phase 0 optional, then 5 phases, a human gate between each)

Run the phases in order. At each **gate**, use `AskUserQuestion` and do not proceed until the user
approves — this is what keeps the flow participatory (the opposite of `ceo-agent`'s full autonomy).

### Phase 0 — (optional) discover the design  · delegate → `autopilot:brainstorm`
**Only when the topic starts fuzzy — the *options don't exist yet***. If the user hands a vague need
("not sure how to approach X / 還沒想清楚"), run `autopilot:brainstorm` first: Socratic exploration →
2-3 approaches → a design spec the user approves. Then carry the chosen approach into Phase 1. **Skip
Phase 0 when the topic is already a clear question** (most invocations) — go straight to Phase 1.
**Gate** (only if Phase 0 ran): "design approved — research best-practice for it?"

### Phase 1 — Research best-practice  · delegate → `autopilot:survey`
Invoke `autopilot:survey` on the topic for external best-practice (dual researcher + skeptic). If the
topic needs deep, multi-source, fact-checked synthesis, use `deep-research` instead.
**Gate**: present the synthesized findings → "research enough to plan, or dig deeper / redirect?"

### Phase 2 — Write the plan  · follow [`references/plan-template.md`](../../references/plan-template.md)
Author a concrete plan to `docs/plans/<YYYY-MM-DD>-<slug>.md` using the **plan-authoring template** —
file-structure map, bite-sized phases with dev-flow sizes (S/L/H/Fix) + acceptance, every step concrete
(actual command/code/expected output, never "improve X"), scope cut, test plan, risks + inversion, and
open questions only the user can answer. Run the template's self-review (scope coverage / placeholder
scan / dependency map) before the gate. Use the **real current date** from the environment — never invent.
**Gate**: "plan good to send to review, or revise first?"

### Phase 3 — Bounded plan readiness  · run `scripts/dispatch-plan-review.js`  (PINNED)

Before dispatch, write a small rubric file and a `plan-review-manifest` beside the plan. Give every
user requirement and next-slice readiness criterion a stable ID (`R1`, `R2`, ...). The manifest
declares the `logical_plan_id`, 1–4 qualified seats, per-seat budgets, and any attempt-2 fallback.
The Phase 2 human approval freezes both files; do not add criteria or silently substitute seats.

Resolve the plan chair/deep seats and budgets from `.claude/review-loop-config.md` through
`scripts/resolve-review-loop.sh`. Require `plan_review:on`; never reuse `spec_review` or the
implementation reviewer tuple. Invoke `dispatch-plan-review.js` with repo, ticket, plan, rubric,
session, generation, and `--manifest-file`. Reuse the same `logical_plan_id` across retries; changing
the repo/ticket/session tuple does not reset the review.

- Generation 1 may contain both chair and deep reviewer. That is one generation: reviewer width,
  not another loop.
- Findings are fingerprinted and deduplicated with full seat provenance. Depth 0 must disposition
  each blocker candidate before the smallest bounded repair may authorize generation 2.
- Nonblocking, rejected, deferred, and out-of-rubric findings are backlog candidates, not hidden
  plan mutations.
- READY or non-blocking CONDITIONAL is terminal and goes to the human gate.
- Generation 2 with any admitted blocker is terminal STOP. Split, spike, accept risk, or reset scope
  with the user; never run generation 3.
- Reviewer prose cannot schedule another pass. The durable repo+ticket controller state owns the
  cap, 120-minute clock, frozen rubric/manifest and 1.25×/1.50× growth rails. Transport exhaustion
  has no semantic verdict and can never be reported as STOP.

**Gate**: "bounded review is READY/CONDITIONAL — expand into a tracked project, or stop?" A STOP
instead asks the user to choose split/spike/risk/scope reset.

### Phase 4 — Expand into a tracked project  · delegate → `autopilot:project-lifecycle`
Bootstrap the project the dev-flow way: `docs/projects/<YYYY-MM-DD>-<slug>/README.md` (OKR, phases,
success criteria) + a row in `docs/projects/INDEX.md` + a feature branch off the default branch.

### Phase 5 — Execute per dev-flow  · delegate → `autopilot:dev-flow`
Run `autopilot:dev-flow` on the project, phase by phase: scope audit → phase tasks → implement →
`autopilot:quality-pipeline` before each merge → `autopilot:finish-flow` at the end. For a phase with
a **transcript-checkable** finish line (e.g. "all tests in X pass"), you MAY offer the user a `/goal`
condition to drive it to green hands-off (Claude Code only — see `ceo-agent` "Harness primitives";
degrades to manual re-prompting elsewhere).

## Boundaries
- **Pins sequence + gates only** — it never reimplements the skills it calls. If a phase's skill is
  unavailable (e.g. `superpowers` not installed and a chain points there), fall back to the autopilot
  primary per `.claude/dispatch-config.md`.
- **vs `ceo-agent`**: ceo-agent = full delegation, the CEO decides each gate within its authority;
  research-to-ship = participatory, **you** approve every gate. Reach for ceo-agent when you want it
  to decide; reach here when you want the rigor but keep the wheel.
- **vs `dev-flow`**: dev-flow starts at "we know what to build". research-to-ship is for when you
  start at a *topic* and want best-practice + a reviewed plan in front of the build.
- **Portability**: every phase is skill delegation that works on any agent autopilot runs on; only the
  optional `/goal` in Phase 5 is Claude-Code-specific and degrades cleanly.

## Don't
- Don't skip a gate to "save a step" — the gates are the point.
- Don't bypass `dispatch-plan-review.js` with direct model commands or a hand-counted loop.
- Don't turn reviewer suggestions outside the frozen rubric into current-plan blockers.
- Don't invent the date or a merge SHA; read them from the environment / git.
