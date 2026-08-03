---
status: review-pending-r4
date: 2026-08-04
size: H
entry_level: l5
project: platform-capability-trigger-activation
logical_plan_id: platform-capability-trigger-activation-2026-08-04-r4
---

# Plan — Platform capability trigger activation and strict-L5 bootstrap

> Owner: CEO controller · Planned branch: `feat/platform-capability-trigger-activation` ·
> Frame: one cumulative Mission deliverable with four ordered internal gates (D1–D4)

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

This plan admits those facts as one bounded implementation deliverable. Its internal D1 gate freezes
current capability contracts, D2 and D3 consume only validated agy and Codex claim IDs, and D4 closes
the repo-owned strict-L5 trust root. Tests, repairs, review seats, doc sync, and release bookkeeping are
gates inside the same deliverable; they are not graph nodes or extra phases.

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

- **KR1 — evidence:** one closed, committed capability receipt binds every promoted claim to both an
  official contract and a fresh version-matched live observation, including agreement, expiry,
  revalidation, exact identity dimensions, and a content-addressed validated claim ID.
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
- The Mission has exactly one graph deliverable; D1–D4 are ordered internal gates, and the existing two-repair-generation ceiling applies to that one deliverable. Tests, review, repair, doc sync, and release work remain internal gates.

## 2.6 Change-policy decisions

- **Compatibility impact**: `authorized-breaking`. The supplied repository policy explicitly says
  not to preserve backward compatibility. Agy capture/result usage and Codex package hook wiring are
  published surfaces; migrate all bundled consumers and generated mirrors in the same cumulative
  change, document the contract in root `CHANGELOG.md`, and bump the package version only during the
  authorized release/finish flow. Rollback is the whole cumulative commit range, not a legacy parser
  or a hidden compatibility flag. Contract validation is the focused schema/dispatch/hook matrix plus
  full suite.
- **Dependency decision**: `platform/stdlib`. Node.js JSON parsing, existing shell containment, and
  current readiness/reconciliation modules fully satisfy the requirement; no library addition or
  custom protocol is needed.

## 3. File-structure map

