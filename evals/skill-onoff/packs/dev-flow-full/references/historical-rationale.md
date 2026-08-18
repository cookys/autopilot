# Historical Rationale

This document compiles historical rationales and dated incident storytelling that support the development flow rules and gates.

## Why L-1.6 exists

On 2026-04-11, `reconnect-regression-fix` ran the full fix workflow against `src/network/`, `src/lobby/`, and E2E tests without invoking `twgs-network` / `twgs-debug` / other project skills. The existing "gate 6: Skill routing" bullet in L-size Full Gates (Phase 1 Session Start, line ~65) is passive markdown and got mentally compressed into "I know this area" — the same failure mode that L-5 hit before `finish-flow` replaced it. This active TaskCreate applies the identical passive→active pattern that worked for L-5. Missing `twgs-*` skill invocations don't produce immediate bugs, but they systematically waste the knowledge base the project has invested in.

## Why the L-1.5 Scope Completeness Audit exists

On 2026-04-11, the `dev-flow-l5-enforcement` project shipped the new `finish-flow` skill but initially missed the autopilot-side user-facing surface (README skill count, CHANGELOG entry, template example, plugin version bump). The source-code dimension was complete; the documentation dimension was invisible. The finish-flow forcing function could not recover this — it enforces closing discipline, not scope completeness. This is a different failure mode that belongs at L-1, not L-5.

## Why Version Sync Verification and Credit / Attribution exist

The v2.2.0 `think-tank-dialectic` release walked the dimensions checklist correctly but still had two near-misses: (1) `marketplace.json`'s version bump was missed because the audit was walked from memory instead of grepping the old version string, so the edit list forgot one of the two version files; (2) the README's `Inspired By` section was not updated to credit the two source repos (`agora`, `council-of-high-intelligence`) because the dimensions checklist had no row for attribution at all. Both failures share a root cause: the audit was *enumerated* rather than *grepped*. The two new rows make grep the default for version bumps, and add attribution as a first-class dimension whenever external prior art is absorbed.
