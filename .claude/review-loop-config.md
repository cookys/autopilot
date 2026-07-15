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
- verification_author_engine: grok-4.5
- verification_author_runner: grok
- verification_author_effort: high
- verification_author_endpoint:

> Temporary repository-wide C1 authorization (2026-07-16): after live capability event 44 confirmed
> Grok 4.5 had returned, the user explicitly rejected stopping the active `/l6` run. This tracked
> roster change is the authorization path; isolated/manual tuple overrides remain prohibited. Because
> the resolver has no unit-id scope, restore the prior `glm-5.2/cc-shim/high/endpoint glm` tuple
> immediately after C1 reaches accepted, STOP, REJECT, or pre-dispatch NO-GO, or if this authorized
> attempt is cancelled, abandoned, or cannot begin. The reviewed restoration is atomic: restore this
> config, its resolver-test expectations, and the project README/HANDOFF lifecycle record before C2
> or any unrelated strict `/l6` author dispatch. `high` is roster provenance only on the Grok path;
> dispatch-author's
> Grok branch does not pass an effort flag to the CLI.

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