| Surface | Responsibility |
|---|---|
| `schemas/platform-capability-claims.schema.json` (new), `scripts/platform-capability-claims.js` (new) | Closed receipt/claim schema plus canonicalization, claim-ID, agreement, freshness, exact-version, and revalidation validator. Only this validator can emit `validated` claim IDs. |
| `scripts/probe-harness-capabilities.sh` (new) | Deterministic probe driver for the exact Codex/agy/Grok/OpenCode/Claude capabilities used by this plan; supplies official-contract and fresh live observations to the claim validator without promoting changelog-only claims. |
| `skills/harness-maintenance/SKILL.md`, `CLAUDE.md` | Register the probe in the canonical maintenance workflow and script inventory. |
| `references/multi-agent-portability.md`, `docs/installation.md` | Publish only live-proven capability/version facts and retain explicit blocked/unverified rows. |
| `docs/projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json` (new) | Durable D1 receipt. D2–D4 may consume only validated claim IDs after immediate revalidation, never prose or an unvalidated receipt row. |
| `scripts/dispatch-status.js` | Parse declared agy structured envelopes into separately normalized response and usage; reject malformed or ambiguous envelopes without content sniffing. |
| `scripts/dispatch-review.sh`, `schemas/review-result.schema.json` | Capture agy native JSON, feed only its response to verdict framing, and expose normalized usage on every review result path (`null` when unavailable). |
| `scripts/dispatch-hetero.sh`, `schemas/runner-result.schema.json` | Capture agy native JSON for implementers and source result usage from that envelope rather than worker output. |
| `scripts/engine-scorecard.js` | Import measured agy usage from emitted dispatch results; remove the unconditional `agy_schema_not_exposed` special case while keeping historical transcript-only samples explicitly unavailable. |
| `platforms/codex/hooks/hooks.json` (new), `platforms/codex/hooks/post-compact.js` (new) | Canonical, non-generated Codex `PostCompact` manifest and adapter sources outside the packaged mirror. |
| `platforms/codex/plugin/.codex-plugin/plugin.json`, `platforms/codex/plugin/hooks/hooks.json` (generated), `platforms/codex/plugin/hooks/post-compact.js` (generated) | Package descriptor points at `./hooks/hooks.json`; hook payload files are generated only from the two canonical sources above. |
| `scripts/compaction-rehydrate.js`, `src/engine/controller-execution.js`, `src/engine/continuation-admission.js` | Seal the production hook input/output contract and enforce reconcile-before-effect semantics without a second recovery implementation. |
| `bin/autopilot.js`, `src/readiness/provider-bootstrap.js` (new) | `provider-bootstrap.js` is the exact canonical code source for `STRICT_L5_PROVIDER_POLICY` and deterministic six-dimensional roster projection; it builds and constructor-injects fresh in-process closures for ordinary strict-L5 CLI use. |
| `src/readiness/status.js`, `src/readiness/qualification-provider.js` | Reuse live probing and non-serializable one-shot qualification; expose only the minimum bootstrap seam needed by the CLI. |
| `hooks/tests/harness-capabilities.test.sh`, `hooks/tests/dispatch-status.test.sh`, `hooks/tests/dispatch-review.test.sh`, `hooks/tests/dispatch-hetero.test.sh`, `hooks/tests/engine-scorecard.test.sh` | D1/D2 positive, malformed, spoof, truncation, non-zero, and historical-unavailable matrices. |
| `hooks/tests/codex-compaction-rehydration.test.sh`, `hooks/tests/codex-hook-probe-package.test.sh`, `hooks/tests/codex-plugin-package.test.sh` | D3 package registration, payload translation, manual/auto live replay, ordering, exactly-once, and failure semantics. |
| `hooks/tests/provider-readiness-consumer.test.sh`, `hooks/tests/mission-routing-campaign-bridge.test.sh`, `hooks/tests/autopilot-cli.test.sh`, `hooks/tests/autopilot-engine.test.sh` | D4 exact tuple, freshness, replay, authority ownership, pre-spend, and ordinary CLI acceptance. |
| `scripts/sync-codex-plugin-skills.sh`, `platforms/codex/plugin/**` | Mechanically regenerate and verify all bundled mirrors after each internal gate, including exact `platforms/codex/hooks/hooks.json` → `platforms/codex/plugin/hooks/hooks.json` and `platforms/codex/hooks/post-compact.js` → `platforms/codex/plugin/hooks/post-compact.js` mappings. |
| `docs/BACKLOG.md`, root `CHANGELOG.md` | Keep trigger status, plan ownership, residual blocks, and shipped contract truthful. |

## 4. Ordered deliverable graph

```text
platform-capability-trigger-activation (one Mission node)
  D1 capability requalification
    └──> D2 agy structured telemetry
           └──> D3 Codex PostCompact production adapter
                  └──> D4 strict-L5 readiness bootstrap
                         └──> cumulative verification/review + doc/version finish gate
```

D1–D4 are ordered acceptance gates inside the single Mission node, not separately claimable
deliverables. D2 and D3 may not claim completion from preparation done before D1 freezes and validates
their exact claim IDs; the cumulative candidate advances D1 → D2 → D3 → D4. D4 lands last because it
consumes the qualified provider tuples and controls pre-spend admission. A failed gate is repaired
inside this node's unchanged gate-attempt and repair-generation budgets; it never creates D5.

### D1 internal gate — Refresh and freeze harness capabilities

**Input:** installed CLIs, upstream changelog/release discoveries, current probe package, current
portability/install docs, and the stale backlog audit.

**Implementation:**

1. Add `schemas/platform-capability-claims.schema.json` as a closed (`additionalProperties:false` at
   every object) receipt contract and `scripts/platform-capability-claims.js` as its sole canonical
   validator. Every claim has exactly: `claim_id`, `capability_id`, `target_identity`,
   `official_contract`, `live_evidence`, `agreement`, `freshness`, `revalidation`, and `status`.
   `target_identity` binds runner, model, role, effort, endpoint, family, resolved binary realpath, and
   exact CLI version. `official_contract` binds canonical URL/locator, retrieved time, and document
   digest. `live_evidence` binds the same CLI version plus probe command/output digests, event or
   behavior class, observation time, TTL, and result. `agreement` is true only when contract and live
   results assert the same capability; `freshness.expires_at` is deterministically observation time +
   TTL. `revalidation` binds validator version, command digest, validation time, and result.
