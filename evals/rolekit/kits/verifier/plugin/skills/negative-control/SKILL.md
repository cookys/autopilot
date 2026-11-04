---
name: negative-control
description: "Use when a check or test is written: it must be shown failing on a deliberately broken case."
---

## 58. A gate that has never been seen to fail has not been shown to guard anything

On 2026-08-08 three checks passed CI while blocking nothing: managed dev-flow admission denied every
bounded non-Mission campaign (no caller or fixture could satisfy it); the `resolve-worktree-teardown`
template-tier assertion was masked by the repo's own dogfood config; `check-test-integrity.sh` looked at
none of the 263 shell test files and exited 0. Each shipped with tests, and each test only ever showed the
gate passing. A caution ("a script existing is not evidence it is running") did not stop the repeat,
because it works only if someone remembers it.

Rule: any new or modified check (gate, hook, scan, admission check) ships with a negative control — a
case deliberately broken in the way the check exists to catch, which must be blocked. Show it red against
the broken input (or with the check's key line removed) and green on the fixed one; a check whose only
tests are passes is unverified. Applies to the guard's input coverage too: a count of what it inspected
should be pinned to the real population, not to zero.

Preventing artifact: `hooks/tests/check-test-integrity.test.sh` §11 (BEFORE/AFTER/BLOCK records for four
gaming actions, plus a coverage meta-test bound to `git ls-files`) is the shape to copy. This rule is the
routine; there is still no meta-gate that checks every gate has such a case (BL-0058). Owner approved as a
development rule 2026-10-13.
