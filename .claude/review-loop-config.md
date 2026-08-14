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

<!-- 2026-08-05 quota rotation: Claude Code native is unavailable, so this
     managed L5 campaign uses the live-smoked hetero seats instead. Grok-4.5
     remains the implementer; MiniMax-M3 remains the calibrated reviewer;
     GLM-5.2 is the verification-author and one QC seat; the other QC seats are
     MiniMax-M3 and Codex gpt-5.5. This is an operational roster rotation only;
     restore the normal Claude/agy seats after quota recovery and re-probe them. -->
- reviewer_engine: MiniMax-M3
- reviewer_effort: high
- reviewer_runner: cc-shim
- reviewer_endpoint: minimax
- reviewer_limitation: minimax-false-central-claim-5-of-6
- reviewer_limitation_required: true
- reviewer_engine_low_risk:
- reviewer_effort_low_risk:
- on_family_conflict: fallback
- reviewer_fallback_preference: GLM-5.2
- reviewer_fallback_preference_low_risk: GLM-5.2
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- verification_author_present: true
- verification_author_engine: GLM-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: glm
- qc_panel: gpt-5.5, GLM-5.2, MiniMax-M3
- qc_panel_runners: codex, cc-shim, cc-shim
- qc_panel_efforts: xhigh, high, high
- qc_panel_endpoints: @none, glm, minimax
- qc_panel_aggregation: union-on-verified-critical
- provider_readiness_receipt_ttl_seconds: 300
- provider_readiness_fallback_family_constraint: different

> **Previous Gemini slot (temporarily suspended 2026-08-05).** The normal
> `Gemini 3.6 Flash (High)` QC seat is restored only after quota recovery and a
> fresh strict provider probe; it is intentionally not silently treated as ready
> during this quota rotation.

> **Historical Gemini slot pinned to `Gemini 3.6 Flash (High)` (2026-07-23).** Previously
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

> Seat note (2026-07-21): `~/.autopilot/endpoints.env` is present and both `glm` and
> `minimax` resolve under the autopilot namespace. GLM-5.2 direct HTTP review smoke and
> GLM-5.2 cc-shim small-review smoke both returned `SHIP-AS-IS`; that is not enough to
> restore GLM as the large authoring seat. Keep Gemini/agy for verification author until
> a full GLM authoring re-drive passes.

> Transport note (updated 2026-07-21): the earlier z.ai / Claude-CLI 529 failure has a
> reported patch and the exact small review shape is live again. This does NOT by itself
> re-qualify cc-shim or GLM for large authoring payloads; authoring promotion waits for
> a full authoring re-drive.

> Reviewer limitation (2026-07-31): the current MiniMax diff-only seat produced false
> central claims in 5 of 6 recorded observations. This is calibration telemetry, not
> authority or a demotion by itself. The resolver requires the machine-readable
> `reviewer_limitation` tag above unconditionally for this exact tuple and surfaces the
> limitation as a diagnostic; `reviewer_limitation_required` remains compatibility
> metadata only and cannot weaken the guard. Independent verification remains required.

> Fallback preference rationale (2026-07-14): with an openai implementer BOTH
> roster reviewers (gpt-5.5, sol) hit the family gate, so the in-loop reviewer
> comes from the cross-family ladder. High risk → claude-opus @ claude-native
> (qualified 2026-07-14: known-bad 12/12, clean 10/11, expires 2026-10-12);
> low risk → claude-haiku (calibrated cheap leg — ~10s rounds). Without the
> preference lists, alphabetical ladder order would put haiku on high-risk
> duty, which is too weak for that seat.
