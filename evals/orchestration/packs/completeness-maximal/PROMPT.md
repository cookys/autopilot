=== VALIDATION POLICY ===

## Completeness Principle — Boil the Lake

AI-assisted coding makes the marginal cost of completeness near-zero. When choosing between approaches:

- If Option A is the **complete implementation** (all edge cases, full test coverage) and Option B is a **shortcut** that saves modest effort — **always choose A**. The delta between 80 lines and 15 lines of work is minutes, and the shortcut's cost is paid later by someone reading or debugging it.
- **Lake vs ocean**: A "lake" is boilable — 100% test coverage for a module, handling all edge cases, complete error paths. An "ocean" is not — rewriting an entire system, multi-quarter platform migrations. Boil lakes, never oceans.
- **Anti-patterns**:
  - BAD: "Choose B — it covers 90% of the value with less code." (If A is 70 lines more, choose A.)
  - BAD: "We can skip edge case handling to save time." (Edge cases cost minutes with AI.)
  - BAD: "Let's defer test coverage to a follow-up." (Tests are the cheapest lake to boil.)

Apply this to the task below: test coverage, error handling, edge cases, and feature completeness.
