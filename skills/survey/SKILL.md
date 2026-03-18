---
name: survey
description: "Technology research before architecture decisions. Use when: technology selection (X vs Y), architecture decisions (canonical approach?), uncertainty in plans (TBD/待定), new domains the team hasn't touched, user says 先調查/survey/research/業界怎麼做, or brainstorming encounters multiple valid approaches with no clear winner."
---

# Survey -- Technology Research

Two independent agents (researcher + skeptic) search in parallel, bringing different perspectives to avoid anchoring bias and recency bias.

## Trigger

| Method | When |
|--------|------|
| Manual | User says "survey", "research", "業界怎麼做" |
| Signal suggestion | Plan Mode / brainstorming detects tech selection / architecture decision / uncertainty -> suggest (user confirms before running) |

**Suggestion template** (when signal detected):
> "This decision involves tech selection. Suggest running `/survey` to research industry practices first. Proceed?"

## Boundary

- **Produce recommendation, marked as suggestion** -- attach reasoning and preconditions so user can judge applicability
- **No code** -- research only
- **No auto-trigger** -- signal only suggests, user confirms

## Flow

### Step 1: Scope the Research

Extract from user input:
- **Topic**: what to research (e.g. "WS compression options")
- **Constraints**: known limits (e.g. "must support C++20", "latency < 1ms")
- **Existing bias**: does user already lean toward something? (researcher should specifically probe that option's weaknesses)

If input is vague (e.g. "look into cache"), ask one clarifying round before dispatch.

### Step 2: Parallel Dispatch

Spawn researcher + skeptic **simultaneously**. Skeptic does NOT wait for researcher -- independent search finds different angles.

```
Agent tool:
  name: "survey-researcher"
  subagent_type: "general-purpose"
  run_in_background: true
  prompt: -> references/prompts.md #Researcher

Agent tool:
  name: "survey-skeptic"
  subagent_type: "general-purpose"
  run_in_background: true
  prompt: -> references/prompts.md #Skeptic
```

> Full agent prompts with variable substitution: [references/prompts.md](references/prompts.md)

### Step 3: Merge Report

After both agents complete:

1. **Deduplicate** -- merge overlapping sources
2. **Cross-validate** -- researcher's pros vs skeptic's risks, same row per option
3. **Gap-fill** -- option with only pros and no risks (or vice versa) -> mark "incomplete data"
4. **Rank** -- by combined pros, risks, industry adoption
5. **Generate report** -- fixed format below

### Step 4: Present to User

Present report, clearly mark "decision is yours". If user wants to dive deeper into one option, run follow-up search.

## Output Format

```markdown
## Survey: {topic}

> Date: YYYY-MM-DD

### Background
{Why this research, 1-2 sentences}

### Options Comparison

| Option | Pros | Risks | Industry Adoption | Fit |
|--------|------|-------|-------------------|-----|
| A      | ...  | ...   | ...               | 3/3 |
| B      | ...  | ...   | ...               | 2/3 |

### Recommendation
{Recommended option + reasoning + preconditions (under what assumptions this holds). Decision is yours.}

### Sources

**Theory/Standards**
- [{title}]({url}) -- {one-line summary}

**Production Practice**
- [{title}]({url}) -- {one-line summary}

**Benchmark / Demo**
- [{title}]({url}) -- {one-line summary}

**Adoption Cases**
- [{title}]({url}) -- {one-line summary}

**Risk/Failure Cases**
- [{title}]({url}) -- {one-line summary}
```

## Error Handling

| Situation | Action |
|-----------|--------|
| WebSearch unavailable | Use LLM knowledge + WebFetch known URLs. Mark "no live search" in report |
| Agent timeout | Use partial results. Mark "{agent} incomplete" |
| No sources found for option | Keep in table, mark all fields "no public data" -- this is a risk signal |

## Signal Detection (for other skills)

| Signal | Example |
|--------|---------|
| Tech selection | "X or Y?", "which library?" |
| Architecture decision | "canonical approach for this?" |
| Uncertainty | "TBD", "方法待定" in plans |
| New domain | Tech/protocol/pattern team hasn't used |
| User bias | "I think X is good" -- worth verifying with survey |
