# Anti-Rationalization Patterns

> Inspired by [tanweai/pua](https://github.com/tanweai/pua) v3.0 (MIT License)

When the agent exhibits any of these patterns, the corresponding correction is
**MANDATORY** — not a suggestion. These patterns are the most common causes of
wasted time in AI-assisted development.

## Pattern Table

| Pattern | Detection Signal | Forced Correction |
|---------|-----------------|-------------------|
| **Blame environment** | "probably environment issue", "might be permissions", "could be network" | Verify with tools FIRST. Run the diagnostic command. Unverified attribution is a skipped step, not a diagnosis. |
| **Premature surrender** | "I cannot solve", "beyond capability", "out of scope" | Complete the 5-step methodology (smell → pull-hair → mirror → execute → review) first. Not done = keep going. |
| **Delegate to user** | "suggest you manually", "please check", "you might need to" | Use available tools first. Only ask what genuinely requires human input (credentials, business decisions). |
| **Spinning in place** | Same approach 3+ times with parameter tweaks | Switch to a FUNDAMENTALLY different strategy. Changing a flag is not a new approach. Changing the entire diagnostic angle is. |
| **Unverified completion** | "done", "fixed", "resolved" without verification output | Run build/test/verification command and show the output. No evidence of success = not done. |
| **Guessing without search** | Conclusions from training data, no tool verification | Search first (Grep/WebSearch/Read). Training data may be outdated. Memory ≠ verified fact. |
| **Passive waiting** | Fix applied, then stop and wait for next instruction | Check related areas proactively. One problem in → one category out. Fix A, then check if B and C have the same issue. |
| **Scope deflection** | "not my scope", "that's a different issue", "outside this task" | If the problem is in front of you, at minimum document it. If it's blocking the current task, it IS in scope. |

## 7-Point Checklist (for persistent failures)

When stuck after 4+ attempts on the same problem, complete ALL items before
declaring inability to solve. Each item must have a concrete answer (not just
a checkmark):

- [ ] **Read failure signal word by word?** — What exactly does the error say? Quote it.
- [ ] **Searched core problem with tools?** — What search queries did you run? What did you find?
- [ ] **Read original context around failure?** — 50 lines above and below. What's the surrounding code doing?
- [ ] **All assumptions verified with tools?** — Version numbers, file paths, permissions, dependencies — confirmed how?
- [ ] **Tried the opposite assumption?** — If you assumed "problem is in A", what if it's NOT in A?
- [ ] **Reproduced in minimal scope?** — Can you isolate the failure in a smaller test case?
- [ ] **Switched tools/methods/angles/stack?** — Did you try a completely different diagnostic approach?

## Structured Failure Report (when genuinely stuck)

If all 7 items are completed and the problem remains unsolved, produce this
report as the deliverable:

```
## Failure Report
### Verified Facts
[What is confirmed with evidence]
### Excluded Possibilities
[What was ruled out, with evidence for each exclusion]
### Narrowed Scope
[Where exactly the problem is — as specific as possible]
### Recommended Next Steps
[What should be tried next by a human or fresh session]
### Approaches Tried
[Each approach, what it tested, and why it didn't resolve the issue]
```

A well-documented dead end is more valuable than continued spinning.
