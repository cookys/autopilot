<!--
FROZEN PACK FIXTURE — do NOT edit mid-experiment (an edit = restart the arm).
Source: skills/quality-pipeline/references/code-review.md
Source-SHA: cb161699a0b6ef05a2d00e0211c4251a00a1783a
Frozen: 2026-07-15 (skill-transport payoff A/B, docs/plans/2026-07-15-skill-transport-payoff-ab.md)
Content: methodology-only (review-execution). Per Global Constraint #1 every output-format
directive has been stripped — no output contract, no handoff enum, no severity-emoji /
report-structure section, no verdict-token vocabulary — so the pack cannot compete with
the dispatch nonce output protocol. Phase 0 grep-asserts this file is free of output-format
directives AND disjoint from each case's defect-matched predicate vocabulary.
-->

# Review methodology

Read the whole change and the task/plan/commit message it claims to implement. Judge the
diff against that baseline. Open every file the diff touches; consult callers, tests, and
configuration when a concern depends on them.

## What to examine

Run the full review checklist over every changed line:

- **Correctness** — does the code do what the task says, for the ordinary case and the edge
  cases? Trace the control flow and the data flow by hand; do not assume the change is right
  because it looks plausible.
- **Security** — untrusted input, access to the filesystem or network, anything that touches
  secrets, permissions, or authority boundaries.
- **Boundary conditions** — first/last element, empty input, ranges and their inclusive or
  exclusive ends, the moment a limit is reached.
- **Error handling** — every failure path. Is a failure detected, propagated, and surfaced,
  or is it quietly discarded so the caller believes it succeeded?
- **Resource management** — anything acquired must be released on every path, including the
  failure paths; concurrent access to shared state must be coordinated.
- **Performance** — obvious hot-path costs, repeated work that could be done once.
- **API usage** — is each library or interface used the way its contract requires?

Reason about what the code does, not what the author intended it to do. A change that
compiles, runs, and passes its own tests can still be wrong; the author's tests may exercise
the wrong thing, or may have been weakened to match a defect.

## Trace before you trust

Findings are claims to check, not orders to obey. Confirm each concern against the actual
code before treating it as real; an issue you cannot reproduce from the diff is a false
positive, not a defect. Equally, do not wave a change through because it is small — a
one-line change can invert a condition or drop a check.

## Scope discipline

Every changed line must trace to a sentence of the stated task, plan, or commit message.
For each hunk ask: which part of the task does this implement? If nothing maps, it is an
unrequested change — reformatting untouched code, renaming beyond the task surface,
refactoring adjacent code "while here", style or comment edits on lines the task did not
need, dependency or configuration tweaks the task did not require. Unrequested changes to
compiled behaviour matter most; the only always-legitimate removal is code the task itself
just made unreachable.

## How much weight a concern carries

- A defect that can crash, corrupt data, or breach security is the most severe.
- A convention violation, a missing error check, or a resource-leak risk is next.
- Naming, whitespace, and cosmetic issues are minor.
- A pure improvement that does not affect correctness is a suggestion.

## Disclose every bound

If you could not review everything — a file only partly read, one partition of many, a
sample, work you skipped for time — say so plainly. An undisclosed bound is itself a defect:
believing a partial sweep was exhaustive is worse than knowing where the gap is. A clean
read means only that what you looked at held up, never that nothing exists beyond it.

## Re-examine after a fix

When a change is revised in response to a concern, re-examine the entire change, not only the
edited lines — a fix can introduce a fresh problem elsewhere.
