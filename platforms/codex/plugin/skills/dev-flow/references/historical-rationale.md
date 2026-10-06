# Historical Rationale

This document compiles historical rationales and dated incident storytelling that support the development flow rules and gates.

## Why the skill-routing task exists

On 2026-04-11, `reconnect-regression-fix` ran the full bug workflow against `src/network/`, `src/lobby/`, and E2E tests without invoking `twgs-network` / `twgs-debug` / other project skills. The skill-routing bullet in the session-start gates was passive markdown and got mentally compressed into "I know this area" — the same failure mode the closing sequence hit before `finish-flow` replaced it. The skill-routing TaskCreate (with unit tasks `blockedBy` it) applies the identical passive→active pattern that worked for the closing sequence. Missing `twgs-*` skill invocations don't produce immediate bugs, but they systematically waste the knowledge base the project has invested in.

## Why the closing sequence is a parent task plus finish-flow

On 2026-03-17 and 2026-04-11 the same completion sequence was silently skipped twice — despite the dev-flow SKILL.md being patched with bolder markdown and anti-patterns. An inline step list gets mentally compressed into "one action". The parent `finish` TaskCreate and the sub-tasks `finish-flow` creates are active reminders that system-reminder surfaces until each is addressed.

## Why the Scope Completeness Audit exists

On 2026-04-11, the `dev-flow-l5-enforcement` project shipped the new `finish-flow` skill but initially missed the autopilot-side user-facing surface (README skill count, CHANGELOG entry, template example, plugin version bump). The source-code dimension was complete; the documentation dimension was invisible. The finish-flow forcing function could not recover this — it enforces closing discipline, not scope completeness. This is a different failure mode that belongs at the `intent` node, not at `finish`.

## Why Version Sync Verification and Credit / Attribution exist

The v2.2.0 `think-tank-dialectic` release walked the dimensions checklist correctly but still had two near-misses: (1) `marketplace.json`'s version bump was missed because the audit was walked from memory instead of grepping the old version string, so the edit list forgot one of the two version files; (2) the README's `Inspired By` section was not updated to credit the two source repos (`agora`, `council-of-high-intelligence`) because the dimensions checklist had no row for attribution at all. Both failures share a root cause: the audit was *enumerated* rather than *grepped*. The two new rows make grep the default for version bumps, and add attribution as a first-class dimension whenever external prior art is absorbed.
