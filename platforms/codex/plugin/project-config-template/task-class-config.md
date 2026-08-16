# Task-Class Config — autonomous front-door routing (DI template)

> Consumed by the CEO front doors (`/l3`–`/l6`, ceo-agent) and `scripts/next-pick.js`
> when present at `.claude/task-class-config.md`. ABSENT FILE = unchanged behavior:
> no auto-classification, no auto-pick weighting — the operator routes manually.
> (autonomous-brain-integration P8; methodology: the Board's 2026-08-17 rulings.)

## Classes (first cut — extend only from real routing misses recorded in the ledger)

| Class | Meaning | Seat posture |
|---|---|---|
| `mechanical-impl` | Bounded, spec-closed units — fast cheap implementers shine | dispatch (hetero ok) |
| `standard-impl` | Ordinary feature/fix work with judgment inside the unit | dispatch (qualified seat) |
| `hard-problem` | 超難架構、效能瓶頸、疑難雜症 — needs the strongest brain | **pinned to depth-0, NEVER dispatched, never auto-picked** |
| `direction` | What-should-we-build questions | hetero brainstorm/survey pipeline |
| `review` | Verification duty | decorrelated family, single round |

## Classification duty (the brain's, at task intake)

1. Classify the incoming task against the table.
2. **Ambiguous → STOP AND ASK** (AskUserQuestion with the candidate classes) —
   guessing costs 2-3 re-alignment rounds (sol shape F11). Keep asking until the
   blueprint scope is clear.
3. Common patterns → don't ask: default the classification from a survey of current
   industry practice, and record the survey ref in the decision ledger.

## Per-class candidate preference (user-owned; outranks every system ranking)

```
- mechanical-impl: [grok-4.5, gpt-5.3-codex-spark]
- standard-impl:   [grok-4.5]
- hard-problem:    [depth-0]        # not a dispatch target
- direction:       [cross-family pair via survey pipeline]
- review:          [per .claude/review-loop-config.md roster]
```

## next-pick class weights (consumed as `class_weights` by scripts/next-pick.js)

```json
{"class_weights": {"mechanical-impl": 5, "standard-impl": 5, "direction": 3, "review": 3, "hard-problem": 0}}
```

`hard-problem` weight is 0 AND the class is ask-first by predicate — both belts on.
