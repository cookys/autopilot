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
5. **Change-policy decisions** — record the compatibility impact and dependency decision explicitly;
   when there is no compatibility or dependency impact, use `internal-only` and `none` with a
   one-line reason rather than inventing another state.

## Section skeleton

```markdown
# Plan — <title>
> Status / Owner / Branch / Frame

## 0. Context / thesis        — why now; what prior decision/research this builds on
## 1. Problem                 — the actual user goal (not the artifact)
## 2. OKR / KRs               — measurable success
## 2.5 Global Constraints     — verbatim-propagated invariants (see § below); copied UNCHANGED into every implementer + reviewer dispatch
## 2.6 Change-policy decisions — required Compatibility impact + Dependency decision fields
## 3. File-structure map      — files touched + responsibility (discipline #1)
## 4. Phases                  — bite-sized, each with a dev-flow size + acceptance (discipline #2/#3)
## 5. Test / validation       — what proves it; what is human-gated vs script-gated
## 6. Risks + inversion       — what guarantees failure (discipline #4)
## 7. Out of scope            — focus-as-subtraction: what you deliberately do NOT do
## 8. Open questions          — only the Board (user) can answer
## Review log                 — R0 author + manifest, controller generations, and depth-0 dispositions
```

## Bounded review identity

Before plan-readiness review, assign one stable `logical_plan_id` and write a
`plan-review-manifest` beside the plan. Record its path and the frozen rubric path in the Review log.
The manifest declares 1–4 reviewer seats, budgets, qualifications, excluded families, and only the
fallbacks allowed on attempt 2. A new ticket or session must not reset the same logical plan.

For each controller generation, record the artifact path, verdict, finding fingerprints, and the
depth-0 disposition for every blocker candidate. Reviewer suggestions never amend the plan by
themselves: accepted blockers authorize the bounded repair; other findings remain explicit backlog
candidates. Generation 2 is terminal.

## Global Constraints (§2.5 — verbatim propagation)

Plan-level invariants that **every** downstream implementer and reviewer must honour *identically*:
version floors, dependency limits, exact named values, a forbidden API, a required interface shape.
The point is **verbatim propagation** — these are copied UNCHANGED into each dispatch prompt, so an
implementer and its reviewer can never diverge on a value (the classic "implementer used 2.4, reviewer
assumed 2.6" fix-round). State each as a flat, quotable line:

```markdown
## 2.5 Global Constraints (copied verbatim into every dispatch)
- Node ≥ 20.10 (do not use APIs added after 20.10).
- All new scripts emit on stderr + exit codes; NO new JSON-schema scripts this plan.
- The on-disk event log format is frozen — append-only, never rewrite a prior line.
```

Two rules:
- **Single canonical statement.** The block lives once, in the plan's §2.5; dispatches *quote* it, they
  do not paraphrase it (paraphrase = drift). This is the same "no second canonical statement" rule the
  rest of autopilot follows.
- **Interfaces are an expansion of the six-element `input`/`output`, not a parallel block.** When a task
  consumes a producer task's output, name that contract inside the task's existing `input`/`output`
  elements ("consumes the `{id}` JSON from task 3 / produces the allowlist task 5 reads") — do **not**
  open a separate Interfaces section that would restate it and drift.

## Change-policy decisions (§2.6)

Every plan carries this short decision record; it is a field pair, not a new phase or gate:

```markdown
## 2.6 Change-policy decisions
- **Compatibility impact**: `internal-only | published-compatible | authorized-breaking` — name affected consumers and migration/removal work, or explain why none exist.
- **Dependency decision**: `none | platform/stdlib | existing | established-new | custom` — name the selected option and why earlier options in the preference order do not satisfy the requirement.
```

For `authorized-breaking`, include the authorization, versioning decision, migration notes,
CHANGELOG coverage, rollback guidance, and contract validation. For `established-new`, record
maintenance health, license compatibility, transitive footprint, and supported-platform fit.
For `custom`, explain why platform/stdlib, existing dependencies, and established libraries are
insufficient.

## Boundaries
- **Authoring vs decomposition**: this template authors the *plan*; `agents/planner.md` decomposes an
  *existing* plan into six-element Task Prompts. Different jobs — don't conflate.
- **Authoring vs gating**: `dev-flow` L-2 / `research-to-ship` Phase 2 own the *gate* (enter-plan-mode,
  user approval); this template owns the *structure* of what gets written.
- **Discover-then-author**: if the design isn't settled yet (options not even on the table), that's
  `brainstorm` first — author the plan only once an approach is chosen.
