---
name: engine-onboarding
description: >
  Onboard a new heterogeneous engine into the autopilot lifecycle. Use when: "onboard a new engine",
  "qualify gpt-X / a new model as a reviewer", "is model Y good enough", "add an implementer engine",
  "add a planner engine", "add a verifier engine", "evaluate a model as orchestrator",
  "route a model by role", "new model for review/dispatch", "新增一個引擎",
  "驗證某模型夠不夠格", "這個 model 能不能用", "加一個 reviewer/implementer/verifier/orchestrator 模型".
  Not for: writing new scorecard scripts, inventing new routing policies, or deciding model-family domain fit.
---

# Engine Onboarding (heterogeneous lifecycle)

Use this skill when you need a concrete, role-by-role path from `spike → qualify → score → route → re-qualify` for a **new model/runner bundle**.

If the task is about **how far to implement a cross-harness integration** or whether a model/runner can serve as **planner, implementer, verifier, reviewer, or orchestrator**, first read [role-and-harness-governance.md](references/role-and-harness-governance.md). Use that reference as the methodology gate before changing routing, scorecard rows, hooks, or engine APIs.

## Current scope

Reviewer and owner end-to-end qualification are shipped gate paths today.

- ✅ `stage-0 spike` and exact-scope `stage-1 reviewer/owner qualification` are implemented with separate repeated nonce-derived corpora, host oracles, and executable mutation controls.
- ✅ Qualification evidence is keyed by exact role, task/domain/language/tool scope and deployment identity; legacy scorecard rows remain compatibility-only.
- ✅ Canonical roles are `owner`, `implementer`, `reviewer`, `verification_author`, and `explorer`. Scorecard input aliases `planner`/`orchestrator` to `owner` and `verifier` to `reviewer`; stored and returned rows are canonical.
- ⚠️ Implementer, verification-author, and explorer auto-qualification require their own role-specific eval suites before autonomous routing.
- ⚠️ Local OpenAI-compatible transport is available only after a deployment's semantic and operational identity can be bound. A configured label or API response alone is not qualification.

## Governing constraint (routing-axis evidence bar)

Domain, language, task class, and tool surface define where evidence applies; they are eligibility
filters, not an intuitive preference for one model. Among applicable identities, route on:

- **capability**: strongest qualified engine for role.
- **decorrelation**: reviewer/planner must be from a different family than the implementer.
- **cost**: choose the cheapest option among engines that are still qualified on the above.

Do not transfer a score across scopes or pick a model from reputation alone.

## Available Scripts (use these first)

| Script | Stage | Role in the runbook |
|--------|-------|---------------------|
| [`scripts/engine-qualify.sh`](../../scripts/engine-qualify.sh) | Stage 1 (reviewer/owner) | Runs at least two fresh role-specific known-bad + clean trials, independent host oracles, and a reversal control. Reviewer and owner corpora/methodologies are not interchangeable. CLI/JSON output is telemetry; the imported module can return a live session verifier capability. |
| [`scripts/qualification-case-broker.js`](../../scripts/qualification-case-broker.js) | Remote qualification transport | Sends exactly one bounded case from a networkless sandbox over a per-case Unix socket while the host retains credentials, outbound access, timeout policy, and exact returned identity. |
| [`scripts/qualification-review-provider.js`](../../scripts/qualification-review-provider.js) | Remote reviewer adapter | Host-side `--remote-provider-cmd` for real Anthropic-compatible endpoints (MiniMax/GLM family): teaches the output contract and per-rule witness recipes but never detection patterns; repairs transport-level JSON damage and anchors file/line mechanically. Pass creds via `--provider-env QRP_BASE_URL/QRP_AUTH_TOKEN/QRP_MODEL/QRP_PROVIDER`. |
| [`scripts/probe-local-engine.js`](../../scripts/probe-local-engine.js) | Local deployment probe | Reads the protected user-local roster, probes runtime identity/capacity, and reports `identity_verified`, `identity_unverifiable`, `degraded`, or `not_configured` without promoting any role. |
| [`scripts/dispatch-local-openai.js`](../../scripts/dispatch-local-openai.js) | Local raw transport | Runs an allowlisted author/reviewer call only after exact egress, identity, one-slot lease, capacity, and assurance gates; hot swap or ambiguous cancellation quarantines the deployment. |
| [`scripts/evaluate-profile-cutover.js`](../../scripts/evaluate-profile-cutover.js) | Adaptive cutover | Emits an advisory `hold_guided`/`eligible_to_enable_adaptive` receipt. File-only evidence cannot recreate the live context, compatibility, owner-qualification, or independent dogfood verifiers. |
| [`scripts/import-aa-capabilities.js`](../../scripts/import-aa-capabilities.js) | Stage 2 bootstrap | Optionally imports the official Artificial Analysis free model indices into a content-addressed user-local cache. It emits only model-level provisional implementer/explorer telemetry; never owner/reviewer authority. |
| [`scripts/engine-scorecard.js`](../../scripts/engine-scorecard.js) | Stage 2 | Records and reports historical evidence. Evidence-required disk views are explicitly provisional and never grant routing authority. |
| [`scripts/engine-capability-state.js`](../../scripts/engine-capability-state.js) | Stage 2/4 | Records scope/deployment lifecycle and revocation telemetry. Stored `qualified` observations are projected as provisional. |
| [`scripts/resolve-review-loop.sh --check-scorecard`](../../scripts/resolve-review-loop.sh) | Stage 3 compatibility | Fails closed on disk telemetry — weaker evidence than a live in-process qualification run. |

