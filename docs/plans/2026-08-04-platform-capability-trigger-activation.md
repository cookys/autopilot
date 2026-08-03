---
status: review-transport-exhausted
date: 2026-08-04
size: H
entry_level: l5
project: platform-capability-trigger-activation
logical_plan_id: platform-capability-trigger-activation-2026-08-04
---

# Plan — Platform capability trigger activation and strict-L5 bootstrap

> Owner: CEO controller · Planned branch: `feat/platform-capability-trigger-activation` ·
> Frame: one cumulative Mission, four ordered deliverables, one integrated verification/review gate

## 0. Context / thesis

The 2026-08-04 capability re-audit compared current code, installed CLIs, live probes, and upstream
CHANGELOG/release evidence. Three backlog prerequisites are no longer future conditions:

- Codex added official `PreCompact`/`PostCompact` plugin hooks in 0.129.0 (PR #19905), and the
  installed 0.146.0 source exposes the documented registration and runtime contract.
- agy 1.1.8 added structured JSON/stream-JSON output; a live agy 1.1.10 call returned authoritative
  `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, and `total_tokens` usage.
- strict `/l5` is blocked by an internal CLI composition gap, not an unavailable external platform:
  the Engine accepts constructor-owned `providerReadinessAuthority` and `qualificationProvider`, but
  `bin/autopilot.js engine implement-review` does not inject them.

The same audit found stale harness records: installed Codex 0.146.0, Claude Code 2.1.220, agy
1.1.10, OpenCode 1.17.15 (latest 1.18.11 also probed), and Grok 0.2.118 exceed several recorded
baselines. Changelog claims are discovery evidence only. Promotion still requires a version-bound
live event/behavior probe.

This plan admits those facts as one bounded implementation graph. D1 freezes current capability
contracts, D2 and D3 consume the verified agy and Codex contracts, and D4 closes the repo-owned
strict-L5 trust root. Tests, repairs, review seats, doc sync, and release bookkeeping are gates inside
the four deliverables; they are not extra phases.

## 1. Problem

Autopilot currently knows about three usable capabilities but does not consume them in production:

1. agy dispatches still capture plain PTY output, so `engine-scorecard.js` deliberately emits
   `agy_schema_not_exposed` and cannot compare agy usage with other runners.
2. the Codex package ships a host-neutral post-compaction adapter and a probe package, but the
   production package remains skills-only and never invokes the adapter on `PostCompact`.
3. the ordinary strict `/l5` CLI constructs `AutopilotEngine` without a live qualification/readiness
   authority and therefore fails closed with `provider_readiness_authority_missing`.

Solving any one against stale harness assumptions risks either a false capability claim or a second
parallel contract. The goal is an atomic, evidence-bound activation of all three.

## 2. OKR / KRs

**Objective:** turn the newly satisfied platform triggers into one production-ready, fail-closed
Autopilot capability slice.

- **KR1 — evidence:** one committed capability receipt binds every probed command to runner/model,
  CLI version, evidence class, command/output digest, observation time, and pass/fail/blocked verdict.
- **KR2 — agy telemetry:** successful agy review and implementer runs preserve the model response for
  the existing framing/status parser and emit normalized harness-native usage; malformed, missing,
  duplicate, truncated, or non-zero structured output yields no accepted result or fabricated usage.
- **KR3 — Codex recovery:** official `PostCompact` manual and auto events invoke the production
  adapter exactly once, and no first effectful post-compact action is admitted before a valid
  reconciliation receipt.
- **KR4 — strict L5:** the ordinary CLI constructs a host-owned, non-serializable exact-tuple
  qualification/readiness bootstrap; ready live tuples proceed, while missing/stale/mismatched,
  replayed, or disk-only evidence fails before model spend.
- **KR5 — closure:** root and generated Codex payloads are synchronized, focused negative matrices
  and the full test suite pass, documentation/backlog are truthful, and one independent cumulative
  review covers the frozen base-to-candidate range.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Do not preserve backward compatibility; update every in-repo producer, consumer, schema, fixture, and generated mirror atomically, then remove the superseded path.
- Use no new third-party dependency; use Node.js, shell, existing repository libraries, and native runner output contracts only.
- A CHANGELOG or release note may discover a capability, but only a version-bound live event or behavior probe may promote it to supported.
- agy token usage authority is the harness-native structured envelope from the exact dispatched process; transcript inference and worker-authored JSON are never usage authority.
- Codex `PostCompact` support must use the official event name, `manual|auto` matcher, payload, ordering, and failure semantics; the first effectful post-compact action remains blocked until exact-root reconciliation succeeds.
- Strict `/l5` readiness and qualification authority must be constructor-owned, non-serializable, exact-tuple-bound, fresh, and consumed before spend; a disk receipt is evidence, never authority.
- Production sources are edited only in the root tree; `platforms/codex/plugin` mirrors are regenerated by `scripts/sync-codex-plugin-skills.sh` and never hand-edited.
- The Mission has exactly D1–D4 and at most two repair generations per deliverable; tests, review, repair, doc sync, and release work remain gates inside their owning deliverable.

## 2.6 Change-policy decisions

- **Compatibility impact**: `authorized-breaking`. The supplied repository policy explicitly says
  not to preserve backward compatibility. Agy capture/result usage and Codex package hook wiring are
  published surfaces; migrate all bundled consumers and generated mirrors in the same cumulative
  change, document the contract in `docs/CHANGELOG.md`, and bump the package version only during the
  authorized release/finish flow. Rollback is the whole cumulative commit range, not a legacy parser
  or a hidden compatibility flag. Contract validation is the focused schema/dispatch/hook matrix plus
  full suite.
- **Dependency decision**: `platform/stdlib`. Node.js JSON parsing, existing shell containment, and
  current readiness/reconciliation modules fully satisfy the requirement; no library addition or
  custom protocol is needed.

## 3. File-structure map

| Surface | Responsibility |
|---|---|
| `scripts/probe-harness-capabilities.sh` (new) | Deterministic, version-bound probe driver for the exact Codex/agy/Grok/OpenCode/Claude capabilities used by this plan; emits one aggregate receipt without promoting changelog-only claims. |
| `skills/harness-maintenance/SKILL.md`, `CLAUDE.md` | Register the probe in the canonical maintenance workflow and script inventory. |
| `references/multi-agent-portability.md`, `docs/installation.md` | Publish only live-proven capability/version facts and retain explicit blocked/unverified rows. |
| `docs/projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json` (new) | Durable D1 receipt consumed by D2–D4 and final review. |
| `scripts/dispatch-status.js` | Parse declared agy structured envelopes into separately normalized response and usage; reject malformed or ambiguous envelopes without content sniffing. |
| `scripts/dispatch-review.sh`, `schemas/review-result.schema.json` | Capture agy native JSON, feed only its response to verdict framing, and expose normalized usage on every review result path (`null` when unavailable). |
| `scripts/dispatch-hetero.sh`, `schemas/runner-result.schema.json` | Capture agy native JSON for implementers and source result usage from that envelope rather than worker output. |
| `scripts/engine-scorecard.js` | Import measured agy usage from emitted dispatch results; remove the unconditional `agy_schema_not_exposed` special case while keeping historical transcript-only samples explicitly unavailable. |
| `platforms/codex/plugin/hooks/hooks.json` (new), `platforms/codex/plugin/hooks/post-compact.js` (new) | Register the official production `PostCompact` hook and translate the official payload into the host-neutral adapter CLI. |
| `scripts/compaction-rehydrate.js`, `src/engine/controller-execution.js`, `src/engine/continuation-admission.js` | Seal the production hook input/output contract and enforce reconcile-before-effect semantics without a second recovery implementation. |
| `bin/autopilot.js`, `src/readiness/provider-bootstrap.js` (new) | Build and constructor-inject the fixed repo-owned exact-tuple qualification/readiness bootstrap for ordinary strict-L5 CLI use. |
| `src/readiness/status.js`, `src/readiness/qualification-provider.js` | Reuse live probing and non-serializable one-shot qualification; expose only the minimum bootstrap seam needed by the CLI. |
| `hooks/tests/harness-capabilities.test.sh`, `hooks/tests/dispatch-status.test.sh`, `hooks/tests/dispatch-review.test.sh`, `hooks/tests/dispatch-hetero.test.sh`, `hooks/tests/engine-scorecard.test.sh` | D1/D2 positive, malformed, spoof, truncation, non-zero, and historical-unavailable matrices. |
| `hooks/tests/codex-compaction-rehydration.test.sh`, `hooks/tests/codex-hook-probe-package.test.sh`, `hooks/tests/codex-plugin-package.test.sh` | D3 package registration, payload translation, manual/auto live replay, ordering, exactly-once, and failure semantics. |
| `hooks/tests/provider-readiness-consumer.test.sh`, `hooks/tests/mission-routing-campaign-bridge.test.sh`, `hooks/tests/autopilot-cli.test.sh`, `hooks/tests/autopilot-engine.test.sh` | D4 exact tuple, freshness, replay, authority ownership, pre-spend, and ordinary CLI acceptance. |
| `scripts/sync-codex-plugin-skills.sh`, `platforms/codex/plugin/**` | Mechanically regenerate and verify all bundled source/schema/script mirrors after each deliverable. |
| `docs/BACKLOG.md`, `docs/CHANGELOG.md` | Keep trigger status, plan ownership, residual blocks, and shipped contract truthful. |

## 4. Ordered deliverable graph

```text
D1 capability requalification
  ├──> D2 agy structured telemetry
  ├──> D3 Codex PostCompact production adapter
  └──> D4 strict-L5 readiness bootstrap
             └──> one cumulative independent verification/review + doc/version finish gate
```

D2 and D3 may be prepared in parallel only after D1 freezes their exact contracts. They merge into
the same cumulative Mission branch in D2-then-D3 order. D4 lands last because it consumes the
qualified provider tuples and controls pre-spend admission. Each deliverable owns its test and repair
budget; a failed gate repairs that deliverable instead of creating D5.

### D1 — Refresh and freeze harness capabilities (`L`)

**Input:** installed CLIs, upstream changelog/release discoveries, current probe package, current
portability/install docs, and the stale backlog audit.

**Implementation:**

1. Add one deterministic probe driver with explicit per-runner version capture, bounded timeout,
   declared command, redacted output digest, result class (`official-doc`, `live-event`,
   `live-behavior`), and `pass|fail|blocked` verdict. It must never infer support from version order.
2. Probe the exact surfaces needed here: agy structured response+usage; Codex production plugin
   `PostCompact` registration plus manual and auto firing; Grok SessionEnd/headless usage event
   firing; OpenCode `debug skill` JSON completeness on installed 1.17.15 and isolated latest 1.18.11;
   Claude Code current hook baseline. Preserve the existing negative Codex install-generator and
   inconclusive `tier:` metadata findings as blocked unless a real probe changes them.
3. Emit the aggregate evidence receipt and update the portability/installation matrices with exact
   versions and evidence links. Do not promote Grok hooks from warning without a live event receipt.
4. Freeze the D2 agy envelope shape and D3 Codex payload/matcher/failure contract in the receipt;
   downstream deliverables consume those exact fields and digests.

**Output:** a version-bound capability receipt and truthful docs with `proven`, `blocked`, or
`unverified` per surface.

**Acceptance:**

```bash
bash scripts/probe-harness-capabilities.sh --all --output docs/projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json
bash hooks/tests/harness-capabilities.test.sh
bash hooks/tests/codex-hook-probe-package.test.sh
bash scripts/preflight-portability.sh
```

The receipt must prove the agy and Codex facts D2/D3 consume. A failed optional Grok/OpenCode/Claude
row remains an honest non-promoted row and does not block D2–D4 unless it contradicts a consumed
contract.

### D2 — Integrate agy structured telemetry (`L`)

**Input:** D1's exact agy 1.1.10 structured envelope contract and existing review/runner result
schemas.

**Implementation:**

1. Invoke agy with the proven native JSON format into a private envelope file. Extend the declared
   agy parser in `dispatch-status.js` to validate a single closed top-level envelope, emit the
   `response` separately for existing framing/status parsing, and normalize non-negative integer
   token fields into the existing usage shape. Do not sniff plain logs or trust response text.
2. Replace the agy PTY/plain capture paths in both dispatchers. A review parses only the extracted
   response; an implementer result uses only envelope-derived usage. Non-zero exit, malformed JSON,
   missing/duplicate response, invalid numeric usage, truncation, or trailing bytes fails closed and
   produces `usage:null` on failure results.
3. Add `usage` to the closed review-result schema and every review result path. Keep the generic
   runner-result usage contract closed. Update every in-repo consumer and fixture atomically.
4. Add a scorecard import path for emitted dispatch results. Historical agy transcript-only rows
   remain `unavailable: transcript_schema_not_exposed`; new harness-native rows become available and
   carry sample counts. Never merge the two evidence classes into a fabricated continuous series.
5. Regenerate the Codex payload mirror and update telemetry docs/CHANGELOG.

**Output:** authoritative agy usage on new dispatches and an evidence-class-aware scorecard.

**Acceptance:**

```bash
bash hooks/tests/dispatch-status.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/engine-scorecard.test.sh
node scripts/validate-json-schema.js --schema schemas/review-result.schema.json --document hooks/tests/fixtures/review-result/agy-reviewed.json
bash scripts/sync-codex-plugin-skills.sh --check
```

The negative matrix must include worker-printed fake usage, malformed/truncated/duplicate envelopes,
negative/fractional/overflow token values, non-zero exit after a valid-looking response, and old
transcript-only imports.

### D3 — Wire the Codex production `PostCompact` adapter (`L`)

**Input:** D1's exact Codex 0.146.0 event receipt and the existing host-neutral
`postcompact-adapter`/continuation-admission implementation.

**Implementation:**

1. Add a production Codex `hooks/hooks.json` entry for official `PostCompact` with the exact
   `manual|auto` matcher and a minimal Node adapter. The adapter validates the official payload,
   resolves the exact Git common dir/root/node/attempt identity, and invokes
   `scripts/compaction-rehydrate.js postcompact-adapter`; it must not copy reconciliation logic.
2. Persist only the existing sealed reconciliation receipt. Missing/ambiguous identity, invalid
   payload, adapter non-zero, duplicate invocation, stale worktree, or reconcile failure must block
   continuation and never degrade to warning-only success.
3. Prove ordering with an effectful sentinel command: both manual and forced-auto compaction must
   record successful reconciliation before the sentinel can run. Prove the inverse by breaking the
   adapter and observing the sentinel remain absent and the outer Codex action fail.
4. Replace the probe-only package boundary claim with the production boundary, retain the disposable
   probe only for capability maintenance, regenerate mirrors, and update portability/install docs and
   CHANGELOG.

**Output:** one official Codex PostCompact registration using the existing recovery authority.

**Acceptance:**

```bash
bash hooks/tests/codex-compaction-rehydration.test.sh
bash hooks/tests/codex-hook-probe-package.test.sh
bash hooks/tests/codex-plugin-package.test.sh
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

The committed live receipt must contain one manual and one auto firing plus the broken-adapter
negative control on the exact supported Codex version.

### D4 — Build the strict `/l5` CLI trust root (`L`)

**Input:** D1 qualified exact provider tuples, the existing non-serializable qualification provider,
live readiness collector, and constructor-only Engine adapter seam.

**Implementation:**

1. Add a fixed repo-owned bootstrap module whose closed allowlist names the supported exact
   `(runner, model, role, effort, endpoint, family)` tuples. Compile that policy into an in-process
   `createQualificationProvider` closure and a `providerReadinessAuthority` closure that runs the
   existing live readiness collection with probing enabled. No CLI flag or work-order field may
   replace either closure.
2. Construct the bootstrap in `bin/autopilot.js` only for strict `engine implement-review`, inject it
   through the `AutopilotEngine` constructor, and consume the fresh readiness bundle before the first
   model dispatch. Preserve lower-level non-strict flows explicitly; never label them strict L5.
3. Bind qualification/readiness to the roster selected for that invocation and record observation
   provenance in the Mission receipt. Reject missing qualification, stale TTL, wrong runner/model/
   role/effort/endpoint/family, fallback-family violations, serialized/replayed receipts, provider
   probe failure, or roster drift.
4. Add an executable command-level positive run and the full negative matrix. Assert no dispatcher
   invocation/model spend on every rejected case. Regenerate mirrors and document the trust boundary.

**Output:** ordinary strict `/l5` is usable only with a fresh, exact, host-owned readiness decision.

**Acceptance:**

```bash
bash hooks/tests/provider-readiness-consumer.test.sh
bash hooks/tests/mission-routing-campaign-bridge.test.sh
bash hooks/tests/autopilot-cli.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/supervised-engine-bridge-contract.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
```

The positive CLI fixture must reach dispatch admission; every negative fixture must terminate with
zero dispatcher calls and a specific readiness/qualification reason.

## 5. Test / validation strategy

Verification is independent of implementation. Implementers may run smoke tests, but the terminal
verifier owns the original frozen `base_sha` and final `candidate_sha` and executes the following on
that exact cumulative range:

```bash
bash scripts/validate.sh
bash scripts/sync-all.sh --check
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/check-canonical-invariants.sh
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
```

Additional required evidence:

- D1–D4 focused suites pass before the next deliverable starts.
- Every live platform receipt records the exact binary path/version and command/output digest, with
  secrets and raw prompts omitted.
- D2 and D3 each include at least one mutation/negative control proving their tests turn red when the
  new authority or ordering check is removed.
- D4 includes a dispatcher-call counter proving fail-before-spend behavior.
- One independent cumulative code review covers code, tests, schemas, generated mirrors, docs, and
  the four receipts after all local gates are green.
- Version bump and release automation run only in the existing bump-version/finish flow; generic
  GitHub Actions remain disabled as previously requested.

## 6. Risks + inversion

| What would guarantee failure | Mitigation / rollback proof |
|---|---|
| Treating a release note as runtime truth | D1 separates discovery from live-event/behavior receipts and blocks promotion without the latter. |
| Mixing agy response text and usage in one parser input | Capture one private native envelope, validate it once, then derive response and usage through declared modes. |
| Accepting worker-authored fake token JSON | Usage is read only from the exact harness process envelope after a zero exit; response/transcript text is never an authority source. |
| Registering a Codex hook with Claude payload assumptions | D3 is bound to D1's official Codex payload/matcher/failure receipt and translates only that shape. |
| Reconciliation happens after the first effectful action | A sentinel ordering oracle and broken-adapter inverse test make this a blocking acceptance condition. |
| Calling a serialized scorecard/receipt “host-owned” | D4 uses constructor-owned WeakMap-backed one-shot objects and live probing; disk artifacts cannot satisfy admission. |
| A broad four-topic mission explodes into test/review phases | The graph is fixed at D1–D4; every retry/gate remains charged to the originating deliverable. |
| Partial rollback leaves schema/mirror drift | Compatibility removal and generated payload migration are atomic; rollback is the complete cumulative range, followed by sync checks. |

## 7. Out of scope

- Codex install-time payload generation remains blocked until a supported fail-loud install/upgrade
  lifecycle exists on both required paths.
- OpenCode `debug skill` hard-fail restoration remains blocked; 1.17.15 and 1.18.11 still truncate the
  discovered-skill JSON near 65,536 bytes.
- Generic `tier:` frontmatter portability is not promoted from the current inconclusive receipt.
- Release-time payload publication, first local-runner integration, new scheduler/portfolio features,
  malicious same-UID hardening, pricing inference, or historical agy token reconstruction are excluded.
- This plan does not re-enable generic GitHub Actions and does not push, tag, publish, or release by
  itself.

## 8. Open questions

None. The owner has authorized the ordered plan, bounded hetero review loop, and backlog admission.
Any platform contradiction found by D1 fails closed inside D1 and may narrow only the contradicted
consumer deliverable with an explicit terminal receipt; it does not silently change a proven fact.

## Review log

- **R0 (2026-08-04, author):** scope normalized into four deliverables; source-plan/test/review rows
  were not expanded into execution phases. Self-review covered requirements, concrete file map,
  dependency order, compatibility/dependency decisions, placeholder scan, acceptance commands,
  risks, inversion, and out-of-scope boundaries.
- **Frozen rubric:** `docs/plans/2026-08-04-platform-capability-trigger-activation.rubric.md`.
- **Frozen seat manifest:** `docs/plans/2026-08-04-platform-capability-trigger-activation.plan-review-manifest.json`.
- **Routing source:** `docs/plans/2026-08-04-platform-capability-trigger-activation.review-config.md`;
  `plan_review:on`, maximum two generations, 7,200-second total wall.
- **Generation 1 (terminal):** formal controller artifact
  `~/.autopilot/plan-review/49fc06cb5dbe035dc6b2ae4a10a4464e01759711d8f1aa1180cf60494dfc4fc8/generation-01.json`.
  Frozen plan SHA-256 `db897d8f0a6f9c44a89596fb5c69d54fbf4be9fe9f7497a3df0b0467b61ce613`;
  verdict `CONDITIONAL`, policy `required_seat_transport_exhausted`, zero findings, zero accepted
  blockers, no generation-2 authorization. Gemini/Google returned machine-parsed `READY` with no
  findings; both Codex/OpenAI attempts failed before model invocation because the controller's
  scratch cwd was not trusted. The same-hash supplemental Sol seat then timed out with zero response;
  Claude native Opus and Fable failed pre-model with zero-byte captures. None of those failures was
  promoted to a semantic verdict.
- **Depth-0 disposition:** no blocker candidates exist to accept or reject, the terminal controller
  state is preserved, and no new ticket/generation was opened. The implementation contract above is
  unchanged from the frozen reviewed bytes; only this closeout metadata and frontmatter status were
  appended. Full receipt: [`2026-08-04-platform-capability-trigger-activation.review.md`](2026-08-04-platform-capability-trigger-activation.review.md).
