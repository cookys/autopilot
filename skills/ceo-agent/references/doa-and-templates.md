# CEO Agent — DOA Matrix and Report Templates

## Full DOA Matrix

### CEO Autonomous (Tactical)

| Decision Type | Examples | Notes |
|---------------|----------|-------|
| Tech selection | zstd vs deflate, which library | Record in CEO Report |
| Research | Whether to run survey, what topic | Self-initiated |
| Team composition | Agent count, roles, parallel vs sequential | Self-organized |
| Implementation path | Phase order, file structure, API design | Design freedom |
| Error recovery | Build failure fix, test failure handling | Immediate action |
| Tactical pivot | Different implementation, same goal | Explain in report |

### Requires Board Approval (Strategic + Irreversible)

| Decision Type | Examples | Why Escalate |
|---------------|----------|-------------|
| Goal change | "WS compression -> delta encoding instead" | Pivot beyond original authorization |
| Scope expansion | "Need to refactor X first" | Resources exceed estimate |
| Irreversible ops | Delete files/branches, merge to main | Cannot undo |
| Resources 2x+ | Work estimate doubles original | Exceeds implied budget |

### Board Escalation Format

```markdown
## Board Decision Needed

**Situation**: {what happened}
**Options**:
  A) {option A + impact}
  B) {option B + impact}
**CEO recommendation**: {which and why}
```

## CEO Report Template (Interim)

Report frequency determined by user's chosen involvement level at startup.

```markdown
## CEO Report #{N} -- {topic}

### Progress
- [x] Completed items
- [ ] In progress items

### Decision Log
| Decision | Chosen | Why | Alternatives Considered |
|----------|--------|-----|------------------------|

### Risks & Findings
{Report honestly. Bad news is more important than good news.}

### Next Steps
{What comes next}

### Needs Board Decision
{If any; otherwise "None"}
```

User responses to reports:
- **No response** -> CEO continues (implicit approval)
- **Feedback** -> CEO adjusts direction
- **Stop** -> CEO halts immediately

## CEO Final Report Template

Produced when all objectives are complete. This is the closing report for the Board.

```markdown
## CEO Final Report -- {topic}

### Outcomes
{What was achieved, checked against original OKR item by item}

### Complete Decision Log
| # | Decision | Chosen | Why | Alternatives |
|---|----------|--------|-----|-------------|

### Pivots During Execution
{Any direction changes, with reasons}

### Remaining Items
{Things done but need follow-up attention, or things deliberately not done}

### Lessons Learned
{Insights from this execution worth recording to knowledge}
```

## Pivot Mechanism

```
Discovery requires change
+-- Tactical adjustment (different implementation, same goal)
|   -> Decide autonomously, explain in Report
|
+-- Strategic pivot (goal itself needs to change)
    -> Pause, propose to Board:
    "Original goal X is not feasible/optimal because {evidence}.
     Suggest changing to Y. Reasoning: {...}.
     Risk of continuing with X: {...}."
```

Pivot proposals must include concrete evidence (survey results, benchmark data, failure logs). "I think" is not sufficient.

## Governance Background

The Board-CEO separation is modeled on corporate governance research: clear delegation boundaries + outcome measurement. Within boundaries, CEO has full freedom. Beyond boundaries, Board approval required. Over-constraining prevents CEO effectiveness (Japanese traditional firms); over-permitting leads to loss of control (WeWork, FTX).

CEO cannot self-audit (corporate governance core principle -- CEO cannot chair audit committee). In AI context, Apollo Research shows capable models will game their own metrics when goals conflict. Therefore:
- quality-pipeline runs independently (quality gate)
- code-review uses independent agent (audit committee)
- CEO cannot skip these steps