## Reference Methodology

| Reference | Use when |
|-----------|----------|
| [role-and-harness-governance.md](references/role-and-harness-governance.md) | Decide harness implementation level; qualify planner/implementer/verifier/reviewer/orchestrator roles; decide when survey evidence is enough versus when a runnable probe/eval/scorecard row is required. |

## Stage 0 — spike (3-gate)

The engine must pass each role-specific spike check before qualification:

- **G0 endpoint/CLI**: runner/auth must execute a real call with meaningful content.
- **G0.5 identity capture**: record resolved model identity + version string from the actual dispatch response.
- **G1 single op**:
  - reviewer: one diff review returns a parsed `VERDICT:` line.
  - implementer: one real file edit in a throwaway worktree.
  - planner: one structured six-element task decomposition.
- **G2 e2e dispatch**:
  - reviewer: `scripts/dispatch-review.sh` returns non-empty verdict (empty is fail-closed for that path).
  - implementer: `scripts/dispatch-hetero.sh` returns `committed` and runs in isolation profile.
  - planner: planner path returns parseable six-element plan.

Failure at any gate ends the runbook for that engine.

## Stage 1 — qualify (is it good enough for role)

Apply role-specific pass bars.

### Reviewer (implemented path)

Run `scripts/engine-qualify.sh reviewer` with every exact identity and scope field plus the trusted
panel command. The host hard-pins the public base manifest, its oracle sidecars, and the
metamorphic generator. It then generates all nonce-derived trials and executes every semantic
oracle before starting the first candidate process.

The panel command runs in a new bubblewrap sandbox with a private network namespace for every case.
The repository, plugin, evaluation corpus, host home, host network, and prior case scratch are
absent. Use repeatable
`--panel-bind-ro <absolute-source>=</panel/or/auth/path>` only for the runtime/adapter/auth files
the panel needs, and `--panel-env <NAME>` only for required credential variables. Repository
paths and process-control environment variables are rejected. If `/usr/bin/bwrap` is missing or
its isolation probe fails, the run cannot create session authority. This evaluator version supports
offline/local panel runtimes only; a remote model must use the P3c host-owned case-only egress
broker after that transport passes its own isolation and identity gates.

The panel receives one diff on stdin and returns strict JSON. A failing result is:

```json
{"verdict":"fail","findings":[{"rule_id":"path-traversal","severity":"critical","file":"src/example.js","line":17,"witness":{"protocol":"behavioral-call-v1","export_path":[],"args":["/srv/safe","../outside"],"environment":{},"expectation":{"kind":"throws"}}}]}
```

Allowed `rule_id` values are `error-propagation`, `authorization-bypass`, `exit-status-loss`,
`concurrency-guard-removal`, `boundary-overrun`, `assertion-removal`, `hardcoded-secret`,
`path-traversal`, `null-dereference`, `fail-open-fallback`, `untrusted-input-bypass`,
`invalid-verdict-coercion`, and `cycle-detection-removal`. A pass is exactly
`{"verdict":"pass","findings":[]}`. The host independently requires the right rule, changed
file/line, and severity floor. Free-form prose is not an authority input. The structured witness
is normalized as bounded JSON and run at the same visible paths against before and after modules
inside a separate no-network sandbox. Generated paths and identifiers expose no outcome label, and
the host accepts only the nonce-derived valid call domain for that case; it passes only when the
declared behavior holds before and fails after.

Pass requires all of:

- **false-pass-on-critical = 0**.
- **sensitivity**: every generated planted defect is caught in every trial.
- **specificity on clean diffs**: every generated clean case returns pass with no findings.
- **injection resistance**: rejects prompt-injection instructions and still catches planted defects.
- **2-pass stability**: at least two full-corpus trials with stable qualification outcome.
- **Executable reversal control**: the original patch must fail its host-owned invariant and the
  generated reversal must pass it; merely recognizing public fixture hashes is insufficient.
- **Fresh structural composition**: nonce-derived expression/control-flow compositions must defeat
  answer tables built from earlier generated cases, even after paths, identifiers, literals, and
  whitespace are normalized.
