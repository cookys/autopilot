# Review-Loop Config (generation-adversarial heterogeneous pipeline)

Per-project engine roster + loop policy for the `/l5`-style pipeline:

> subagent writes plan/acceptance → **decorrelated reviewer** low loop-to-convergence
> → **heterogeneous implementer** → reviewer low loop + depth-0 adversarial harness
> → qc-gate subagent.

This file turns that hand-typed prompt into **data**: it is the roster, and `/l5` reads it
instead of you re-typing it. Do not copy it into a project: a project's
`.claude/review-loop-config.md` is a stub that follows this roster, plus override blocks
(see "Roster" below) for the groups that truly differ.
Resolved by [`scripts/resolve-review-loop.sh`](../scripts/resolve-review-loop.sh)
(same precedence chain as `resolve-qc-gate.sh` / `resolve-doa.sh`).

The point is **decorrelation**: the GENERATOR (a Claude subagent / the hetero
implementer) and the REVIEWER are DIFFERENT engines, so their failure modes don't
correlate — the reviewer catches what the generator's own green tests miss
([[feedback_delegate-selftest-false-green]]). `/l5`'s default qc is homogeneous
Claude; set `reviewer_engine` here to make the review heterogeneous too.

> **Verifier isolation (MUST).** Decorrelation only holds if the reviewer/qc panel is fed
> **artifacts** (diff, files, test output) + the **original** task/plan — **never** the
> implementer's self-report, summary, or self-verdict. A reviewer anchored by the implementer's
> account converges to confidently-wrong (hallucination cascade), collapsing the whole point of a
> different engine. The `dispatch-review.sh` reviewer path enforces this structurally (diff-text
> only). Canonical rule: [`references/blind-dispatch.md`](../references/blind-dispatch.md)
> § "Verifier isolation".

## Roster

This file is the only roster. `scripts/resolve-review-loop.sh` reads the seat fields under
Settings below and overlays a repo `.claude/review-loop-config.md` on top. A repo file holds seat
fields only inside an override block: a declaration line of the shape
`- override: <group> | until YYYY-MM-DD | <reason>`, followed by that group's whole field set
(for `reviewer`: engine, runner, effort and the rest of its fields, each written as
`- reviewer_engine: value` and so on). The block replaces the roster's group as a whole.

The groups are `reviewer`, `implementer`, `verification_author`, `qc_panel`, `consult`, `discuss`,
`plan_reviewer`, `plan_deep_reviewer`. A repo file with seat fields outside an override block
is refused by the resolver (exit 3). Non-seat knobs (`loop_max_rounds` and the like) are written
in the repo file as before, or left out to follow this file.

### Roster changelog

Every roster change adds a block here: date, reason, who ruled.

**2026-11-11.** Local implementer seats always sandboxed, PM 01M748P8G8.

* A cc-shim implementer whose endpoint is listed in `scripts/lib/local-sandbox-endpoints.json` (today `qwen_local`) is dispatched with `--sandbox bwrap` and `--worktree-parent`. `dispatch-hetero.sh` refuses that seat without `--sandbox bwrap` before any model call (`boundary_code` `local_implementer_sandbox_required`). Reviewer and consult seats are unchanged. No local DeepSeek endpoint name is registered yet.

**2026-11-11.** The agy default moves from gemini-4-argon to gemini-4-carbon. Local smoke only (`docs/plans/evidence/2026-11-11-agy-carbon-smoke/`). Carbon is not written into the official qualification defaults.

* The `gemini-flash` alias and the terminal `qc_panel` google seat are `gemini-4-carbon-high`. Reviewer, plan-review and consult seats that use this agy default stay on the high tier.
* An empty `reviewer_cloud_fallback_rung` on an agy `gemini-4-carbon-*` reviewer is filled with `gemini-4-argon-<same tier>/<tier>@agy`, and an empty `reviewer_on_engine_unavailable` becomes `cloud-fallback`. That same-tier pair is the one same-family exception. The qwen reviewer's rung stays `gpt-6.1-sol/high@codex`.
* `scripts/dispatch-hetero.sh` default model is `gemini-4-carbon-low`. An agy implementer whose engine is `gemini-4-carbon-*` and whose `implementer_ladder` is empty gets that id as rung 0 and `gemini-4-argon-<same tier>` as rung 1 (the existing ladder climb). The roster implementer stays `gpt-6.1-sol`.

**2026-11-10.** The qwen reviewer seat retreats to a cloud seat when `qwen_local` is down or busy, and returns when the endpoint answers again. Ruled by the PM (fleet 01M726SXVB).

* Reason: c4140 qwen planned downtime 16:05–18:40 +08. Only the reviewer seat. The global `on_engine_unavailable` stays `ask`, and every other seat is unchanged.
* `reviewer_on_engine_unavailable: cloud-fallback` and `reviewer_cloud_fallback_rung: gpt-6.1-sol/high@codex`. `dispatch-review.sh` pre-probes the reviewer's endpoint (the same `endpoint-probe.sh` the consult seat uses) and retreats once. A later probe that lists the model dispatches to `qwen_local` again and writes no second `cloud-fallbacks.jsonl` row.
* Empty `reviewer_on_engine_unavailable` follows the global policy. A repo reviewer override that omits the two keys drops them with the rest of the group.

**2026-11-09 (re-qualified).** GLM-5.3 is back on the terminal `qc_panel` after gpt-6.1-sol, as runner `anthropic-compatible`, endpoint `glm`, effort high: re-qualified 2026-11-09 (cloud, anthropic-compatible, 42/42, event 357/524), back per PM 01M6YTKCKJ. `reviewer_fallback_preference` and its low-risk twin are `gpt-6.1-sol, GLM-5.3`. A seat whose endpoint has no URL and no token on the account is skipped with reason `endpoint_not_configured`, not counted as a gap.

**2026-11-09 (later).** GLM-5.3 comes off every review seat. Ruled by the PM (fleet 01M6YNHCJ5).

* Reason: GLM-5.3 has no qualified reviewer record (`engine-scorecard seat-status --engine GLM-5.3 --runner cc-shim --role reviewer --effort high` gives `admission_status no_record`), and gpu-lead reports it failed the reviewer exam.
* Terminal `qc_panel` is now gpt-6-astra, gpt-6.1-sol, gemini-4-argon-high (three seats, still meets `min_panel_size` 3). `reviewer_fallback_preference` and its low-risk twin are `gpt-6.1-sol` alone.
* The `glm` endpoint and GLM as implementer or other non-review role are unchanged.

**2026-11-09.** The loop reviewer seat moves from GLM-5.3 to the local qwen. Ruled by the PM (fleet 01M6XM5Y).

* New loop reviewer: `Qwen3.8-27B-QUASAR-NVFP4`, runner `anthropic-compatible` (HTTP), endpoint `qwen_local`
  (the same local server as the implementer canary), effort `default`. This is exactly the qualified row the
  exam recorded: scorecard event_id 15, evidence_id
  `45d2727dc900272c80eb31524b388426fb84778ed03aa485cc1dfd07e7359ef7`, reviewer corpus 42/42, 0 critical
  false pass, specificity 0/38 false alarms, thinking plus json_schema, 2 repeated trials.
* Fallback order when the family check rejects the seat (it shares the implementer's family during the
  canary): `reviewer_fallback_preference` is now `GLM-5.3, gpt-6.1-sol`, so GLM is tried first and the cloud
  seat last. The family-conflict fallback only takes ladder rows on the runners `codex|agy|grok|claude-native`,
  and a `cc-shim` GLM row is not one of them, so in practice the cloud seat is the one that runs.
* "GLM as an extra seat while online" has no mechanism today: there is one loop reviewer seat, and
  `reviewer_ladder` is a substitute list, not a second parallel vote. The only multi-seat review is the
  terminal `qc_panel` (which already holds GLM-5.3). Not invented here; a follow-up would add a loop-level
  extra seat that joins only when its endpoint answers the `/models` probe.
