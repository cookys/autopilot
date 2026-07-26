# Capability-adaptive execution profiles

> Status: In progress
> Target: v2.33.0
> Branch: `feat/v2.33.0-capability-adaptive-profiles`
> Base: `develop@dd34d57`
> Plan: [capability-adaptive-execution-profiles.md](../../plans/2026-07-26-capability-adaptive-execution-profiles.md)

## Project Goal

> **Final goal**: Keep one Autopilot product while admitting exact model deployments by role and
> task scope, then compile exactly one bounded `guided` or `autonomous` profile per admitted
> dispatch without changing the task's authority or assurance floor.
>
> **Success criteria**:
> 1. Focused profile, Owner Kernel, evidence, AA, and local-adapter suites pass with zero failures,
>    and `scripts/verify-red-green.sh` proves the new behavioral tests fail against the base.
> 2. Full-session traces show exactly one profile and no inactive semantic metadata/loader path.
>    Added control context is no more than `min(2,000 measured tokens, 5% of probed usable context)`.
> 3. Mutation tests prove guidance cannot admit a denied owner/reviewer, broaden a role grant,
>    relax red lines/egress/assurance, or promote from external prior or ordinary receipts.
> 4. Guided remains the compatibility default until the dogfood cutover gate passes; one config
>    change restores guided behavior.
> 5. The AA adapter works from a fake API without a network/runtime dependency and never stages
>    imported score data.
> 6. The local adapter binds pre/post deployment identity, enforces deny-by-default transport and
>    cancellation/resource outcomes, and never advertises raw HTTP as an agentic harness.
> 7. `scripts/sync-all.sh --check`, `scripts/preflight-portability.sh`, focused tests, and the
>    repository test runner all exit 0 before merge.
>
> **Scope boundary**: Implement the core adaptive-profile contract, evidence lifecycle, generic AA
> prior adapter, and bounded local OpenAI-compatible adapter with fake-server coverage. Ship only
> runtime/harness rows that pass a live probe. Do not create a second repository, a host daemon, a
> general-purpose agent loop, or claim Owner Kernel production authority.

## Verification Contract

Primary objective command:

```bash
bash hooks/tests/execution-profile.test.sh &&
bash hooks/tests/profile-context-isolation.test.sh &&
bash hooks/tests/aa-capability-import.test.sh &&
bash hooks/tests/local-engine-probe.test.sh &&
bash hooks/tests/dispatch-local-openai.test.sh &&
bash hooks/tests/owner-kernel.test.sh &&
bash hooks/tests/engine-capability-state.test.sh &&
bash hooks/tests/engine-scorecard.test.sh
```

Repository closure:

```bash
bash scripts/sync-all.sh --check
bash scripts/preflight-portability.sh
bash hooks/tests/run.sh
```

Red control: behavioral extensions must fail for the intended missing behavior when their new tests
are applied to `develop@dd34d57`; infrastructure errors, missing imports, and zero-test collection do
not count as red. Standalone new modules with no base import surface instead require mutation-tested
negative controls that fail when the claimed guard is removed.

## Scope Completeness Audit

| Dimension | In scope / disposition |
|-----------|------------------------|
| Source code + tests | Owner Kernel policy projection, profile resolver/rendering, context trace/isolation, evidence lifecycle, AA importer, local transport/fingerprint, and focused negative suites. |
| User-facing docs | English and zh-TW README, architecture/routing/hetero references, installation/config guidance, and completion receipt behavior. |
| API / interface reference | Two JSON schemas, CLI contracts, exact identity/evidence fields, egress matrix, error names, and compatibility behavior. |
| Config templates / examples | Project guidance/assurance/topology/egress defaults and user-local AA/local-engine configuration. |
| CHANGELOG | v2.33.0 entry with honest supported/unverified rows and measured context result. |
| Version bump / mirrors | Canonical `.claude-plugin/plugin.json` plus all mirrors via `sync-version.js`; full tracked-file old-version scan. |
| Migration | Existing projects resolve to guided compatibility; task override never edits project default. |
| Dependent consumers | Claude plugin, Codex generated payload, OpenCode/Antigravity portability claims, dispatch rails, and Owner Kernel compatibility callers. |
| Credit / attribution | Anthropic prompting guidance, Artificial Analysis methodology/API, and supported local runtime protocol sources stay linked in the reference/plan; no third-party score data is redistributed. |
| Dogfood | Shadow resolution first, then bounded low-risk autonomous dogfood; live claims require current-host traces/probes. |
| Security / privacy | Role admission, least-privilege grants, deny-by-default egress, local endpoint TLS/offline distinction, identity TOCTOU, cancellation, containment, and secret-free telemetry. |
| Operations | No Autopilot daemon; external runtimes remain user managed. Per-endpoint lease covers only Autopilot callers and does not claim global resource ownership. |

