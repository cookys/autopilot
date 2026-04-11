
# Code Review (All Sizes, Mandatory)

**Every commit/merge requires code review. No exceptions.**

## Fix-First Classification (C++ Safe)

Before presenting findings to the user, classify each into AUTO-FIX or ASK.

**C++ safety principle:** In C++, even "mechanical" changes can alter compiled output and runtime behavior. Auto-fix scope is intentionally narrow.

### AUTO-FIX (apply immediately, no asking)

Only these categories — nothing that changes compiled output:

| Category | Examples | Why safe |
|----------|----------|----------|
| Comment typos/formatting | `// retrun` → `// return`, missing period | Zero compiled output change |
| Trailing whitespace / extra blank lines | Whitespace-only diffs | Zero compiled output change |
| Log message text corrections | `spdlog::info("recieved")` → `spdlog::info("received")` | String literal only |
| Markdown / documentation fixes | Typos in `doc/`, README, CLAUDE.md | Not compiled |
| Unused `#include` removal | **Only if compiler confirms** no transitive dependency (the project build command passes) | Must verify — C++ headers have side effects |

**Hard boundary:** If in doubt, it is ASK, not AUTO-FIX.

### ASK (present to user with recommendation)

Everything else, including items that seem trivial:

| Category | Why not auto-fix |
|----------|-----------------|
| Any code logic change (even "obvious") | C++ implicit conversions, overload resolution |
| `#include` reordering | May change implicit conversion behavior, macro definitions |
| Type cast changes (even narrowing → widening) | Affects overload resolution, template instantiation |
| Variable/function rename | May affect serialization, protocol field names, reflection |
| Error handling changes | Different exception paths, return codes |
| Default parameter changes | Affects all call sites, ABI |
| Const/constexpr additions | May change overload selection |
| `std::move` / forwarding changes | Ownership semantics |

### Workflow

```
1. Collect all findings from code-reviewer agent
2. Classify each finding as AUTO-FIX or ASK
3. Apply all AUTO-FIX silently
   - If any AUTO-FIX involves #include removal: run the project build command to verify
   - Revert on build failure → reclassify as ASK
4. Present ASK findings one-at-a-time with severity + recommendation
5. Summary: "Auto-fixed N items (comments/formatting). M items need your decision."
```

### Classification Example

| # | Finding | Class | Rationale |
|---|---------|-------|-----------|
| 1 | Comment: `// caluclate score` | AUTO-FIX | Typo in comment, no compiled effect |
| 2 | Trailing whitespace in `GameRoom.cpp` | AUTO-FIX | Whitespace only |
| 3 | `spdlog::warn("faild to connect")` | AUTO-FIX | Log string typo |
| 4 | Unused `#include <algorithm>` | AUTO-FIX | Only after build verification |
| 5 | `int` → `size_t` for loop counter | ASK | Changes type, affects comparisons |
| 6 | Reorder includes alphabetically | ASK | May change macro/conversion behavior |
| 7 | Rename `tmp` → `pendingCards` | ASK | May affect debug tooling, serialization |
| 8 | Add `[[nodiscard]]` to return value | ASK | Changes compiler warnings at call sites |


## Invocation

Dispatch `autopilot:reviewer` as the primary code reviewer — it carries autopilot's Three Red Lines discipline (closure / fact-driven / exhaustiveness) and emits a unified Output Contract with enum-based `### Handoff` section that quality-pipeline can pattern-match:

```
Task tool:
  subagent_type: "autopilot:reviewer"
  prompt: "Review the changes against [plan/task description]. Focus on [specific concerns]."
```

The agent will:
1. Read all changed files (git diff)
2. Compare against the original plan/task intent
3. Run the full correctness / security / boundary / error-handling / performance / API-usage checklist
4. Return findings with 4-tier severity (🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion) + `✅ Verified Clean` section + `### Handoff` with enum `Next consumer`

**Alternate reviewers** (invoke explicitly when you want a different discipline axis):

- `superpowers:code-reviewer` — broader latitude, less strict on discipline enforcement
- `voltagent-qa-sec:code-reviewer` — role-specialized with broader domain catalog

quality-pipeline does **not** runtime-detect which reviewers are available. `autopilot:reviewer` is the primary because autopilot ships it. If you want an alternate, dispatch it directly via the Agent tool — that is a user-layer choice, not a quality-pipeline decision.

## Handoff Consumption

After the reviewer returns, read the `### Handoff` section and route the next step by enum:

