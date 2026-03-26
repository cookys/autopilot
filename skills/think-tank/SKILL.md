---
name: think-tank
description: >
  Multi-role debate (architect, ops, QA, product, UX, finance) for strategic decisions. Use when:
  "I want perspectives from different roles", "let's debate this", "tradeoff analysis", "which
  should we prioritize", "blast radius of X", "scope decision", "hear from architect/ops/product",
  "what's the impact?". Not for: pure tech selection (→ survey), open brainstorming, or full
  delegation (→ ceo-agent).
---

# Think Tank — Multi-Role Decision Brief

6 specialized roles analyze the same topic in parallel, each producing independent perspectives, then cross-collide. Value lies in divergence, not consensus.

## When to Use

| Trigger | Example |
|---------|---------|
| Product/strategy decisions | "Should we build X?" "A or B first?" |
| Scope decisions | "How far do we go?" "What's in Phase 1?" |
| Tradeoff analysis | "Performance vs features vs maintenance cost" |
| Risk assessment | "What's the blast radius of this change?" |
| CEO Agent hits strategic decision | CEO autonomously invokes `autopilot:think-tank` |

**Not for**: pure technical selection (X library vs Y) → use `autopilot:survey`.

## Relationship to Other Skills

```
survey       → external research (what does the industry do?)
think-tank   → internal multi-perspective debate (what should WE do?)  ← this skill
ceo-agent    → autonomous execution after decision
```

Chain: survey output → feed into think-tank → Decision Brief → CEO executes.

## Role Configuration

### 6 Standard Roles

| Role | voltagent subagent_type | Focus |
|------|------------------------|-------|
| **Architect** | `voltagent-qa-sec:architect-reviewer` | Technical feasibility, coupling, performance, tech debt |
| **Product Director** | `voltagent-biz:product-manager` | Feature ROI, priority, scope, success metrics |
| **UX Advocate** | `voltagent-biz:ux-researcher` | User experience, interaction flow, edge cases |
| **QA Devil** | `voltagent-qa-sec:qa-expert` | Test coverage, regression risk, failure modes |
| **Ops/SRE** | `voltagent-infra:sre-engineer` | Deploy complexity, monitoring, rollback, resource usage |
| **Customer Advocate** | `voltagent-biz:customer-success-manager` | User needs, pain points, retention impact |

### Quick Mode (3 Roles)

Small decisions don't need 6 roles. Pick the 3 most relevant:

| Topic Type | Suggested Roles |
|-----------|----------------|
| Technical approach | Architect + QA + Ops |
| Feature scope | Product + UX + Customer |
| Performance vs features | Architect + Product + Ops |
| New user-facing feature | UX + QA + Customer |

## Execution Flow

### Step 1: Define the Topic

Extract from user input:
- **Topic**: one sentence describing the decision
- **Context**: current state, known constraints
- **Survey results**: if a survey was run previously, summarize conclusions

If the topic is too vague, ask one clarifying round first.

### Step 2: Prepare Domain Context

Read codebase context relevant to the topic (architecture docs, domain skills, related source code). Compile into a shared context block for all roles. Each role needs sufficient domain knowledge to produce valuable perspectives.

### Step 3: Parallel Dispatch

Spawn all roles simultaneously (6 or 3), each agent gets:
- Role prompt (see [references/role-prompts.md](references/role-prompts.md))
- Shared domain context
- Topic + constraints

```
Agent({
  subagent_type: "<voltagent-type>",
  prompt: "<role-prompt> + <domain-context> + <topic>",
  run_in_background: true,
  name: "tt-<role>"
})
```

Dispatch ALL roles simultaneously — do not wait for one to complete before dispatching the next.

### Step 4: Cross-Collision Synthesis

After all roles report back, synthesize into a Decision Brief:

1. **Find consensus** — conclusions all roles agree on
2. **Find divergence** — conflict points between roles (this is the most valuable part)
3. **Find collision insights** — new perspectives emerging from role interactions (A's view + B's view → insight neither had alone)
4. **Summarize recommendations** — each role's stance (approve/conditional/reject) + one-sentence rationale

### Step 5: Produce Decision Brief

Use the fixed format (see [references/brief-template.md](references/brief-template.md)), including:
- Consensus
- Divergence map (ASCII diagram showing tensions between roles)
- Key divergence table (pro vs con + tension level)
- Role recommendation summary table
- Top 2-3 collision insights
- CEO recommendation (if in CEO mode)

## Output Requirements

- Decision Brief must present complete results in a single response
- Divergence map uses ASCII diagram (not mermaid)
- Each role's output: max 300 words
- Brief should be readable in under 2 minutes

## Error Handling

| Situation | Action |
|-----------|--------|
| Agent timeout | Produce partial brief from available roles, mark missing ones |
| All roles agree | Normal — mark as "strong consensus", but verify no angle was missed |
| All roles oppose | Report to user, suggest not proceeding or redefining the topic |
| Topic too broad (multiple independent decisions) | Split into sub-topics, run one round per sub-topic |

## See Also

| Skill | Relationship |
|-------|-------------|
| `autopilot:survey` | Survey finds external data, think-tank does internal debate. Can chain. |
| `autopilot:ceo-agent` | CEO autonomously invokes think-tank for strategic decisions |
| `superpowers:dispatching-parallel-agents` | Parallel execution; think-tank does parallel analysis |
