# Advance Decision Brief Template

> Used by `think-tank-dialectic` Step 7. Fill in all sections. Do NOT skip sections by leaving them empty — if a section is N/A, say so explicitly with a reason.

The brief has **3 variants**:

1. **Full Brief** (R1 → R2 → Hegelian Synthesis) — the default, used when MEDIUM/LOW consensus triggered R2
2. **Downgrade Brief** (HIGH consensus auto-downgrade via Rule 3) — shorter, no Hegelian Arc
3. **Interim Brief** (Rule 4 turn-budget exceeded) — emergency 200-word compression

---

## Variant 1: Full Brief (default)

```markdown
## Advance Decision Brief: {Topic Title}

### The Question
{Confirmed problem statement after Restate Gate. NOT the original vague question —
the version that survived the divergence check in Step 1. If the Gate reframed
the question, note that: "Original: X. Confirmed after Restate Gate: Y (reason: Z)"}

### Panel
6 members: Architect, Product Director, Ops/SRE, QA Devil, Falsifier, Inverter
Mode: Full (R1 + R2 Hegelian Cross-Examination)
Dispatched count: {N} agent calls total

### Evidence Summary
{3-5 bullet points from Step 1. What the panel collectively knows about the
situation before analysis began. Be specific — numbers, file paths, git log
highlights, actual product data. Not vague.}

### Hegelian Arc

**Thesis** (majority position from R1):
{2-3 sentences — the dominant direction the majority of the panel gravitated
toward in R1. State it in its strongest form, not a strawman.}

**Antithesis** (strongest dissent from R1):
{2-3 sentences — the most compelling minority position. Usually from Falsifier,
Inverter, or QA Devil, but not always. State it in its strongest form.}

**Synthesis** (Coordinator-identified after R2):
{2-3 sentences — the higher-order integration that transcends BOTH.

**NOT a compromise.** Not "do a bit of both". Not "average the two positions".
A synthesis is a new frame that reveals why Thesis and Antithesis are each
partially right about different dimensions, and what action serves both truths.

If no honest synthesis exists, write:
  "No transcendent synthesis found. The tension on {axis} is irreducible:
  {Thesis concern} and {Antithesis concern} are genuinely incompatible.
  This decision requires a values commitment, not a technical resolution.
  See Questions Only You Can Answer below."

Faking a synthesis is worse than admitting none exists.}

### Convergence Points
{Where most/all roles agreed, despite different lenses. Often factual
observations about constraints, not recommendations.}

### Irreconcilable Tensions
{Where disagreement genuinely cannot be resolved. Be honest. If synthesis
exists above, this section may be short; if synthesis is "no synthesis
found", this section explains why.}

### Role Positions Table

| Role | R1 Position | R2 Update | Final Lean |
|------|-------------|-----------|------------|
| Architect | {1 sentence} | {what changed or "held"} | {direction} |
| Product Director | ... | ... | ... |
| Ops/SRE | ... | ... | ... |
| QA Devil | ... | ... | ... |
| Falsifier | ... | ... | ... |
| Inverter | ... | ... | ... |

### Minority Report

{The strongest dissenting position from the panel, preserved in full — NOT
summarized. Use direct quotes from the agent's R2 output where possible.

Include:
- Who dissented (usually the role whose R2 Synthesis Proposal said "no
  transcendent synthesis", or the role with the strongest rejection in R1)
- Their full argument (2-4 sentences minimum — do not compress)
- What would have to be true for the dissent to be correct
- One concrete signal to watch for that would validate the dissent

See references/minority-report.md for format details.}

### Unresolved Questions (Factual Gaps)

**What these are**: Questions the panel could not answer because they require
external evidence, data, testing, or time that is currently unavailable.
These CAN be answered by doing more work.

1. {Specific factual question + what would answer it}
2. {Another}
3. {Another, if relevant}

### Questions Only You Can Answer (Value / Preference / Context)

**What these are**: Questions the panel structurally CANNOT answer because
the answer depends on the user's own values, preferences, or private context.
No amount of further analysis helps. These must be answered by the human.

**The test**: "Could more research or data answer this?"
- If yes → it's an Unresolved Question above
- If no → it belongs here

1. {Specific values question, e.g., "How much latency improvement is worth
    how much technical debt? This is a trade-off preference, not a fact."}
2. {Another}
3. {Another, if relevant}

### Recommended Next Steps

**(Always present — not conditional on CEO mode.)**

2-4 concrete actions, ordered by priority. Each must be specific enough to
execute without further deliberation.

1. {Concrete action + why first}
2. {Next action + dependencies}
3. {Follow-up action + when to revisit}
4. {Optional — if there's a clear 4th}

### Epistemic Diversity Scorecard

(See references/epistemic-diversity-scorecard.md for calculation rules.)

- **Perspective spread** (1-5): {how orthogonal the 6 roles' positions were.
  1 = all said the same thing; 5 = genuinely divergent}
- **Evidence mix**: {% empirical / % mechanistic / % strategic / % ethical / % heuristic}
- **Convergence risk**: {Low | Medium | High — how much the brief reflects
  structural groupthink vs genuine deliberation}
- **Trust ceiling**: {HIGH | MEDIUM | LOW — based on the scorecard. See rules.}

### Confidence

**Level**: {High | Medium | Low}

**Reasoning**:
- {Specific uncertainty 1}
- {Specific uncertainty 2}
- {What would move this to higher/lower confidence}

### CEO Recommendation

**(ONLY include this section if invoked from CEO mode. Otherwise omit.)**

Integrated action recommendation. This is a **super-set** of Recommended Next
Steps, not a replacement.

- **Go / No-Go**: {commit with preconditions, or defer}
- **Phase breakdown**: {Phase 1 scope, Phase 2 scope, explicit out-of-scope}
- **Preconditions**: {what must be true before starting}
- **Rollback triggers**: {specific observable conditions that mean "stop and revert"}
- **Accountability**: {who owns each phase}

### Related Skills

{Which autopilot skills could follow this brief? Examples:
- "If the Minority Report gains evidence, re-invoke think-tank-dialectic
  with that evidence preloaded"
- "For the Unresolved Questions, chain to autopilot:survey"
- "For implementation: autopilot:dev-flow (L-size)"}

### Follow-Up Tracking

After you act on this decision, log:
- What did you choose?
- Did the panel's analysis change your mind, or confirm what you already knew?
- Which role's position best predicted the outcome?
- Was the Synthesis useful, or did you end up with pure Thesis or pure Antithesis?

This feedback is the only way to know whether dialectic is actually changing
decisions or just adding ceremony.
```

