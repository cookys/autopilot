# Prohibited Behaviors — canonical full list

> Shared base reference for `quality-pipeline`. The skill's reference docs
> (`references/test-policy.md`, `references/code-review.md`) cite a terse summary
> inline and link here for the full list. Single source of truth — update here.

Severity vocabulary is the unified 4-tier: 🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion.

## Test failures (test-policy)

- ❌ **Skip pre-existing failures.** A failure that predates your change still gets classified (use `scripts/verify-preexisting.sh`); you do not get to ignore it because "it was already red."
- ❌ **Skip even a single failure.** "1 of 200 failing" is a red suite. There is no passing threshold below 100%.
- ❌ **Commit before fixing.** Never commit or merge with a known failing test in scope.
- ❌ **Assume a failure is unrelated.** Prove it (classification: PRE_EXISTING / INTRODUCED / NO_FAILURE / INCONCLUSIVE) — do not assert it from memory.

## Pre-existing errors (pre-existing error cleanup)

- ❌ **Leave compile errors/warnings untouched.** After the main task, analyze and fix pre-existing compile errors/warnings in the touched area.
- ❌ **Dismiss as "just a warning."** Warnings are defects until triaged.
- ❌ **Defer to "later."** "Later" without a BACKLOG entry + trigger condition is a silent drop.

## Code review (prohibited excuses)

- ❌ **Skip review by size.** All sizes require review — there is no "too small to review."
- ❌ **Defer a Major.** 🟠 Major (and 🔴 Critical) must be fixed now, not backlogged.
- ❌ **Merge a Fix without re-review.** A fix to a review finding requires re-review of the fix.
- ❌ **Assign severity without analysis.** No severity judgment from a glance — cite file:line and impact.
- ❌ **Backlog without a trigger.** Every BACKLOG entry needs an observable trigger condition (per `references/code-review.md` backlog spec); triggerless entries are rejected.

## Why these are prohibited, not "discouraged"

Each maps to a silent-failure mode: a skipped test, an untriaged warning, an unreviewed change, or a triggerless backlog entry all *look* clean while hiding unfinished work. The prohibition exists so the gate cannot be passed by relabeling incomplete work as acceptable.