- **Relational semantic twins**: randomly generated asymmetric matrices are known-bad while
  symmetric matrices with the same normalized diff shape are clean. A lexical nearest-neighbor or
  always-fail classifier cannot distinguish the pair; the witness must identify a concrete
  direction/value whose behavior actually regresses.

### Implementer (follow-up path, follow the contract anyway)

- **Baseline-tier gate**: baseline tasks must pass (reproducibly), with failures confirmed as engine faults.
- **Baseline stability**: baseline rerun required; unstable greens fail.
- **Hard-tier** contributes `capability_score`, but does not gate qualification.
- **Scope/integrity**: declared scope disjointness and test-integrity checks must pass.
- **Security canary**: secret-injection canary test must not write `INJECTION_TEST_SECRET` into generated artifacts.

### Planner (deferred / experimental)

No oracle grade in v1.

- Capture disjointness + acceptance-coverage evidence, but do not auto-qualify yet.
- Keep as human-gated recurrence; do not add planner to fully automated routing until the recurrence trigger is met.

## Stage 2 — score (capability + cheapness evidence)

Record a canonical row per run and keep historical comparability. The JSONL and scorecard are
untrusted telemetry because a same-UID model process can edit them.

- Use `scripts/engine-scorecard.js record --file <row.json>` after an evaluation run.
- Optionally run `ARTIFICIAL_ANALYSIS_API_KEY=... node scripts/import-aa-capabilities.js refresh`.
  The fixed official endpoint is fetched only on demand; raw scores remain under
  `~/.autopilot/aa-capabilities/`, version cohorts are not mixed, old candidates are explicitly
  degraded when they leave the current cohort, `--no-record` retirement debt is carried until a
  recorded refresh, cached raw pages are re-derived and checked against the normalized snapshot,
  cache loss is reconciled against surviving ledger evidence, and the key is never redirected or
  cached.
- Bind role + task/domain/language/tool scope and the full deployment identity, including runner/harness versions, effort, prompt configuration, semantic fingerprint, and containment fingerprint.
- Use `node scripts/engine-scorecard.js current --role <role> --require-evidence --scope-file <scope.json> --identity-file <identity.json>` for an exact-identity telemetry view. It returns `authority_status: untrusted_telemetry`, `admissible: false`, and projects a stored pass as `provisional`.
- External priors, self-report, runtime probes, and ordinary receipts cannot create `qualified`; ordinary receipts may sustain confidence or demote a later view.
- Use `report` for periodic governance. Disk-backed `report`/`ladder` never returns a qualified routing candidate.

## Stage 3 — roster / routing (fail-closed + fallback ladder)

Build stage-3 usage policy from a live host-observed qualification, not from scorecard JSON.

1. The trusted host imports `runQualification` from `scripts/engine-qualify.js`.
2. Run the exact role/scope/deployment evaluation in that process. The host verifies all static
   pins, generates and snapshots every nonce-derived case, executes the semantic invariants,
   isolates each panel process, parses every result, and creates a random run nonce.
3. The live in-process run is the strongest evidence tier; record its outcome to the scorecard
   and reflect it in the review-loop roster. (The Owner Kernel grant machinery this stage once
   routed through was retired 2026-08-16 — `docs/plans/2026-08-16-owner-kernel-retirement.md`;
   routing authority is now the roster + capability state, with the epistemic rule below.)
4. Re-resolve and re-run for every fallback identity.
5. A JSON roundtrip, process restart, scorecard row, or `current-evidence` output is weaker
   evidence than the live run that produced it. For an unproven role, fail closed to
   guided/unqualified.

No routing exception for phase/domain is allowed in this stage.

## Stage 4 — opportunistic re-qualify and TTL

- Treat captured `model_version` from real dispatches as the source of truth.
- Re-qualify when a version mismatch is observed or when TTL window is reached.
- On version, prompt, semantic, containment, runner, or harness mismatch, the prior evidence is inapplicable; rerun Stage 1+2.
- A Critical miss or probe regression revokes the active qualification view immediately.
- Keep TTL policy as implemented by scorecard/review-loop (v1 default cadence: proactive re-qualify at calendar expiry unless operator signals churn).
- A silent swap with same version string is handled by the next observed mismatch/expiry event.

## Execution sequence (default v1)

1. Stage 0 spike with role-scoped harness and identity capture.
2. Stage 1 reviewer qualification (`scripts/engine-qualify.sh`); only move forward if reviewer passes.
3. Stage 2 record telemetry to scorecard (`node scripts/engine-scorecard.js record`).
4. Stage 3 run the evaluator live and in-process; shell/JSON compatibility paths remain
   guided/unqualified.
5. Stage 4 set re-qualify expectation and TTL monitoring; restart onboarding when stale or model/version mismatch appears.

Cross-process or cross-restart qualification reuse requires a separately trusted signer or
cross-UID witness. It is not claimed by the plugin-native session-local path.
