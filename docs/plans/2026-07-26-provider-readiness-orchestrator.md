# Plan — Provider Readiness Orchestrator
<!-- autopilot-authority-claims: ["provider_readiness"] -->
> Status: ✅ Shipped in v2.34.0 — merged as `c66349e` / Owner: CEO / Frame: independent readiness core with optional Kimi transport follow-up

## 0. Context / thesis

The 2026-07-26 TWGame review session rejected usable providers before reading the canonical
Autopilot configuration, missed the native Kimi CLI and its `kimi-code/k3` alias, trusted stale
Grok state, and discovered a verification-author qualification gap only near closeout.

Autopilot already has endpoint discovery, harness capability records, quota observations,
scorecards, a roster resolver, and safe probes. The missing piece is one preflight that resolves an
exact role tuple and reports three separate facts without conflating them:

1. transport/configuration availability;
2. live auth/quota availability;
3. role qualification.

Unknown or stale state must trigger a bounded probe instead of being interpreted as unavailable.

## 1. Problem

An orchestrator currently has to join facts from `endpoints`, harness records, quota state,
`resolve-review-loop.sh`, and `engine-scorecard.js`. Different runner types use different identity
keys, and native Kimi is not an admitted author/reviewer runner. This makes routing depend on agent
memory and causes false rejection, late blocking, and manual provider recovery.

## 2. OKR / KRs

**Objective:** Make provider selection a deterministic, probe-backed Autopilot preflight.

- **R1 / KR1 — exact tuple identity:** Every result is keyed by
  `{role, runner, model, effort, endpoint|null}`. Endpoint-backed wallets are never collapsed into a
  runner/model-only row.
- **R2 / KR2 — three-axis truth:** The result independently reports `transport`, `live`, and
  `qualification`, each as `ready|blocked|unknown`, with observation time, TTL, and evidence class.
- **R3 / KR3 — stale-state behavior:** A stale or absent observation for a selected seat triggers the
  configured bounded probe. It never directly becomes `unavailable`.
- **R4 / KR4 — bounded live probe:** Safe surface checks run first. When they cannot establish live
  auth/quota, one minimal no-effect provider request is allowed per exact tuple and TTL window; its
  spend and result are recorded without exposing credentials.
- **R5 / KR5 — optional native Kimi:** after the readiness core is usable, `kimi` may become a
  first-class read-only author/reviewer runner with explicit `kimi-code/k3` alias mapping and
  feature-detected headless invocation. This transport phase cannot block the readiness core.
- **R6 / KR6 — early L5/L6 gate:** All selected implementer, reviewer, verification-author, and QC
  seats receive one content-bound readiness receipt. ICC consumes it at its sole effectful intake;
  a blocked required seat is therefore reported before implementation dispatch and eligible
  configured fallbacks are named deterministically.
- **R7 / KR7 — honest CLI:** `autopilot status readiness --json [--probe]` and human output explain
  whether a seat is usable now and why. No remaining-quota percentage is invented.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Provider identity is the exact tuple `{role, runner, model, effort, endpoint|null}`; never collapse endpoint-backed wallets into runner/model-only state.
- `transport`, `live`, and `qualification` are independent axes; no axis may be inferred from another.
- Unknown or stale provider state triggers a bounded probe and must never be rendered as unavailable without probe evidence.
- Safe probes run before live probes; a live probe is limited to one minimal no-effect request per exact tuple and TTL window.
- Credentials and bearer tokens must never appear in argv, JSON output, logs, fixtures, or error messages.
- Native Kimi support is read-only author/reviewer transport only; this plan does not qualify Kimi for a role by assertion.
- Existing `autopilot status quota|runs|roster` output remains backward compatible.
- PRO exports pure readiness decisions/receipts and does not wire `autopilot-engine.js`, claim
  campaign generations, or choose Mission scope.
- PRO consumes the shared `RunnerTransportEnvelope` for mechanical runner outcomes and owns only
  probe/readiness observation validation; it does not create a second raw-output envelope.

## 3. File-structure map

