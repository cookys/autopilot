# Silent Pre-Check

> Used by `think-tank-dialectic` Step 2. Coordinator runs a 4-item self-audit BEFORE presenting the confirmed problem statement to the user. The checklist is NEVER shown to the user — it shapes how the Coordinator frames Step 2's confirmation question.

## Purpose

Every Agora room has a "Before the AskUser, the Coordinator runs a silent check" section. The pattern: catch likely framing errors before burning user attention on a bad confirmation round.

Reference: `agora/rooms/forge/SKILL.md`, `agora/rooms/oracle/SKILL.md`, `agora/rooms/bazaar/SKILL.md` all have variant silent pre-checks customized to their domain. `think-tank-dialectic`'s silent pre-check is tuned for engineering/strategic decisions.

## The 4-Item Checklist

Coordinator answers all 4 questions internally before presenting Step 2 confirmation. Answers are not shown to the user.

### 1. Reversibility Classification

**Question**: Is this decision a **one-way door** (irreversible or expensive to reverse) or a **two-way door** (easily reversible)?

**Why it matters**: Dialectic is only justified for one-way doors. Two-way doors should use `autopilot:think-tank` or just make a choice and iterate.

**Internal action**:
- If one-way → proceed normally
- If two-way → at Step 2 confirmation, explicitly ask: "This looks like a reversible decision. Dialectic is expensive. Are you sure you want the full protocol, or would think-tank suffice?"

### 2. Help-Me-Think vs Validate-My-Decision

**Question**: Does the user already have a preferred answer and want the panel to either validate or challenge it? Or is the user genuinely undecided?

**Why it matters**: These need different R2 framings.
- **Validation mode**: R2 should stress-test the preferred answer specifically
- **Undecided mode**: R2 should derive recommendations independently

**Internal action**:
- Look for signals in the user's phrasing: "I'm thinking of X, but..." = validation mode. "I can't decide between X and Y" = undecided mode.
- If validation mode detected → note this in the Step 2 confirmation: "It sounds like you're leaning toward {X}. I'll have the panel specifically challenge that position rather than re-derive from scratch. Correct?"
- If the user confirms validation mode → R2's Thesis should be X; Antithesis should be the strongest challenge; Synthesis should either strengthen X with new conditions, or replace X.

### 3. Hidden Constraints

**Question**: Are there constraints the user mentioned in passing but may not realize are load-bearing? (Deadlines, team size, budget, legacy lock-in, political factors)

**Why it matters**: Dialectic analysis that ignores real constraints produces synthesis that doesn't fit reality.

**Internal action**:
- Scan the user's question for implicit constraints: mentions of timelines, team composition, existing commitments
- At Step 2 confirmation, explicitly list detected constraints: "I'm treating the following as hard constraints: {A, B, C}. Correct me if any of these are actually flexible or if I missed something."
- If constraints are ambiguous → the user's answer here is critical; do NOT proceed without clarity

### 4. Two Questions Bundled

**Question**: Is this actually two (or more) decisions combined into one?

**Why it matters**: Dialectic can only resolve one dialectic at a time. Bundled questions produce mushy synthesis.

**Examples of bundled questions**:
- "Should we rewrite the system AND migrate to new framework?" (2 decisions)
- "Should we hire a new person to work on X?" (hire decision + priority decision)
- "Should we refactor before or after shipping Y?" (refactor decision + ship timing)

**Internal action**:
- Count the actual decisions being asked about
- If ≥2 → at Step 2 confirmation, surface this: "I detected 2 separate decisions in your question: (a) {X}, (b) {Y}. Which one do you want this dialectic to resolve? The other can be a follow-up."
- If user insists on bundling → proceed but note the bundling explicitly in the Evidence Summary section

## Output: Confirmation Prompt

After the 4-item checklist, Coordinator produces a Step 2 confirmation prompt that incorporates any flagged issues:

```markdown
## Step 2 Confirmation

Before I run R1, I want to make sure I understand what we're deciding.

**The confirmed question** (after Step 1 Restate Gate):
{confirmed problem statement}

**What I'm treating as constraints**:
- {constraint 1}
- {constraint 2}
- ({or "none — open field" if no constraints detected})

**Decision type**:
- {one-way door | two-way door}
- {help-me-think mode | validate-my-decision mode | undecided mode}

{If checklist items 2, 3, or 4 flagged something, surface it here.
Otherwise, just ask:}

Proceed with R1? (yes / correct me on X / let me reframe)
```

If user says "yes" → proceed to Step 3 (R1 dispatch).
If user corrects → update confirmed statement and re-run checklist silently once.
If user reframes → go back to Step 1 Restate Gate (counts against budget — be careful of loops).

## Dispatch Count Impact

Silent Pre-Check does not dispatch any agents — it is a Coordinator-internal reasoning step. `dispatched_count` does NOT increment.

Step 2 confirmation **is** a user interaction and counts against the `dispatched_count` budget alongside Agent tool calls. Under the normal flow, there are 2 expected AskUser calls (Step 2 confirmation + Step 4 active probe). The Step 1 Restate Divergence AskUser is exceptional — it only fires when ≥3 roles diverged, which is rare — and does not count toward the 2 expected calls.

**If Step 1 divergence DOES fire**, the Coordinator should accept the budget pressure: the conversation has already burned 1 extra turn, so Rule 4 (`dispatched_count > 12` → interim brief) is closer to firing. This is acceptable: a divergence AskUser means the question itself was mis-framed, and correcting that early is worth the turn budget.

## Anti-Patterns

| Anti-pattern | Why it fails |
|---|---|
| Showing the checklist to the user | It's diagnostic scaffolding, not output. Don't ask 4 questions when you only need to confirm 1 synthesis |
| Skipping the checklist "because the question is obvious" | Questions are rarely as obvious as they look. 30 seconds of self-audit prevents 30 minutes of mis-targeted R1 |
| Running Step 2 confirmation with no detected issues | Just confirm the problem statement in one line. No need to elaborate if nothing was flagged |
| Treating the 4 items as questions to answer literally in sequence | They are reasoning prompts. Use them to shape your confirmation, not to produce 4 separate outputs |
