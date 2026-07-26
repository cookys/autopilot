# Plan - Capability-adaptive execution profiles

> Status: PROPOSED 2026-07-26
> Owner: depth-0 owner session
> Branch: `feat/capability-adaptive-profiles`
> Size: L
> Frame: keep one Autopilot repository and product, but separate invariant enforcement from
> model guidance density. Strong, weak, unknown, remote, and local deployments receive one
> role-specific effective profile compiled for each admitted dispatch. Project defaults apply once;
> a task may override them at intake without editing the project default.

## 0. Context / thesis

Frontier models increasingly self-plan, self-correct, and verify without procedural prompting.
Anthropic's Opus 5 guidance explicitly recommends removing mandatory re-verification and verifier
subagents when they merely duplicate the model's native behavior:

- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

Autopilot still needs a guided path for weaker or unqualified models. The answer is not a second
`hetopilot` repository. Heterogeneous dispatch and model capability are independent:

- capability controls how much reasoning/process scaffolding is supplied;
- risk controls the assurance and evidence gate;
- topology controls whether work is inline, foreman-dispatched, or heterogeneous.

This plan introduces a thin invariant core plus one active guidance profile. It does not grant a
strong model additional authority. A stronger qualification may remove redundant process prose,
but it can never relax red lines, effect permissions, artifact identity, transport identity,
deterministic acceptance, or high-risk review requirements.

Artificial Analysis supplies a low-cost cold-start prior, not an authorization source. Current
methodology exposes model-level Agentic/Coding indices and a coding-agent index that distinguishes
agent variants and settings:

- https://artificialanalysis.ai/methodology/capability-indices
- https://artificialanalysis.ai/methodology/coding-agents-benchmarking
- https://artificialanalysis.ai/data-api/docs

Local inference is a first-class case, but a local model name is not an identity. Quantization,
weights, tokenizer, chat template, tool parser, context configuration, runtime build, and sampling
can change behavior materially. OpenAI-compatible HTTP support also does not imply a safe coding
agent loop. Candidate protocols must be spiked against their official surfaces:

- Ollama: https://docs.ollama.com/api/openai-compatibility
- vLLM: https://docs.vllm.ai/en/latest/serving/openai_compatible_server/
- llama.cpp: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- LM Studio: https://lmstudio.ai/docs/developer

The implementation therefore freezes a task authority envelope, then compiles one least-privilege
role grant from task risk, exact engine/deployment evidence, and the requested role. Only the
envelope capsule, current role grant, and one selected profile enter the model context.

## 1. Problem

The current repository has the necessary substrate but not a clean policy boundary:

- `skills/ceo-agent/SKILL.md` and `skills/dev-flow/SKILL.md` together contain roughly 9.6K words
  of lifecycle guidance. That is source surface, not proof that every host injects all of it; P0
  measures actual model-visible tokens before a packaging decision.
- Existing `density_scaling`, risk classification, scorecards, owner rosters, and `/l3`-`/l6`
  already model parts of adaptive execution, but they are distributed across skills, hooks,
  resolver scripts, and engine code.
- Guidance rules and invariant enforcement are mixed. Adding `if strong_model` branches in every
  consumer would create a policy matrix that cannot be reasoned about or tested coherently.
- Profile switching can stack contradictory instructions in one session because prior system and
  skill context cannot be unloaded.
- External benchmark results describe a model or agent variant, not necessarily the exact
  Autopilot runner, effort, endpoint, or local deployment.
- Current named endpoints are primarily Anthropic-compatible. Local OpenAI-compatible runtimes
  do not have a first-class fingerprint, capability probe, or role-admission path.
- A fallback engine can currently differ from the requested engine; inheriting the original
  profile across that fallback would be unsafe.
- The workspace and model process must not be able to promote themselves by editing policy,
  benchmark cache, prompt content, or self-reported verdicts.

The user-facing goal is simple:

1. Configure a project default once.
2. Override only when a task needs it.
3. Let qualified strong models run with a thin harness.
4. Give weak, unknown, stale, or locally degraded models additional scaffolding.
5. Keep the same safety and acceptance floor for every profile.
6. Report the effective profile and non-user-specified decisions at completion.

## 2. OKR / key results

### Objective

Make Autopilot capability-adaptive without forking the product or paying a large context tax.

### Key results

| ID | Result |
|----|--------|
| KR1 | Every admitted role dispatch resolves exactly one guidance profile: `guided` or `autonomous`; `adaptive` is a request mode, never an effective profile. |
| KR2 | Guidance profile, assurance/risk, and execution topology remain separate typed fields; no profile grants effect authority. |
| KR3 | The control-plane prompt addition (core capsule + selected profile + finish receipt contract, excluding user task/repo artifacts) is at most 2,000 measured tokens and at most 5% of the deployment's probed usable context. |
| KR4 | Only one selected profile body/hash appears in the full-session trace for a role dispatch. Inactive profile bodies are absent. |
| KR5 | `unknown`, stale, unresolvable alias, changed semantic fingerprint, or failed context/tool probe resolves to `guided` only where that identity is role-admissible; otherwise the dispatch blocks/escalates. No silent autonomous fallback exists. |
| KR6 | Artificial Analysis can create only `provisional` evidence. `Qualified` status requires a project-local, mutation-validated role suite with an independent artifact oracle; ordinary live receipts can sustain or demote qualification but cannot create it. |
| KR7 | Exact fallback identity is re-resolved. A replacement engine never inherits the failed engine's profile or qualification. |
| KR8 | Local deployments are keyed by a semantic fingerprint and an operational fingerprint; a model label alone cannot reuse evidence. |
| KR9 | A raw local endpoint is admitted only to probed raw roles. Owner/implementer admission requires a separately verified agentic harness adapter; Autopilot does not hand-roll a tool loop. |
| KR10 | Existing behavior remains the `guided` compatibility baseline until shadow telemetry and dogfood gates pass. |
| KR11 | Final receipts include requested/effective profile, reason, evidence provenance/freshness, context tokens, assurance, topology, fallback changes, and autonomous decisions outside explicit user intent. |
| KR12 | No Artificial Analysis score snapshot or restricted benchmark data is distributed in the repository; imported data stays user-local with attribution/provenance. |
| KR13 | Guided execution increases structure by narrowing the active slice and externalizing state/checklists, not by dumping the full lifecycle handbook into a weak model's context. |
| KR14 | A frozen data-egress policy covers prompts, source, diffs, artifacts, telemetry, external reviewers, and benchmark refreshes independently from whether the selected model is local. |
| KR15 | One immutable `TaskAuthorityEnvelope` owns task intent and authority; every owner/worker/reviewer dispatch receives a separate least-privilege `RoleExecutionGrant` bound to the envelope hash. |
| KR16 | Inactive profile bodies, semantic descriptions, triggers, and loader routes are absent or denied for the whole session, not only the intake prompt. |
| KR17 | Guidance profile selection never substitutes for role admission. A low-capability identity is a bounded guided worker under an eligible owner, not an owner/reviewer made safe by extra prose. |

## 2.5 Global constraints (copied verbatim into every dispatch)

