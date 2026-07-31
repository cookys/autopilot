# Review-Loop Config (generation-adversarial heterogeneous pipeline)

Per-project engine roster + loop policy for the `/l5`-style pipeline:

> subagent writes plan/acceptance → **decorrelated reviewer** xhigh loop-to-convergence
> → **heterogeneous implementer** → reviewer xhigh loop + depth-0 adversarial harness
> → qc-gate subagent.

This file turns that hand-typed prompt into **data**: copy it to
`.claude/review-loop-config.md` (in the consuming project, or autopilot's own
`.claude/` for dogfood) and `/l5` reads the roster instead of you re-typing it.
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

## Settings

- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: codex
- reviewer_limitation:
- reviewer_limitation_required: false
- reviewer_engine_low_risk:
- reviewer_effort_low_risk:
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
- reviewer_endpoint:
- implementer_endpoint:
- verification_author_present: false
- verification_author_engine:
- verification_author_runner:
- verification_author_effort:
- verification_author_endpoint:
- on_engine_unavailable: ask
- on_family_conflict: fallback
- reviewer_fallback_preference:
- reviewer_fallback_preference_low_risk:
- loop_max_rounds: 5
- loop_convergence_verdict: SHIP-AS-IS
- spec_review: on
- independent_harness: on
- qc_panel: gpt-5.5, claude-opus, gemini-flash
- qc_panel_runners: codex, claude-native, agy
- qc_panel_efforts: xhigh, high, high
- qc_panel_endpoints: @none, @none, @none
- qc_panel_aggregation: union-on-verified-critical
- provider_readiness_receipt_ttl_seconds: 300
- provider_readiness_fallback_family_constraint: different
- review_diff_scope: full
- min_panel_size: 3
- density_scaling: off

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
> **Preset `all-calibrated`**: Setting `qc_panel` to exactly `all-calibrated` expands to the full, calibrated 5-family reviewer roster. The concrete engine list is maintained inside the resolver script (single source of truth) and covers all families with recorded reviewer calibration/spike evidence.

## Field reference