## Affected Surfaces

| Surface | Planned ownership |
|---------|-------------------|
| `src/engine/owner-kernel/` | Canonical task envelope and narrowing shadow role-grant projection; no second authority resolver. |
| `src/engine/execution-profile.js`, `schemas/` | Role admission, profile selection, deterministic rendering, typed contracts. |
| `scripts/engine-capability-state.js`, `engine-scorecard.js`, `engine-qualify.sh` | Scope/deployment evidence lifecycle and promotion/revocation integration. |
| `scripts/measure-profile-context.js`, `check-profile-isolation.js` | Host-observed context accounting and inactive-profile gate. |
| `scripts/import-aa-capabilities.js` | Optional user-local provisional benchmark prior. |
| `scripts/probe-local-engine.js`, `dispatch-local-openai.js`, `scripts/lib/` | Exact local deployment probe, bounded raw transport, endpoint lease. |
| `skills/ceo-agent`, `dev-flow`, `l3`-`l6`, hooks | Consume the canonical envelope/grant and selected profile without re-deriving policy. |
| `project-config-template/`, `.claude/` | Default/override and dogfood configuration. |
| `references/`, `README*`, `docs/architecture.md`, `CLAUDE.md` | Public contract, limitations, source attribution, and scripts inventory. |
| `platforms/codex/plugin/` | Generated mirror only; never hand edited. |

## User Requirements Ledger

| User statement | Project mapping |
|----------------|-----------------|
| “專案設定一次預設、每次任務只在需要時覆寫” | P1 config/envelope freeze; P5 override tests. |
| “autopilot 本質是無人職守專案可以自動一直推進並驗收” | Core goal; P1 authority binding and P5 unattended dogfood. |
| “對於較弱模型還是需要一個思考面比較強的來指引” | Role admission before profile; eligible owner gives bounded slices to guided workers. |
| “強模型給越多限制是不一定是好事” | P2 autonomous profile removes redundant choreography without removing invariant gates. |
| “能力深的模型跟能力淺的都有 profile 可以 guide” | P1/P2 exact role-specific `guided`/`autonomous` resolution. |
| “這樣會浪費很多 context 嗎?” | P0 measured full-session traces; P2 one-profile budget/isolation gate. |
| “本地模型呢?” | P4 exact deployment identity, bounded raw transport, harness qualification, privacy/resource policy. |
| “初步可以靠 artificialanalysis.ai 的分數矩陣暫定” | P3b provisional prior only; P3a local oracle required for qualification. |
| “我們還有漏掉什麼嗎? 你全面的組織思考一次” | Scope audit, three-lens review, role-admission correction, egress/fallback/drift/TOCTOU negative matrix. |
| “go” | Execute continuously under CEO Hold scope until the verification contract and finish-flow complete. |

## Skill Routing

| Area | Required skill / result |
|------|-------------------------|
| L-size lifecycle | `autopilot:dev-flow` — active; plan + project + per-phase gates + finish-flow. |
| Test architecture | `autopilot:test-strategy` — baseline before change; focused unit/negative suites per module; red-green against immutable base; full regression only after focused green. |
| Capability qualification | `autopilot:engine-onboarding` — reuse the scorecard and R0-R5 promotion states; role admission precedes profile; task scope limits evidence applicability but never hardcodes domain/model routing. |
| Harness/runtime claims | `autopilot:harness-maintenance` — 2026-07-26 report found 0/7 records H3-ready and six stale records. P0 observations do not promote mutation/gating readiness; each shipped live row needs a fresh probe. |
| Parallel allocation | `autopilot:team` — evaluated: phases are dependency-heavy; implementation remains inline per the user's no-delegated-implementation instruction. Read-only terminal review may be dispatched later. |
| Pre-merge quality | `autopilot:quality-pipeline` — focused tests, completeness/error/secret/test-integrity scans, then review at each phase and final closure. |
| Documentation drift | `autopilot:doc-sync` — run scoped deterministic gate after implementation, then independently verify any reported drift before editing. |
| Project closure | `autopilot:finish-flow` — mandatory seven-step L-5 sequence after every success criterion is evidenced. |

## Phases

