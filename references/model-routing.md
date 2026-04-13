# Model Routing — Subagent Dispatch Defaults

> Shared reference for all autopilot skills that dispatch subagents.
> Project can override via `.claude/model-routing-config.md`.

## How to Use

Before dispatching an Agent, determine the role and look up model + mode:

```
1. Read .claude/model-routing-config.md (if exists → use project config)
2. If not found → use defaults below
3. Apply model + mode to Agent() call
```

## Default Routing Table

| Role | Model | Mode | Rationale |
|------|-------|------|-----------|
| **planner** | sonnet | plan | Analysis tasks: sonnet ≥ opus accuracy, -34% cost |
| **reviewer** | sonnet | plan | 100% accuracy on review tasks in benchmark |
| **debugger** | sonnet | plan | 100% accuracy on debug tasks in benchmark |
| **implementer** | opus | default | Needs full tool access + deep reasoning |
| **test-runner** | haiku | default | Execution-focused, speed priority |
| **researcher** | sonnet | default | Web search + synthesis, needs tools |
| **think-tank-role** | sonnet | plan | Analysis only, no implementation |

## Agent Dispatch Pattern

```javascript
// Example: planner subagent
Agent({
  description: "...",
  model: "sonnet",    // from routing table
  mode: "plan",       // from routing table
  prompt: "..."
})
```

## Mode Reference

| Mode | Effect | When to use |
|------|--------|-------------|
| `"plan"` | Read-only — cannot Edit/Write/Bash | Analysis, review, planning |
| `"default"` | Full tool access | Implementation, test execution |

## Override

Projects can create `.claude/model-routing-config.md` with a custom dispatch table.
The file format should include a markdown table with columns: Role, Model, Mode.
Skills will prefer the project config over these defaults.

## Evidence

Based on benchmark (2026-04-13, 90 runs, 10 real cases, 6 providers):
- Sonnet ≥ Opus on analysis (97% vs 88% accuracy)
- Runtime constraint (mode:"plan") achieves 95-100% compliance
- Model strength doesn't affect boundary violation rate
- Cost: opus $0.115 → sonnet $0.074 → haiku $0.037 per run