| File | Responsibility |
|---|---|
| `src/readiness/provider-readiness.js` (new) | Pure tuple normalization, three-axis aggregation, TTL decisions, fallback eligibility, and verdict construction. |
| `src/readiness/probe.js` (new) | Safe-first then bounded-live probe coordinator; consumes the shared runner envelope and deduplicates exact tuples within TTL. |
| `schemas/provider-readiness-receipt.schema.json` (new) | Exact seat tuple, axis evidence/TTL, ordered eligible fallbacks, policy digest, observation digest, and receipt binding. |
| `src/runners/kimi.js` (new) | Feature-detected native Kimi read-only invocation and normalized result. |
| `src/status/cli.js` | Add `readiness` collection and human/JSON rendering without changing existing subcommands. |
| `bin/autopilot.js` | Expose `status readiness [--json] [--probe]`. |
| `scripts/dispatch-author.sh` | Admit the `kimi` runner and delegate to the native transport without shell interpolation. |
| `scripts/resolve-review-loop.sh` | Emit normalized exact tuples and make Kimi a valid configured/fallback runner. |
| `scripts/engine-capability-state.js` | Store endpoint-aware live observations and TTL evidence for exact tuples. |
| `scripts/engine-scorecard.js` | Provide an exact-tuple role-qualification lookup consumable by readiness preflight. |
| `.claude/review-loop-config.md` and `project-config-template/review-loop-config.md` | Document Kimi model alias and readiness/probe policy fields. |
| `hooks/tests/status-cli.test.sh` | Readiness CLI contract, backward compatibility, redaction, stale/unknown cases. |
| `hooks/tests/dispatch-author-kimi.test.sh` (new) | Native Kimi argv/stdin, alias, timeout, malformed response, and missing-binary fixtures. |
| `hooks/tests/provider-readiness.test.sh` (new) | Three-axis matrix, TTL dedupe, fallback ordering, exact endpoint identity, intake fail-closed behavior. |
| `hooks/tests/provider-readiness-consumer.test.sh` (new) | Pure consumer contract: valid/expired/drifted/blocked receipts and eligible fallback binding; no engine wiring. |
| `schemas/review-loop-contract.schema.json` | Schema additions for exact seat tuples and readiness policy. |
| `platforms/codex/plugin/**` | Regenerated mirror through the canonical sync script; never hand-edited. |

## 4. Phases

### Phase 1 — Pure readiness contract and exact identity (L)

**Depends on:** none.

1. Add fixture matrices for subscription, endpoint-backed, and native CLI tuples. Include:
   fresh-ready, stale-ready, unknown, missing binary, auth failure, quota exhausted, unqualified,
   and same model through two endpoints.
2. Implement `provider-readiness.js` as a pure join over existing observations. It returns:
   `tuple`, three axis objects, `usable_now`, `probe_required`, `blocking_reasons`, and ordered
   `fallbacks`.
3. Make missing/stale data produce `unknown + probe_required`, never `blocked`.
4. Extend capability-state keys with `endpoint|null` while preserving reads of legacy rows as
   endpoint-ambiguous evidence rather than silently assigning them.

**Acceptance:** `bash hooks/tests/provider-readiness.test.sh` passes, including two endpoint wallets
for the same runner/model remaining distinct.

### Phase 2 — Safe-first bounded probe coordinator (L)

**Depends on:** Phase 1.

1. Reuse existing binary/auth surface probes for the safe stage.
2. Add a live-probe adapter interface whose request is fixed, read-only, minimal, and not caller
   supplied.
3. Persist `observed_at`, TTL, exact tuple, outcome class, and redacted evidence. A fresh observation
   prevents a second live request.
   `scripts/engine-capability-state.js` is the sole persistence target for the live-probe outcome,
   spend class, observation time, and TTL; stored evidence is limited to the redacted outcome class
   and never includes the credential-bearing response.
4. Treat timeout, transport failure, auth failure, quota exhaustion, and malformed response as
   distinct outcomes.
5. Prove tokens cannot enter argv/output with sentinel-secret fixtures.

**Acceptance:** the fixture live probe runs once on the first stale lookup, zero times on the second
lookup inside TTL, and reruns after an injected clock crosses TTL.

### Phase 3 — Optional native Kimi author/reviewer runner (L, independent follow-up)

**Depends on:** Phase 1. Does not block Phase 4 or readiness-core shipment.

1. Feature-detect the installed `kimi` CLI and its non-interactive/headless surface; fail closed when
   the required flags are absent.
2. Add an explicit model mapping for `kimi-code/k3`; do not guess a default model.
3. Pass the prompt through the installed CLI's detected non-interactive contract. Kimi 0.28.0 may
   use a direct argv vector with `--prompt <prompt>` because it exposes neither stdin nor a prompt
   file flag. Never build a shell command or use evaluation/interpolation; run from an isolated
   scratch cwd, redact the prompt from public receipts/errors, and keep argv/raw transcript evidence
   private.
4. Return exit, timeout, and private raw reference through the shared runner envelope; validate the
   Kimi-specific semantic body only inside PRO. Empty/malformed semantic output never changes the
   mechanical transport SSOT.
5. Admit `kimi` in `dispatch-author.sh` and the resolver schema.

