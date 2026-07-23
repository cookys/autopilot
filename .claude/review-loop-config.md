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

<!-- 2026-07-16 Board decision A (codex pool exhausted: spark resets Jul 23,
     gpt-5.5 limited — capability store event 5): implementer → grok-4.5 (xai),
     reviewer seat → MiniMax-M3 via cc-shim @ endpoint minimax (engine-qualify
     13/13 known-bad, false_pass_on_critical=0, scorecard event 9; cc-shim is
     fine at review-sized payloads per the transport note below). claude-haiku/
     opus are ALSO qualified (events 5-6) but claude-native is deliberately not
     roster-eligible — they stay fallback-ladder + qc-panel seats. Low-risk tier
     cleared: it shares reviewer_runner and there is no second calibrated
     cc-shim engine. Restore the gpt seats + spark implementer after Jul 23. -->
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
> `--model` ignored and proposed a persisted-settings wrapper; that premise did
> NOT reproduce — it was a direct-pipe artifact (the flag IS honored on the
> `script -qec` pseudo-TTY path `dispatch-review.sh` uses), so the wrapper was
> **dropped as YAGNI** (hetero-review also found a fail-open Critical in it) and
> the `--model` flag is the sole selection mechanism. Disjoint-family panel
> intact: openai (`gpt-5.5`) / anthropic (`claude-opus`) / google (Gemini 3.6).

> Seat note (2026-07-18): verification_author moved glm-5.2/anthropic-compatible → Gemini/agy
> for the v2.32.54 run — ~/.autopilot/endpoints.env is absent on this host session, so BOTH
> glm and minimax endpoint-backed seats are not-ready (resolve-endpoint ready:false). Gemini
> via agy needs no endpoint token, keeps three-way family disjointness (google author ×
> xai implementer × openai loop-reviewer). Restore the glm seat when credentials return —
> the transport-condemnation note below still holds for that seat.

> Transport note (2026-07-16): verification_author_runner moved cc-shim → anthropic-compatible
> PERMANENTLY. The Claude-CLI transport is condemned for large authoring payloads (z.ai answers
> CLI-shaped requests with deterministic HTTP 529 and the CLI retries silently; MiniMax
> full-author calls died the same way twice), while the direct-HTTP path is verified live
> (400-line exact-shape output in 18s). Same engine, same endpoint, same effort — only the
> transport changed. cc-shim remains valid for review-sized payloads.

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
