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
- verification_author_engine: Gemini 3.1 Pro (High)
- verification_author_runner: agy
- verification_author_effort: high
- verification_author_endpoint:

> Temporary repository-wide C1 authorization (2026-07-16): the user previously authorized AGY
> Gemini 3.1 Pro, the active `/l6` continuation requires automatic recovery, and fresh live event 48
> confirmed `Gemini 3.1 Pro (High)` available. This tracked roster change is the only authorization
> path; old Gemini prompts and isolated/manual tuple overrides remain prohibited. Because the resolver
> has no unit-id scope, restore `glm-5.2/cc-shim/high/endpoint glm` after accepted, STOP, REJECT,
> pre-dispatch NO-GO, cancellation/abandonment, or inability to begin. Restore this config, dogfood
> resolver expectations, and README/HANDOFF lifecycle record atomically through review before C2 or
> unrelated strict `/l6` authoring. The isolated AGY regression fixture is permanent and tuple-local.

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