2. Derive `claim_id` as `cap-v1-<sha256>` over canonical JSON of the claim body excluding
   `claim_id`, `status`, and mutable revalidation time. Emit `status:validated` only when both evidence
   arms exist, target/live CLI versions match exactly, agreement is true, the observation is unexpired,
   the current binary reports the same version, and revalidation succeeds. Missing, stale,
   version-mismatched, contradicted, or digest-drifted inputs remain `blocked` and cannot yield a
   validated ID. The validator rejects unknown fields and duplicate IDs.
3. Add one deterministic probe driver with bounded timeout, declared command, version capture, and
   redacted digests. Probe the exact surfaces needed here: agy structured response+usage; Codex production plugin
   `PostCompact` registration plus manual and auto firing; Grok SessionEnd/headless usage event
   firing; OpenCode `debug skill` JSON completeness on installed 1.17.15 and isolated latest 1.18.11;
   Claude Code current hook baseline. Preserve the existing negative Codex install-generator and
   inconclusive `tier:` metadata findings as blocked unless a real probe changes them.
4. Cover every strict-L5 policy dimension in each provider claim's `target_identity`: runner, model,
   role, effort, endpoint (explicit `null` for default), and family. No dimension may be inferred or
   wildcarded at D4 consumption time.
5. Emit the aggregate evidence receipt and update the portability/installation matrices with exact
   versions and evidence links. Freeze the D2 agy envelope and D3 Codex payload/matcher/failure
   contracts as validated claims. D2–D4 call `platform-capability-claims.js validate` immediately
   before their gate and accept only explicitly named validated `claim_id` values; receipt presence,
   prose, a stale prior validation, or a substituted receipt path has no authority.

**Output:** a version-bound capability receipt and truthful docs with `proven`, `blocked`, or
`unverified` per surface.

**Acceptance:**

```bash
bash scripts/probe-harness-capabilities.sh --all --output docs/projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json
node scripts/validate-json-schema.js --schema schemas/platform-capability-claims.schema.json --document docs/projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json
node scripts/platform-capability-claims.js validate --receipt docs/projects/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json --all-validated --reprobe
bash hooks/tests/harness-capabilities.test.sh
bash hooks/tests/codex-hook-probe-package.test.sh
bash scripts/preflight-portability.sh
```

The negative matrix must reject missing official evidence, missing live evidence, stale TTL,
version mismatch, contract/live contradiction, current-version drift, claim-ID tampering, duplicate
claims, and unknown fields. A failed optional Grok/OpenCode/Claude row remains an honest blocked row
and does not block D2–D4 unless it contradicts a consumed claim.

### D2 internal gate — Integrate agy structured telemetry

**Input:** D1's revalidated agy structured-envelope `claim_id` and existing review/runner result
schemas. A receipt row without that validated ID is not an input.

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

### D3 internal gate — Wire the Codex production `PostCompact` adapter

**Input:** D1's revalidated Codex `PostCompact` contract `claim_id` and the existing host-neutral
`postcompact-adapter`/continuation-admission implementation.

**Implementation:**

1. Create the canonical non-generated manifest at `platforms/codex/hooks/hooks.json` and adapter at
   `platforms/codex/hooks/post-compact.js`, both outside `platforms/codex/plugin`. The manifest uses
   the D1-validated official `PostCompact` event, exact `manual|auto` matcher, and relative adapter
   command. The adapter validates the official payload, resolves exact Git common-dir/root/node/
   attempt identity, and invokes `scripts/compaction-rehydrate.js postcompact-adapter`; it never copies
   reconciliation logic.
2. Persist only the existing sealed reconciliation receipt. Missing/ambiguous identity, invalid
   payload, adapter non-zero, duplicate invocation, stale worktree, or reconcile failure must block
   continuation and never degrade to warning-only success.
3. Prove ordering with an effectful sentinel command: both manual and forced-auto compaction must
   record successful reconciliation before the sentinel can run. Prove the inverse by breaking the
   adapter and observing the sentinel remain absent and the outer Codex action fail.
