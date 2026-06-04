# Plan-authoring template (the structure every autopilot plan doc follows)

The home for **plan authoring** discipline. Internalized from superpowers' `writing-plans` as a *template*
(not a skill — a plan form never triggers standalone; it is invoked by `research-to-ship` Phase 2 and
`dev-flow` L-2). Output a plan to `docs/plans/<YYYY-MM-DD>-<slug>.md` (real date from the environment —
never invent one).

## The discipline (what separates a usable plan from a wish-list)

1. **File-structure map** — which files will be touched, and each one's responsibility. A reviewer should
   see the surface area before reading a single step.
2. **Bite-sized phases** — each phase is one coherent, independently-shippable chunk with a **dev-flow size**
   (S / L / H / Fix) and an explicit **acceptance** ("done when …").
3. **Every step is concrete** — the actual command, the code shape, the expected output. **Never** "add
   error handling" / "improve X" — say *which* call, *which* failure, *which* file:line. A zero-context
   engineer must be able to execute the step without guessing.
4. **Self-review before done** (the gate that makes the plan trustworthy):
   - **Scope coverage** — every requirement maps to a phase; nothing requested is unplanned.
   - **Placeholder scan** — no `TODO` / `TBD` / "figure out later" left in load-bearing steps (mirror
     `scripts/completeness-scan.sh`'s anti-stub intent).
   - **Dependency map** — phase ordering is explicit; what blocks what.
   - **Risks + inversion** — "what would guarantee this fails?" named, with mitigations.

## Section skeleton

```markdown
# Plan — <title>
> Status / Owner / Branch / Frame

## 0. Context / thesis        — why now; what prior decision/research this builds on
## 1. Problem                 — the actual user goal (not the artifact)
## 2. OKR / KRs               — measurable success
## 3. File-structure map      — files touched + responsibility (discipline #1)
## 4. Phases                  — bite-sized, each with a dev-flow size + acceptance (discipline #2/#3)
## 5. Test / validation       — what proves it; what is human-gated vs script-gated
## 6. Risks + inversion       — what guarantees failure (discipline #4)
## 7. Out of scope            — focus-as-subtraction: what you deliberately do NOT do
## 8. Open questions          — only the Board (user) can answer
## Review log                 — R0 author + any dialectic rounds
```

## Boundaries
- **Authoring vs decomposition**: this template authors the *plan*; `agents/planner.md` decomposes an
  *existing* plan into six-element Task Prompts. Different jobs — don't conflate.
- **Authoring vs gating**: `dev-flow` L-2 / `research-to-ship` Phase 2 own the *gate* (enter-plan-mode,
  user approval); this template owns the *structure* of what gets written.
- **Discover-then-author**: if the design isn't settled yet (options not even on the table), that's
  `brainstorm` first — author the plan only once an approach is chosen.