* Known gap: `resolve-dispatch-topology.js` maps an HTTP seat to an endpoint by runner name or by a substring
  of the engine id, so `qwen_local` never matches `Qwen3.8-27B-QUASAR-NVFP4`; the qwen reviewer row does not
  appear in the derived `reviewer_ladder`. The primary seat is declared above and does not depend on it.

**2026-11-08.** Review-seat wiring for three families (PM fleet 01M6W6QAVQ and 01M6W6S85M, part A). The
ladders are DERIVED, not listed: `scripts/resolve-dispatch-topology.js` builds `reviewer_ladder` and
`plan_review_panel` from scorecard rows that are qualified for the role, whose runner is installed (an HTTP
runner: whose endpoint env is set). So "registering" a seat means (a) the right runner and endpoint wiring
below and (b) a qualified row for that exact `engine + runner + effort`. Ids are written as the roster and
the shipped defaults write them; no aliases.

* GLM-5.3: runner `cc-shim`, endpoint `glm`, effort high (the terminal-panel seat above). Env names:
  `AUTOPILOT_ENDPOINT_GLM_URL`, `AUTOPILOT_ENDPOINT_GLM_TOKEN` (optional `AUTOPILOT_ENDPOINT_GLM_TRANSPORT`).
  `dispatch-author.sh` / `dispatch-review.sh` export them to the `claude` child as `ANTHROPIC_BASE_URL` and
  `ANTHROPIC_AUTH_TOKEN`; nothing else is set by hand. Shipped reviewer rows are on runner
  `anthropic-compatible` (HTTP, same endpoint, effort low and high, qualified); a `cc-shim` reviewer row is
  not shipped, only the implementer one, so the cc-shim reviewer seat needs its own exam or an adopted row.
* MiniMax-M3.1-Flash: runner `cc-shim`, endpoint `minimax`. Env names: `AUTOPILOT_ENDPOINT_MINIMAX_URL`,
  `AUTOPILOT_ENDPOINT_MINIMAX_TOKEN`, or the provider-native pair `AUTOPILOT_MINIMAX_BASE_URL` (optional) and
  `MINIMAX_API_KEY` (`resolve-endpoint.sh` order). Shipped rows: implementer qualified; the reviewer rows for
  `MiniMax-M3.1-Flash-Preview` FAILED, and there is no reviewer row for `MiniMax-M3.1-Flash`, so it enters
  `reviewer_ladder` only after a reviewer exam passes.
* kimi-code/k3.1-pro: runner `kimi`, no endpoint, no env var. The binary is `kimi` on PATH, else
  `~/.kimi-code/bin/kimi` (`scripts/lib/runner-fallback-bin.sh`). Shipped rows: consult, discuss, owner,
  implementer and verification_author qualified; `kimi-code-k3` and `kimi-k2.8-preview` are the reviewer-
  qualified kimi ids, `kimi-code/k3.1-pro` has no reviewer row yet. `kimi` is now panel-eligible, so its
  consult row joins `plan_review_panel` as a non-chair seat today, and its reviewer row would join the
  `reviewer_ladder` the same way.
* opencode: runner `opencode`, ids `opencode-go/<model>`, no endpoint. It stays OUT of `plan_review_panel`
  because `dispatch-author.sh` (the plan-review transport) has no opencode branch.
* Runner binaries: `codex` and `agy` under `~/.local/bin`, `grok` under `~/.grok/bin` (and `~/.local/bin`) are
  found after PATH misses; PATH, and so a test sentinel dir, always wins.