| Field | Meaning | Values |
|-------|---------|--------|
| `reviewer_engine` | the **decorrelated** adversarial reviewer (spec + impl loops) | a model name (e.g. `gpt-5.5`); resolved via `reviewer_runner` |
| `reviewer_effort` | reviewer reasoning effort | `low\|medium\|high\|xhigh\|max` |
| `reviewer_limitation` | exact reviewer-tuple limitation tag. The `MiniMax-M3` + `cc-shim` + `minimax` tuple must use `minimax-false-central-claim-5-of-6`; the resolver warns and rejects that tuple when the tag is absent | the exact limitation tag, or empty |
| `reviewer_limitation_required` | compatibility metadata only; it cannot enable, disable, or weaken the exact MiniMax tuple guard | `true\|false` |
| `reviewer_engine_low_risk` | **risk-tiered overlay**: when BOTH `_low_risk` keys are set, the loop reviewer for computed `review_risk=low` becomes this pair (same `reviewer_runner`); `review_risk=high` ALWAYS uses `reviewer_engine`/`reviewer_effort`. Empty = tiering off. Adopt a faster engine on low-risk diffs only after it clears `engine-qualify.sh` (scorecard-first) | a model name (e.g. `gpt-5.6-sol`), or empty |
| `reviewer_effort_low_risk` | effort for the low-risk reviewer; garbage → empty (tiering off — fail-safe reviews with the stronger incumbent) | `low\|medium\|high\|xhigh\|max`, or empty |
| `on_family_conflict` | engine `reviewDiff` policy when the (effective) reviewer shares the implementer's model family: `fallback` = substitute the first cross-family QUALIFIED scorecard-ladder row (runner allowlist `codex\|agy\|grok\|claude-native`; codex rows need a calibrated `effort` on the row; ladder provenance must match the actual implementer family) so the in-loop decorrelated review actually runs; `block` = hard-block (pre-v2.32.25 behavior — for the default openai implementer + openai reviewer this means the in-loop review NEVER runs and convergence rides verify-first). Garbage → `block` (fail-closed) | `fallback` (default) \| `block` |
| `reviewer_fallback_preference` | HUMAN-ordered engine ids the family-conflict fallback prefers over raw ladder order (every candidate still passes all guards: cross-family, runner allowlist, calibrated codex effort). Empty = ladder order (alphabetical within capability ties — set this if the strongest cross-family reviewer must win the high-risk seat) | comma list of scorecard engine ids (e.g. `claude-opus, MiniMax-M3`), or empty |
| `reviewer_fallback_preference_low_risk` | preference list applied when computed `review_risk=low` (cheap calibrated leg for cheap rounds); empty = use `reviewer_fallback_preference` | comma list, or empty |
| `skill_mode` | 是否把 skill pack（選定 SKILL.md 內容）傳輸進 hetero implementer prompt（`references/hetero-dispatch.md` § Skill transport）。2026-07 A/B：reviewer 席 H2 已被推翻——implementer 席才是它的戰場；resolver 輸出 `skill_mode_requested`/`skill_mode_effective` | `off`（預設）/ `prompt-pack` |
| `reviewer_runner` | how the reviewer is invoked (→ `dispatch-review.sh --runner`) | `codex` (`codex exec`) `\| agy` (Gemini) `\| grok` (xAI; read-only) `\| qoderclicn` (QoderCN/Qwen; read-intent, explicit) `\| cc-shim` (Claude Code CLI to any Anthropic-compatible endpoint) `\| anthropic-compatible` (direct HTTP reviewer via `dispatch-anthropic-review.js`) `\| claude-native` (first-party Claude Code ambient auth) `\| auto` |
| `implementer_engine` | the heterogeneous implementer | a model name (e.g. `gpt-5.3-codex-spark`, `Gemini 3.5 Flash (High)`, `grok-composer-2.5-fast`, `MiniMax-M3`) |
| `implementer_effort` | implementer reasoning effort (codex only) | `low\|medium\|high\|xhigh\|max` |
| `implementer_runner` | dispatch-hetero runner | `auto\|codex\|agy\|grok\|qoderclicn\|cc-shim\|pi` (→ `dispatch-hetero.sh --runner`). `auto` routes `*gpt*`/`*codex*`→codex, `*grok*`/`*composer*`→grok, `*qwen*`/`*qoder*`→fail-loud requiring explicit `qoderclicn`, else agy; **`qoderclicn`, `cc-shim`, and `pi` must be set EXPLICITLY** (see Gotchas) |
| `reviewer_endpoint` | **named endpoint** for a `cc-shim`/`anthropic-compatible` REVIEWER — resolves creds via `resolve-endpoint.sh` (`AUTOPILOT_ENDPOINT_<NAME>_*`, populated from `~/.autopilot/endpoints.env`). `/l5`/`/l6` passes it as `--endpoint <name>` so you don't hand-type it. Empty = none (raw `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` env, byte-identical to before) | an endpoint name `[A-Za-z0-9_]` (e.g. `glm`, `minimax`), or empty |
| `implementer_endpoint` | same, for a `cc-shim` IMPLEMENTER (→ `dispatch-hetero.sh --endpoint`). Empty = none | an endpoint name `[A-Za-z0-9_]`, or empty |
| `on_engine_unavailable` | what to do when a dispatch engine is unavailable (quota exhausted / `precondition_failed`) | `ask\|solo-fallback\|wait-reset` (default `ask`). **Behavior matrix**: `ask` — BOTH engine-quota death and `precondition_failed` stop the run and escalate to the user (no automatic `--solo` inline fallback, no automatic quota-reset wakeup). Fail-closed: the expensive depth-0 session model never silently takes over implementation labor. `solo-fallback` — legacy: `precondition_failed` falls back to `--solo` inline; quota death follows the §1.b auto-wakeup recovery (see `level-front-door.md`). `wait-reset` — quota death follows §1.b auto-wakeup; `precondition_failed` (non-quota) still escalates to the user. **Engine wiring**: when a dispatch dies `engine_unavailable`/`precondition_failed`, `engine implement-review` applies this matrix mechanically and emits an additive `engine_unavailable: {policy, action, error_class}` on its result (`action` ∈ `escalate\|solo-fallback\|wait-reset`; auth/unparseable deaths always `escalate` — waiting can't fix auth) so the orchestrator acts on `action` instead of re-deriving the policy from raw dispatch JSON |
| `loop_max_rounds` | adversarial-loop convergence cap per phase | integer (default 5) |
| `loop_convergence_verdict` | the reviewer verdict that ENDS a loop | `SHIP-AS-IS` (loop continues on `FIX-THEN-SHIP`/`RECONSIDER`) |
| `spec_review` | run the reviewer loop on the spec BEFORE dispatching impl | `on\|off` |
| `independent_harness` | depth-0 builds its OWN adversarial harness (never trusts the implementer's green) | `on\|off` |
| `qc_panel` | the authoritative depth-0 terminal gate — a disjoint-family reviewer panel (distinct families >= required AND ≥1 family ≠ implementer) | comma list of model names (e.g. `gpt-5.5, claude-opus, gemini-flash`) |
| `qc_panel_runners` / `qc_panel_efforts` / `qc_panel_endpoints` | positional exact-tuple metadata for readiness. All three lists must align 1:1 with `qc_panel`; endpoint `@none` means literal null. Missing/invalid/misaligned metadata leaves legacy review dispatch unchanged but makes `qc_panel_seats_complete=false`, so readiness fails closed instead of guessing | comma lists; reviewer runner allowlist, effort `low\|medium\|high\|xhigh\|max`, endpoint `@none` or `[A-Za-z0-9_]` |
| `qc_panel_aggregation` | how panel verdicts combine | `union-on-verified-critical` (default; majority is forbidden → falls back to this) |
| `provider_readiness_receipt_ttl_seconds` | lifetime of one content-bound readiness receipt and its explicit probe observations | integer `1..86400` (default 300; invalid values fail safe to default) |
| `provider_readiness_fallback_family_constraint` | family admission for ordered readiness fallbacks; unknown family never satisfies `different` | `different` (default) `\| any` |
| `min_panel_size` | **minimum panel-size floor** for a homogeneous (single-family) qc panel — a homogeneous panel must not drop below this many distinct-lens reviewers. Emitted **separately** from `required_review_families` on purpose: lens diversity ≠ family decorrelation, and same-family lenses can still share blind spots, so panel size and family count are independent knobs. Standalone integer — NOT coupled to review_risk / families / source-trust | integer ≥ 1 (default 3); garbage / missing / `0` / negative → fail-safe 3 |
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
ENFORCES (same pattern as `resolve-doa`/`resolve-qc-gate`). Full design: [`docs/plans/2026-06-26-trust-tiered-review-policy.md`](../docs/plans/2026-06-26-trust-tiered-review-policy.md).

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
  `gpt-5.3-codex-spark` remains the default for tasks where the agent must run build/test itself.
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
  - implementer_engine: <provider-model-id>     # e.g. MiniMax-M3, glm-5.2
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
  | MiniMax (intl) | `https://api.minimax.io/anthropic` | `MiniMax-M3` | the `.io` host (a `.minimaxi.com` host 401'd for one intl key — use whichever your account is provisioned for); **M3 returns clean text; M2.x leaks a `thinking` block** so prefer M3 |
  | Zhipu/GLM | `https://api.z.ai/api/anthropic` (or `https://open.bigmodel.cn/api/anthropic`) | `glm-5.2` | clean (no thinking leak); as of 2026-06-30 frequently **529-overloaded** — unproven under a full loop |

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
- The implementer's own passing tests are **not** the criterion — keep
  `independent_harness: on` so depth-0 builds adversarial cases the implementer
  didn't write (this is what caught vitest-blind / go multi-pkg build-fail / the
  override forgeability the implementer's green missed).

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