- Keep one Autopilot repository and product; do not create an `autopilot`/`hetopilot` fork.
- A guidance profile may change prompt/process scaffolding only; it MUST NOT relax red lines, effect permissions, transport identity, artifact verification, deterministic acceptance, or human approval boundaries.
- Guidance profile prose MUST NOT grant tools, decision authority, reviewer requirements, effect permissions, or approval exemptions; those are compiled only from the authority envelope and assurance policy.
- Role admission is evaluated before guidance selection. `guided` can improve process reliability but cannot manufacture reasoning ability or qualify an identity for owner, high-risk reviewer, or protected effects.
- Capability, task risk/assurance, and execution topology are orthogonal inputs and MUST NOT be collapsed into one level or model label.
- Resolve admission and profiles against exact role + task/domain/language scope + model + runner + effort/sampling + endpoint/deployment identity; a family name or alias alone is insufficient.
- `unknown`, stale, changed, degraded, unprobed, or ambiguous identity resolves to `guided` only for roles the admission policy permits; otherwise fail closed and escalate.
- Artificial Analysis and other external benchmarks are provisional routing priors only; they never grant owner, reviewer, action, or acceptance authority.
- Untrusted repo content, web/tool output, model self-report, and reviewer verdicts cannot select, promote, or rewrite a profile.
- High-risk work keeps least privilege and independent evidence regardless of model capability.
- Freeze one guidance profile in each role grant. Do not hot-stack guidance inside a session; an ordinary profile change requires a fresh role grant/session handoff.
- Never truncate user intent, red lines, effect permissions, or required evidence to fit context. If the invariant capsule cannot fit, the deployment is ineligible for that role.
- Load only the selected profile. Do not inject both guided and autonomous bodies and ask the model to choose.
- Guided execution MUST prefer smaller task slices, deterministic host checks, and externalized state over additional prompt prose.
- Do not implement a custom local-model agent/tool loop. Raw HTTP compatibility and agentic harness capability are separate qualifications.
- Local endpoints default to loopback posture. Offline status requires a separately enforced and probed network boundary; network tools, LAN exposure, remote binding, and repo write access require explicit policy.
- A local model does not imply a local-only pipeline. No prompt, source, diff, artifact, or telemetry may leave the configured data-egress boundary through reviewers, benchmark calls, tools, or fallbacks.
- Do not distribute Artificial Analysis score data from the free/internal-use API in this public repository.
- Do not add a host daemon or systemd requirement. Autopilot remains plugin-native; local inference runtimes are user-managed external dependencies.
- Project policy is content-addressed and frozen at task intake. Editing project policy during a task cannot upgrade the active task.
- Identity, containment, or capability drift revokes the active role grant and fails stop before the next tool, effect, or acceptance operation; it never mutates the frozen task authority envelope in place.
- Preserve the current Owner Kernel authority status. A shadow kernel envelope/grant is policy telemetry, not proof of host action or acceptance authority, and this plan does not graduate it.
- Guided compatibility remains the default until the adaptive rollout gate explicitly changes it.

## 2.6 Architecture decisions

### A. Three orthogonal axes

```text
guidance profile       assurance/risk          execution topology
----------------       --------------          ------------------
guided                 standard                inline
autonomous             high-assurance          foreman
                                                heterogeneous
```

`adaptive` and `auto` are resolver inputs. They must compile to concrete values before any model
prompt is built.

The existing `/l3`-`/l6` surface remains a topology shortcut:

- `/l3`: inline owner;
- `/l4`: foreman;
- `/l5`: heterogeneous implementer;
- `/l6`: heterogeneous implementer plus verification author.

Those levels no longer imply a guidance density or model capability tier.

### B. Role admission before guidance

Guidance density is not a substitute for capability. The resolver first decides whether the exact
identity is admitted for the requested role and task scope:

- an eligible identity may receive `guided` or `autonomous`;
- a provisional identity may run only the explicitly permitted low-risk shadow/bounded roles;
- an ineligible owner or high-risk reviewer blocks/escalates;
- a lower-capability implementer receives a bounded slice from an eligible owner rather than owning
  the whole task.

If no eligible model can own the task, Autopilot asks for a stronger model/human owner or stops. It
does not add more flow and claim equivalent capability.

### C. Role- and scope-specific capability, not one global strong/weak label

Qualification is recorded per role:

- `owner`
- `implementer`
- `reviewer`
- `verification_author`
- `explorer`

A model may be autonomous-qualified as an implementer and still require guided reviewer prompts.
Qualification also records applicable task class/domain, language, harness/tool surface, and
deployment shape. The resolver never promotes all roles or scopes from one composite score. A
scope mismatch weakens the evidence or returns to guided/denied according to the role admission
floor.

Evidence may remain continuous and multidimensional internally. The first release deliberately
compiles it to two guidance profiles to keep behavior testable. A third profile is added only when
project evals prove a stable execution strategy that neither existing profile can express. Local is
a deployment property, not a third guidance profile.

### D. Task authority envelope and role execution grants

There is no parallel profile authority. Owner Kernel remains the canonical policy/hash/ledger seam.
Its canonical policy resolver freezes one immutable `TaskAuthorityEnvelope`:

```json
{
  "schema_version": 1,
  "task_authority_id": "sha256:...",
  "task_id": "...",
  "policy_hash": "sha256:...",
  "authority_status": "shadow",
  "intent": {},
  "acceptance": {},
  "red_lines": [],
  "effect_permissions": {},
  "resource_ceiling": {},
  "data_egress_policy": {},
  "escalation_policy": {},
  "finish_receipt_schema": {}
}
```

Each owner, implementer, reviewer, verification-author, or explorer dispatch gets a separate
least-privilege `RoleExecutionGrant`:

```json
{
  "schema_version": 1,
  "grant_id": "sha256:...",
  "parent_task_authority_id": "sha256:...",
  "authority_status": "shadow",
  "dispatch_id": "...",
  "role": "implementer",
  "capability_scope": {},
  "role_admission": "admitted",
  "requested_profile": "adaptive",
  "effective_profile": "guided",
  "profile_reason": "provisional implementer evidence",
  "profile_hash": "sha256:...",
  "model_identity": {},
  "evidence": [],
  "risk": "low",
  "assurance": "standard",
  "topology": "heterogeneous",
  "allowed_tools": [],
  "allowed_artifacts": [],
  "effect_subset": {},
  "required_evidence": [],
  "context_budget": {},
  "issued_at": "...",
  "expires_at": "..."
}
```

The grant can only narrow the authority envelope. A fallback, role change, identity change, or
profile change creates a new grant bound to the same parent envelope; it never edits the envelope or
lets a child inherit owner permissions.

`src/engine/execution-profile.js` is a pure child projection used by Owner Kernel policy code. It
selects guidance from evidence and context capacity, but cannot mint authority. The compatibility
path for projects not yet using active Owner Kernel still calls the same canonical policy/projection
modules and emits a shadow-labelled envelope/grant; it does not implement a second resolver.

This does not claim that current Owner Kernel callbacks are an external host authority. Shadow
envelopes/grants drive profile selection and receipts while existing DOA/hooks/dispatch containment
remain authoritative. Only a separately completed Owner Kernel graduation may change
`authority_status`; profile qualification cannot.

Prompt capsules are deterministic renderings of the envelope plus one role grant, not second policy
sources. Hooks and dispatchers verify both hashes and do not independently infer strength, risk, or
permissions. Compiler time is an explicit normalized input, so identical inputs produce
byte-identical output.

### E. Profile semantics

`profiles/core.md` contains only:

- user intent and acceptance binding;
- red lines and effect permissions;
- resource budgets;
- required evidence;
- escalation boundary;
- final decision receipt.

`profiles/guided.md` adds:

- explicit decomposition, with the host sending only the current bounded slice;
- concrete checklist/phase scaffolding;
- structured checkpoints and state externalized to files/artifacts;
- additional output/schema guidance.

Guided does not mean verbose. Weak or small-context workers receive a smaller immediate problem,
not the entire project plan plus a longer handbook. Deterministic scripts and the owner retain the
full task graph, checklist state, prior receipts, and cross-slice dependencies outside the worker
prompt. Reviewer/verifier requirements come only from the assurance projection in the role grant,
never from `guided.md`.

