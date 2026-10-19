# Decision Brief Template

> Use this format after synthesizing all role outputs.

```markdown
## Think Tank Decision Brief: {Topic Title}

### Consensus
{Conclusions all roles agree on, 1-3 sentences}

### Divergence Map

{ASCII diagram showing tension relationships between roles}
{Example:}

```
                    Architect              Product Director
                   "View A"               "View B"
                         \               /
                          \             /
          QA Devil ─────── Core Topic ─────── Ops/SRE
         "View C"                          "View D"
                          /             \
                         /               \
                   UX Advocate           Customer Advocate
                  "View E"               "View F"
```

### Key Divergence Points

| Divergence | Pro | Con | Tension |
|-----------|-----|-----|---------|
| {description} | {role} ({view}) | {role} ({view}) | high / medium / low |

### Role Recommendation Summary

| Role | Recommendation | Key Condition | Unique Insight |
|------|---------------|---------------|----------------|
| Architect | approve/conditional/reject | {one sentence} | {something only this role noticed} |
| Product Director | ... | ... | ... |
| UX Advocate | ... | ... | ... |
| QA Devil | ... | ... | ... |
| Ops/SRE | ... | ... | ... |
| Customer Advocate | ... | ... | ... |

### Most Valuable Collision Insights

**1. {Role A} vs {Role B}: {Insight Title}**
> {2-3 sentences explaining why these two perspectives colliding produced a new understanding}

**2. {Role C} vs {Role D}: {Insight Title}**
> ...

{2-3 insights max — don't list every divergence}

### CEO Recommendation

{If in CEO mode, provide integrated action recommendation}
{Include: go/no-go, phase breakdown, preconditions}

### Escalation Recommendation

{Check R1 consensus level:}

- **HIGH consensus** (most roles align): "Decision is clear. Proceed. No escalation needed."
- **MEDIUM consensus** (3-4 roles align, some meaningful disagreement): "Brief is usable. If the disagreement centers on something irreversible, consider escalating to `autopilot:think-tank-dialectic` for Hegelian cross-examination."
- **LOW consensus** (<3 roles align, fundamental disagreement): **"Escalation recommended."** Specifically: "This brief reflects genuine stalemate among the panel. If this decision is **irreversible or expensive to reverse**, invoke `autopilot:think-tank-dialectic` — it's designed exactly for this failure mode. If the decision is reversible, just pick one and iterate."
```

## Synthesis Principles

1. **Consensus is still valuable** — when all roles agree to proceed, focus shifts to differences in conditions
2. **Divergence map shows only major tensions** — pick the 2-4 most strategically significant, not every minor disagreement
3. **Collision insights are the Brief's highest value** — perspectives that no single role had, emerging only from cross-role interaction
4. **No whitewashing** — if QA says "don't do it" but 5 others say "do it", QA's objection must be fully presented
5. **Brief must be readable in 2 minutes** — executive summary, not a thesis
