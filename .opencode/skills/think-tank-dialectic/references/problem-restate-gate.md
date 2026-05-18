# Problem Restate Gate

> Used by `think-tank-dialectic` Step 1. Every role restates the problem in 50 words before R1 analysis begins. Divergence between restatements is a signal that the question itself may be wrong.

## Purpose

Most dialectic failures are not bad analysis — they are **analyzing the wrong question**. The Restate Gate catches this before burning R1 tokens on a misframed problem.

Evidence for this pattern: `agora/protocol/deliberation.md` Step 2a (lines 57-79) makes this the first agent-facing step in every Agora room. The observation: **if 3 of 6 roles restate the question differently, the question itself was the bug.**

## Prompt Template

Dispatch to all 6 roles in parallel with this prompt (in addition to their role identity):

```
Before you begin analysis, restate this problem in TWO parts:

1. **Your restatement**: One sentence capturing the core question
   through your analytical lens.

2. **Alternative framing**: One sentence reframing the problem in a
   way the original statement may have missed — OR "No alternative
   framing — original question is well-formed" if you genuinely
   see no alternative.

Limit: 50 words total. Do NOT begin analysis yet. Just the two
sentences.

The problem as stated:
  {topic}
```

## Divergence Detection

After collecting all 6 restatements, Coordinator checks for divergence:

### Low divergence (< 2 diverging restatements)
All roles frame the problem similarly. The question is well-defined. Proceed to Step 2 (Silent Pre-Check) without user intervention.

### Medium divergence (2 diverging restatements)
Two roles reframed differently. Note this in the Evidence Summary section of the final brief, but proceed — the divergence may reveal something in R1.

### High divergence (≥3 diverging restatements)
**Stop and surface to user.** The question has a framing problem.

Present this to the user:

```markdown
## Problem Restate Divergence Detected

The 6 panel roles restated your question differently:

- **Architect**: "{their restatement}"
- **Product Director**: "{their restatement}"
- **Ops/SRE**: "{their restatement}"
- **QA Devil**: "{their restatement}"
- **Falsifier**: "{their restatement}"
- **Inverter**: "{their restatement}"

Your original question: "{original}"

**Three or more roles reframed the question.** This usually means the
stated question is not quite the one you want answered. Possibilities:

1. The question is asking solution Y when the real problem is X (XY problem)
2. The question bundles two decisions — pick one first
3. The question has hidden constraints the roles picked up on that
   the original phrasing missed

Before we run R1:

A. Accept {role name}'s framing and proceed with it as the confirmed
   question (which role's reframing feels most correct?)

B. Give me a corrected question statement

C. Proceed with your original question as-is (ignore the divergence —
   you may get a less useful brief)
```

Wait for user to choose A, B, or C. Then set the confirmed problem statement accordingly and proceed to Step 2.

## Recording the Confirmed Statement

In the final brief's "The Question" section, if the Restate Gate changed the problem statement:

```markdown
### The Question
**Original**: {user's input}
**Confirmed after Restate Gate**: {final version}
**Reason for change**: {which role(s) flagged the divergence, and which reframing was accepted}
```

If no change happened, just state the original as the confirmed question.

## Dispatch Count

The Restate Gate dispatches 6 agents in parallel. Increment `dispatched_count += 6` before dispatch. Note: this count includes the restate dispatches, so your total budget is tighter.

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Skipping the Restate Gate because "the question is clear" | You don't know it's clear until 6 roles have tried to restate it |
| Accepting the restates as analysis | They are diagnostic, not output. Throw them away after the divergence check |
| Asking the user to confirm every restate individually | That's 6 questions. Only surface when divergence is high (≥3 diverging) |
| Treating the "Alternative framing" as a required 2nd question | It's an offer. "No alternative" is a valid answer and should be respected |
