# engine-capability-state — /l5 hetero-loop dogfood

> Implements `docs/plans/2026-07-02-engine-capability-state.md` (Codex R0 proposal): an
> evidence-backed runtime capability-state layer — quota/reset awareness + skill-transport
> awareness + a low-cost bench — so `/l5`/`/l6` can dispatch quota-aware and skill-aware.

**Process**: `/l5` CEO-at-depth-0. Implementer = **agy / Gemini 3.5 Flash (High)** (switched from
`gpt-5.3-codex-spark` after it hit its usage cap — the exact pain this plan addresses), reviewer =
**gpt-5.5 xhigh via codex** (decorrelated, cross-family). Depth-0 (claude-opus) holds authoritative
qc: independent full-suite harness + empirical verification of every fix; exec-bit + codex-payload
sync are depth-0 steps (agy is edit-only and cannot set file modes).

Base: `88afd609` (develop). Batches dispatched sequentially (dependency chain P0→…→P5).

## Batch 1 — P0 store/contract + P1 passive quota capture + safe probe ✅ CONVERGED

- **HEAD** `17069de` on `feat/eng-cap-state-b1-r2` (not merged).
- **Artifacts**: `schemas/engine-capability-state.schema.json`, `scripts/engine-capability-state.js`
  (record/current/report/prune/classify-error; flock+PID-stale-breaker, monotonic event_id,
  additionalProperties enforced, UTC-required timestamps, TTL merge with unknown-never-clobbers-known),
  `scripts/probe-engine-capability.sh` (safe + `--live-spend`, read-only), passive quota capture wired
  into `dispatch-hetero.sh` + `dispatch-review.sh` (status-keyed, not exit-code), 5 test files.
- **Review loop** (gpt-5.5 decorrelated): **6 rounds, 19 findings, all verified real + fixed**; severity
  🔴 only in R1, trended to hygiene by R7 (temp-leak trap) → converged by depth-0 judgment.
  - R1 F1-F4 (passive_capture def-order, exit-code key, JSON escape, live-spend) · R2 G1-G2
    (additionalProperties, over-broad quota classifier) · R3 H1-H4 (store path, non-quota poison,
    dispatch JSON escape, probe shift) · R4 I1-I3 (merge event_id, prune blank-line, codex rc) ·
    R5 J1-J2 (unknown clobbers known, tz-less timestamps) · R6 K1-K2 (probe live-spend unsafe flags,
    codex review not fail-closed) · R7 (probe temp-leak trap).
  - Bonus hardening of pre-existing infra: **`dispatch-review.sh` codex path now fail-closes on
    nonzero exit** (K2) — a quota-limited codex review with a partial `VERDICT:` can no longer be
    accepted as valid.
- **Tests**: 4 target suites green; full suite **85/86** (only pre-existing `intent-capture-basic-write`
  fails — verified identical on clean develop base, environment-specific canonical-session-id).

## Batch 2 — P2 skill-transport flag + P3 capability bench ✅ CONVERGED

- **HEAD** `0482832` on `feat/eng-cap-state-b2` (base `17069de`).
- `--skill-mode off|prompt|native|auto` + repeatable `--skill <name>` on `dispatch-hetero.sh` (bounded
  skill pack ≤60KB, provenance `skill_mode_effective`/`skills_injected`, PATH-TRAVERSAL guard on skill
  names); `bench-engine-capability.sh` (native vs prompt-pack, honest recording via isolated temp store,
  sanitized bench dir, fixture-only tests + 4 bench cases).
- **Review loop**: 4 rounds. R1 (5 findings incl. **L5 `--skill` path traversal → arbitrary-file-read
  into an external-runner prompt**, verified exploitable) · R2 (M1 skill_transport per-field merge, M2
  bench-dir sanitize) · R3 (N1 bench native-honesty via temp store, N2 packed-prompt temp cleanup) · R4
  (O1/O2 both **verified non-issues** — O1 already handled by the M1 per-field merge, O2 EXIT-trap is
  sole + coexists with INT/TERM; cleaned O1's dead read).
- **Bonus fix**: a PRE-EXISTING Batch-1 latent bug — an expired medium/low quota did `continue`,
  skipping the skill_transport in the SAME row (invisible until a bench event carried both). Now the
  quota merge is guarded (not continued) and skill_transport merges per-field.
- **Tests**: full suite **86/87** (only pre-existing `intent-capture`), verified in FOREGROUND (see
  finding #4 below).

## Batch 3 — P4 resolver consumption + P5 docs/config 🔄 IN PROGRESS

- P4 (agy): `resolve-review-loop.sh` capability fields (`quota_status`/`skill_mode_effective`/
  `capability_warnings`/…), report-only + demote-only-on-exhausted-high-fresh, `/l4` untouched.
- P5 (depth-0): docs (`references/hetero-dispatch.md`, review-loop-config template), CLAUDE.md/AGENTS.md
  inventory (closes the batch1 R5 J3 finding), CHANGELOG + version bump (**PATCH** per repo semver —
  new scripts, not a new skill/agent), BACKLOG close. Base `0482832`.

## Findings during the run (worth keeping)

1. **`gpt-5.3-codex-spark` hit its usage cap** mid-run (reset ~21:26) → the dispatch surfaced as
   `question_suspected` (a MISCLASSIFICATION of quota exhaustion) — live proof of this plan's value.
   CEO switched implementer to agy/Gemini via `$REVIEW_LOOP_CONFIG_OVERRIDE` (no repo-default change).
2. **`engine implement-review` internal review has a JSON-parse bug** — the engine's review phase
   `blocked` with "Expected ',' or '}' … in JSON", stalling the automated loop at `dispatch_review`.
   Depth-0 took over the review loop manually (dispatch-review.sh direct). **This is a real engine-layer
   defect worth a separate fix** before the engine CLI can drive `/l5` review end-to-end.
3. **agy is edit-only** → cannot set exec bits; every new `.js`/`.sh` needs a depth-0 `chmod +x`
   (the `.js` is invoked directly by dispatch-hetero passive_capture, so 644 = silent skip).
4. **Background Bash tasks need an explicit high `timeout`** — the default 120s SIGTERMs long codex
   reviews / full-suite runs (two were killed mid-flight; not an OOM/interrupt — root-caused to the
   2-min default). Use `timeout: 600000`.
5. **Don't run the full suite in the shared verify-worktree while committing to it** — a concurrent
   commit made `codex-plugin-package` transiently fail (payload drift race); quiescent re-run is green.
