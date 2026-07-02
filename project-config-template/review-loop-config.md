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
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
- loop_max_rounds: 5
- loop_convergence_verdict: SHIP-AS-IS
- spec_review: on
- independent_harness: on
- qc_panel: gpt-5.5, claude-opus, gemini-flash
- qc_panel_aggregation: union-on-verified-critical
- review_diff_scope: full

> **The terminal qc panel** (`qc_panel`) is the authoritative depth-0 gate — a
> **disjoint-family** panel (OpenAI / Anthropic / Google), distinct from the inner-loop
> `reviewer_engine`. The point is that ≥1 panel family differs from the **implementer's**
> family, so a bug the implementer+its-family-reviewer jointly miss is caught by a different
> vendor (PoLL, arXiv 2404.18796). The resolver WARNS if the panel shares the implementer
> family (`family_of()` knows openai/anthropic/google/**xai**/**minimax**/**zhipu**). Gemini joins
> read-only via `dispatch-review.sh --runner agy`, and **xAI via `--runner grok`** (put a
> `grok-build`/`grok-composer-2.5-fast` in the panel for an extra disjoint family). Aggregation is **`union-on-verified-critical`**:
> any panelist's *verified* Critical blocks; a panelist's empty/no-verdict is fail-closed (NOT a
> pass); **majority vote is forbidden** (it would suppress the single-track blind-spot catch that
> is the whole reason for a panel).

## Field reference

| Field | Meaning | Values |
|-------|---------|--------|
| `reviewer_engine` | the **decorrelated** adversarial reviewer (spec + impl loops) | a model name (e.g. `gpt-5.5`); resolved via `reviewer_runner` |
| `reviewer_effort` | reviewer reasoning effort | `low\|medium\|high\|xhigh\|max` |
| `reviewer_runner` | how the reviewer is invoked (→ `dispatch-review.sh --runner`) | `codex` (`codex exec`) `\| agy` (Gemini) `\| grok` (xAI; read-only) `\| cc-shim` (any Anthropic-compat model, e.g. MiniMax-M3 — needs the same `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` env as the cc-shim implementer) `\| auto` |
| `implementer_engine` | the heterogeneous implementer | a model name (e.g. `gpt-5.3-codex-spark`, `Gemini 3.5 Flash (High)`, `grok-composer-2.5-fast`, `MiniMax-M3`) |
| `implementer_effort` | implementer reasoning effort (codex only) | `low\|medium\|high\|xhigh\|max` |
| `implementer_runner` | dispatch-hetero runner | `auto\|codex\|agy\|grok\|cc-shim` (→ `dispatch-hetero.sh --runner`). `auto` routes `*gpt*`/`*codex*`→codex, `*grok*`/`*composer*`→grok, else agy; **`cc-shim` must be set EXPLICITLY** (see Gotchas) |
| `loop_max_rounds` | adversarial-loop convergence cap per phase | integer (default 5) |
| `loop_convergence_verdict` | the reviewer verdict that ENDS a loop | `SHIP-AS-IS` (loop continues on `FIX-THEN-SHIP`/`RECONSIDER`) |
| `spec_review` | run the reviewer loop on the spec BEFORE dispatching impl | `on\|off` |
| `independent_harness` | depth-0 builds its OWN adversarial harness (never trusts the implementer's green) | `on\|off` |
| `qc_panel` | the authoritative depth-0 terminal gate — a disjoint-family reviewer panel (≥1 family ≠ implementer) | comma list of model names (e.g. `gpt-5.5, claude-opus, gemini-flash`) |
| `qc_panel_aggregation` | how panel verdicts combine | `union-on-verified-critical` (default; majority is forbidden → falls back to this) |
| `review_diff_scope` | how much the per-round reviewer reads (cost vs regression-catching) | `full` (re-read whole `base..HEAD` each round — safe, O(n) cost growth) `\| incremental-mitigated` (read `prev..HEAD` + full content of files-touched + invariants list + periodic/critical-path full re-read + **mandatory final full review before merge**) |
| `work_domain` | **emitted telemetry, NOT a config/routing knob** — the deterministic dominant domain of a diff (via `--auto-domain`/`--domain`; computed by `scripts/probe-diff-domain.sh`) | `rust\|backend-cli\|frontend\|docs\|mixed` (read-only record; selects no engine — domain routing is BACKLOG'd) |
| `domain_source` | **emitted telemetry** — provenance of `work_domain` | `explicit` (valid `--domain`) `\| auto` (successful `--auto-domain` probe) `\| none` (no flag / non-git / empty diff / probe failure ⇒ `work_domain=mixed`) |

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
  untrusted diff prefer the `codex` reviewer with `bwrap` installed. **MiniMax-M3 is calibrated as a
  reviewer** (2026-06-30: 10/10 `evals/known-bad` caught, false-pass-on-critical = 0, 3/3 clean) → safe
  in a `qc_panel`. **GLM-5.2** is endpoint-verified but was 529-overloaded under load — re-Spike before trusting.
- The implementer's own passing tests are **not** the criterion — keep
  `independent_harness: on` so depth-0 builds adversarial cases the implementer
  didn't write (this is what caught vitest-blind / go multi-pkg build-fail / the
  override forgeability the implementer's green missed).