| Phase | Work | Gate |
|-------|------|------|
| P0 | Measure supported-host context loading and classify every current lifecycle rule. | Reproducible traces; every rule has one owner; packaging path selected from evidence. |
| P1 | Add immutable task authority envelope and narrowing role grants in Owner Kernel shadow mode. | Deterministic hashes; denied admission cannot be changed by profile; current authority unchanged. |
| P2 | Extract core/guided/autonomous packs and enforce full-session isolation/context budget. | Exactly one active profile; baseline source retention; profile prose cannot grant authority. Effectful golden traces remain a P5 cutover prerequisite. |
| P3a | Add scope-aware evidence lifecycle and mutation-validated promotion/revocation. | No promotion from AA/self-report/ordinary receipts; scope and identity drift fail closed. |
| P3b | Add optional Artificial Analysis provisional prior adapter. | Fake API/offline/cache/no-redistribution tests; core works without it. |
| P3c | Add case-only remote transport and a dedicated owner evaluator. | Provider credentials stay host-side; exact request/response identity is bound; owner qualification is reachable without reusing reviewer evidence. |
| P4 | Add optional local deployment fingerprint, raw transport, resource lease, and harness gate. | Fake server adversarial suite; live rows only after real probe. |
| P5 | Run shadow comparison/dogfood and decide adaptive default from frozen gates. | Zero Critical profile-reduction escapes; measured context savings; config-only rollback. |
| P6 | Sync docs/packages/version and close release evidence. | Portability, sync, release, full test, and doc-drift gates pass. |

## Progress

| Phase | Status | Evidence / commit |
|-------|--------|-------------------|
| L-1.5 | Complete | Scope audit and requirements ledger recorded in this README. |
| L-1.6 | Complete | Dev-flow, test-strategy, engine-onboarding, harness-maintenance, team, quality-pipeline, doc-sync, and finish-flow applied above. |
| P0 | Complete | 745 conservative rule candidates / 728 canonical rules / 17 declared aliases; 42 focused assertions; three-lens re-review accepted; generated profile-specific payload strategy selected fail-closed. |
| P1 | Complete | Immutable shadow task authority and narrowing role grants; 33 focused profile assertions plus Owner Kernel/translation gates; three-lens review accepted; base-vs-head red-green `VALIDATED`. |
| P2 | Complete | Canonical core/guided/autonomous packs, exact-one-profile generated payloads, 122 isolation assertions, 33 execution-profile assertions, standalone Codex package proof, and unanimous three-lens review acceptance. Effectful golden traces remain a P5 cutover prerequisite. |
| P3a | Complete | Scope/identity evidence lifecycle, immutable canonical roles, session-local qualification authority, label-free metamorphic reviewer corpus, domain-bound behavioral witnesses, 61 qualifier assertions, 204-file full regression, and unanimous three-lens re-review acceptance. |
| P3b | Pending | |
| P3c | Pending | |
| P4 | Pending | |
| P5 | Pending | |
| P6 | Pending | |
| L-5 | Pending | |

## P0 Implementation Review

| Lens | Verified blocker | Resolution / final verdict |
|------|------------------|----------------------------|
| Architecture | Broad line ranges treated TaskCreate/checklist mechanics as core and duplicated S/L scope rules lacked one canonical owner. | Split into 72 semantic segments; mechanics/detection are guided, intent/DOA/escalation stay core, and 17 exact duplicates require declared owner/aliases. Accepted after re-review. |
| Security / evidence | Trace corruption, non-prompt string matches, symlink escape, and heuristic token estimates could overstate evidence. | Malformed traces fail by default; developer prompt and other trace occurrences are separate; realpath containment is enforced; heuristic estimates cannot satisfy budgets. Accepted after re-review. |
| Transport / false-green | Frontmatter routing, fragmented content, unknown options, trace hashes, and baseline summaries were not gated. | Frontmatter prose is inventoried; developer parts are reconstructed; unknown options fail; baseline checks live source hashes plus non-empty unique trace/catalog/Grok evidence. Accepted after mutation re-review. |

## P1 Implementation Review

