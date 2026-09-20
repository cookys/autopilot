# Rubric — 2026-09-12-bounded-campaign-marker-gate.md

> Source plan: docs/plans/2026-09-12-bounded-campaign-marker-gate.md

R1: This is a SUPERSESSION of the rule asserted by 8d7e61c2 on 2026-07-28 and must be recorded as one, in the commit message and at the code anchor, so no later reader finds a stale absolute.
R2: `hooks/tests/dispatch-hetero.test.sh:966-979` is rewritten under a name stating the new rule, never deleted and never left asserting the old one.
R3: The predicate is `campaignCarriesMissionProjection` from `scripts/session-mode.js`, reused — not reimplemented in shell. Two implementations of one predicate is the origin of this defect.
R4: The skip requires ALL THREE of contract, sha256 and seal. Any one alone must not reach it.
R5: Bare dispatch with no `--campaign-contract` stays gated with the unchanged string, asserted.
R6: `check_marker_campaign_admission_bridge` is untouched and still refuses a strict campaign under a stale-digest marker, asserted as its own case. A diff touching the bridge fails this plan.
R7: `check_mission_enforcement_gate` is untouched.
R8: The green case must assert the dispatcher was actually CALLED (a capture stub file exists), not merely that the exit code changed. An exit 0 reached by a different early return satisfies nothing.
R9: Codex mirror parity: the same change lands in `platforms/codex/plugin/scripts/dispatch-hetero.sh` and `sync-codex-plugin-skills.sh --check` exits 0.
R10: ADR-0001 binding — the sealed contract is authority because it is independently re-derivable (digest recomputed from bytes), not because a seal asserts it.
R11: RISK — the skip is placed so that it also bypasses the bridge or the mission enforcement gate. Mitigation is R6 and its dedicated test case; reviewers must attack the placement specifically.
R12: RISK — the fix is written as a bug fix and the 2026-07-28 decision is silently overwritten, so the next session re-reverses it. Mitigation is R1.
R13: RISK — a bounded contract becomes a general bypass for any caller wanting to dodge the marker. Mitigation: the seal and digest are verified before the skip is consulted, and this ordering must be asserted, not assumed.
R14: Version bump is PATCH; CHANGELOG entry required, naming the supersession.
R15: No new severity vocabulary.
