# Minority Report

> Used by `think-tank-dialectic` Step 7 brief section. Dissenting positions are preserved as first-class content, not summarized or collapsed into the Hegelian Arc.

## Purpose

In a dialectic with 6 roles and forced synthesis, the dissenting minority is the **most valuable** signal. The Hegelian Arc gives you the majority's direction; the Minority Report tells you what that direction is ignoring.

**Reference**: `council-of-high-intelligence/SKILL.md` lines 518-519 (Council verdict output template). Council makes Minority Report a required section because it catches the case where consensus is wrong for reasons the majority structurally cannot see.

**Key principle**: The Minority Report should preserve enough of the dissent that someone reading the brief 3 months later — after the decision has been made and maybe gone wrong — can reconstruct the dissenting argument in full.

## When Is There a Minority Report?

Every Full Brief has a Minority Report section. The only question is which dissent is worth preserving.

**Selection rules**, in priority order:

1. **If any role's R2 Synthesis Proposal was "No transcendent synthesis exists"** → that role's full argument goes in Minority Report. This is the strongest form of dissent — the role is saying the Hegelian Arc itself is wrong for this question.

2. **If the Falsifier or Inverter produced a specific falsification case or failure path in R2** → that becomes the Minority Report. Adversarial roles' dissent is structurally valuable even when they lost the R2 argument.

3. **If any role in R2 updated their position AWAY from the emerging majority** (not toward it) → that role's updated position is the Minority Report. Dissent that survived R2 is more reliable than R1 dissent that got washed away.

4. **If none of the above** → pick the role whose R1 confidence was highest among those who disagreed with the final synthesis. High confidence + sustained dissent = worth recording.

If genuinely all 6 roles agreed → you should have applied Rule 3 auto-downgrade, not produced a Full Brief. Go back to Step 4.

## Format

```markdown
### Minority Report

**Dissenting role**: {role name}

**Core argument** (2-4 sentences minimum, preserve from R2 output — do not summarize):

  "{direct quote or near-verbatim from the role's R2 output}"

**What would have to be true for this dissent to be correct**:
  {1-2 sentences — the implicit assumption or external fact that would
  validate the minority position. This is the "signal to watch for"}

**Concrete signal to watch for**:
  {1 sentence — a specific observable event or metric that, if it
  happens, would prove the Minority Report right and the majority wrong}

**If this dissent turns out to be correct, the recovery path is**:
  {1-2 sentences — what the user should do if they discover, 3 months
  later, that the minority was right}
```

## Example

```markdown
### Minority Report

**Dissenting role**: Falsifier

**Core argument**:
  "The majority concludes that X approach reduces technical debt. But
  debt reduction requires the team to actually pay the debt down over
  time — which requires stable ownership of the touched modules.
  Evidence brief shows 40% turnover in the team responsible for these
  modules over the past 2 quarters. In a high-turnover context, 'debt
  reduction' is a function of who happens to remember the reduction
  plan 6 months from now. No one on the panel has addressed this."

**What would have to be true for this dissent to be correct**:
  Turnover in these modules must continue at current rate, AND the
  incoming engineers must lack the context to continue the debt
  reduction plan without explicit documentation.

**Concrete signal to watch for**:
  Within 3 months, check if the "debt paydown" commits from the first
  person who left the team have been picked up by anyone else. If zero
  pickup → dissent is proving correct.

**If this dissent turns out to be correct, the recovery path is**:
  Convert the debt reduction plan into an executable runbook with
  explicit milestones and owners, rather than trusting ambient team
  memory. Re-evaluate at next team restructure.
```

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Summarizing the dissent to save space | The whole point of Minority Report is preservation. Summary destroys it. Direct quote when possible |
| Weakening the dissent by adding caveats ("but of course, majority is still right") | The brief already contains the Hegelian Synthesis. Minority Report is for the view that didn't make it into synthesis. Don't undermine it |
| Picking "the most polite dissent" | Pick the strongest dissent, not the most diplomatic one. If Falsifier was harsh but correct, preserve the harshness |
| Leaving out "what would have to be true" | Without this, the Minority Report is just noise. The whole value is: "here's a specific empirical claim to watch for" |
| Missing the "concrete signal to watch for" | Same — without a falsifiable trigger, the dissent is un-actionable |

## Interaction with Hegelian Arc

The Hegelian Arc and Minority Report should NOT contradict each other. They should complement:

- **Hegelian Arc**: What the panel could converge on — Thesis, Antithesis, Synthesis
- **Minority Report**: What the panel could NOT integrate — the view that sits outside the arc

If the Minority Report contradicts the Synthesis, the brief should say so explicitly:

```markdown
**Note**: The Minority Report represents a position that the Synthesis
did NOT successfully integrate. If the minority is correct, the
Synthesis is wrong. The brief records both so that the user can make
an informed choice — this is a real value commitment, not a technical
misunderstanding.
```

This is the correct state when the Hegelian Arc's Synthesis was "No transcendent synthesis found — the tension is irreducible". In that case, Minority Report is essentially a second candidate answer, and the user must commit.