`profiles/autonomous.md` adds only:

- full objective and scope boundary;
- instruction to use only the tools and reversible-decision latitude already enumerated in the role
  grant, without adding procedural approval checkpoints;
- requirement to disclose non-user-specified decisions;
- instruction to follow the grant's escalation boundary for materially different interpretations or
  protected effects.

It does not repeat "double-check", "re-verify", or mandatory self-review/subagent choreography.
`check-profile-isolation.js` rejects permission, approval, tool-grant, and reviewer-gate language in
either guidance body unless it is an exact reference to a typed grant field.

### F. Context isolation and budget

P0 measures each supported harness rather than assuming how skill discovery affects context.

Packaging decision rule:

1. Keep one plugin artifact only if inactive profiles contribute zero model-visible semantic
   metadata/body/triggers, the loader denies their invocation for the entire session, and a
   full-session trace proves they never become loadable.
2. Otherwise generate profile-specific plugin payloads from the same canonical repository source.
   This is packaging separation, not a repository fork.

For either path:

- total added control context is capped at `min(2000 tokens, 5% of probed usable context)`;
- token accounting uses the exact deployment tokenizer or harness-reported input delta. A
  conservative byte estimate may block over-budget input but cannot satisfy the cutover metric;
  an unmeasurable host remains `unverified`;
- the core invariant capsule is never truncated;
- optional examples/checklists are loaded just in time;
- guided workers receive only the current slice plus its input/output contract; completed and future
  slices remain external state;
- if the minimum capsule does not fit, the role dispatch fails precondition;
- changing profiles after one was loaded requires a fresh role grant/session plus handoff;
- prompt tracing covers the full session, including late skill invocation and compaction/reload, not
  only the intake message.

### G. Evidence and lifecycle

Evidence precedence:

```text
project-local repeated role+scope evidence
> exact model+runner+effort/deployment+scope internal eval
> exact Artificial Analysis coding-agent variant
> Artificial Analysis model-level capability indices
> unknown
```

Evidence states:

- `unknown`
- `provisional`
- `qualified`
- `degraded`
- `stale`
- `revoked`

Rules:

- AA import can produce only `provisional`.
- Provisional autonomous candidates run only low-risk shadow/dogfood work.
- Promotion requires a role-specific, mutation-validated known-bad suite, a clean specificity set,
  and an independent artifact oracle. Ordinary low-risk receipts may extend confidence and detect
  regressions but can never promote by absence of an observed failure.
- Critical miss, identity mismatch, semantic fingerprint change, or tool/context regression
  immediately revokes every affected active role grant. The next tool/effect/acceptance operation
  fails stop; continuation requires a newly attested identity, a newly compiled grant, and a fresh
  session when its profile changes.
- Evidence expires in 30-90 days according to role/risk; reviewer and owner evidence use the
  shorter end unless a project policy explicitly selects a stricter interval.
- Fallback resolution starts again from the replacement identity.

An explicit user override to `guided` is always allowed. An `autonomous` override for an
unqualified identity requires an explicit Board-level override, is recorded in the receipt, and
still cannot weaken assurance or authority.

### H. Artificial Analysis bootstrap

`scripts/import-aa-capabilities.js`:

- reads the official API with a user-supplied key;
- uses stable model IDs and records index/methodology version, retrieval time, source URL,
  exact variant/settings where present, raw score, and within-version percentile;
- records benchmark language/domain/harness scope; current English or cloud/full-precision evidence
  is weakened when the task language, harness, or local quantized deployment differs;
- maps Agentic/Coding/Coding-Agent evidence to eligible roles without producing reviewer or owner
  authority;
- stores a content-hashed user-local cache;
- never runs on every task and never makes AA availability a runtime dependency;
- does not commit or package imported score data;
- treats index version changes as a new comparison cohort rather than comparing raw scores across
  versions.

Initial cold-start policy:

- top-quartile exact Agentic + Coding evidence may create an `autonomous-candidate`;
- model-level evidence without an exact runner/agent variant remains `provisional`;
- missing, below-floor, ambiguous, or expired evidence remains `guided`;
- cost, speed, and context window optimize routing only after the capability floor is met.

Thresholds are configuration defaults backed by versioned evidence, not timeless claims.

### I. Local deployment identity

Split the identity into two hashes.

Semantic fingerprint:

- model creator/repository/revision or weight digest;
- model provenance and license identifier/policy result;
- quantization and tensor format;
- tokenizer hash;
- chat template hash;
- tool parser/template hash;
- runtime and build version;
- configured/effective context bucket;
- sampling/reasoning/effort settings;
- endpoint protocol and model ID returned by the endpoint.

An OpenAI-compatible `model` string is not an attestation. Each runtime adapter must acquire the
strongest runtime-specific model digest/properties/generation identity available and bind it to the
grant. Before every dispatch and before accepting its result, the adapter re-reads that identity.
If the endpoint cannot expose a stable identity that distinguishes weights, quantization, template,
parser, and runtime, it remains `identity_unverifiable`: guided raw use may be allowed, but reusable
qualified evidence and autonomous/agentic admission are forbidden.

Stable operational fingerprint:

- CPU/GPU/accelerator backend;
- driver/runtime version;
- parallelism/concurrency configuration;
- cold-load and eviction policy.

A semantic change invalidates role qualification. An operational change invalidates capacity/SLO
evidence and triggers resource probes; it does not automatically claim a semantic quality change.

Available RAM/VRAM, queue depth, and current load are transient admission observations, not identity.
Autopilot serializes each local endpoint by default with a per-endpoint lease (`max_concurrency: 1`),
then rechecks headroom immediately before dispatch. A runtime-supported reservation/lease may replace
that default only after a live atomicity probe. The lease coordinates Autopilot dispatches; external
contention remains observable and causes precondition/retry rather than a false reservation claim.

Required local probes:

- endpoint/model identity and health;
- runtime-specific identity/attestation before and after the request, including hot-swap detection;
- effective context and truncation behavior;
- strict JSON/schema behavior;
- tool-call and parallel-tool behavior where claimed;
- timeout, stream termination, server-side cancellation acknowledgement, disappearance of the
  generation/queue item, and resource recovery;
- read/write containment appropriate to the requested role;
- cold start, TTFT, tokens/sec, memory peak, concurrency degradation, OOM recovery;
- offline/network posture and telemetry behavior.
- capacity admission under the configured concurrency limit, with local OOM/resource pressure
  failing precondition rather than silently switching to a remote model.

No self-reported capability is trusted without an observed probe.

The data-egress contract governs Autopilot routes; it cannot prove the external runtime itself is
offline. `offline_verified` requires an independently enforced network boundary (for example a
network namespace/firewall or an equivalent host control) plus a probe. A loopback URL alone is
labelled `local_endpoint`, not `offline_verified`. Non-loopback endpoints require authenticated TLS
with certificate verification; otherwise they are ineligible for source/diff/artifact payloads.

### J. Raw endpoint versus agentic harness

The first local transport is a bounded `local-openai` raw adapter for probed author/reviewer-style
requests. It supports only the roles proven by its live contract tests.

Owner/implementer admission requires a separately installed, proven coding harness that provides:

- tool execution;
- working-directory anchoring;
- edit/write containment;
- timeout/process-tree containment;
- artifact and identity reporting;
- deterministic handback.

P4 spikes existing proven harness candidates. If none satisfies the contract, local models remain
raw author/reviewer candidates; Autopilot does not create an agent loop to force eligibility.

### K. Product behavior

Project default, stored in the canonical governance configuration:

```json
{
  "guidance_profile": "adaptive",
  "assurance_profile": "conservative",
  "topology_preference": "auto",
  "data_egress": "allowlisted"
}
```

Task intake may override these values without editing the project file. The task authority envelope
is frozen and hashed. Migration derives the initial `allowlisted` destinations from the project's
already configured engine/endpoint roster so guided behavior does not break. `data_egress` is one of
`local-only`, `allowlisted`, or `online`; an override may narrow it freely, while widening it follows
the existing approval/DOA boundary. UI/reporting uses `guided` and `autonomous`, not "weak" and
"strong".

The authority envelope expands `data_egress` into a deny-by-default route matrix. Each row binds:

- data class: `task_prompt`, `source`, `diff`, `artifact`, `test_log`,
  `telemetry_metadata`, or `benchmark_metadata`;
- route class: `runner`, `reviewer`, `tool`, `telemetry`, or `benchmark_refresh`;
- exact destination identity and transport;
- allow/deny and maximum payload classification.

Explicit deny wins over allowlist, and a destination absent from the finite matrix is denied.
`online` permits configured/qualified destinations to be compiled into the matrix; it is not a
wildcard bypass. Every dispatcher/tool/reviewer checks the selected matrix row before payload
construction so denied data never enters an outbound prompt.

If `local-only` work requires a high-risk independent reviewer and no qualified local reviewer is
available, the task blocks/escalates. It never sends the diff to a cloud reviewer merely to satisfy
the assurance topology. Artificial Analysis refresh is metadata-only but still a network action and
is skipped while the active policy forbids it.

The completion receipt explains:

- what was requested and what became effective;
- why the profile was selected;
- whether evidence was external, local, stale, or overridden;
- context tokens consumed by core/profile guidance;
- model/runner/fingerprint and fallback changes;
- decisions made outside explicit user intent, with rationale and reversibility.

## 3. File-structure map

| File | Responsibility |
|------|----------------|
| `profiles/core.md` | New canonical invariant prompt capsule. |
| `profiles/guided.md` | New guided-only scaffolding; compatibility target for current lifecycle behavior. |
| `profiles/autonomous.md` | New thin strong-model guidance with no duplicated verification choreography. |
| `profiles/rule-inventory.json` | Machine-readable classification of existing rules as core/guided/autonomous/assurance/topology; prevents silent duplication. |
| `src/engine/owner-kernel/policy.js`, `canonical.js`, `compatibility.js`, `shadow-translation.js` | Remain the single policy/hash seam; add immutable task authority envelopes and least-privilege child role grants without creating parallel authority. |
| `src/engine/execution-profile.js` | Pure guidance child projection called by Owner Kernel; selects profile/context from role evidence but cannot mint authority. |
| `schemas/task-authority-envelope.schema.json` | Typed task-level intent, authority, resource ceiling, and data-egress matrix. |
| `schemas/role-execution-grant.schema.json` | Typed per-dispatch role/model/profile/evidence/effect-subset grant bound to one authority-envelope hash. |
| `scripts/owner-kernel.js` | Resolve/check the canonical envelope and expose its hash to compatibility callers. |
| `scripts/resolve-execution-profile.js` | Compile/check one child role grant from an existing authority envelope; JSON output and field lookup for shell/skill consumers. |
| `scripts/measure-profile-context.js` | Prompt-trace/token measurement harness; records which profile bodies and metadata were actually loaded. |
| `scripts/check-profile-isolation.js` | Gate for one-profile-only, core invariants, unreachable combinations, duplicate policy, and prompt budget. |
| `scripts/import-aa-capabilities.js` | User-local Artificial Analysis importer/cache with provenance, version, expiry, and no redistribution. |
| `scripts/probe-local-engine.js` | Deployment fingerprint, protocol/tool/context/resource/privacy probes. |
| `scripts/dispatch-local-openai.js` | Bounded raw local OpenAI-compatible author/reviewer transport; no agent loop. |
| `scripts/lib/local-capacity-lease.sh` | Per-endpoint Autopilot concurrency lease and just-in-time capacity recheck; does not overclaim control of external processes. |
| `scripts/engine-capability-state.js` | Extend observed capability records with semantic/operational fingerprints and evidence lifecycle. |
| `scripts/engine-scorecard.js` and `scripts/engine-qualify.sh` | Consume provisional evidence and promote/demote exact role identities through existing qualification discipline. |
| `project-config-template/governance-config.md` | Document `guidance_profile`, assurance default, topology preference, data-egress policy, overrides, and compatibility migration. |
| `.claude/owner-kernel-governance.json` | Dogfood project default and exact qualified owner/challenger identities. |
| `skills/ceo-agent/SKILL.md` | Freeze requested guidance policy at task intake; consume one admitted role grant/profile per dispatch rather than always injecting the full guided lifecycle. |
| `skills/dev-flow/SKILL.md` | Become the guided profile compatibility path rather than an unconditional owner wrapper. |
| `skills/l3/SKILL.md` through `skills/l6/SKILL.md` | Retain topology semantics; pass normalized profile overrides without redefining capability policy. |
| `hooks/context-budget.js` | Enforce measured control-context budget and fail before invariant truncation. |
| `hooks/orchestrator-edit-gate.js` | Verify the frozen envelope/current role grant while keeping effect authority profile-independent. |
| `hooks/tests/execution-profile.test.sh` | Envelope/grant narrowing, resolver precedence, fallback, override, expiry/revocation, egress, and authority-invariance tests. |
| `hooks/tests/profile-context-isolation.test.sh` | Full-session prompt trace, zero inactive semantic metadata/loader access, token budget, fresh-session switch, and no-truncation tests. |
| `hooks/tests/aa-capability-import.test.sh` | Fake API, version cohort, stable ID, percentile, cache, expiry, attribution, and no tracked-data tests. |
| `hooks/tests/local-engine-probe.test.sh` | Fake/local servers for fingerprint, context, JSON/tool, timeout, identity, and resource outcomes. |
| `hooks/tests/dispatch-local-openai.test.sh` | Raw transport role allowlist, loopback default, containment, response parsing, and failure classification. |
| `references/capability-adaptive-profiles.md` | User/developer contract, evidence precedence, local deployments, and troubleshooting. |
| `references/model-routing.md` | Route only after capability floor; keep role and depth policy aligned. |
| `references/hetero-dispatch.md` | Add local raw transport and explicitly separate it from agentic implementation. |
| `CLAUDE.md` | Add new deterministic scripts to the inventory. |
| `README.md`, `README.zh-TW.md`, `docs/architecture.md` | Explain one product, profiles, project default/task override, and local limitations. |
| `scripts/sync-codex-plugin-skills.sh` output | Regenerate Codex support payload from canonical files; never hand-edit mirrors. |
| `CHANGELOG.md`, `docs/projects/INDEX.md`, version manifests | Release and project lifecycle closure. |

## 4. Phases

### P0 - Measure and classify current behavior (size L)

1. Add `scripts/measure-profile-context.js` and host-specific fixtures for Claude Code, Codex,
   OpenCode, and agy.
2. Measure, rather than infer:
   - skill metadata injected at discovery;
   - skill bodies loaded on invocation;
   - hook-produced additional context;
   - token count before/after `ceo-agent`, `dev-flow`, and `/l3`-`/l6`;
   - late skill invocation, compaction, reload, and whether an inactive profile ever becomes
     model-visible or loadable during the full session.
3. Add `profiles/rule-inventory.json`. Classify every imperative rule in the owner/dev lifecycle as:
   `core`, `guided`, `autonomous`, `assurance`, `topology`, or `obsolete`.
4. Fail the inventory check when the same canonical rule is independently owned by multiple
   categories.
