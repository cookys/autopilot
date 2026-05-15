
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

**Dispatch per the `.claude/dispatch-config.md` `## Code Review` chain** (auto-injected at the top of `skills/quality-pipeline/SKILL.md`). quality-pipeline picks the **first AVAILABLE** reviewer in the chain; plugins not installed are skipped automatically. **`autopilot:reviewer` is the default fallback** when the chain is unset or no entry is dispatchable. The chain is a declarative preference; if you want a one-off non-chain reviewer, dispatch it directly via the Agent tool.

**Model/mode**: resolve via `scripts/resolve-dispatch.sh --role reviewer` — emits JSON `{model, mode, agent, source}` consulting `.claude/model-routing-config.md` or [`references/model-routing.md`](../../../references/model-routing.md) defaults. Do not hardcode defaults at the dispatch site.

Example dispatch (when the chain selects `autopilot:reviewer`):

```
Task tool:
  subagent_type: "autopilot:reviewer"
  prompt: "Review the changes against [plan/task description]. Focus on [specific concerns]."
```

> On round 2+ (Re-review Loop below), leave `[specific concerns]` blank or restrict it to **non-finding-derived** scope reminders only. Run `scripts/check-redispatch-prompt.sh <prompt>` before dispatching — exit 1 means the prompt is leaky per [`references/blind-dispatch.md`](../../../references/blind-dispatch.md) and MUST be stripped.

Whichever reviewer the chain selects, the agent (per the canonical scope statement consumed by `agents/reviewer.md` too) will:
1. Read every file affected by the diff and the **original task / plan / commit message** as baseline. Callers / tests / config are read only when a finding depends on them.
2. Run the full correctness / security / boundary / error-handling / performance / API-usage / scope-creep checklist (scope-creep dimension defined in "Scope Creep / Surgical Changes Scan" below).
3. Return findings with 4-tier severity (🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion) + `✅ Verified Clean` section + `### Handoff` with enum `Next consumer`.

(Non-autopilot reviewers may return a different output shape — see "Handoff Consumption" below for enum vocabulary; foreign-shape outputs fall back to inline interpretation by quality-pipeline.)

## Handoff Consumption

After the reviewer returns, read the `### Handoff` section and route the next step by enum.

**Scope note**: the table below lists only the enum values `autopilot:reviewer` itself emits. The global enum grammar (see `agents/README.md`) also defines `AUTOPILOT_PLANNER`, `PARALLEL_DISPATCH`, and `SEQUENTIAL_DISPATCH` — those are emitted by other methodology agents (planner / debugger) but never by reviewer, so quality-pipeline does not need to consume them here.

| Enum | quality-pipeline action |
|------|------------------------|
| `MAIN_CLAUDE` | Apply fixes inline (or hand to main Claude context) |
| `AUTOPILOT_DEBUGGER` | Re-dispatch `autopilot:debugger` as an independent session to investigate root cause, then loop back to review |
| `AUTOPILOT_PLANNER` | Re-dispatch `autopilot:planner` for six-element Task Prompt decomposition before attempting the fix |
| `NEEDS_DOMAIN_EXPERT` | Use the rationale to pick the appropriate voltagent role agent (e.g., `voltagent-lang:rust-engineer`, `voltagent-data-ai:postgres-pro`) and dispatch for the fix |
| `DOCUMENT_ONLY` | Record the findings without taking fix action (typical for 🟡 Minor / 🔵 Suggestion only runs) |

Methodology agents do not call each other. Any re-dispatch happens in quality-pipeline, never inside the reviewer's own session.

## Scope Creep / Surgical Changes Scan

**Every changed line must trace directly to the stated task, plan, or commit message.**

In addition to the correctness / security / boundary / error-handling / performance / API-usage checklist, the reviewer **must** scan the diff for changes that are not requested by the task. This addresses the most common LLM-coding failure mode: agents "improving" adjacent code, refactoring what isn't broken, or cleaning up code they think they understand.

### Pre-screen (cheap, deterministic)

Before the per-hunk judgment pass, run `scripts/diff-scope-report.sh [--message-file <commit-msg>]`. v1 covers two language-agnostic signals: `whitespace_only_file` and `unrelated_to_message`. The script emits JSON `findings`; the reviewer treats each as a candidate that must be judged, not an auto-finding. Hunks not pre-screened still get the full "which sentence implements this hunk?" test below.

### What counts as scope creep

| Pattern | Example |
|---------|---------|
| Reformatting unrelated lines | Reindenting a function the task didn't touch |
| Renaming outside the task surface | Renaming `tmp` → `pendingCards` in a file the task only adds one method to |
| Refactoring "while we're here" | Extracting a helper from existing code the task didn't need to call |
| Style alignment beyond changed lines | `'` → `"` quote swaps, trailing commas, etc., in unmodified code |
| Deleting pre-existing dead code | Removing a function the task didn't make unused (only newly-orphaned code may be removed) |
| Comment cleanup unrelated to the change | Rewording or removing comments on lines the task didn't touch |
| Dependency / config tweaks not required by the task | Bumping unrelated package versions, reordering imports |

### The test

For each changed hunk the reviewer answers: **"Which sentence of the task description does this hunk implement?"** If no sentence maps to it, it is scope creep.

### Severity

