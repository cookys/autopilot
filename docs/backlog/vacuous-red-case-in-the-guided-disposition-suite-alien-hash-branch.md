# Vacuous red case in the guided-disposition suite (alien-hash branch)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: Next touch of `scripts/build-profile-payload.js` guided-compatibility validation, or when adding any new disposition error code.
- **Context**: Mutation-tested 2026-08-18: deleting the `required === 0` branch at `scripts/build-profile-payload.js:478-483` leaves `hooks/tests/profile-guided-dispositions.test.sh:114-117` **GREEN** — the mutant survives. When `required === 0`, `shortfall = 0 - current ≤ 0` always falls through to the next branch, which emits the *same* `PROFILE_GUIDED_DISPOSITION_DEAD` token the test asserts, so the assertion cannot distinguish the two failure modes. The other four gate branches were mutation-killed. Fix: give the branches distinct codes (e.g. `..._NOT_IN_BASELINE` vs `..._STILL_PRESENT`) and assert the distinct one. Pre-existing — both the branch structure and the assertion predate v2.34.19.
- **Effort**: Fix
- **Source**: v2.34.19 pre-merge review mutation pass (autopilot:reviewer, 2026-08-18).

