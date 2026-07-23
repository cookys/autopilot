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
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: glm
- qc_panel: gpt-5.5, claude-opus, Gemini 3.6 Flash (High)
- qc_panel_aggregation: union-on-verified-critical

> **Gemini slot pinned to `Gemini 3.6 Flash (High)` (2026-07-23).** Previously
> this config omitted `qc_panel`, inheriting the template default whose Google
> member `gemini-flash` dispatches an *implicit* Gemini 3.5 Flash. The slot is
> now explicit at 3.6 on reviewer-qualification evidence:
> - 2-pass `evals/known-bad/` reverification through the real agy path
>   (`panel-cmd-dispatch.sh agy "Gemini 3.6 Flash (High)"` → `dispatch-review.sh`
>   `--runner agy`): **both rounds 12/13 (sensitivity 0.923),
>   false-pass-on-critical 0/9**. The single miss is `13-runstree-cycle-drop`
>   (Major, not Critical), stable across both rounds.
> - `evals/clean/` specificity: **0/11 over-flags** (no clean diff wrongly
>   FIX-THEN-SHIP'd).
> - For comparison the incumbent 3.5 Flash scored 11/13 on the same corpus
>   (missed a Critical, `06-removed-test-assertion`), so 3.6 is a strict catch
>   upgrade for this seat.
>
> **Selection mechanism:** `dispatch-review.sh --runner agy` passes
> `agy -p --model "Gemini 3.6 Flash (High)"`, which is HONORED on the installed
> agy 1.1.5 (2026-07-23 controlled matrix: `--model` overrides the persisted
> settings.json model for display-names AND slugs — see
> `docs/upstream-bugs/agy-print-mode-model-flag.md`). An earlier spike reported
> `--model` ignored and drove this via a persisted-settings wrapper; that no
> longer reproduces (likely a since-superseded agy build). The wrapper survives
> as an OPT-IN safety net (`AUTOPILOT_AGY_PERSIST_MODEL=1`, `scripts/with-agy-model.sh`)
> for a future agy regression, not the default path. Disjoint-family panel intact:
> openai (`gpt-5.5`) / anthropic (`claude-opus`) / google (Gemini 3.6).

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