| Situation | Severity |
|-----------|----------|
| Unrequested change in compiled output (rename, refactor, dep change, behavior tweak) | **Major** |
| Unrequested whitespace / formatting / comment edit in compiled-output files | **Minor** |
| Unrequested whitespace / formatting in pure-doc files (`.md`, comments-only) | **Suggestion** |
| Newly-orphaned imports/variables/functions removed by the task | ✅ Verified Clean (not scope creep — cleanup is required) |

### Reviewer output contract

When scope creep is found, emit a dedicated subsection:

```
### Scope Creep Findings

🟠 Major — `src/foo.cpp:42-58` reindented; not in task description.
🟡 Minor    — `src/bar.h:103` comment reworded; not part of the requested fix.
```

When no scope creep is detected, the `✅ Verified Clean` section MUST explicitly include the line:

```
- No scope creep — every changed line traces to the task.
```

so downstream consumers can confirm the scan ran rather than being silently skipped. To populate that Verified Clean section deterministically (every reviewed file enumerated), seed it from `scripts/diff-file-list.sh changed` — that removes the LLM-from-memory file enumeration step.

### Why this matters (one-liner)

Mixed task-driven and scope-creep changes inflate review time, break `git blame` / bisect attribution, and (especially in C++) risk silent behavior changes from "harmless" refactors. Cheaper to push back at review than revert after merge.

## 4-Tier Severity

| Severity | Definition | Action |
|----------|------------|--------|
| **Critical** | Correctness / security / data-loss | Fix immediately, before commit |
| **Major** | Quality / maintainability / reliability | Fix immediately, before commit |
| **Suggestion** | Improvement, does not affect correctness | Analyze, then backlog or fix (see below) |
| **Minor** | Style, naming, cosmetic | Analyze, then backlog or fix (see below) |

**Classification guide:**

| Symptom | Severity |
|---------|----------|
| Crash, data corruption, security hole | **Critical** |
| Coding convention violation, missing error handling, resource leak risk | **Major** |
| Better design, readability, performance suggestion | **Suggestion** |
| Naming style, whitespace, formatting | **Minor** |

## Re-review Loop (Critical / Major)

Fix Critical and Major findings, then re-review. Repeat until only Suggestion/Minor remain or reviewer says LGTM.

```
review → findings?
├── Has Critical/Major → fix → re-review (repeat until clean)
├── Only Suggestion/Minor → process per below → commit
└── Clean (LGTM) → commit
```

**Re-review scope:** After each fix round, re-review the **entire diff**, not just the fix. Fixes can introduce new issues.

**Re-review checkpoint (dispatcher-only)**: Before round 1, run `scripts/diff-since-last-round.sh mark` to snapshot the HEAD SHA; between rounds, `scripts/diff-since-last-round.sh stat` returns JSON `{changed_files, insertions, deletions, doc_only}`. If `doc_only=true` and `changed_files` is trivially small, the dispatcher MAY short-circuit re-review. This decision and its data live **only in the dispatcher** — never pass the delta to the reviewer (leaks round-cycle meta-signal per [`references/blind-dispatch.md`](../../../references/blind-dispatch.md)). After the loop closes, `scripts/diff-since-last-round.sh clear`.

**Re-review dispatch is blind** — when re-dispatching `autopilot:reviewer` (or whichever reviewer the chain selects) for round 2+ on the same diff, the dispatch prompt MUST be stripped of prior-round findings. Follow the dispatcher pre-flight checklist in [`references/blind-dispatch.md`](../../../references/blind-dispatch.md); run `scripts/check-redispatch-prompt.sh <prompt-file>` — exit 1 ⇒ strip and re-check before dispatching. The prior finding lives in the dispatcher's memory; the fixer is NOT blind (it gets the full finding). Skipping the linter step is how the gate silently self-bypasses.

## Suggestion / Minor Processing

**Suggestion/Minor does not mean "ignore."** Each must be analyzed before merge:

```
For each Suggestion/Minor finding:
    ↓
Dispatch Explore agent to analyze impact and effort
    ↓
Classify into one of four outcomes:
├── S-size fix (< 5 min) → fix now, treat as Major
├── False positive / by-design → close with written rationale
├── Independent task needing more analysis → create next task with context
└── Has clear trigger condition → add to doc/BACKLOG.md with trigger
```

### Example Processing Table

| # | Issue | Severity | Analysis | Size | Disposition |
|---|-------|----------|----------|------|-------------|
| 1 | Null deref in error path | Critical | Crash when DB returns empty | S | Fix now + re-review |
| 2 | Missing mutex on shared map | Major | Race condition under load | S | Fix now + re-review |
| 3 | Could use string_view instead of string copy | Suggestion | 2% fewer allocations in hot path | S | Fix now (upgrade to Major) |
| 4 | Function name `doIt()` unclear | Minor | Rename to `processMatchResult()` | S | Fix now (upgrade to Major) |
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

All sizes require review. Major must be fixed now. Fix requires re-review. No severity judgment without analysis. No backlog without trigger condition.
> Full list: [_base/prohibited-behaviors.md](../_base/prohibited-behaviors.md)

## See Also

| Skill | Boundary |
|-------|----------|
| `quality-pipeline` (completeness-gate) | Must pass before code review starts |
| `quality-pipeline` (test-policy) | Must pass before completeness gate |
| `quality-pipeline` | Unified entry point that orchestrates all three |
