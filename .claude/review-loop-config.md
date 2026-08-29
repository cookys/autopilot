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
- verification_author_engine: GLM-5.3
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
- verification_author_endpoint: glm
<!-- 2026-08-14 使用者裁定：qc 的 codex 席 `gpt-5.5 @ xhigh` → `gpt-5.6-sol @ max`。
     模型出新版就該更新，這是維護不是繞道。實測 codex-cli 0.147.0 上
     `codex exec --model gpt-5.6-sol -c model_reasoning_effort=max` 回 OK。

     與檔頭 2026-07-13 那條註記的關係：那條管的是 **risk-tiered loop reviewer
     overlay**（`reviewer_engine_low_risk`，依 resolver 算出的 `review_risk` 選
     in-loop reviewer），front-door 明寫 `qc_panel is unaffected by this overlay`，
     所以它從來沒管過 qc 這個 terminal-only gate；reviewer 席本身也已在 8/05
     輪成 MiniMax-M3。保留該註記的實質理由供日後追溯：known-bad corpus 量的是
     catch，不是 honesty-under-pressure（METR 對 sol 的 eval-awareness 發現）。
     它被校準的檔位是 `high`；這裡用的是 `max`，比校準時更多算力。 -->
- qc_panel: gpt-5.6-sol, GLM-5.2, MiniMax-M3
- qc_panel_runners: codex, cc-shim, cc-shim
- qc_panel_efforts: max, high, high
- qc_panel_endpoints: @none, glm, minimax
- qc_panel_aggregation: union-on-verified-critical
- provider_readiness_receipt_ttl_seconds: 300
- provider_readiness_fallback_family_constraint: different
<!-- brain_seat_identity_file (2026-08-17, qualification-cli-transport): pinned
     incumbent depth-0 identity for the P7 rail + readiness three-state. The file
     is EXACTLY the 12-field capability-identity object (identity_hash =
     sha256(canonicalJson(file))). Derivations (recorded this time — the earlier
     roster run left its fingerprint recipes unrecorded):
     - prompt_config_hash = sha256 of BRAIN_SYSTEM_PROMPT in
       scripts/qualification-review-provider.js (exam-facing prompt surface;
       same convention the GLM reviewer run used for its SYSTEM_PROMPT).
     - harness_version = engine-qualify-<first8 sha256(scripts/engine-qualify.js)>.
     - semantic_fingerprint = sha256(canonicalJson({kind:
       'brain-seat-semantic-surface-v1', model:'claude-fable-5',
       transport:'claude-cli-headless-no-tools', setting_sources:'project'})).
     - containment_fingerprint = sha256(canonicalJson({kind:
       'brain-seat-containment-surface-v2', exam_transport:
       'qualification-case-broker-networkless-bwrap', cli_posture:
       'claude -p --setting-sources-empty --strict-mcp-config --tools-empty',
       credential_isolation:'dedicated-exam-config-dir-credentials-only'})).
       (v1 used --setting-sources project; the hardening round made the exam
       child hermetic — probed on claude 2.1.233 — and the sittings 1-2
       identities keep their recorded v1 value.)
     - harness_version engine-qualify-9e7befef (VA suite + its review-round repairs
       landed in v2.34.17; the dogfood administration recorded 56535d6b at its
       own sit time; earlier pins:
       v2.34.17; the --version-source flag round recorded 0a2f112f; sittings
       1-2 recorded e9eb3890).
       CLI-transport administrations from here on pass
       --version-source operator-asserted.
     Effort 'default': claude -p exposes no effort control; the seat runs the
     model default. Re-pin prompt_config_hash + harness_version when the brain
     prompt or engine-qualify.js changes AND the seat re-sits — the identity file
     records the SEATED deployment, not the repo tip.
     Prompt-hash history: af99c673… (sitting 1 2026-08-17, FAILED — diagnosis
     attributed 勤勞/收斂 to prompt teaching defects: no incremental-flag
     semantics, no 12-round horizon; 公平 was a REAL seat miss) → f9e2d8b6…
     (sitting 2 2026-08-17, FAILED — re-report and hard-fails went to ZERO,
     confirming the repairs; remaining misses are stable capability signal:
     plants 4/5 + fairness content 3/4 in BOTH trials, plus a third teaching
     defect — final-round conflict between the legal full-suite and
     declare_done, both trials spent round 12 on the full-suite) → 718e1f4f…
     (final-round conflict resolution taught; never administered) → 5feb7076…
     (pre-merge review round: full-suite action ids disambiguated — the
     production contract already forbids full-suite reverify. NOT yet
     administered — no further sitting this session: two independent seeds put
     the same subjects at the same margins, so a third sitting would be
     selecting on noise, which the exam design forbids. The incumbent seat
     stays on Board 2026-08-16 advisory bootstrap semantics with readiness
     annotating no_record; both FAIL rows stand untouched, store events 3
     and 4. The provider test suite pins sha256(BRAIN_SYSTEM_PROMPT) to this
     file's prompt_config_hash — a prompt edit fails the suite until identity
     and honesty are re-reviewed together). -->
- brain_seat_identity_file: .claude/brain-seat-identity.json

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
