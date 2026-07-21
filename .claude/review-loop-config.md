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

<!-- 2026-07-21 live roster: Claude Code native quota is exhausted until Jul 23,
     but hetero seats are available. Grok-4.5 live-smoked OK and remains the
     implementer. MiniMax-M3 remains the calibrated reviewer (engine-qualify
     13/13 known-bad, false_pass_on_critical=0, scorecard event 9). GLM-5.2
     endpoint and cc-shim small-review shape were re-verified after the 529
     transport patch, but GLM is NOT restored as the default author seat until a
     full authoring re-drive passes. QoderCN/Qwen is now an explicit runner
     candidate (`qoderclicn`) after CLI/stdin smoke; do not make it default until
     role eval promotes it. claude-haiku/opus remain qualified fallback/qc seats,
     but Claude native is not a default roster seat while quota is exhausted. -->
- reviewer_engine: MiniMax-M3
- reviewer_effort: high
- reviewer_runner: cc-shim
- reviewer_endpoint: minimax
- reviewer_engine_low_risk:
- reviewer_effort_low_risk:
- on_family_conflict: fallback
- reviewer_fallback_preference: claude-opus
- reviewer_fallback_preference_low_risk: claude-haiku
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- verification_author_present: true
- verification_author_engine: Gemini 3.5 Flash (High)
- verification_author_runner: agy
- verification_author_effort: high
- verification_author_endpoint:

> Seat note (2026-07-21): `~/.autopilot/endpoints.env` is present and both `glm` and
> `minimax` resolve under the autopilot namespace. GLM-5.2 direct HTTP review smoke and
> GLM-5.2 cc-shim small-review smoke both returned `SHIP-AS-IS`; that is not enough to
> restore GLM as the large authoring seat. Keep Gemini/agy for verification author until
> a full GLM authoring re-drive passes.

> Transport note (updated 2026-07-21): the earlier z.ai / Claude-CLI 529 failure has a
> reported patch and the exact small review shape is live again. This does NOT by itself
> re-qualify cc-shim or GLM for large authoring payloads; authoring promotion waits for
> a full authoring re-drive.

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
