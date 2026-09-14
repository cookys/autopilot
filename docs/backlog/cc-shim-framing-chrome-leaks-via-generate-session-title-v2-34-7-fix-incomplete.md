# cc-shim framing chrome leaks via `generate_session_title` (v2.34.7 fix incomplete)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: Next touch of `dispatch-review.sh`'s cc-shim launcher, or the next `no_verdict` whose raw log shows an intact nonce block behind CC chrome.
- **Context**: 2026-08-18 P1 review (MiniMax-M3, cc-shim): parser returned `no_verdict` / "response did not start with the expected wrapped block" because Claude Code prepended `[claude-code:unrecognized_model] {"query_source":"generate_session_title"}` ahead of an INTACT `<<<AUTOPILOT-REVIEW-…>>>` block carrying a full SHIP-AS-IS verdict. Same family as the v2.34.7 reviewer-transport-framing incident — that fix suppressed the unknown-model notice at the main-query launch env, but the session-title generator path is not covered. Fix at the launch env (e.g. disable title generation in headless shim runs) rather than relaxing the parser (prompt-echo hole, v2.34.7 rationale). Verdict was recovered manually from raw log (`docs/plans/evidence/2026-08-18-dev-flow-contract-card/p1-review-raw.log`).
- **Effort**: Fix
- **Source**: 2026-08-18 dev-flow-contract-card P1 review round.