5. Apply the packaging decision rule from section 2.6F and record the result in this plan's review
   log before P2.

Acceptance:

- Baseline context/token traces are checked in as sanitized fixtures or reproducible summaries.
- Every current owner/dev rule has exactly one category and canonical owner.
- A single artifact is selected only if inactive semantic metadata/body/triggers are zero and the
  inactive loader route is denied for the full session; otherwise generated profile-specific
  payloads are mandatory.
- No new execution behavior is enabled.

### P1 - Owner Kernel envelope/grant projection in shadow (size L; depends on P0)

1. Add task-authority-envelope and role-execution-grant schemas.
2. Extend Owner Kernel canonical policy/hash/compatibility modules to:
   - freeze one immutable task authority envelope;
   - compile a least-privilege child role grant for each dispatch;
   - bind every grant to the parent envelope hash;
   - reject any grant that broadens task permissions, destinations, budgets, or red lines.
3. Add the pure guidance child projection and CLI wrapper; it receives a resolved envelope and
   cannot independently parse/mint authority.
4. Extend governance configuration with:
   - `guidance_profile: adaptive|guided|autonomous`;
   - `assurance_profile: standard|conservative`;
   - `topology_preference: auto|inline|foreman|heterogeneous`;
   - `data_egress: local-only|allowlisted|online`.
5. Compile the typed deny-by-default data-class x route-class x exact-destination matrix into the
   authority envelope. Explicit deny wins; absent rows deny.
6. Resolve exact role identity, task/domain/language scope, tool surface, and evidence freshness
   before compiling a grant.
7. Apply the role-admission floor before profile selection:
   - admitted identities may receive either profile;
   - provisional identities are limited to configured low-risk shadow/bounded roles;
   - ineligible owner/high-risk reviewer/protected-effect dispatches block or escalate;
   - `guided` never changes the admission result.
8. Make `unknown/stale/degraded/revoked` resolve to `guided` only for admitted bounded roles;
   otherwise deny the dispatch.
9. Re-resolve fallback and role changes as new grants against the same envelope.
10. Treat identity/capability/containment drift as active-grant revocation. Before the next
   tool/effect/acceptance operation, fail stop and require a new attested grant/session.
11. Take evaluation time as an explicit input to keep the compiler pure/deterministic.
12. Emit shadow ledger/telemetry/receipt fields only; current guided behavior remains authoritative.
13. Add deterministic pairwise generation across profile, risk, topology, role, task scope,
   identity state,
   and fallback. Exhaustively enumerate high-risk cases.

Acceptance:

- Same normalized inputs, including explicit evaluation time, produce byte-identical envelope,
  grant, and hashes.
- Every child grant references exactly one envelope and can only narrow it.
- Implementer/reviewer grants cannot inherit owner effect permissions.
- Guidance choice cannot turn an admission denial into an admitted role.
- An ineligible owner is replaced by an eligible owner/human or blocks; adding guided prose is not
  a passing result.
- Profile changes do not alter envelope permission/red-line/acceptance fields.
- Untrusted text cannot affect resolution.
- Fallback cannot inherit model/profile/evidence and receives a new grant.
- Route tests cover every data class and route class; treating `allowlisted` as `online` fails.
- Active identity drift invalidates the grant before another protected operation.
- Shadow envelopes/grants cannot authorize an effect or acceptance that current DOA/hooks deny.
- Existing `/l3`-`/l6` behavior is unchanged in shadow mode.

### P2 - Canonical packs and context isolation (size L; depends on P1)

1. Create `core`, `guided`, and `autonomous` canonical bodies from the P0 inventory.
2. Remove obsolete duplicated verification instructions only from the autonomous path.
3. Move guided task-graph/checklist/history state outside worker prompts and render only the active
   slice's six-element input/output contract.
4. Implement the P0-selected packaging path:
   - just-in-time selected profile in one artifact; or
   - generated profile-specific plugin payloads from canonical source.
5. Deny inactive profile loaders/triggers for the full session. An explicit conflicting skill or
   profile request returns a fresh-grant/session handoff rather than loading a second body.
6. Wire `ceo-agent` and `/l3`-`/l6` to consume the envelope plus current role grant.
7. Keep `dev-flow` as the guided compatibility implementation.
8. Split hooks into:
   - invariant/effect hooks that remain profile-independent;
   - guidance hooks that run only when selected and never grant authority.
9. Add the context/isolation gate, full-session trace, exact token source, and budgets.
10. Add a profile-prose gate that rejects tool/permission/approval/reviewer requirements from
    guidance bodies; those fields may appear only in core/assurance/grant renderings.

Acceptance:

- Prompt traces contain core + exactly one profile.
- Inactive profile body/hash/semantic metadata/triggers are absent, and its loader is denied for the
  full session including compaction/reload.
- Added control context is within KR3.
- Envelope/core invariants are byte-equivalent across guided/autonomous grants.
- Guided golden traces match current behavior.
- A guided worker sees only its current slice; removing completed/future slice text does not remove
  dependency IDs, inputs, outputs, or acceptance.
- Guidance bodies contain no permission, tool-grant, approval, or reviewer-gate semantics.
- Autonomous traces contain no mandatory double-check/verifier choreography; any independent gate
  appears only in the assurance/core rendering.

### P3a - Evidence lifecycle core (size L; depends on P1)

1. Extend capability state with source, role, task/domain/language/tool scope, exact identity,
   status, issued/observed/expiry time, methodology version, trial set, and evidence hash.
2. Require mutation-validated known-bad, clean specificity, and an independent artifact oracle for
   every autonomous role promotion. Qualification thresholds use repeated trials and versioned
   pass/false-pass floors rather than one successful run.
3. Treat ordinary-work receipts as supplemental regression/confidence evidence only. They cannot
   promote an identity by absence of a discovered error.
4. Add immediate active-grant revocation on Critical miss, semantic identity drift, or probe
   regression.
5. Expose provenance, applicability, and expiry in the final receipt.

Acceptance:

- No model becomes `qualified` from self-report, external prior, or ordinary receipts alone.
- Mutating the known-bad defect makes the oracle fail; a vacuous green suite cannot promote.
- Evidence for one role/domain/language/tool surface cannot silently qualify a different scope.
- Expired/changed identity is demoted and active grants are revoked deterministically.
- Reviewer promotion includes false-pass-on-Critical and clean-specificity floors.

### P3b - Optional Artificial Analysis prior adapter (size S; depends on P3a)

1. Implement the AA importer using the documented API:
   - API key remains user-local;
   - response cached user-locally;
   - stable IDs and attribution retained;
   - index versions form separate cohorts;
   - no fetched data is staged or packaged.
2. Map AA dimensions to provisional roles:
   - Agentic + exact coding-agent evidence: owner candidate;
   - DeepSWE/Terminal/Coding: implementer candidate;
   - repository Q&A/long context: explorer candidate;
   - reviewer remains unqualified without local false-pass/specificity evidence.
3. Downgrade applicability when benchmark language/domain, harness, precision, or deployment shape
   does not match the requested role.

Acceptance:

- AA network/API failure leaves routing functional using P3a evidence or guided.
- External data alone cannot produce `qualified`.
- Index-version changes never compare raw scores as one stable scale.
- No AA response/cache enters git.
- AA is not required for the core adaptive-profile release.

### P4 - Optional local deployment onboarding (size L track; depends on P1/P3a)

#### P4a - Fingerprint and bounded raw transport (size L)

1. Add semantic fingerprint, stable operational fingerprint, and transient capacity observation
   schema/records.
2. Add a user-local non-secret local-engine roster. Continue to use existing protected endpoint
   secret handling where authentication exists.
