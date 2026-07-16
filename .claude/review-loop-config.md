# Review-Loop Config — autopilot (self-hosting)

> Dogfood config consumed by `scripts/resolve-review-loop.sh` (precedence slot 3).
> Delta vs the shipped template: the risk-tiered low-risk reviewer overlay.
>
> 2026-07-13 calibration (scorecard event 58, expires 2026-10-11): `gpt-5.6-sol @ high`
> known-bad 12/12, false-pass-critical 0, clean-set 9/10 (one defensible Minor),
> ~10s/case vs minutes for gpt-5.5 xhigh — adopted for LOW-RISK loop reviews only.
> High risk (protected paths / security surface / large diffs) stays on the incumbent
> `gpt-5.5 xhigh`: the known-bad corpus measures catch, not honesty-under-pressure
> (METR eval-awareness findings on sol), so promotion to high-risk duty needs live
> low-risk round history first. Revisit at scorecard expiry.

## Settings

- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: codex
- reviewer_engine_low_risk: gpt-5.6-sol
- reviewer_effort_low_risk: high
- on_family_conflict: fallback
- reviewer_fallback_preference: claude-opus
- reviewer_fallback_preference_low_risk: claude-haiku
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
- verification_author_present: true
- verification_author_engine: MiniMax-M3
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: minimax

> Temporary repository-wide C1 authorization (2026-07-16, MiniMax-M3 recovery r5): after reviewed,
> pushed r4 terminal restoration, persistent `/l6` continuation authorizes one materially new
> current-HEAD attempt. Depth-0 root-caused the GLM rail before this selection: z.ai returns
> deterministic HTTP 529 to every Claude-CLI-shaped request while direct HTTP returns 200, so all
> four GLM author failures are one transport failure and GLM cc-shim full-author readiness is
> ABSENT (capability event 65, limited/high). The same cc-shim invocation shape against MiniMax-M3
> returned OK live (event 66, available/high). R5 therefore uses the user-authorized MiniMax-M3
> family with a materially new zero-backtick raw-stdout prompt and an extended 540-second author
> budget (r4's 300s wall was never model-attributed). All older prompts/artifacts remain
> terminal/non-replayable/non-normalizable. Because the resolver has no unit-id scope, restore
> `glm-5.2/cc-shim/high/endpoint glm` after accepted, STOP, REJECT, pre-dispatch NO-GO,
> cancellation/abandonment, inability to begin, or before C2/unrelated strict authoring. Restore
> config, dogfood expectations, and README/HANDOFF atomically through independent review.
> Permanent isolated runner fixtures remain tuple-independent.

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