4. Extend `scripts/sync-codex-plugin-skills.sh` only through its existing mapped-file primitives with
   these exact pairs after `clean_hooks_root`: `platforms/codex/hooks/hooks.json` →
   `platforms/codex/plugin/hooks/hooks.json`, and `platforms/codex/hooks/post-compact.js` →
   `platforms/codex/plugin/hooks/post-compact.js`. Its `--check` mode checks both byte-for-byte and
   permits exactly `_shared`, `hooks.json`, and `post-compact.js` under the generated hooks root.
   `platforms/codex/plugin/.codex-plugin/plugin.json` points to `./hooks/hooks.json`; no package hook
   payload is hand-authored.
5. Replace the probe-only package boundary claim with the production boundary, retain the disposable
   probe only for capability maintenance, regenerate mirrors, and update portability/install docs and
   CHANGELOG. The package test deletes both generated hook files then proves sync regenerates exact
   bytes; it then manually changes each generated file and proves `--check` fails naming the drift,
   while edits to either canonical source regenerate the package. This inverse test replaces the old
   assertion that `plugin/hooks/hooks.json` is forbidden.

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

### D4 internal gate — Build the strict `/l5` CLI trust root

**Input:** D1's revalidated exact provider claim IDs, the existing non-serializable qualification
provider, live readiness collector, and constructor-only Engine adapter seam.

**Implementation:**

1. Make `src/readiness/provider-bootstrap.js` the single canonical code source. It exports a frozen,
   ordered `STRICT_L5_PROVIDER_POLICY` array whose entries contain one D1 validated `claim_id` and one
   exact six-field object: `{runner, model, role, effort, endpoint, family}`. Default endpoint is
   canonical `null`; wildcards, omitted dimensions, inferred family, unions, and fallback guesses are
   invalid. The policy digest is SHA-256 of canonical JSON for that ordered array.
2. Deterministically derive the invocation policy match by resolving the existing review-loop roster,
   expanding implementer, reviewer, verification-author, QC, and configured fallback seats, projecting
   each to the same six named fields, sorting by role then runner/model/effort/endpoint/family, and
   requiring one byte-equal policy entry and its revalidated D1 claim ID for every projected tuple.
   Unknown tuple, duplicate tuple, unresolved dimension, extra policy tuple, changed ordering after
   canonical sort, family disagreement, claim substitution, policy-digest drift, or roster drift
   rejects admission.
3. From that freshly matched in-memory policy, compile a `createQualificationProvider` callback and a
   `providerReadinessAuthority` closure. The first authorizes only exact matched tuples; the second
   invokes the existing readiness collector with live probing enabled and the same frozen roster,
   policy digest, claim IDs, and invocation time. No CLI flag, environment variable, work-order field,
   disk receipt, or caller-supplied callback may replace either closure.
4. Construct the bootstrap in `bin/autopilot.js` only for strict `engine implement-review`, inject it
   through the `AutopilotEngine` constructor, and consume the fresh readiness bundle before the first
   model dispatch. Preserve lower-level non-strict flows explicitly; never label them strict L5.
5. Bind qualification/readiness to the roster selected for that invocation and record observation
   provenance in the Mission receipt. Reject missing qualification, stale TTL, wrong runner/model/
   role/effort/endpoint/family, fallback-family violations, serialized/replayed receipts, provider
   probe failure, claim-ID substitution, policy digest drift, unknown tuple, or roster drift.
6. Add an executable command-level positive run and the full negative matrix. Assert no dispatcher
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

The positive CLI fixture must reach dispatch admission through freshly created in-process closures.
Every unknown/drifted tuple, stale/missing claim, claim/receipt substitution, serialized/replayed
closure attempt, or receipt-only authority fixture must terminate with zero dispatcher calls and a
specific readiness/qualification reason.

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

- D1–D4 focused suites pass before the next internal gate starts.
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
| Treating a release note or lone live probe as runtime truth | D1 requires both official-contract and fresh version-matched live evidence, agreement, and immediate revalidation before emitting a consumed claim ID. |
| Mixing agy response text and usage in one parser input | Capture one private native envelope, validate it once, then derive response and usage through declared modes. |
| Accepting worker-authored fake token JSON | Usage is read only from the exact harness process envelope after a zero exit; response/transcript text is never an authority source. |
| Registering a Codex hook with Claude payload assumptions | D3 is bound to D1's official Codex payload/matcher/failure receipt and translates only that shape. |
| Reconciliation happens after the first effectful action | A sentinel ordering oracle and broken-adapter inverse test make this a blocking acceptance condition. |
| Calling a serialized scorecard/receipt “host-owned” | D4 uses constructor-owned WeakMap-backed one-shot objects and live probing; disk artifacts cannot satisfy admission. |
| A broad four-topic mission explodes into test/review phases | The graph has one node; D1–D4 and every retry/review are internal gates charged to its unchanged budgets. |
| Codex hook payload is hand-edited inside the package | Canonical sources live under `platforms/codex/hooks`; sync owns both package hook files, and deletion/regeneration plus inverse drift tests prove the mapping. |
| A readiness receipt substitutes for executable policy | The six-dimensional policy is canonical code; only fresh in-process closures derived from its exact roster match can admit dispatch. |
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
downstream gate with an explicit terminal receipt; it does not silently change a proven fact.