3. Implement `probe-local-engine.js` against a fake contract server first.
4. Add runtime-specific identity acquisition. An endpoint without a stable weight/quant/template/
   parser/runtime binding is `identity_unverifiable` and cannot reuse qualification.
5. Live-spike each runtime before publishing its row. One passing runtime is sufficient to ship
   that one row; absent runtimes stay `unverified` and do not block the core release.
6. Add `dispatch-local-openai.js` with:
   - loopback default;
   - explicit role allowlist;
   - raw author/reviewer request only;
   - pre/post identity verification and hot-swap fail-stop;
   - server-side cancellation acknowledgement plus queue/resource recovery verification;
   - no repo tools and no implicit network tools;
   - metadata-only telemetry by default.
7. Add a per-endpoint Autopilot lease with default concurrency one and just-in-time headroom check.
   Do not claim it controls non-Autopilot external load.
8. Enforce the envelope's egress matrix before any reviewer, tool, fallback, or AA refresh.
9. Require authenticated TLS/certificate verification for non-loopback payloads.
10. Record runtime network containment separately: loopback is `local_endpoint`, while
    `offline_verified` requires an independent network boundary and probe.
11. Record resource/SLO evidence separately from semantic qualification.

Acceptance:

- Same model label with different quantization/template/runtime cannot reuse semantic evidence.
- An unbindable endpoint stays guided/provisional and cannot reuse qualified evidence.
- Hardware/config changes invalidate SLO evidence; transient headroom does not churn identity.
- Claimed JSON/tool/context support is observed, not copied from model metadata.
- Parallel Autopilot dispatches cannot both acquire a single-capacity endpoint lease.
- Timeout is not complete until server generation/queue/resource recovery is observed; otherwise
  the endpoint is degraded/quarantined.
- Remote/non-loopback endpoints require explicit configuration, authenticated TLS, and certificate
  verification.
- Loopback alone is never reported as `offline_verified`.
- Prompt/output bodies are not written to telemetry by default.
- `local-only` high-risk work blocks when no qualified local assurance path exists.

#### P4b - Agentic harness qualification (size L; depends on P4a)

1. Spike existing coding harness candidates that can target the local endpoint.
2. Require working-directory anchoring, tool loop, write containment, process-tree timeout,
   artifact handback, and exact endpoint identity.
3. Run an adversarial containment suite that attempts worktree escape, writes through Git
   common-dir/hooks/config, credential reads, network access, symlink/path escape, and surviving
   descendants after timeout.
4. Add a runner only after the happy-path edit/test/commit probe and every required containment
   mutation pass.
5. Keep raw-only deployments in author/reviewer roles when no harness qualifies.

Acceptance:

- No raw endpoint is advertised as owner/implementer merely because chat/tool JSON works.
- The selected harness passes real worktree containment, artifact, credential/network, Git
  metadata, path-escape, and descendant-process probes.
- If no harness qualifies, the phase records that bounded result and ships no fake agentic path.

### P5 - Core adaptive dogfood and cutover (size L; depends on P2/P3a)

1. Start with `guidance_profile: guided` authoritative and adaptive shadow decisions.
2. Compare context cost, completion rate, false-green, reviewer catches, rework, wall time, and
   token use for guided versus autonomous on low-risk tasks.
3. Dogfood autonomous only with fresh qualified owner identities; bounded guided workers remain
   under an admitted owner.
4. Keep high-risk assurance invariant and verify cross-family/evidence behavior.
5. Test task override at intake and fresh-session switching.
6. Enable `adaptive` as project default only after:
   - zero Critical false-pass attributable to profile reduction;
   - KR3/KR4 context isolation passes across supported hosts;
   - fallback re-resolution and expiry/demotion tests pass;
   - all dogfood identities already passed P3a promotion;
   - at least five subsequent low-risk autonomous dogfood tasks have complete independent receipts.
7. Emit final decision receipts and retain a one-setting `guided` rollback.

Acceptance:

- Adaptive selection saves measured context/tokens for autonomous-qualified roles.
- Guided behavior remains available and regression-compatible.
- Profile rollback is configuration-only and does not change project intent or authority.
- AA and local adapters are not required for remote adaptive cutover.

### P6 - Core documentation, portability, and release closure (size Fix; depends on P5)

1. Update architecture, routing, hetero dispatch, installation, and bilingual README surfaces.
2. Document AA/local adapters only when their independent P3b/P4 gates have passed; otherwise label
   them planned/unverified without blocking the core release.
3. Add all new deterministic scripts to `CLAUDE.md`.
4. Regenerate agent bodies/Codex payload from canonical source.
5. Run doc-sync, canonical invariants, version/hook inventory, portability, and release preflight.
6. Record actual context savings, supported local runtimes/roles, and remaining unverified claims in
   the changelog/project archive.

Acceptance:

- Every published capability claim has a live probe or official-source URL.
- Canonical/generated mirrors are byte-aligned.
- Release gates and pre-commit pass.
- P3b and P4 may ship as later additive releases without changing the core envelope/grant contract.

## 5. Test / validation

### Deterministic tests

```bash
bash hooks/tests/execution-profile.test.sh
bash hooks/tests/profile-context-isolation.test.sh
bash hooks/tests/aa-capability-import.test.sh
bash hooks/tests/local-engine-probe.test.sh
bash hooks/tests/dispatch-local-openai.test.sh
node scripts/check-profile-isolation.js --check
scripts/validate.sh
scripts/check-canonical-invariants.sh
scripts/sync-codex-plugin-skills.sh --check
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
```

### Required negative cases

- alias spoof and unresolved alias;
- model hot-swap behind the same endpoint;
- preflight identity matches but postflight identity/generation binding differs;
- full precision to quantized downgrade;
- tokenizer/chat-template/tool-parser change;
- context claim larger than observed usable context;
- invariant capsule truncation attempt;
- repo/web prompt injection requesting autonomous promotion;
- expired or withdrawn external benchmark evidence;
- fallback engine change without profile re-resolution;
- role/domain/language/tool-surface qualification reused outside its evidence scope;
- guidance profile turns a denied owner/reviewer admission into an allowed dispatch;
- child role grant broadens its parent authority or inherits owner effects;
- active grant continues after semantic identity/containment drift;
- transport model identity mismatch;
- reviewer self-report claiming qualification;
- known-bad Critical false-pass;
- clean patch over-flag/specificity regression;
- same-family correlated reviewer path;
- local server timeout with surviving child/process;
- local OOM and recovery;
- remote binding or network tool enabled without explicit policy;
- non-loopback local endpoint without authenticated TLS/certificate verification;
- loopback endpoint incorrectly reported as offline-verified;
- local model followed by cloud reviewer/fallback under `local-only`;
- `allowlisted` destination accepts an absent data-class/route-class row;
- explicit egress deny loses to an allowlisted/online rule;
- benchmark evidence from English/cloud/full-precision treated as exact Chinese/local/quantized evidence;
- guided prompt includes completed/future slices instead of external references;
- guidance prose grants a tool, routine-decision authority, approval exemption, or reviewer gate;
- profile policy edited after task intake;
- inactive profile semantic metadata/trigger/loader is reachable later in the session;
- local harness escapes the worktree through Git metadata, symlink/path tricks, credentials,
  network access, or a surviving descendant;
- HTTP abort returns while the server generation/queue/resource use remains active.

### Matrix strategy

Do not test the full Cartesian product for ordinary cases.

- Exhaust core invariants across both effective profiles.
- Use deterministic pairwise coverage for role x task scope x profile x risk x topology x evidence
  state x fallback x egress route.
