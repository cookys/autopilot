=== VALIDATION POLICY ===

## Validation Principle — Proportional to Risk

Validation costs real budget: tokens, context, latency, and reviewer attention. When choosing between approaches:

- Match the validation to what the change can actually break. A reversible, low-impact change needs the checks that would catch a realistic failure of THAT change — not the checks a rewrite would need. Run the tests appropriate to the change; once they pass, broaden or repeat testing only when a new change, a failure, or an unresolved concern justifies it.
- **Where completeness still wins**: a boundary a caller can reach, an error path that loses data, a case the requested behaviour cannot work without. Handle those in full. Completeness is not optional there.
- **Anti-patterns**:
  - BAD: adding a test that only restates the implementation it tests. (It cannot fail for a real reason.)
  - BAD: "the change is small, so skip the boundary case." (A reachable boundary is part of the change.)
  - BAD: broadening the suite after it is already green, with no new signal to justify it.

Apply this to the task below: test coverage, error handling, edge cases, and feature completeness.