## Review log

- **R2 terminal receipt (2026-08-04):** logical plan
  `platform-capability-trigger-activation-2026-08-04-r2`, ticket
  `platform-trigger-activation-r2-20260804`, session `platform-trigger-activation-r2-g1`, session key
  `86c6fe1a48cd998176137a2e3f982dd1884c66de67ccb0bf13461f79ba84801e`. Frozen hashes were plan
  `5fa5c74e7fc71697bcafd010373cc7ec9d12d874a3a204d8581fa3ed95c53d12`, rubric
  `851531ee781e01ce59456eaed1eec8a557f7ee4edc09bb8f189a5dd1358da560`, and manifest
  `0b0e4be04999232bcccbc728c80b579efe20c7e82539c851c96245f8ed20c331`. The controller artifact at
  `/home/cookys/.autopilot/plan-review/86c6fe1a48cd998176137a2e3f982dd1884c66de67ccb0bf13461f79ba84801e/generation-01.json`
  is terminal `CONDITIONAL` with policy `required_seat_transport_exhausted`,
  `semantic_verdict:null`, `repair_authorized:false`, and `next_generation:null`. Both Codex
  transports succeeded but returned parser-invalid findings envelopes; Gemini transport/parser
  succeeded with semantic `READY` and no findings. The valid single-family result was not promoted.
  R2 is an infrastructure-failure receipt and is never reopened, relabelled, or authorized for
  generation 2.
- **R3 terminal receipt (2026-08-04):** logical plan
  `platform-capability-trigger-activation-2026-08-04-r3`, ticket
  `platform-trigger-activation-r3-20260804`, session `platform-trigger-activation-r3-g1`, session key
  `600fa0d7e15caa3cc8c738fdd62e429da596742c2824f8f07ddb09dab7877bc9`. Frozen hashes were plan
  `6bd4bf5c3857928e3d0c806d0e5f535211bc7202b8540bb20130b68bfaa631de`, rubric
  `c5e0228093da7f0cb39fea4e7e132ac8aeb246b49dcfabe21798e9daac34df51`, and manifest
  `a3368b3db19ef1a88849d72faa3198c2ba5519c2fe9ba17e95bafc94a392b10b`. The controller artifact is
  `/home/cookys/.autopilot/plan-review/600fa0d7e15caa3cc8c738fdd62e429da596742c2824f8f07ddb09dab7877bc9/generation-01.json`.
  Both required Codex attempts ran from the canonical worktree in read-only mode and reached the
  controller's default five-minute seat timeout: exit 3, zero stdout/last-message, raw stderr only
  prompt/runtime chrome, and no private raw reference. Gemini parsed semantic `READY` with empty
  findings. The terminal controller result is required-seat timeout infrastructure-only
  `CONDITIONAL`, policy
  `required_seat_transport_exhausted`, `semantic_verdict:null`, `repair_authorized:false`, and
  `next_generation:null`. R3 is never reopened, reset, relabelled, or authorized for generation 2.
- **R4 retry intent (2026-08-04):** new logical plan
  `platform-capability-trigger-activation-2026-08-04-r4` preserves the same D1–D4 semantic content,
  one-node graph, and budgets. It will retry through the existing controller CLI option
  `--timeout 12m` within the unchanged 7,200-second total review wall. R4 is a new logical revision,
  not a reset or generation 2 of R3, and remains `review-pending-r4`.
- **Receipts:** full immutable R2/R3 details and externally recorded R4 frozen hashes live in
  [`2026-08-04-platform-capability-trigger-activation.review.md`](2026-08-04-platform-capability-trigger-activation.review.md).