- Exhaust high-risk cases across every profile and evidence state.
- Run local golden cases for each semantic fingerprint class and each claimed role.
- Mutation-test critical resolver predicates so a vacuous green suite cannot promote a model.

### Live gates

- One current Claude Code prompt trace.
- One current Codex prompt trace.
- OpenCode/agy traces where their installed harness exposes the required observation; otherwise
  retain an explicit `unverified` record.
- AA API smoke with a user-owned key and a temporary cache outside git, only when P3b ships.
- One live runtime protocol/identity/cancellation smoke per local row, only when P4a ships.
- One real local harness happy-path plus adversarial containment suite before each P4b implementer
  admission.

## 6. Risks + inversion

| Failure that would sink the project | Mitigation |
|------------------------------------|------------|
| Profiles become a new permission tier | Envelope/grant narrowing plus a profile-prose linter forbid tool, permission, approval, and reviewer-gate semantics in guidance. |
| Guided prose is mistaken for a capability upgrade | Role admission runs first; denied owners/reviewers block or defer to an eligible owner, and bounded workers cannot widen their grant. |
| All profile prose still enters context | Full-session traces require zero inactive semantic metadata/loader access; otherwise generated payloads are mandatory. |
| `adaptive` becomes scattered `if model` logic | Owner Kernel remains the one policy seam; one pure child projection and typed grant are consumed, never re-derived. |
| Task authority and dispatch identity drift together | Immutable authority envelope plus replaceable least-privilege role grants; fallback/role/model changes mint a new grant. |
| AA leaderboard drift silently changes production behavior | User-local versioned cache, expiry, provisional ceiling, no runtime fetch, local promotion required. |
| Public repo redistributes restricted AA data | Importer/schema only; tracked-score scan blocks fetched data. |
| Same local model label hides a different deployment | Runtime-specific pre/post attestation; unbindable identity cannot reuse qualification. |
| Hardware changes trigger unnecessary full quality eval | Separate semantic identity, stable operational fingerprint, and transient capacity observation. |
| Local API compatibility is mistaken for an agent | Raw and agentic roles are separate; no custom tool loop; real harness probe required. |
| A weak model promotes itself through repo edits | Policy frozen at intake; untrusted/model-authored evidence cannot promote; profile never grants authority. |
| Context budget truncates safety text | Core capsule non-truncatable; role fails precondition when it cannot fit. |
| Mid-session override stacks contradictory profiles | Requested policy is frozen at intake and one effective profile is frozen per role grant/session; changes require a fresh-session handoff. |
| Test matrix becomes unbounded | Orthogonal axes, invariant/property tests, pairwise ordinary coverage, exhaustive high-risk coverage. |
| Guided compatibility is lost while extracting rules | Golden prompt/behavior fixtures and guided-first shadow rollout. |
| Local endpoint leaks private data or opens LAN access | Loopback default, separately verified offline boundary, explicit network policy, metadata-only telemetry, and no implicit tools. |
| A "local" task leaks through external review or fallback | Frozen end-to-end data-egress policy; missing local assurance blocks/escalates instead of routing online. |
| Loopback is falsely sold as offline | Offline is a separate independently enforced/probed state; non-loopback requires authenticated TLS and certificate verification. |
| Concurrent local calls pass a stale RAM probe then OOM | Per-endpoint Autopilot lease, default concurrency one, just-in-time headroom check, and explicit limit on external-load guarantees. |
| HTTP cancellation leaves local generations consuming capacity | Require server acknowledgement plus queue/resource recovery; otherwise degrade/quarantine the endpoint. |
| Guided profile consumes more context than the weak model can use | External task graph/state, current-slice-only prompt, hard budget, and role ineligibility when the invariant capsule cannot fit. |
| Strong model optimization merely moves complexity into the resolver | Surface-line/context budgets and one envelope/grant policy seam; every added predicate requires a failing eval or invariant. |

Inversion statement:

> This project fails if "adaptive" means more prose, more duplicated policy, or more authority for a
> benchmark winner. It succeeds only if the core becomes smaller, one profile is observable in
> context, and every effect/acceptance boundary stays model-independent.

## 7. Out of scope

- Splitting Autopilot and Hetopilot into separate repositories.
- Building or managing a long-running Autopilot host service.
- Starting/stopping Ollama, vLLM, llama.cpp, LM Studio, or GPU drivers.
- Writing a new general-purpose coding-agent/tool loop for raw local models.
- Reproducing Artificial Analysis benchmarks or shipping their score dataset.
- Treating one public composite score as reviewer qualification.
- Removing deterministic tests, artifact verification, red lines, or high-risk independent gates.
- Dynamically unloading system/skill instructions inside an already contaminated session.
- Automatic production deployment or expanded DOA.
- Supporting every local runtime in the first release; only live-probed protocol/role rows ship.

## 8. Open questions

No Board decision is required before P0/P1. Two implementation choices are intentionally resolved by
measured gates rather than preference:

1. One plugin artifact with just-in-time profile loading versus generated profile-specific payloads
   is decided by the P0 context-isolation threshold.
2. AA prior import and each local runtime/agentic harness row ship only after their independent
   adapter gates; neither blocks the core profile release.

Any request to let an unqualified autonomous override weaken assurance/authority is a new Board
decision and outside this plan.

## Dependency map

```text
P0 measure/inventory
  -> P1 Owner Kernel envelope/grant shadow
       -> P2 packs/context isolation
       -> P3a evidence lifecycle core
P2 + P3a
  -> P5 adaptive dogfood/cutover
       -> P6 docs/release

P3a -> P3b AA prior adapter (optional additive release)
P1 + P3a -> P4a local fingerprint/raw transport
                 -> P4b local harness qualification
              (optional additive releases)
```

P2 and P3a may run in parallel after P1. P3b/P4 are capability adapters and cannot block P5/P6.
P4b gates only the local owner/implementer rows it actually qualifies.

## Requirement coverage

| Concern | Decision | Enforced by |
|---------|----------|-------------|
| Strong and weak models coexist | One product with two compiled guidance profiles; continuous evidence does not create an unbounded profile matrix. | KR1/KR17, sections 2.6A-C, P1/P2 |
| Weak model needs stronger direction | Role admission runs first; an eligible owner gives bounded slices to guided workers. More flow never upgrades a denied owner/reviewer. | KR5/KR17, P1, negative tests |
| Strong model should not be over-constrained | Autonomous guidance removes redundant choreography while keeping the same authority and assurance floor. | KR2, profile-prose gate, P2 |
| Context waste | Load exactly one profile, externalize guided state, measure full-session tokens, and generate separate payloads if metadata leaks. | KR3/KR4/KR13/KR16, P0/P2 |
| Project default and task override | Freeze requested policy once at intake; resolve each role grant from that policy and exact deployment evidence. | section 2.6K, P1/P5 |
| Local models | Treat deployment identity, raw transport, agentic harness, resource capacity, and offline state as separate verified facts. | KR8/KR9, P4a/P4b |
| Local privacy | Deny-by-default egress spans models, reviewers, tools, telemetry, fallbacks, and benchmark refreshes. | KR14, P1/P4a |
| Cheap capability bootstrap | Artificial Analysis is an optional, versioned, provisional prior with no bundled score data. | KR6/KR12, P3b |
| Capability is not global | Evidence is scoped to role, task/domain/language, tool surface, runner, settings, and exact deployment. | section 2.6C/G, P1/P3a |
| Fallback and runtime drift | Re-resolve exact identity; revoke the role grant before another protected operation. | KR5/KR7, P1/P3a |
| Review rigor | Assurance remains independent from guidance; high-risk gates and artifact oracles do not disappear for strong models. | KR2, P2/P3a/P5 |
| Plugin architecture | No Autopilot daemon and no home-grown local agent loop; optional adapters cannot block core cutover. | Global constraints, P4/P6 |
| User-visible accountability | Final receipt reports effective policy, evidence, fallback, context cost, and non-user-specified decisions. | KR11, section 2.6K |