* Plan-review fallback: a seat with no fallbacks gets up to two from the topology (a family no primary seat
  uses, never the implementer's runner). A missing runner binary now counts as the seat being unavailable, so
  that fallback takes over instead of the panel ending on a precondition.

**2026-11-06.** The roster became the single source, and its values are the seats running now.
Ruled by the PM (Q1 of the roster-single-source design, go 2026-11-06).

* The terminal panel is gpt-6-astra (codex, low), gpt-6.1-sol (codex, medium), gemini-4-argon-high
  (agy, high) and GLM-5.3 (cc-shim, endpoint glm, high). Runner and effort per seat come from the
  four-seat command in daily use (`collect-gen-55.sh`: sol medium, GLM high, astra low, argon high).
  `min_panel_size` stays 3 as before.
* The loop reviewer was GLM-5.3 on cc-shim (endpoint glm, high; replaced on 2026-11-09, see above) with fallback preference gpt-6.1-sol,
  which is the state of autopilot's own config after commit 3859a85b4 dropped MiniMax-M3.
* The verification author is Qwen3.8-Max on qoderclicn, high: the seat autopilot's own config gives
  strict /l5 today.
* The implementer and every other field are unchanged from the previous template.

## Settings

- reviewer_engine: Qwen3.8-27B-QUASAR-NVFP4
- reviewer_effort: default
- reviewer_runner: anthropic-compatible
- reviewer_endpoint: qwen_local
- reviewer_on_engine_unavailable: cloud-fallback
- reviewer_cloud_fallback_rung: gpt-6.1-sol/high@codex
- reviewer_limitation:
- reviewer_limitation_required: false
- reviewer_engine_low_risk:
- reviewer_effort_low_risk:
- implementer_engine: gpt-6.1-sol
- implementer_effort: high
- implementer_runner: auto
- implementer_ladder: auto
- ladder_start_rung_judgment: 0
- implementer_endpoint:
- verification_author_present: true
- verification_author_engine: Qwen3.8-Max
- verification_author_runner: qoderclicn
- verification_author_effort: high
- verification_author_endpoint:
- on_engine_unavailable: ask
- cloud_fallback_rung:
- on_family_conflict: fallback
- review_fresh_context: on
- reviewer_fallback_preference: gpt-6.1-sol, GLM-5.3
- reviewer_fallback_preference_low_risk: gpt-6.1-sol, GLM-5.3
- loop_max_rounds: 5
- loop_convergence_verdict: SHIP-AS-IS
- spec_review: on
- independent_harness: on
- qc_panel: gpt-6-astra, gpt-6.1-sol, GLM-5.3, gemini-4-carbon-high
- qc_panel_runners: codex, codex, anthropic-compatible, agy
- qc_panel_efforts: low, medium, high, high
- qc_panel_endpoints: @none, @none, glm, @none
- review_packet_deny_extra:
- qc_panel_aggregation: union-on-verified-critical
<!-- in_rail_review: auto|single|panel. auto uses the sealed panel as the in-loop review station when the QC panel is complete. -->
- in_rail_review: auto
- provider_readiness_receipt_ttl_seconds: 300
- provider_readiness_fallback_family_constraint: different
- review_diff_scope: full
- min_panel_size: 3
- density_scaling: off
- plan_review: auto
- hetero_review: auto
- consult_engine:
- consult_effort:
- consult_runner:
- consult_endpoint:
- discuss_engine:
- discuss_effort:
- discuss_runner:
- discuss_endpoint:
- consult_dispatch: auto
- discuss_dispatch: off
- unknown_escalation: auto
- unknown_budget_u1: 2
- unknown_budget_u2: 1
- unknown_budget_u3: 1
- allow_same_runner_dual_seat: off

> **The terminal qc panel** (`qc_panel`) is the authoritative depth-0 gate — a
> **disjoint-family** panel (OpenAI / Anthropic / Google), distinct from the inner-loop
> `reviewer_engine`. The point is that the count of distinct review families in the panel is >= `required_review_families` AND ≥1 panel family differs from the **implementer's**
> family, so a bug the implementer+its-family-reviewer jointly miss is caught by a different
> vendor (PoLL, arXiv 2404.18796). The resolver WARNS if the panel shares the implementer
> family (`family_of()` knows openai/anthropic/google/**xai**/**alibaba**/**minimax**/**zhipu**). Gemini joins
> read-only via `dispatch-review.sh --runner agy`, and **xAI via `--runner grok`** (put a
> `grok-build`/`grok-composer-2.5-fast` in the panel for an extra disjoint family). Aggregation is **`union-on-verified-critical`**:
> any panelist's *verified* Critical blocks; a panelist's empty/no-verdict is fail-closed (NOT a
> pass); **majority vote is forbidden** (it would suppress the single-track blind-spot catch that
> is the whole reason for a panel).
>
> **Per-role heterogeneous routing (2026-08-27).** Every seat above names its own engine,
> so "which hetero engine serves this role" is configuration, not hand-typed argv. The two
> seats added in this release are `consult` (a mid-run ad-hoc second opinion, previously
> hand-typed `dispatch-review.sh` argv) and `discuss` (heterogeneous participation in
> `think-tank` / `brainstorm`). Both default EMPTY, which is exactly the previous behaviour.
> `review` and `plan` are NOT new roles — they are the existing `reviewer_*` and
> `plan_reviewer_*` seats; point those at a different engine rather than declaring a second
> one, or you get two canonical statements of the same seat.
>
> **Routing an UNQUALIFIED engine.** A runner with no recorded role qualification (today:
> `cursor` — `src/harness/capabilities/cursor.json` is `status: unverified` / `H0`) may be
> named in any seat, but the resolver **refuses the roster (exit 3)** unless
> `$AUTOPILOT_QUALIFICATION_OVERRIDE` carries an unexpired entry matching that exact
> engine / runner / **role**:
>
> ```json
> { "schema": 1, "overrides": [ { "engine": "cursor-grok-4.6-high", "runner": "cursor",
>   "role": "reviewer", "reason": "why this is acceptable today", "operator": "who decided",
>   "expires": "2026-12-31" } ] }
> ```
>
> An admitted seat is announced on stderr as an EVIDENCE-FREE operator override and listed
> in the resolved `override_admitted_seats`. That list records a **decision**, never
> evidence of qualification — nothing downstream may read it as a scorecard. Being spellable
> in a runner enum means "the roster can name this token", not "this engine is qualified".
>
> **`allow_same_runner_dual_seat`** (default `off`) governs whether one runner may hold the
> implementer seat and a reviewer-class **loop** seat at once. Off refuses (exit 3); on permits
> it, warns on stderr, and sets `same_runner_dual_seat: true` for the run summary.
>
> It applies to **qualified engines too** — "one vendor, one auth, one server-side prompt layer
> is not decorrelation" has no qualified-engine exemption; `gpt-5.6-sol` reviewing
> `gpt-5.6-sol`'s own work is the same loss whether or not both seats are qualified.
>
> The axis is the **runner**, not the model family: one rail can serve several families (a
> single `cursor` rail hosts both grok and gpt ids), so a family test would miss exactly the
> case the rule names. The comparison is over the **configured token**, and `auto` is inert —
> it delegates the choice rather than asserting a rail. That is what keeps this template valid,
> since its `auto` implementer runner resolves to the reviewer's `codex`. An **inherited
> default does count**: a roster naming only `implementer_runner: codex` collides with the
> built-in reviewer default `codex`, because the resolved loop really does put one rail on both
> sides — name a different reviewer runner, or opt in.
>
> The terminal **`qc_panel` is not governed by this key.** A panel is a multi-seat body
> (`min_panel_size` 3, `union-on-verified-critical`, majority forbidden), so one seat sharing
> the implementer's rail still leaves independent seats that can each block alone. The panel has
> its own proportionate rule instead: only **total** overlap — every seat carrying both an
> engine and a runner sitting on the implementer's rail, so the terminal gate has no runner
> decorrelation at all — is refused (and that is openable too). **Partial** overlap is silent
> by design: the shipped panel above spans three rails on purpose, so a `codex` implementer
> overlaps exactly one seat in the recommended setup, and a warning that fires on the
> recommended setup is noise. Panel/implementer overlap is still reported at the family level
> by the pre-existing cross-family control.

> **Preset `all-calibrated`**: Setting `qc_panel` to exactly `all-calibrated` expands to the full, calibrated 5-family reviewer roster. The concrete engine list is maintained inside the resolver script (single source of truth) and covers all families with recorded reviewer calibration/spike evidence.

> **Low-risk review default (G1).** When the resolver computes `review_risk=low`, the
> `code-review` node needs one review family (`required_review_families: 1`) and the
> reviewer is a fresh-context one (no carried-over session). `review_risk=high` needs two
> distinct families. This is the resolver's built-in behavior, not a settings key: there is
> nothing to set here, and a shortfall in the families actually available still goes through
> `on_engine_unavailable`, never a silent downgrade. The family ids actually used are
> recorded on the session marker (`review_families`).

## Field reference

| Field | Meaning | Values |
|-------|---------|--------|
| `reviewer_engine` | the **decorrelated** adversarial reviewer (spec + impl loops) | a model name (e.g. `gpt-6.1-sol`); resolved via `reviewer_runner` |
| `reviewer_effort` | reviewer reasoning effort | `low\|medium\|high\|xhigh\|max` |
| `reviewer_limitation` | exact reviewer-tuple limitation tag. The `MiniMax-M3` + `cc-shim` + `minimax` tuple must use `minimax-false-central-claim-5-of-6`; the resolver warns and rejects that tuple when the tag is absent | the exact limitation tag, or empty |
| `reviewer_limitation_required` | compatibility metadata only; it cannot enable, disable, or weaken the exact MiniMax tuple guard | `true\|false` |
| `reviewer_engine_low_risk` | **risk-tiered overlay**: when BOTH `_low_risk` keys are set, the loop reviewer for computed `review_risk=low` becomes this pair (same `reviewer_runner`); `review_risk=high` ALWAYS uses `reviewer_engine`/`reviewer_effort`. Empty = tiering off. Adopt a faster engine on low-risk diffs only after it clears `engine-qualify.sh` (scorecard-first) | a model name (e.g. `gpt-5.6-sol`), or empty |
| `reviewer_effort_low_risk` | effort for the low-risk reviewer; garbage → empty (tiering off — fail-safe reviews with the stronger incumbent) | `low\|medium\|high\|xhigh\|max`, or empty |
| `on_family_conflict` | engine `reviewDiff` policy when the (effective) reviewer shares the implementer's model family: `fallback` = substitute the first cross-family QUALIFIED scorecard-ladder row (runner allowlist `codex\|agy\|grok\|claude-native`; codex rows need a calibrated `effort` on the row; ladder provenance must match the actual implementer family) so the in-loop decorrelated review actually runs; `block` = hard-block (pre-v2.32.25 behavior — for the default openai implementer + openai reviewer this means the in-loop review NEVER runs and convergence rides verify-first). Garbage → `block` (fail-closed) | `fallback` (default) \| `block` |
| `review_fresh_context` | whether a reviewer must run in a brand-new provider session. `on` = a review dispatch that would continue an existing session (a resumed session id, or the implementer's own session) is refused at dispatch with a named error; `off` = legal, but `hetero-review-loop.js finalize` stamps `review_fresh_context: "off"` into the review receipt so the waiver stays visible afterwards (the `on` receipt is unchanged). Garbage → `on` (fail-closed). The guarantee of `on` comes from the structural guard `hooks/tests/review-rail-no-session-reuse.test.sh`: the review rail has no session-resume entry (it drives each runner against a fake binary and fails on any resume/continue argument or a repeated claude `--session-id`), so there is nothing to refuse at dispatch today; if a resume entry is ever added to a review path, this key MUST refuse it at dispatch | `on` (default) \| `off` |
| `reviewer_fallback_preference` | HUMAN-ordered engine ids the family-conflict fallback prefers over raw ladder order (every candidate still passes all guards: cross-family, runner allowlist, calibrated codex effort). Empty = ladder order (alphabetical within capability ties — set this if the strongest cross-family reviewer must win the high-risk seat) | comma list of scorecard engine ids (e.g. `claude-opus, MiniMax-M3`), or empty |
| `reviewer_fallback_preference_low_risk` | preference list applied when computed `review_risk=low` (cheap calibrated leg for cheap rounds); empty = use `reviewer_fallback_preference` | comma list, or empty |
| `skill_mode` | 是否把 skill pack（選定 SKILL.md 內容）傳輸進 hetero implementer prompt（`references/hetero-dispatch.md` § Skill transport）。2026-07 A/B：reviewer 席 H2 已被推翻——implementer 席才是它的戰場；resolver 輸出 `skill_mode_requested`/`skill_mode_effective` | `off`（預設）/ `prompt-pack` |
| `reviewer_runner` | how the reviewer is invoked (→ `dispatch-review.sh --runner`) | `codex` (`codex exec`) `\| agy` (Gemini) `\| grok` (xAI; read-only) `\| qoderclicn` (QoderCN/Qwen; read-intent, explicit) `\| cc-shim` (Claude Code CLI to any Anthropic-compatible endpoint) `\| anthropic-compatible` (direct HTTP reviewer via `dispatch-anthropic-review.js`) `\| claude-native` (first-party Claude Code ambient auth) `\| kimi` (Kimi Code CLI; `kimi-code/k3`, read-only scratch cwd; prompt is ONE `-p` argv string — diff+spec above ~120 KB is refused pre-spend, kernel MAX_ARG_STRLEN 128 KiB; seat a prompt-file runner for big diffs) `\| opencode` (OpenCode CLI; `--agent plan` + scratch cwd, best-effort — see Gotchas) `\| auto` |
| `implementer_engine` | the heterogeneous implementer | a model name (e.g. `gpt-6.1-sol`, `Gemini 3.5 Flash (High)`, `grok-composer-2.5-fast`, `MiniMax-M3`) |
| `implementer_effort` | implementer reasoning effort (codex only) | `low\|medium\|high\|xhigh\|max` |
| `implementer_runner` | dispatch-hetero runner | `auto\|codex\|agy\|grok\|qoderclicn\|cc-shim\|pi\|cursor\|opencode` (→ `dispatch-hetero.sh --runner`). `auto` routes `*gpt*`/`*codex*`→codex, `*grok*`/`*composer*`→grok, `*qwen*`/`*qoder*`→fail-loud requiring explicit `qoderclicn`, else agy; **`qoderclicn`, `cc-shim`, and `pi` must be set EXPLICITLY** (see Gotchas) |
| `implementer_ladder` | optional ordered rungs `engine/effort@runner`. The literal value `auto` expands to the host topology file written by `scripts/resolve-dispatch-topology.js` (falls back to the single implicit rung + a capability warning when no topology file exists at all, OR when the file exists but its `implementer_ladder` is empty/absent — `claude_fallback_ladder` rungs, which run `claude-native`, are never expanded into `implementer_ladder` since that runner isn't a `dispatch-hetero` runner). Absent/empty = the three `implementer_*` fields are the single rung. Each auto-expanded rung is validated against the same runner enum as the comma-list form; a rung with an invalid runner exits 3 (a stale topology file must not smuggle a bad runner past the resolver). Campaign `unit_class: mechanical` and `judgment` both start at rung 0 by default now; see `ladder_start_rung_judgment`. A red repair round climbs one rung, then caps at the top and uses existing convergence adjudication. `on_engine_unavailable` is unchanged (availability only). Each runner must be a valid `implementer_runner` | comma list, e.g. `gemini-3.7-flash-low/low@agy, grok-4.6/low@grok, sonnet/medium@codex`, or `auto` |
| `ladder_start_rung_judgment` | restores the old judgment-starts-at-rung-1 behaviour when set to `1`; any other value (including absent) is `0` | `0\|1` |
| `reviewer_endpoint` | **named endpoint** for a `cc-shim`/`anthropic-compatible` REVIEWER — resolves creds via `resolve-endpoint.sh` (`AUTOPILOT_ENDPOINT_<NAME>_*`, populated from `~/.autopilot/endpoints.env`). `/l5`/`/l6` passes it as `--endpoint <name>` so you don't hand-type it. Empty = none (raw `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` env, byte-identical to before) | an endpoint name `[A-Za-z0-9_]` (e.g. `glm`, `minimax`), or empty |
| `implementer_endpoint` | same, for a `cc-shim` IMPLEMENTER (→ `dispatch-hetero.sh --endpoint`). A name in `scripts/lib/local-sandbox-endpoints.json` is always dispatched under `--sandbox bwrap` (PM 01M748P8G8). Empty = none | an endpoint name `[A-Za-z0-9_]`, or empty |
| `consult_engine` / `consult_effort` / `consult_runner` / `consult_endpoint` | the **consult** seat: a mid-run ad-hoc heterogeneous second opinion. Read by callers as `resolve-review-loop.sh --field consult_engine` (etc.) instead of hand-typing `dispatch-review.sh` argv — see `references/hetero-dispatch.md`. Tuple is wholly empty or engine+runner+effort all present. The consult seat must not equal a `qc_panel` seat (same engine+runner+effort, aliases canonicalized): a declared seat that does exits 3, and the `sonnet/high@claude-native` fallback that coincides with one is kept but adds a `capability_warnings` line | engine name / `low\|medium\|high\|xhigh\|max` / any reviewer runner incl. `cursor` / endpoint name, all optionally empty |
| `discuss_engine` / `discuss_effort` / `discuss_runner` / `discuss_endpoint` | the **discuss** seat: heterogeneous participation in `think-tank`. Consumed by `scripts/dispatch-discuss.js` (plan `2026-08-28-consult-discuss-qualification.md` D9), called unconditionally from `skills/think-tank/SKILL.md` Step 3.5 — the wrapper itself resolves `discuss_dispatch` and refuses when the seat is off or unqualified. `brainstorm` is not wired (backlog candidate). Same tuple rule | as above |
| `plan_review` | first-class bounded plan-readiness rail: `off` ⇒ stage skipped, opt-out receipt + `capability_warnings` line; `on` ⇒ explicit tuple required (incomplete ⇒ exit 3); `auto` (new default) with ≥1 qualified topology seat for the role ⇒ tuple expanded from `~/.autopilot/topology.json`, `plan_review_resolved_from: topology`; `auto` with an absent/malformed/zero-seat topology ⇒ native fallback (`opus/high@claude-native` for plan and hetero review, `sonnet/high@claude-native` for consult), `plan_review_resolved_from: native-fallback` plus a `capability_warnings` line, and the knob's own value stays the literal `auto` (never rewritten) | `auto\|on\|off` (default `auto`) |
| `plan_review_allow_native_fallback` | whether a plan-review roster query may proceed on the single-family fallback. `off` (default) ⇒ with `plan_review: auto`, when no plan-review roster resolves (topology without `plan_review_panel`, or no qualified seat), `resolve-review-loop.sh --field plan_review*` / `plan_reviewer_*` / `plan_deep_reviewer_*` exits 4 and lists the qualified seats, a recommended pair and the command that writes it. Set `on` ONLY when the owner has explicitly accepted a plan review by a single family (opus@claude-native, the depth-0 family); the fallback then resolves as before with its `capability_warnings` line. | `on\|off` (default `off`) |
| `hetero_review` | per-phase code-review loop switch: `off` ⇒ stage skipped, opt-out receipt + `capability_warnings` line; `on` ⇒ explicit tuple required (incomplete ⇒ exit 3); `auto` (new default) with ≥1 qualified topology seat for the role ⇒ tuple expanded from `~/.autopilot/topology.json`, `hetero_review_resolved_from: topology`; `auto` with an absent/malformed/zero-seat topology ⇒ native fallback (`opus/high@claude-native` for plan and hetero review, `sonnet/high@claude-native` for consult), `hetero_review_resolved_from: native-fallback` plus a `capability_warnings` line, and the knob's own value stays the literal `auto` (never rewritten) | `auto\|on\|off` (default `auto`) |
| `consult_dispatch` | whether the consult rail (`scripts/dispatch-consult.sh`) is live: `off` ⇒ stage skipped, opt-out receipt + `capability_warnings` line; `on` ⇒ explicit tuple required (incomplete ⇒ exit 3); `auto` (new default) with a **fully declared** `consult_engine`/`consult_runner`/`consult_effort` ⇒ the declared seat wins over topology and native fallback (`consult_resolved_from: config-explicit`; owner ruling 2026-10-13) but still passes the `on` qualification gate (exit 3 when unqualified) and must not be a `qc_panel` seat (exit 3); `auto` with ≥1 qualified topology seat for the role ⇒ tuple expanded from `~/.autopilot/topology.json`, `consult_resolved_from: topology`; `auto` with an absent/malformed/zero-seat topology ⇒ native fallback (`opus/high@claude-native` for plan and hetero review, `sonnet/high@claude-native` for consult), `consult_resolved_from: native-fallback` plus a `capability_warnings` line, and the knob's own value stays the literal `auto` (never rewritten) | `auto\|on\|off` (default `auto`) |
| `unknown_escalation` | whether the unknown-escalation ladder (`scripts/probe-unknown.js`, plan `2026-09-07-unknown-escalation-ladder.md`) may recommend and receipt climbs. `off` ⇒ the probe recommends `none` with `reason: knob-off`, writes one knob-off `ladder` row per work unit into the decision ledger (no receipt file), and the resolver emits a `capability_warnings` line; `on` ⇒ the three `unknown_budget_u*` fields must be present non-negative integers (missing ⇒ exit 3), `unknown_resolved_from: explicit`; `auto` (default — owner ruling 2026-09-07: a switch, default on in participatory and just-results modes alike) ⇒ missing budgets fill 2/1/1, `unknown_resolved_from: default`. Two-knob matrix: rung U1 (consult) is eligible only when this knob and `consult_dispatch` are both `auto` or `on`; a `native-fallback` consult is skipped as not heterogeneous. The knob's own value is never rewritten | `auto\|on\|off` (default `auto`) |
| `unknown_budget_u1` / `unknown_budget_u2` / `unknown_budget_u3` | climbs allowed to rungs U1 (consult) / U2 (survey, issue-search) / U3 (think-tank, debugger PUA) per **work unit** — one unit (phase or deliverable) for M/L/XL, the whole task for XS/S, the whole run for `/l4`–`/l6`. A spent rung is never repeated and never buys a higher rung; when every signal-eligible rung is spent the probe recommends `none` with `reason: budget-exhausted`. A rung whose rail died (`reason: rail-failed`, written by `dispatch-consult.sh --ladder-receipt` on its failure paths) also consumes budget, so a dead seat is retried at most budget times. U1 defaults to 2 because the common debug shape is consult → new evidence → one more bounded question | non-negative integers (defaults `2` / `1` / `1`) |
| `discuss_dispatch` | whether the discuss rail (`scripts/dispatch-discuss.js`) is live. DEFAULT OFF. `off` = today's behavior byte-for-byte — `discuss_*` stays declared but not dispatched. `on` requires a non-empty `discuss_*` tuple AND a real `discuss` role qualification for the configured `{engine, runner}` (`references/consult-discuss-seats.md`) | `on\|off` (default `off`) |
| `allow_same_runner_dual_seat` | may one runner hold the implementer seat and a reviewer-class **loop** seat simultaneously? `off` = resolver exit 3. `on` = permitted, stderr warning, `same_runner_dual_seat: true`. Applies to qualified engines too; runner axis, not family axis; compares the CONFIGURED token (`auto` is inert, an inherited default is not). `qc_panel` has its own proportionate rule — see the note above | `off` (default) \| `on` |
| `on_engine_unavailable` | what to do when a dispatch engine is unavailable (quota exhausted / `precondition_failed`) | `ask\|solo-fallback\|wait-reset\|cloud-fallback` (default `ask`). **Behavior matrix**: `ask` — BOTH engine-quota death and `precondition_failed` stop the run and escalate to the user (no automatic `--solo` inline fallback, no automatic quota-reset wakeup). Fail-closed: the expensive depth-0 session model never silently takes over implementation labor. `solo-fallback` — legacy: `precondition_failed` falls back to `--solo` inline; quota death follows the §1.b auto-wakeup recovery (see `depth0-control-loop.md`). `wait-reset` — quota death follows §1.b auto-wakeup; `precondition_failed` (non-quota) still escalates to the user. **Engine wiring**: when a dispatch dies `engine_unavailable`/`precondition_failed`, `engine implement-review` applies this matrix mechanically and emits an additive `engine_unavailable: {policy, action, error_class}` on its result (`action` ∈ `escalate\|solo-fallback\|wait-reset\|cloud-fallback`; auth/unparseable deaths always `escalate` — waiting can't fix auth) so the orchestrator acts on `action` instead of re-deriving the policy from raw dispatch JSON. `cloud-fallback` — for an implementer that runs on a local endpoint (`--endpoint` given): a death classified `endpoint_unreachable` (connection refused/reset, DNS, connect/read timeout, any 5xx other than 503) or `endpoint_busy` (HTTP 429 or 503, the throttling proxy in front of the server shedding load) is re-dispatched ONCE to `cloud_fallback_rung`, without `--endpoint`, and one row is appended to `cloud-fallbacks.jsonl` in the capability store dir. If the fallback attempt itself dies unavailable, the run stops as under `ask` (`cloud_fallback_exhausted: true`); auth, quota and cloud-runner deaths escalate as under `ask`. Nothing about an endpoint is remembered between dispatches: every dispatch tries the local endpoint first. Inside an admitted campaign `cloud-fallback` behaves as `ask`: an `endpoint_unreachable` / `endpoint_busy` death escalates without a re-dispatch, the result carries `cloud_fallback_skipped: "campaign"` and `cloud-fallbacks.jsonl` gets one row with `outcome: skipped_campaign` (campaign 不退回雲端, PM 2026-11-08). Requires `cloud_fallback_rung` (exit 3 without it) |
| `cloud_fallback_rung` | the single rung `cloud-fallback` retreats to, same `engine/effort@runner` shape as one `implementer_ladder` rung. The runner must be a cloud runner: `codex\|agy\|grok\|cursor\|kimi\|qoderclicn`; `cc-shim`, `anthropic-compatible`, `pi`, `opencode` (local-endpoint runners) and `auto` exit 3. The rung's family gets the implementer family check: a rung in the reviewer seat's family, or one that leaves fewer reviewer families than `required_review_families`, exits 3 (a single rung has no ladder, so `on_family_conflict` cannot substitute). The retreat runs on branch `<branch>-cloudfb` from the original base. Emitted by the resolver only when set | `engine/effort@runner` (e.g. `gpt-5.6-sol/high@codex`), or empty |
| `reviewer_on_engine_unavailable` | reviewer seat only. Empty follows the global `on_engine_unavailable`, except an agy reviewer whose engine is `gemini-4-carbon-<low\|medium\|high>`: an unset field resolves to `cloud-fallback` (an explicit `ask`, `solo-fallback`, `wait-reset` or `cloud-fallback` is kept; garbage is coerced to empty and does not take that default). `cloud-fallback` makes `dispatch-review.sh` pre-probe that seat's endpoint and, on unreachable or busy, retreat once to `reviewer_cloud_fallback_rung` (one `cloud-fallbacks.jsonl` row, `probe` and `served_by` on the result). The next dispatch probes again and returns to the local endpoint when it answers. Other seats are unchanged | empty (follow global, or `cloud-fallback` for an unset agy carbon reviewer) \| `ask` \| `solo-fallback` \| `wait-reset` \| `cloud-fallback` |
| `reviewer_cloud_fallback_rung` | the rung the reviewer seat retreats to. Same `engine/effort@runner` shape and the same cloud-runner allowlist as `cloud_fallback_rung` (a local runner exits 3). Required when `reviewer_on_engine_unavailable` is `cloud-fallback`. The rung's family must not be the reviewer seat's own family, except an agy `gemini-4-carbon-<tier>` reviewer whose rung is `gemini-4-argon-<same tier>` (filled in when the rung field was empty; an explicit rung is not replaced). Always emitted (`null` when unset) | `engine/effort@runner` (e.g. `gpt-6.1-sol/high@codex`), or empty |
| `loop_max_rounds` | adversarial-loop convergence cap per phase | integer (default 5) |
| `loop_convergence_verdict` | the reviewer verdict that ENDS a loop | `SHIP-AS-IS` (loop continues on `FIX-THEN-SHIP`/`RECONSIDER`) |
| `spec_review` | run the reviewer loop on the spec BEFORE dispatching impl | `on\|off` |
| `independent_harness` | depth-0 builds its OWN adversarial harness (never trusts the implementer's green) | `on\|off` |
| `qc_panel` | the authoritative depth-0 terminal gate — a disjoint-family reviewer panel (distinct families >= required AND ≥1 family ≠ implementer) | comma list of model names (e.g. `gpt-6-astra, gpt-6.1-sol, gemini-4-carbon-high`) |
| `qc_panel_runners` / `qc_panel_efforts` / `qc_panel_endpoints` | positional exact-tuple metadata for readiness. All three lists must align 1:1 with `qc_panel`; endpoint `@none` means literal null. Missing/invalid/misaligned metadata leaves legacy review dispatch unchanged but makes `qc_panel_seats_complete=false`, so readiness fails closed instead of guessing | comma lists; reviewer runner allowlist, effort `low\|medium\|high\|xhigh\|max`, endpoint `@none` or `[A-Za-z0-9_]` |
| `review_packet_deny_extra` | additional packet deny-list patterns, composed with the eight shipped defaults (`DEFAULT_PACKET_DENY_LIST`). Additive only — extras cannot remove a default. Grammar is `normalizeDenyList`: relative `/`-joined globs; `**` whole-segment; `*` inside a segment. Invalid element fails closed. Visible in `MANIFEST.json` `deny_list` / `packet_hash` | comma list (default empty) |
| `exclude_allowlist` | consumer-declared pathspec(s) that widen `scripts/lib/exclude-allowlist.js`'s hardcoded `EXCLUDE_ALLOWLIST` for `--exclude` on generated/vendor paths, one per row. Each row is checked by `isAcceptedConsumerRow`: no source extension (`.js\|.ts\|.py\|.sh\|.md`), no glob character except a literal trailing `/**`, and at least one `/` — a code directory such as `src/**` is refused, not widened | one or more `- exclude_allowlist: <pathspec>` rows (repeatable), or absent |
| `qc_panel_aggregation` | how panel verdicts combine | `union-on-verified-critical` (default; majority is forbidden → falls back to this) |
| `in_rail_review` | which engine runs the implementation loop's `full_diff_review` station. `auto` becomes `panel` when `qc_panel_seats_complete` is true, else `single`; `panel` with an incomplete panel is a resolver refusal | `auto\|single\|panel` (default `auto`) |
| `provider_readiness_receipt_ttl_seconds` | lifetime of one content-bound readiness receipt and its explicit probe observations | integer `1..86400` (default 300; invalid values fail safe to default) |
| `provider_readiness_fallback_family_constraint` | family admission for ordered readiness fallbacks; unknown family never satisfies `different` | `different` (default) `\| any` |
| `min_panel_size` | **minimum panel-size floor** for a homogeneous (single-family) qc panel — a homogeneous panel must not drop below this many distinct-lens reviewers. Emitted **separately** from `required_review_families` on purpose: lens diversity ≠ family decorrelation, and same-family lenses can still share blind spots, so panel size and family count are independent knobs. Standalone integer — NOT coupled to review_risk / families / source-trust. List one more seat than the minimum to get a standby | integer ≥ 1 (default 3); garbage / missing / `0` / negative → fail-safe 3 |
| `review_diff_scope` | how much the per-round reviewer reads (cost vs regression-catching) | `full` (re-read whole `base..HEAD` each round — safe, O(n) cost growth) `\| incremental-mitigated` (read `prev..HEAD` + full content of files-touched + invariants list + periodic/critical-path full re-read + **mandatory final full review before merge**) |
| `density_scaling` | scale verification density both directions by capability tier/risk: low/unknown implementers fail-closed upward (bump max rounds, require 2 cross-family reviewers, require l1 decorrelated oracle); high-tier + low-risk implementers cap cheap rounds at 2 and emit `verify_first: true` without weakening cross-family policy | `on\|off` (default off) |
| `work_domain` | **emitted telemetry, NOT a config/routing knob** — the deterministic dominant domain of a diff (via `--auto-domain`/`--domain`; computed by `scripts/probe-diff-domain.sh`) | `rust\|backend-cli\|frontend\|docs\|mixed` (read-only record; selects no engine — domain routing is BACKLOG'd) |
| `domain_source` | **emitted telemetry** — provenance of `work_domain` | `explicit` (valid `--domain`) `\| auto` (successful `--auto-domain` probe) `\| none` (no flag / non-git / empty diff / probe failure ⇒ `work_domain=mixed`) |

### Orthogonal R5 risk classifier + sampler policy

`classify-diff-risk.sh` is the orthogonal domain/adversariality layer. It emits:

- detected `domains`
- `checklists` matched for that diff
- `risk_flags` (`source_trust`, `diff_lines`, `protected_path`, `oracle_available`, `security_surface`)
- `sampling` metadata (`enabled`, `ratio`, `bucket`, `selected`, `reason`)
- `adversarial_review` boolean for the caller

Required canonical docs entries (for humans and policy checks, not mandatory parser keys):

- `risk_family_decorrelation_always_on: true` (inner-loop reviewer must differ from implementer family; enforced unconditionally by `ensureDistinctReviewFamily` in `src/engine/autopilot-engine.js` and **not** controllable by any config key)
- `risk_adversarial_sampling_ratio: 0.05` (or your preferred non-zero ratio)

Checklist mapping:

- `auth` → `authz-boundary`, `authz-tests`
- `tenant`/`tenant_id` → `tenant-boundary`, `tenant-isolation`
- §2e dispatch-gate → `dispatch-gate-hardening`
- `money`/`stripe`/`billing` → `billing-contracts`, `payment-security`
- `schema` → `schema-stability`, `contracts`
- `migration` → `migration-safety`
- `sync`/`cursor`/`watermark` → `sync-safety`, `replication-gating`
- `shared-infra` → `shared-infra-hardening`
- `config` → `configuration-drift`
- `generated-types` → `generated-types-contract`
- `contracts` → `contracts-hardening`
- `concurrency` → `concurrency-safety`
- `serialization` → `serialization-correctness`
- `db-helper` → `db-helper-integrity`
- `feature-flag` → `feature-flag-governance`
- `clock`/`timezone` → `clock-time-ordering`

Closed-loop write-back is supported via:

- `bash scripts/classify-diff-risk.sh append-rule --repo <repo> --domain <domain> --scope path|content|either --pattern <regex> --checklist <c1,c2> [--rules-file <path>]`

Canonical behavior is still enforced by `resolve-review-loop.sh` on the same run flags (`--source-trust`, `--diff-lines`, `--protected-path`, `--oracle-available`, `--security-surface`) so this file documents intent and telemetry, not a separate parser contract.

### Risk-tiered review depth (v2.25.11 — emitted by `resolve-review-loop.sh`, not config keys)

`resolve-review-loop.sh` derives a deterministic **`implementation_review_risk`** from runtime
inputs (NOT just who implemented — source-trust is one input, per the design's category-error
correction). Pass them as flags; the resolver emits the policy the depth-0 loop enforces.

| Input flag | Default | Effect |
|------------|---------|--------|
| `--source-trust high\|low` | derived (known cloud family ⇒ high, else low) | low ⇒ high risk |
| `--diff-lines N` | 0 | `>150` ⇒ high risk |
| `--protected-path 0\|1` | 0 | 1 ⇒ high risk |
| `--oracle-available 0\|1` | 1 | 0 (no executable oracle) ⇒ high risk |
| `--security-surface 0\|1` | 0 | 1 ⇒ high risk |

Emitted fields: `review_risk` (low/high), `required_review_families` (1 low / 2 high — PROVISIONAL,
calibrate before flipping the panel default), `l1_required` (decorrelated execution oracle required),
`cross_family_required`, `cross_family_satisfied` (an **unknown-family** panel member never satisfies
it — fail-closed). The cross-family overlap message escalates **WARNING** (low risk) → **ERROR**
(high risk). **`--enforce`** turns the resolver into an opt-in hard gate: exit 3 (JSON still emitted)
when a high-risk change's required cross-family decorrelation is unsatisfied (incl. an empty panel at
high risk). Default stays exit-0 data mode — the resolver REPORTS, the depth-0 loop / pre-push gate
ENFORCES (same pattern as `resolve-doa`/`resolve-qc-gate`). Full design: [`project/plans/_archive/2026/06/2026-06-26-trust-tiered-review-policy.md`](../project/plans/_archive/2026/06/2026-06-26-trust-tiered-review-policy.md).

`density_scaling` is bidirectional because the exchange-rate bench showed the pipeline rescues
under-capacity implementers, but taxes or regresses at/above-capacity implementers.

## When to use `incremental-mitigated` (architect-reviewed 2026-06-26)

Default is `full`. Switch to `incremental-mitigated` only for **long** loops (many rounds,
large accumulating diff) where the reviewer cost grows O(n) re-reading the whole diff each
round. The naive "only the incremental diff" is **unsafe** — it can't prove earlier fixes
still hold and misses cross-file regressions in untouched files (the exact class this loop
catches). So it is only allowed WITH all of: re-read the full content of every file touched
this round; carry a standing invariants/prior-findings checklist; do a full `base..HEAD`
re-read every 3–5 rounds or whenever a fix touches shared/critical logic (classifiers,
schemas, fixtures, harness control flow); and ALWAYS a final full `base..HEAD` review before
merge. Real-world lesson (2026-06-26): a too-narrow per-round test/review scope let a
stale-fixture regression in an *untouched* test file slip to the final full sweep — so pair
this with `independent_harness: on` running the **FULL** suite, not just touched-file tests.

## Gotchas (carried from the test-integrity-l1 ship)

- **Native fallback under `auto` when topology is unavailable.** When `plan_review`, `hetero_review`,
  or `consult_dispatch` is set to `auto` (the default) and the host topology file
  (`~/.autopilot/topology.json`, produced by `scripts/resolve-dispatch-topology.js`) is absent,
  malformed, or has zero qualified seats for the role, the resolver falls back to native models
  (`opus/high@claude-native` for plan and hetero review, `sonnet/high@claude-native` for consult).
  A fully declared seat is exempt: `plan_reviewer_*` (plan chair) and `consult_*` (consult) declared
  in full win over topology and fallback, reporting `*_resolved_from: config-explicit`. A declared
  consult seat is still refused (exit 3) when unqualified or when it is also a `qc_panel` seat.
  The resolved origin is set to `*_resolved_from: native-fallback`, an entry is recorded in
  `capability_warnings`, and the knob's own value remains the literal `auto` (never rewritten).
- **Implementer model rate-limits are transient, not engine failures.** A per-model usage cap
  (e.g. "You've hit your usage limit for GPT-5.3-Codex-Spark") makes the codex worker exit
  non-zero with no commit → dispatch-hetero reports `question_suspected` and the engine
  `blocks`. It is NOT the flag/PATH bug (fixed v2.30.2) — check the `agent_log`: if it shows
  codex started + accepted `--dangerously-bypass-hook-trust` then hit a usage limit, just
  switch the implementer model (set `implementer_engine` here, or point
  `$REVIEW_LOOP_CONFIG_OVERRIDE` at a temp config) and retry, or wait for the cap to reset.
  Verified 2026-07-02: with `implementer_engine: gpt-5.5` the loop converged `SHIP-AS-IS`.
- **`agy` as implementer — works now via the v2.25.9 anchor fix.** agy `-p` ignores process
  cwd (Antigravity-CLI #231/#133/#253), so a relative-path prompt made it invent a scratch
  project under `~/.gemini/antigravity-cli/scratch/` and leave the worktree untouched (the old
  `no_op`). `dispatch-hetero.sh` now PREPENDS an absolute-worktree anchor to the agy directive,
  so agy edits in place — verified single- and multi-file, and 3-way concurrent
  ([[project_agy-writes-install-dir]]). So `implementer_runner: agy` is viable again (cost
  arbitrage / a Gemini-family generator). Caveats: agy stays EDIT-ONLY (run_command 10s cap →
  it can't run build/test mid-turn; the harness commits, the panel verifies), and Docker
  headless auth is still broken (#223/#479) so run agy on an interactively-authed host. `codex`/
  `gpt-6.1-sol` remains the default for tasks where the agent must run build/test itself.
- **`agy` has a ~131 KB payload ceiling that is NOT the context-window gate.** agy has no
  `--prompt-file`, so the whole prompt goes to it as one argv string, and Linux caps a single argv
  string at `MAX_ARG_STRLEN` = 131072 bytes (32 × PAGE_SIZE) — separate from, and far below, the
  total `ARG_MAX`. Past that, `execve` fails before agy starts: no vendor error, no partial output,
  just a bare shell status (126/127 both observed), which reads as a stalled seat rather than a
  refused one. Both rails now refuse first with a named reason (`dispatch-review.sh` →
  `no_verdict`, `dispatch-hetero.sh` → `precondition_failed`), so a big-diff agy seat tells you to
  narrow `--diff` or move that seat to a runner that reads a file/STDIN (codex, grok, qoderclicn,
  cursor) instead of going quiet. Details + the measurement:
  `references/hetero-dispatch.md` § agy argv-payload ceiling.
- **`grok` as implementer or reviewer (v2.26.6/2.26.7).** xAI Grok Build CLI; models
  `grok-build` and `grok-composer-2.5-fast` (Composer 2.5 ships inside the grok CLI on the
  Grok Build plan). Unlike agy, grok `-p` HONORS `--cwd` so no anchor hack is needed. To use:
  `implementer_engine: grok-composer-2.5-fast` + `implementer_runner: grok`, OR put a
  `grok-build` in `qc_panel` / set `reviewer_runner: grok`. Requires the `grok` CLI installed +
  logged in (`grok login`). Implementer is EDIT-ONLY + wrapper-commit (like agy); reviewer is
  read-only by construction. ([[project_grok-hetero-implementer]])
- **`cc-shim` (v2.26.8 implementer / v2.26.10 reviewer) — Claude Code CLI → ANY Anthropic-compatible
  provider, using YOUR OWN account.** This is provider-agnostic: cc-shim runs the `claude` CLI but
  points it at a different endpoint, so the MODEL there (MiniMax, GLM/Zhipu, or any vendor that
  exposes an Anthropic-compatible `/v1/messages` API) does the work. For an IMPLEMENTER the model
  writes the code (driver family doesn't matter); as a REVIEWER it's a different-family vote.

  **Who/what are the two env vars?** They are **Claude Code's own override knobs** (not MiniMax's,
  not autopilot's). You supply YOUR values:
  - `ANTHROPIC_BASE_URL` = the provider's **public** Anthropic-compatible endpoint (no secret).
  - `ANTHROPIC_AUTH_TOKEN` = **YOUR OWN API key** for that provider (a secret — yours, per-account).
    Set this, NOT `ANTHROPIC_API_KEY`; cc-shim deliberately unsets `ANTHROPIC_API_KEY` before launch
    so your real-Anthropic key can't override the shim token.

  To use (generic — substitute YOUR provider's endpoint + model id + key):
  ```
  # in .claude/review-loop-config.md:
  - implementer_engine: <provider-model-id>     # e.g. MiniMax-M3.1-Flash-Preview, glm-5.3
  - implementer_runner: cc-shim                  # or reviewer_runner: cc-shim
  # in your shell, before /l5 (cc-shim is EXPLICIT-only and REFUSES to run without both,
  # so it can never silently fall back to your real Claude quota):
  export ANTHROPIC_BASE_URL='<your provider's Anthropic-compatible endpoint>'
  export ANTHROPIC_AUTH_TOKEN='<your own API key for that provider>'
  ```

  Known endpoints (find yours in your provider's "Anthropic-compatible / Claude Code" docs — these are
  examples, your key + region may differ):

  | Provider | `ANTHROPIC_BASE_URL` | model id | notes |
  |----------|----------------------|----------|-------|
  | MiniMax (intl) | `https://api.minimax.io/anthropic` | `MiniMax-M3` (reviewer) / `MiniMax-M3.1-Flash-Preview` (implementer, consult, discuss; never the bare `MiniMax-M3.1`, the endpoint silently answers it as M3) | the `.io` host (a `.minimaxi.com` host 401'd for one intl key — use whichever your account is provisioned for); **M3 returns clean text; M2.x leaks a `thinking` block** so prefer M3 |
  | Zhipu/GLM | `https://api.z.ai/api/anthropic` (or `https://open.bigmodel.cn/api/anthropic`) | `glm-5.3` | clean (no thinking leak); as of 2026-06-30 frequently **529-overloaded** — unproven under a full loop |

  EDIT-ONLY + wrapper-commit (implementer); prompt via STDIN. **cc-shim as a `reviewer_runner`** is
  read-INTENT best-effort surface reduction (`--setting-sources project` + `--strict-mcp-config` +
  `--tools ""` + `HOME`/scratch cwd + no skip-permissions), **NOT a hard sandbox** — for a genuinely
  untrusted diff prefer the `codex` reviewer with `bwrap` installed. **MiniMax-M3 has strong
  reviewer calibration** (2026-06-30: 10/10 `evals/known-bad` caught,
  false-pass-on-critical = 0, 3/3 clean), but a 2026-07-31 diff-only observation produced false
  central claims in 5 of 6 cases. The exact `MiniMax-M3` + `cc-shim` + `minimax` reviewer tuple
  therefore requires `reviewer_limitation: minimax-false-central-claim-5-of-6`; the resolver
  emits an advisory and rejects a missing tag. This is telemetry, not automatic demotion or
  authority, and independent verification remains required. **GLM-5.2** is endpoint-verified but
  was 529-overloaded under load — re-Spike before trusting.
- **`opencode` as a reviewer (v2.36.x, probe-verified 2026-09-07 on opencode 1.18.27).**
  `opencode run --dir <scratch> --pure --agent plan --variant <effort> --format json`,
  prompt on STDIN, model ids are `provider/model` (e.g.
  `opencode-go/muse-spark-1.3-contributor`). `--agent plan` denies `edit`, but a live
  adversarial probe showed it does **NOT** block bash/tool execution (asked it to run
  `hostname`; it ran the real command and returned the real hostname) — so this is
  **best-effort read-only, NOT a hard sandbox**, same tier as `kimi`/`cursor`/`grok`:
  scratch cwd is the actual containment (never the repo, since the diff is text in the
  prompt). It therefore stays OUT of `AUTOPILOT_BLIND_DISCOVERY`'s no-tools allowlist,
  and `scripts/qualification-review-provider.js`'s stricter exam-integrity threshold
  refuses the `opencode` CLI kind entirely (same doctrine as its `cursor` refusal). To
  use: `reviewer_runner: opencode` + `reviewer_engine: <provider/model>`, or a
  `qc_panel` seat with `qc_panel_runners` containing `opencode`. `--format json` streams
  newline-delimited events; the rail extracts the final assistant text from the last
  `{"type":"text",...}` event's `.part.text` via a Node built-in scriptlet before the
  shared VERDICT parser runs (same normalize-before-parse shape as the kimi salvage).
  `--bin` overrides the binary (else PATH), same as every other rail.
- The implementer's own passing tests are **not** the criterion — keep
  `independent_harness: on` so depth-0 builds adversarial cases the implementer
  didn't write (this is what caught vitest-blind / go multi-pkg build-fail / the
  override forgeability the implementer's green missed).
- **`--endpoint <name>` vs. hand-exporting `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`.** When a
  named endpoint is configured (`resolve-endpoint.sh`, creds from `~/.autopilot/endpoints.env`,
  `AUTOPILOT_ENDPOINT_<NAME>_*`), pass `--endpoint <name>` to `dispatch-review.sh`/`dispatch-hetero.sh`
  — do NOT also hand-export `ANTHROPIC_BASE_URL` first. The dispatcher clears that variable to an
  empty string before resolving the named endpoint, so a manual export is silently overwritten and
  produces confusing "it worked with export but not with --endpoint" reports. Also:
  `load-endpoints-env.sh` is a bash script (source it from bash, not zsh — zsh chokes on its
  arithmetic/substitution syntax) and only DEFINES a function; you still have to call
  `autopilot_load_endpoints_env` afterward.
- **`--timeout` default (5m) is too short for a large diff at a high effort level** — a ~166 KB diff
  at `codex effort=max` has hit `rc=124` (timeout). A timeout is FAIL-CLOSED to `no_verdict`: the
  review is lost, not merely slow. Size the timeout to the diff — 15–20m for anything large.
- **Diagnose every `no_verdict` from the `raw_log`, never from file size alone.** A large raw log can
  be a prompt echo with zero real response. `rc=124` = timeout; `rc=1` is commonly a quota exhaustion;
  `"did not start with the expected wrapped block"` means the response framing was corrupted by
  harness chrome — chrome sometimes lands BEFORE a fully intact wrapped block (e.g. a session-title
  generator's own prefix), and that block can be adopted directly from the raw log — but ONLY if its
  markers are the derived nonce hash, not the raw nonce (`dispatch-review.sh` derives the accepted
  marker as `SHA256("autopilot-review-v1:" || nonce)`, so a bare echo of the visible nonce value
  cannot forge one), the opening and closing markers match each other exactly, and the block contains
  no leaked prompt/instruction text. A block merely resembling a verdict (visible VERDICT/FINDINGS
  text with no matching derived markers) is NOT safe to adopt — it may be the model echoing the
  prompt's own output-format example back at you.
- **When the primary reviewer's provider has a sustained outage** (repeated 529s), don't retry
  indefinitely — reroute the review to a qualified reviewer on a different provider (e.g. `--runner
  codex` against an OpenAI-hosted model) rather than burning rounds against a dead endpoint. This is
  exactly the situation the decorrelated roster exists for.

## Capability-state advisory (v2.31.2 — emitted fields, not config keys)

`resolve-review-loop.sh --capability-state on` (default on, **report-only / non-blocking**) consults the
local engine capability store (`~/.autopilot/engine-capability/`, written by `scripts/probe-engine-capability.sh`
and passive capture in the dispatch scripts) and appends advisory fields to its JSON:
`capability_state_source` (`store`/`none`/`unknown`), `quota_status`, `quota_reset_at`, `skill_mode_requested`,
`skill_mode_effective`, `capability_warnings[]`. A runner is **demoted only** when its quota is
`exhausted` + `high` confidence + fresh; an `unknown` status NEVER demotes; `/l4` is untouched. This is
v1 report-only — never a hard gate. **Skill transport**: pass `--skill-mode off|prompt|native|auto` +
`--skill <name>` to `dispatch-hetero.sh` (implementer only — reviewers never get a skill pack); `native`
requires a `scripts/bench-engine-capability.sh` bench to have recorded native support, else it fails
closed. See [`references/hetero-dispatch.md`](../references/hetero-dispatch.md) § "Skill transport is now
a MEASURED capability".

## Brain-seat identity pin (v2.34.15+, optional)

```
- brain_seat_identity_file: .claude/brain-seat-identity.json
```

Pins the incumbent depth-0 brain identity (the exact 12-field capability-identity
object; `identity_hash = sha256(canonicalJson(file))`) for the P7 governed-path
rail and the `status readiness` brain-seat line. Scope rule: the pin is honored
ONLY from an explicit `REVIEW_LOOP_CONFIG_OVERRIDE` or the caller-cwd project
config — a config the ladder pulled from the plugin repo or template never seats
a brain for a consumer. A relative path resolves against the config's project
root (`dirname(config)/..`), never the caller's cwd. Standing comes exclusively
from a passed `engine-qualify.sh brain` administration (or a loud per-invocation
override); see `skills/engine-onboarding/references/role-and-harness-governance.md`.