---

## Variant 2: Downgrade Brief (HIGH consensus via Rule 3)

Used when R1 produces ≥5/6 alignment — dialectic adds no value, output a short form and recommend `think-tank` next time.

```markdown
## Dialectic Downgrade Notice

This question had HIGH consensus after Round 1 — 5+/6 roles aligned on the
same recommendation. Dialectic's value requires genuine tension between
positions; when consensus is this strong, the structured cross-examination
produces no new insight over a standard multi-perspective brief.

### Consensus Direction
{What ≥5/6 agreed on, 2-3 sentences}

### Single Dissent
**Role**: {name}
**Position**: {their 1-sentence dissent}
**Worth noting because**: {why this minority voice is interesting even
though it didn't shift consensus}

### Evidence Summary
{3-5 bullets — same as full brief}

### Role Positions (R1 only, no R2)
| Role | Position | Lean |
|------|----------|------|
| ... | ... | ... |

### Unresolved Questions
{If any}

### Recommended Next Steps
{2-3 concrete actions}

### Recommendation for Next Time

Use `autopilot:think-tank` (not think-tank-dialectic) for questions with this
shape. Dialectic's cost is only justified when R1 consensus would be
MEDIUM or LOW. This question's shape — {describe} — is typically high-consensus
and fits think-tank's single-round model better.

### Confidence
{High/Medium/Low + reasoning}
```

---

## Variant 3: Interim Brief (Rule 4 turn-budget exceeded)

Used when `dispatched_count > 12` without a final brief. Emergency 200-word compression that preserves what's known and stops further dispatches.

```markdown
## Interim Brief (Dialectic Budget Exceeded)

**Status**: Deliberation exceeded turn-count budget (12) without convergence.
No further agent dispatches. This is a deliberate stop, not a failure.

### What We Have

**Problem**: {confirmed statement}
**R1 positions** (compressed): {1 line per role}
**Emerging tension**: {what the dialectic revealed before cut-off}
**Unresolved**: {what R2 or synthesis would have addressed}

### Why Budget Was Exceeded
{Likely cause: hemlock loop? Multiple re-dispatches? Problem was too broad?}

### Recommended Next Steps

1. **Stop**: The evidence for additional deliberation is weak. Commit to
   one position and move, OR step away for offline thinking.
2. **If you must continue**: Narrow the problem statement and re-invoke
   dialectic with a sharper question. Do NOT re-invoke with the same
   statement — Rule 2 will refuse it.
3. **Alternative**: Use `autopilot:think-tank` (single-round) instead —
   the tension may be less sharp than you thought.

### What NOT to Do
- Do not re-invoke dialectic on the same statement — Rule 2 will refuse it.
- Do not split the topic into 3 sub-dialectics — that's the same budget problem × 3.
- Do not take the emerging tension as "the real answer" — it's incomplete data.

### Confidence
LOW — by definition. This is not a real brief, it is a stop signal.
```

---

## Format Rules

1. **Never skip a required section**. If empty, state why (e.g., "No Irreconcilable Tensions — the Synthesis resolved the apparent conflict").
2. **Quote directly when possible**. Paraphrasing the Minority Report weakens it.
3. **No hedging in Recommended Next Steps**. Each item must be actionable by a person reading the brief without further clarification.
4. **Trust ceiling is calculated, not chosen**. See epistemic-diversity-scorecard.md for the formula.
5. **Synthesis Must Not Be Fake**. If no honest synthesis exists, say so explicitly in the Hegelian Arc section. Writing a fake synthesis is the #1 failure mode of this skill.