| Enum | quality-pipeline action |
|------|------------------------|
| `MAIN_CLAUDE` | Apply fixes inline (or hand to main Claude context) |
| `AUTOPILOT_DEBUGGER` | Re-dispatch `autopilot:debugger` as an independent session to investigate root cause, then loop back to review |
| `NEEDS_DOMAIN_EXPERT` | Use the rationale to pick the appropriate voltagent role agent (e.g., `voltagent-lang:rust-engineer`, `voltagent-data-ai:postgres-pro`) and dispatch for the fix |
| `DOCUMENT_ONLY` | Record the findings without taking fix action (typical for 🟡 Minor / 🔵 Suggestion only runs) |

Methodology agents do not call each other. Any re-dispatch happens in quality-pipeline, never inside the reviewer's own session.

## 4-Tier Severity

| Severity | Definition | Action |
|----------|------------|--------|
| **Critical** | Correctness / security / data-loss | Fix immediately, before commit |
| **Important** | Quality / maintainability / reliability | Fix immediately, before commit |
| **Suggestion** | Improvement, does not affect correctness | Analyze, then backlog or fix (see below) |
| **Minor** | Style, naming, cosmetic | Analyze, then backlog or fix (see below) |

**Classification guide:**

| Symptom | Severity |
|---------|----------|
| Crash, data corruption, security hole | **Critical** |
| Coding convention violation, missing error handling, resource leak risk | **Important** |
| Better design, readability, performance suggestion | **Suggestion** |
| Naming style, whitespace, formatting | **Minor** |

## Re-review Loop (Critical / Important)

Fix Critical and Important findings, then re-review. Repeat until only Suggestion/Minor remain or reviewer says LGTM.

```
review → findings?
├── Has Critical/Important → fix → re-review (repeat until clean)
├── Only Suggestion/Minor → process per below → commit
└── Clean (LGTM) → commit
```

**Re-review scope:** After each fix round, re-review the **entire diff**, not just the fix. Fixes can introduce new issues.

## Suggestion / Minor Processing

**Suggestion/Minor does not mean "ignore."** Each must be analyzed before merge:

```
For each Suggestion/Minor finding:
    ↓
Dispatch Explore agent to analyze impact and effort
    ↓
Classify into one of four outcomes:
├── S-size fix (< 5 min) → fix now, treat as Important
├── False positive / by-design → close with written rationale
├── Independent task needing more analysis → create next task with context
└── Has clear trigger condition → add to doc/BACKLOG.md with trigger
```

### Example Processing Table

| # | Issue | Severity | Analysis | Size | Disposition |
|---|-------|----------|----------|------|-------------|
| 1 | Null deref in error path | Critical | Crash when DB returns empty | S | Fix now + re-review |
| 2 | Missing mutex on shared map | Important | Race condition under load | S | Fix now + re-review |
| 3 | Could use string_view instead of string copy | Suggestion | 2% fewer allocations in hot path | S | Fix now (upgrade to Important) |
| 4 | Function name `doIt()` unclear | Minor | Rename to `processMatchResult()` | S | Fix now (upgrade to Important) |
| 5 | Consider caching DB query result | Suggestion | Would help at 10K+ users, not current scale | M | Backlog (trigger: when optimizing for 10K+) |
| 6 | "Magic number 42" | Minor | Actually `MAX_TILES` constant, used consistently | - | Close (by-design) |

### Backlog Entry Format

Every backlog entry **must** include a trigger condition:
```markdown
- [ ] [Suggestion] Cache rank table query results
  - Trigger: when optimizing for 10K+ concurrent users
  - Context: quality-pipeline (code-review) found repeated DB queries in the target module
```

Entries without trigger conditions are rejected.

## Review Timing

| Size | When | Baseline |
|------|------|----------|
| S | Before commit | Task intent |
| M | Before finishing branch | Original objective |
| L (Phase) | After each phase | Phase plan |
| L (Final) | Before finishing branch | Full project plan |

## Prohibited Excuses

All sizes require review. Important must be fixed now. Fix requires re-review. No severity judgment without analysis. No backlog without trigger condition.
> Full list: [_base/prohibited-behaviors.md](../_base/prohibited-behaviors.md)

## See Also

| Skill | Boundary |
|-------|----------|
| `quality-pipeline` (completeness-gate) | Must pass before code review starts |
| `quality-pipeline` (test-policy) | Must pass before completeness gate |
| `quality-pipeline` | Unified entry point that orchestrates all three |
