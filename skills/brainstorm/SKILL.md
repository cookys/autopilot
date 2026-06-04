---
name: brainstorm
description: >
  Pre-code Socratic design exploration — when the options don't exist yet. Use when: "I haven't figured
  out the approach", "help me think through X", "what should this even be / 還沒想清楚", "explore how to
  do X before we build", "我不確定要怎麼做", "尚未成形 / 沒有方向". DISCOVERS the options, surfaces 2-3
  genuinely different approaches, and GATES implementation until you approve a design. Not for: deciding
  between options that ALREADY exist on the table (→ think-tank), external best-practice research
  (→ survey), an approach you've already chosen (→ references/plan-template.md to author the plan, then
  dev-flow), or a quick known fix (→ dev-flow).
---

# brainstorm — discover the design before any code exists

The discriminator vs neighbours: **do the options exist yet?**
- **No options yet / fuzzy need** → `brainstorm` (this skill) — explore, then converge on a design.
- **Options on the table, need to decide** → `think-tank` (multi-perspective) / `think-tank-dialectic`.
- **Need to know what others do** → `survey` (external research).
- **Approach already chosen** → author the plan (`references/plan-template.md`) → `dev-flow`.

This is a **gate**: do NOT invoke any implementation skill or write code until the user approves a design.

## Protocol

### 1. Explore the real need — Socratic, ONE question at a time
Don't propose solutions yet. Ask one focused question, wait for the answer, then ask the next. Surface the
*actual* problem, the constraints, the success picture, the no-go zones. Stop asking once you can restate
the need in one sentence the user confirms. (One-at-a-time matters: a wall of questions gets a thin
answer; a single sharp question gets a real one.)

### 2. Surface 2–3 genuinely different approaches
Not strawmen. Each approach: a one-line essence, its honest tradeoffs, what it's best/worst at. They must
differ in *kind* (different architecture / different mechanism), not just in parameter. If you can only
find one real approach, say so — that's a finding, not a failure.

### 3. Converge to a design spec
Once the user leans toward an approach, write a short **design spec**: the chosen approach, why it beat the
others (1 line each), the key decisions made, and the open questions that remain. Keep it tight — it's the
thing the plan will be built from, not the plan itself.

### 4. The approval gate
Present the design spec and ask for explicit approval. **Nothing downstream runs without it.** On approval,
hand off:
- to `references/plan-template.md` to **author the plan** (then `dev-flow` to execute), or
- directly to `dev-flow` if the work is small enough to skip a formal plan.
On "not yet" → keep exploring (back to step 1/2) — do not force forward.

## Boundaries
- **Discovers, doesn't decide-between-knowns** — the moment the options are already enumerated and the
  question is "which one", that's `think-tank`, not this.
- **Explores internally, doesn't research externally** — if the gap is "what do others do", chain to
  `survey` first, then bring its findings back here.
- **Designs, doesn't author the plan** — the structured plan doc is `references/plan-template.md`'s job;
  this skill produces the *design spec* that feeds it.
- Fits `research-to-ship` as an optional Phase-0 (discover the design before its Phase-1 research/plan),
  for topics that start fuzzy rather than from a clear question.