| Lens | Verified blocker | Resolution / final verdict |
|------|------------------|----------------------------|
| Architecture / compatibility | New P4 profile fields could rewrite historical pre-P4 translations, or accept caller-selected downgraded targets. | Translation retries preserve the witnessed target; new invocations derive shape from the frozen policy; current and pre-P4 policies reject the opposite shape. Accepted after re-review. |
| Correctness / authority | Caller-shaped emitter identity or a profile decision could masquerade as admission/authority, and drift needed to revoke before another operation. | Owner Kernel fixes event identity/channel namespaces, admits the exact role before selecting guidance, anchors each grant to one envelope, and revokes on identity/capability/containment drift. Accepted after re-review. |
| Transport / false-green | The small schema oracle initially accepted unsupported keyword shapes, lossy JSON, duplicate keys, invalid UTF-8, and non-JSON API objects. | The validator now fails closed on unsupported schema/ref forms, unsafe numbers, decoded duplicate keys, invalid UTF-8, cyclic/accessor/exotic values, and array side properties; canonical/Codex hashes match. Accepted after adversarial re-review. |

## P2 Implementation Review

| Lens | Verified blocker | Resolution / final verdict |
|------|------------------|----------------------------|
| Architecture / isolation | A host-only profile selector could leave the inactive profile reachable, while Claude `--bare` cannot execute the hooks needed for an effectful adapter. | Generated bundles contain exactly one profile; the bare path is explicitly a no-effect context-isolation probe with a frozen workspace, exact model checks, one-shot receipts, and an external-witness requirement. Accepted after re-review. |
| Correctness / authority | A guided slice or caller-authored trace could broaden intent, inputs, outputs, acceptance, or manufacture runtime proof. | Guided slices must exactly match the frozen objective and narrow all other grant fields; caller traces are conformance-only and cannot become terminal witnesses. Accepted after replaying the six blocking cases. |
| Transport / standalone packaging | A copied Codex plugin could silently depend on the parent repository for the immutable P0 source baseline. | Hash-named P0 source snapshots and the hook classification manifest are packaged and validated in isolation with parent Git discovery blocked. Accepted after standalone package re-review. |

## P3a Implementation Review

| Lens | Verified blocker | Resolution / final verdict |
|------|------------------|----------------------------|
| Architecture / contract | Evidence source payloads initially shared reviewer-only fields, canonical roles diverged across components, the owner qualification dependency was unreachable, and public schema discriminants lagged runtime validation. | Added one generic evidence envelope with source-specific methodology branches, one immutable role taxonomy with legacy read migration, explicit P3c dependency, and negative schema/runtime parity tests. Accepted after re-review. |
| QA / false promotion | Public/nonced lookup, label-bearing generated paths, and invalid-domain witnesses could pass without genuine review capability. | Added asymmetric/symmetric relational twins, opaque panel-visible artifacts, exact semantic metadata, host-pinned nonce-derived call domains, and separately sandboxed before/after witnesses. The original bypasses are regression tests. Accepted after re-review. |
| Portability / authority | Same-UID disk rows could be mistaken for authority, stale files could leak into the standalone Codex package, and a public mutable role set could drift from schemas in a long-lived process. | Disk remains provisional telemetry; only a live nonserializable session verifier can admit a role. Exact payload allowlists remove stale files, canonical/Codex bytes match, and the exported role view has no mutation API. Accepted after standalone re-review. |

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-26 | Treat the feature as L-size, not H-size. | This is a planned multi-surface feature; repository H means a production hotfix. |
| 2026-07-26 | Target v2.33.0. | The feature introduces public policy/schema/CLI behavior rather than a patch-only change. |
| 2026-07-26 | Keep implementation inline. | The user most recently required Codex to implement directly; parallelism is reserved for read-only review/verification. |
| 2026-07-26 | Preserve Owner Kernel shadow authority. | Profile selection is a child projection and cannot claim host authority or bypass current DOA/hooks. |
| 2026-07-26 | Treat AA/local tracks as additive but implement their bounded generic contracts in this project. | They answer the requested capability/bootstrap cases without making network keys or installed runtimes prerequisites for core cutover. |
| 2026-07-26 | Generate profile-specific payloads from one canonical source. | No supported host currently proves full-session absence of inactive profile metadata/body/triggers and denial of its loader route, so the single-payload optimization fails closed. |
| 2026-07-26 | Treat Claude `--bare` as a no-effect isolation probe, not a production profile adapter. | The documented mode skips hooks and skills; a same-process observation proves context isolation only. An independently witnessed effectful trace remains required before adaptive cutover. |
| 2026-07-26 | Package immutable P0 sources as hash-named non-skill snapshots in the Codex payload. | Standalone validation must not reach through to the parent clone, and the snapshots must not become discoverable profile instructions. |
| 2026-07-26 | Keep effectful guided compatibility as a P5 prerequisite. | P2 proves content-addressed source retention and isolation, but cannot honestly claim behavioral equivalence without an independently witnessed effectful transport. |
