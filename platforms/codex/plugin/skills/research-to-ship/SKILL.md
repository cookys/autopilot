---
name: research-to-ship
description: >
  Pinned participatory pipeline — research industry best-practice → write a plan → multi-round
  dialectic review (loop until it converges) → expand into a tracked project → execute per dev-flow.
  Each phase ends at a human approval gate. Use when: "research best practice on X then build it
  properly", "查業界 best practice 寫成 plan、loop review 到沒問題後展開成 project 照 dev-flow 跑",
  "把這個主題做成正式專案", "spec it out then ship it the rigorous way". Not for: full hands-off
  autonomy (→ ceo-agent), a quick fix / already-known implementation (→ dev-flow), research with no
  build (→ survey / deep-research), or a single irreversible decision (→ think-tank-dialectic).
---

# research-to-ship — a topic → researched, reviewed, shipped

A **pinned** chain that fixes the *sequence* and the *human gates*; the real work is delegated to
existing autopilot skills. It exists because that exact sequence (best-practice research → plan →
**always** a dialectic loop → project → dev-flow) is a recurring ritual worth one command instead of
re-typing each time.

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

### Phase 3 — Dialectic loop review  · delegate → `autopilot:think-tank-dialectic`  (PINNED)
**Always** run the multi-round Architect / Ops / Skeptic dialectic on the plan — do NOT downgrade to a
single `think-tank` pass; this chain is reserved for work that warrants the loop. Each round re-checks
the **prior round's fixes**; fold every round's findings into a review log inside the plan doc.
Continue until it converges (the dialectic skill caps at 2 rounds — if a genuine fork remains, surface
it to the user rather than faking a synthesis).
**Gate**: "review converged — expand into a tracked project, run another angle, or stop?"

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
- Don't collapse Phase 3 to a single review pass — the dialectic loop is pinned by design.
- Don't invent the date or a merge SHA; read them from the environment / git.