**Acceptance:** `bash hooks/tests/dispatch-author-kimi.test.sh` passes against a fake CLI capturing
the direct argv vector and cwd, proving the exact `kimi-code/k3` alias, isolated scratch execution,
no shell evaluation, public-output prompt redaction, bounded timeout/exit behavior, and fail-closed
empty or malformed semantic output. A local opt-in smoke returns a non-empty response from
`kimi-code/k3`; transport support alone never asserts role qualification or a hard no-effect
guarantee absent a CLI-enforced read-only flag.

### Phase 4 — Receipt and CLI integration (L)

**Depends on:** Phases 1–2 only.

1. Add `autopilot status readiness [--json] [--probe]`; without `--probe`, it is observation-only.
2. Render a one-line decision for each selected seat:
   `usable`, `probe-needed`, or `blocked`, followed by the exact failing axis.
3. Emit a content-bound `ProviderReadinessReceipt` for the selected roster and policy. Expired,
   tuple-drifted, policy-drifted, or incomplete receipts fail validation; unknown stays unknown.
4. Resolve fallbacks through configured order and family constraints; never promote an unqualified
   fallback. The receipt names the decision but performs no dispatch.
5. Keep existing `status`, `status quota`, `status runs`, and `status roster` byte-compatible where
   fixture-pinned.

**Acceptance:** `hooks/tests/provider-readiness-consumer.test.sh` proves that a fixture with stale
Grok, ready MiniMax endpoint, ready Kimi transport but missing qualification, and exhausted Fable
produces four distinct decisions; its blocked receipt is rejected by a generic pure consumer.
ICC separately proves that rejection happens before branch/worktree/runner spend.

### Phase 5 — Package sync and documentation (S)

**Depends on:** Phase 4.

1. Update architecture/front-door documentation with the readiness decision contract.
2. Run `bash scripts/sync-codex-plugin-skills.sh` and then
   `bash scripts/sync-codex-plugin-skills.sh --check`.
3. Add a CHANGELOG entry when implementation ships.

**Acceptance:** mirror check and documentation invariant checks pass.

## 5. Test / validation

```bash
bash hooks/tests/provider-readiness.test.sh
bash hooks/tests/dispatch-author-kimi.test.sh
bash hooks/tests/provider-readiness-consumer.test.sh
bash hooks/tests/status-cli.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/engine-scorecard.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

Red cases must prove stale state is not blocked before probing, endpoint wallets remain distinct,
unqualified does not mean transport-down, and a secret sentinel never appears in captured output.
The optional real Kimi smoke is human-gated because it spends provider quota.

## 6. Risks + inversion

| Failure guarantee | Mitigation |
|---|---|
| Treating a stale row as current truth | Unknown/stale is a first-class state that mechanically requests a probe. |
| Probing every candidate on every turn | Exact-tuple TTL dedupe and probe only selected seats plus ordered fallbacks as needed. |
| Conflating auth, quota, transport, and qualification | Three independent axes with fixture matrices. |
| Leaking provider secrets through debug output | Environment/private-file transport and sentinel redaction tests. |
| Claiming Kimi is qualified because its CLI works | Transport support and role scorecard remain separate axes. |
| Breaking existing status consumers | Additive subcommand and byte-compatibility fixtures. |

## 7. Out of scope

- Purchasing quota, changing provider subscriptions, or rotating credentials.
- Predicting a numeric remaining-quota percentage that the provider does not expose.
- Automatically qualifying a model without the existing known-bad/clean scorecard process.
- Replacing the review controller or adding N-seat panel semantics; that belongs to the separate
  review-controller plan.
- Worktree/branch lifecycle budgets; covered by the existing lifecycle plan.
- Effectful `engine implement-review` intake ordering, campaign generations, and pre-spend spawn
  blocking; ICC consumes this plan's pure receipt at its canonical composition point.
- Mission budget/scope and task-level `can_close`.

## 8. Open questions

None. The Board already directed automatic provider probing and named native Kimi routing.

## Review log

- R0 (2026-07-26): Authored from the transcript investigation. Rubric frozen in
  `2026-07-26-provider-readiness-orchestrator.rubric.md`.
- R0.5 Kimi K3: CONDITIONAL. Confirmed and repaired the missing canonical L5/L6 intake call site,
  end-to-end dispatch-blocking test, and live-probe persistence wording.
- R1 MiniMax-M3 + GLM-5.2: both READY, zero findings. Durable ticket
  `transcript-followup-provider-readiness-orchestrator`, terminal generation 1.
- R2 ownership consolidation: removed direct `autopilot-engine.js` ownership, made the readiness
  receipt the integration boundary, and made native Kimi an independent optional phase. The R1
  plan/rubric hash is historical; this revision requires a new bounded review.