## Review log

### R0 - Author synthesis (2026-07-26)

Sources:

- repository architecture/config/runner/context inventory at `develop@dd34d57`;
- Anthropic Opus 5 prompting guidance;
- Artificial Analysis capability/coding-agent methodology and Data API terms;
- official Ollama, vLLM, llama.cpp, and LM Studio protocol documentation;
- prior discussion selecting monorepo core + packs over a repository fork.

### R1 - Three-perspective review (2026-07-26)

| Lens | Main finding | Disposition |
|------|--------------|-------------|
| Architect / Context | Prompt-only profile selection cannot prove isolation; measure each harness and generate profile-specific artifacts if inactive bodies leak. Profile changes require a fresh session. | Accepted in P0/P2 and KR3/KR4. |
| QA / Security | The dangerous error is false promotion. Profile identity must include exact deployment; unknown/stale/fallback resolves guided; profile cannot buy authority. High-risk cases need exhaustive negative coverage. | Accepted in constraints, P1/P3a/P5, and validation matrix. |
| Local Runtime / Ops | Local quality depends on weights, quantization, templates, runtime, context, hardware, and concurrency. Raw HTTP and agentic harness are separate. Default loopback; offline requires separate verification; observe resources without logging content. | Accepted in fingerprint split and P4a/P4b. |

### R1 collision insights

1. Context isolation is a packaging property, not merely a prompt instruction. The plan therefore
   allows multiple generated plugin payloads while retaining one canonical repository.
2. Capability evidence should optimize guidance density but not effect authority. This bounds damage
   if an external prior or local fingerprint is wrong.
3. Local hardware changes affect operational capacity more often than semantic quality. Splitting
   semantic and operational fingerprints avoids both unsafe reuse and needless full requalification.
4. Profile switching and project-default/task-override UX are compatible only when the override is
   frozen at task intake; late switching requires a clean session because context cannot be unloaded.

### R2 - Plan-text adversarial review (2026-07-26)

| Severity / lens | Verified finding | Disposition |
|-----------------|------------------|-------------|
| Critical / Architect | One frozen object mixed task authority with per-dispatch role/model/profile identity, which would either mutate frozen intent on fallback or leak owner permissions to children. | Replaced with immutable Owner Kernel `TaskAuthorityEnvelope` plus replaceable, narrowing `RoleExecutionGrant` child projections. |
| Major / Architect | Inactive skill metadata could still steer/load the other profile; intake-only tracing was insufficient. | Single artifact now requires zero inactive semantic metadata/triggers and loader denial across a full-session trace; otherwise generated payloads are mandatory. |
| Major / Architect | A new compiler risked becoming a second authority beside Owner Kernel. | Owner Kernel canonical policy/hash/ledger is explicitly the only authority seam; profile resolution is a non-authoritative child projection. |
| Major / Architect + QA | Guided/autonomous prose granted reviewer/tool/decision behavior, violating profile/assurance/authority orthogonality. | Removed those grants from profile bodies and added a profile-prose gate. |
| Major / QA | Ordinary successful receipts could promote a model without an independent oracle. | Promotion now requires mutation-validated known-bad, clean specificity, and an independent artifact oracle; receipts are supplemental only. |
| Major / QA | Frozen-profile language conflicted with immediate demotion after active identity drift. | Drift now revokes the role grant and fails stop before the next protected operation; task authority remains frozen. |
| Major / QA | `allowlisted` egress lacked typed data/route/destination semantics. | Added a finite deny-by-default route matrix with explicit-deny precedence and coverage for every data/route class. |
| Major / QA | Local harness admission tested only happy-path edit/commit. | Added adversarial worktree/Git/credential/network/path/process containment mutations. |
| Major / Local Ops | OpenAI model ID could not bind weights/quant/template/runtime, leaving a hot-swap TOCTOU gap. | Added runtime-specific pre/post attestation; unbindable deployments cannot reuse qualification. |
| Major / Local Ops | Transient RAM/VRAM was incorrectly part of identity and lacked concurrency admission. | Split stable operational fingerprint from transient capacity; added per-endpoint lease/default concurrency one and JIT headroom check. |
| Major / Local Ops | Loopback did not prove runtime offline, and remote transport lacked TLS requirements. | Added independent `offline_verified` state and authenticated TLS/certificate verification for non-loopback payloads. |
| Major / Local Ops | HTTP abort did not prove server generation/resource cancellation. | Cancellation acceptance now requires server acknowledgement plus queue/resource recovery or endpoint quarantine. |
| Major / all lenses | AA/local adapter work unnecessarily blocked remote adaptive cutover. | Split P3a core evidence from optional P3b AA; made P4 optional; P5/P6 depend only on P2/P3a. |

### R3 - Final author boundary audit (2026-07-26)

The final audit found that `unknown -> guided` could be misread as role admission and that a
role-only capability record could overgeneralize across task domains or languages. The plan now
puts admission before guidance, makes an ineligible owner/reviewer block or defer to an eligible
owner, and scopes evidence by role + task/domain/language/tool surface + exact deployment. It also
keeps only two initial profile outputs despite continuous evidence, preventing premature profile
proliferation.

Plan-text validation passed `scripts/validate.sh`, `scripts/check-canonical-invariants.sh`, a
placeholder scan, and whitespace/diff checks on 2026-07-26.

Consensus after repair: proceed with P0/P1. No unresolved architecture blocker remains.
Packaging, each local runtime row, and each optional adapter are admitted only by their named
measurement gates; none is assumed in advance.

### R4 - P0 implementation review (2026-07-26)

Three independent read-only lenses reproduced and then closed the P0 false-green paths:

- the rule inventory now covers frontmatter routing plus every conservative body candidate, requires
  an independent source manifest, and gives exact duplicates one declared owner;
- guidance/checklist mechanics are not core invariants;
- malformed traces fail by default, prompt visibility excludes diagnostic strings, and heuristic
  token estimates cannot pass the budget;
- checked-in summaries bind live source hashes, two unique content-free trace hashes, catalog
  aggregates, Grok discovery evidence, and the fail-closed generated-payload decision.

Final P0 re-review: Architecture accepted; Security/Evidence accepted; Transport/False-green
accepted. Focused gate: 42 assertions, zero failures.

### R5 - P1 implementation review (2026-07-26)

Three independent read-only lenses reproduced the P1 authority, compatibility, and executable-oracle
boundaries, then accepted the repaired implementation:

- architecture verified that current P4 policy cannot accept downgraded pre-P4 targets, pre-P4 policy
  cannot accept P4 targets, and historical retries preserve the witnessed translation;
- correctness verified fixed Owner Kernel emitter identity/channel namespaces, admission before
  guidance, one-parent narrowing grants, and fail-stop revocation on live drift;
- transport/false-green replayed 55 schema/ref/keyword cases plus duplicate-key, unsafe-number,
  invalid-UTF-8, non-JSON API value, exotic-array, and canonical/Codex mirror probes.

Final P1 re-review: Architecture accepted; Correctness accepted; Transport/False-green accepted.
Focused profile gate: 33 assertions, zero failures. Translation, Owner Kernel, and action-hardening
focused gates also passed. The worktree-aware red-green run was `VALIDATED`: HEAD passed all 25
translation assertions while P0 base plus the changed test failed on the missing P4-shape rejection.
