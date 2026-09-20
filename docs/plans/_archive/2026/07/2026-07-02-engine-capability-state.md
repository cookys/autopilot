# Plan R0 - Engine Capability State

> Status: Proposal R0 - authored while CC is actively repairing the repo; do not implement until the current repair branch/worktree is stable.
> Owner: Codex acting as Tech Lead.
> Date: 2026-07-02.
> Size: L.
> Frame: integrated follow-up to the hetero-engine lifecycle and cross-harness engine infrastructure plans.
> Branch: none for R0 authoring. Implementation should branch from fresh `develop` after the current CC repair work lands.

## 0. Context / Thesis

Autopilot now has multiple runner surfaces:

- `dispatch-hetero.sh` for write-oriented implementers.
- `dispatch-review.sh` for artifact-only heterogeneous reviewers.
- `dispatch-explore.sh` for trusted repo-reading probes.
- `engine-scorecard.js` and `engine-qualify.sh` for quality/cost/latency qualification evidence.
- `/l4`, `/l5`, and `/l6` front doors that increasingly depend on routed engines.

The missing layer is not another hardcoded routing table. The missing layer is an evidence-backed
runtime capability state:

```
engine identity + quota state + reset evidence + skill transport + probe/bench evidence
```

This plan integrates three related ideas into that one layer:

- quota/reset awareness, so dispatch can avoid known-exhausted runners without guessing;
- skill transport awareness, so hetero workers can receive Autopilot methodology only through proven channels;
- a small bench, so native skill support and prompt-packed skill obedience are measured before routing relies on them.

## 1. Problem

Current routing can answer "which runner should I try?" but not "is this runner currently available,
does it have quota, can it actually consume the methodology contract, and when should I retry it?"

Specific gaps:

- Quota exhaustion is discovered late, inside a long dispatch, then handled manually.
- Reset times live in transient CLI text or user memory, not in a structured local state.
- Runner capability facts rot in prose; `references/hetero-dispatch.md` already carries both verified and unverified skill-loading claims.
- Native skill support is not equivalent across Codex, agy, Grok, and cc-shim; treating it as universal would be a silent correctness bug.
- Prompt-packing full skill bodies can bloat context and confuse a worker unless the selected transport is measured.
- `/l5` and `/l6` can route to hetero workers, but the worker's methodology input is still mostly hand-carried by the task prompt.

## 2. OKR / KRs

Objective: Build a provider-neutral engine capability state layer that `/l5` and `/l6` can use for quota-aware and skill-aware dispatch without breaking existing behavior.

Key results:

- KR1: A schema-backed append-only local event store records quota, reset, skill transport, and bench evidence per runner/model/role.
- KR2: Dispatch scripts passively record quota-like failures from real runs without scraping dashboards or sending extra model prompts.
- KR3: A manual safe probe can refresh capability state and emits `unknown` when the runner has no official low-cost status surface.
- KR4: Hetero dispatch accepts an explicit skill transport flag with conservative defaults and no behavior change when omitted.
- KR5: A bench distinguishes native skill loading from prompt-packed skill obedience, with recorded artifacts and deterministic unit fixtures.
- KR6: Resolver integration starts report-only: exhausted high-confidence runners are demoted or warned, never silently hard-blocked in v1.
- KR7: Existing `/l4`, `/l5`, `/l6`, review, and dispatch behavior remains unchanged unless the new flags/config are explicitly enabled.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- No dashboard scraping, private web automation, or unofficial account-page parsing.
- No probe sends a paid model prompt unless the operator passes an explicit live-spend flag.
- `unknown` quota or skill state never blocks dispatch; it only suppresses confidence claims.
- Native skill support is unsupported until a runner/version/model passes the native-skill bench.
- Prompt-packed skills must be opt-in by selected skill name; never inject all Autopilot skills by default.
- Verifier isolation remains mandatory: reviewer prompts consume artifacts, never implementer self-report.
- v1 resolver consumption is report-only or demotion-only; hard fail-closed quota gating requires a later explicit approval.
- Local capability state lives under `~/.autopilot/` by default and is never committed.

## 3. File-Structure Map

| Path | Responsibility |
| --- | --- |
| `schemas/engine-capability-state.schema.json` | JSON schema for append-only capability events and merged current state. |
| `scripts/engine-capability-state.js` | Pure-Node state CLI: `record`, `current`, `report`, `prune`, and `classify-error`. |
| `scripts/probe-engine-capability.sh` | Safe manual probe wrapper for runner binary/auth/version/status/skill transport checks. |
| `scripts/bench-engine-capability.sh` | Optional live bench runner for skill transport and low-cost availability probes. |
| `evals/engine-capabilities/` | Bench prompt fixtures, expected result files, and captured sample outputs. |
| `hooks/tests/engine-capability-state.test.sh` | Deterministic unit tests for schema validation, merge rules, TTL, and error classification. |
| `hooks/tests/probe-engine-capability.test.sh` | Stubbed runner tests proving probes do not spend quota by default. |
| `hooks/tests/engine-capability-bench.test.sh` | Fixture-only bench tests for native vs prompt-packed skill evidence. |
| `hooks/tests/dispatch-hetero.test.sh` | Extend existing stubs to prove passive quota capture does not alter dispatch outcomes. |
| `hooks/tests/dispatch-review.test.sh` | Extend existing stubs to prove reviewer no-verdict/quota evidence stays fail-closed. |
| `hooks/tests/resolve-review-loop.test.sh` | Report-only resolver consumption tests for high-confidence exhausted state. |
| `scripts/dispatch-hetero.sh` | Add passive capture and `--skill-mode off|prompt|native|auto` for implementers. |
| `scripts/dispatch-review.sh` | Add passive capture only; no skill injection into artifact-only reviewer prompts. |
| `scripts/dispatch-explore.sh` | Optional skill-read probe consumer for trusted repo-reading checks. |
| `scripts/resolve-review-loop.sh` | Read capability state and emit routing advisory fields. |
| `project-config-template/review-loop-config.md` | Document `skill_mode`, capability state consumption, and quota advisory behavior. |
| `references/hetero-dispatch.md` | Update invariants: skill transport is a measured capability, not assumed. |
| `references/multi-agent-portability.md` | Move fast-changing skill/quota probe facts into capability records; keep docs as summaries. |
| `CLAUDE.md` and `AGENTS.md` | Add the new scripts to the deterministic tooling inventory after implementation. |
| `docs/BACKLOG.md` | Close or replace any existing quota/fallback routing leaf when the project ships. |

## 4. Phases

### P0 - Contract and Store (S)

Create the capability schema and local state CLI.

Contract shape:

```json
{
  "schema_version": 1,
  "event_id": 1,
  "observed_at": "2026-07-02T00:00:00Z",
  "runner": "codex",
  "model": "gpt-5.5",
  "role": "reviewer",
  "runner_version": "codex-cli 0.142.5",
  "capability": {
    "quota": {
      "status": "available|limited|exhausted|unknown",
      "reset_at": null,
      "confidence": "high|medium|low",
      "evidence": "human-readable redacted source",
      "ttl_seconds": 3600
    },
    "skill_transport": {
      "native": "supported|unsupported|unknown",
      "prompt_pack": "supported|unsupported|unknown",
      "last_bench_id": null
    }
  }
}
```

Merge rules:

- Latest non-expired event wins per `(runner, model, role, capability field)`.
- `high` confidence beats older `medium`/`low`; expired high confidence becomes `unknown`.
- `reset_at` must be ISO-8601 or `null`.
- `quota.status=exhausted` without `reset_at` is valid but shorter TTL.
- Malformed lines are warned and skipped, matching `engine-scorecard.js`.

Acceptance:

```bash
node scripts/engine-capability-state.js record --file hooks/tests/fixtures/engine-capability/quota-exhausted.json
node scripts/engine-capability-state.js current --runner codex --model gpt-5.5 --role reviewer --now 2026-07-02T00:00:00Z
bash hooks/tests/engine-capability-state.test.sh
```

### P1 - Passive Quota Capture and Safe Probe (S)

Add low-risk quota awareness without changing dispatch results.

Implementation steps:

- Add `classify-error` to `engine-capability-state.js`.
- Classify only broad availability categories: `quota_exhausted`, `rate_limited`, `overloaded`, `auth_failed`, `network_failed`, `unknown`.
- Treat provider overload separately from user quota; for example, a 529-style overload is not a quota reset signal.
- Extend `dispatch-hetero.sh` and `dispatch-review.sh` to call `classify-error` after non-success exits and append local evidence when classification is not `unknown`.
- Add `scripts/probe-engine-capability.sh quota --runner <runner> --model <model> --safe`.
- In `--safe` mode, probe only binary presence, version, auth/status commands already exposed by the CLI, and known local state.
- If a runner has no safe status surface, emit `quota.status=unknown` and exit 0.
- Add an explicit `--live-spend` mode for a tiny live prompt only after operator opt-in; this mode is not used by tests or default `/l5`.

Acceptance:

```bash
bash hooks/tests/probe-engine-capability.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/dispatch-review.test.sh
node scripts/engine-capability-state.js report --capability quota
```

### P2 - Skill Transport Flag for Hetero Implementers (S)

Add an explicit transport knob without assuming native skills exist.

Flag:

```bash
scripts/dispatch-hetero.sh \
  --branch feat/example \
  --prompt-file /tmp/task.md \
  --runner codex \
  --model gpt-5.3-codex-spark \
  --skill-mode off|prompt|native|auto \
  --skill autopilot:dev-flow \
  --skill autopilot:test-strategy
```

Semantics:

- `off`: current behavior; no additional skill material is injected.
- `prompt`: prepend selected skill material to the task prompt through a bounded skill pack.
- `native`: require current capability state to say native skill support is `supported`; otherwise precondition failure.
- `auto`: use native only when bench-supported and fresh; otherwise use prompt for explicitly selected skills; otherwise behave as `off`.

Bounded skill pack rules:

- Selected skills only; never all 27 skills.
- Include `SKILL.md` body plus the user's task and the six-element contract.
- Preserve verifier isolation by never adding skill packs to `dispatch-review.sh` diff prompts.
- If a selected skill references extra files, include only files explicitly required by that skill for the current task.
- Emit `skill_mode_effective` and `skills_injected` in the runner JSON.

Acceptance:

```bash
bash hooks/tests/dispatch-hetero.test.sh
scripts/dispatch-hetero.sh --help | rg -- '--skill-mode'
```

### P3 - Capability Bench (S)

Create a small, explicit bench for skill transport and availability evidence.

Bench dimensions:

| Dimension | Native skill mode | Prompt-pack mode |
| --- | --- | --- |
| Inventory | Can the runner see an installed skill catalog without prompt injection? | Not applicable. |
| Invocation behavior | Does a skill-triggering task produce the skill's required behavior? | Does injected skill material produce the required behavior? |
| Read proof | Can the runner read the exact skill source when it claims to use it? | Can the runner cite only injected material? |
| Context control | Does the runner avoid claiming unavailable skills? | Does output stay under a configured token/line cap? |
| Mutation safety | Does the probe avoid repo mutation unless explicitly write-oriented? | Same. |

Initial bench cases:

- `brainstorm-gate`: fuzzy design prompt should ask one focused question and not implement.
- `quality-review-findings-first`: review prompt should lead with findings and not summary.
- `dev-flow-branch-check`: coding prompt should mention branch/session start before implementation.
- `no-skill-claim`: with skill mode off, runner must not claim it invoked Autopilot skills.

Pass bars:

- Native support is `supported` only if inventory, invocation behavior, and read proof pass for 3/3 cases on the same runner/model/version.
- Prompt-pack support is `supported` only if invocation behavior and context control pass for 3/3 cases.
- Any repo mutation during a read-only bench is a failed bench event.
- Live bench artifacts are local-only under `~/.autopilot/engine-capabilities/bench/`.

Acceptance:

```bash
bash hooks/tests/engine-capability-bench.test.sh
scripts/bench-engine-capability.sh --runner codex --model gpt-5.5 --skill-mode prompt --dry-run
```

### P4 - Resolver Consumption, Report-Only First (S)

Wire capability state into routing without making it a hard dependency.

Implementation steps:

- Extend `resolve-review-loop.sh` output with:
  - `capability_state_source`
  - `quota_status`
  - `quota_reset_at`
  - `skill_mode_requested`
  - `skill_mode_effective`
  - `capability_warnings`
- Add an optional `--capability-state on|off` flag, default `on` for report output but non-blocking.
- Demote a runner only when `quota.status=exhausted`, confidence is `high`, and the event is fresh.
- Never demote on `unknown`.
- Emit a warning when `/l5` or `/l6` requests native skills for a runner whose native state is not supported.
- Keep `/l4` unchanged; it is a Claude-native foreground/sub-orchestrator path, not a hetero worker path.

Acceptance:

```bash
bash hooks/tests/resolve-review-loop.test.sh
scripts/resolve-review-loop.sh --capability-state on
```

### P5 - Docs, Config, and Release Wiring (S)

Document the new behavior and wire it into the repo's deterministic checks.

Implementation steps:

- Update `references/hetero-dispatch.md` to replace "skills inside executor are unverified" with the measured transport model.
- Update `project-config-template/review-loop-config.md` with `skill_mode` and quota advisory fields.
- Update `CLAUDE.md` and `AGENTS.md` script inventories.
- Add release note and version sync if the implementation is externally visible.
- Update `docs/BACKLOG.md` to close the quota/fallback-routing leaf or replace it with a narrower follow-up.

Acceptance:

```bash
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/doc-drift-gate.js .
bash scripts/preflight-release.sh
```

### P6 - Full Quality and L5/L6 Loop Review (L close)

Run the normal L-size close.

Acceptance:

```bash
bash hooks/tests/run.sh
bash scripts/preflight-portability.sh
bash scripts/preflight-release.sh
node scripts/doc-drift-gate.js .
```

Then run a decorrelated `/l5` or equivalent review loop over the whole diff. Ship only after the reviewer returns `SHIP-AS-IS` or all blocking findings are fixed and re-reviewed.

## 5. Test / Validation

Unit tests are fully stubbed and must not require network, credentials, or live CLIs.

Required local gates:

```bash
bash hooks/tests/engine-capability-state.test.sh
bash hooks/tests/probe-engine-capability.test.sh
bash hooks/tests/engine-capability-bench.test.sh
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/run.sh
bash scripts/preflight-release.sh
bash scripts/preflight-portability.sh
node scripts/doc-drift-gate.js .
```

Optional live probes are operator-gated:

```bash
scripts/probe-engine-capability.sh quota --runner codex --model gpt-5.5 --safe
scripts/bench-engine-capability.sh --runner codex --model gpt-5.5 --skill-mode prompt --live-spend
```

Live output is evidence, not a unit-test dependency.

## 6. Dependency Map

Phase order:

```
P0 contract/store
  -> P1 passive quota + safe probe
  -> P2 skill transport flag
  -> P3 bench
  -> P4 resolver consumption
  -> P5 docs/config
  -> P6 full quality/review
```

P1 and P2 both depend on P0 because they append capability events. P3 depends on P2 because it needs a concrete skill-mode interface to measure. P4 depends on P1 and P3 because resolver output should not consume unbenchmarked skill support or unstructured quota evidence.

## 7. Risks + Inversion

What would guarantee failure:

- Over-claiming native skill support from a single manual observation. Mitigation: native support requires a bench pass keyed by runner/model/version.
- Burning quota while trying to measure quota. Mitigation: safe probes are default and live prompts require `--live-spend`.
- Blocking a good runner because the local cache is stale. Mitigation: `unknown` never blocks, stale events expire, v1 is report-only/demotion-only.
- Confusing provider overload with user quota exhaustion. Mitigation: classifier keeps `overloaded` separate from `quota_exhausted`.
- Injecting too much skill text and degrading worker performance. Mitigation: selected skills only, prompt-pack bench, emitted `skills_injected` provenance.
- Breaking verifier isolation by adding methodology context to reviewer prompts. Mitigation: `dispatch-review.sh` remains diff-artifact-only; skill transport applies to implementers and trusted explore probes only.
- Racing CC's current repair work. Mitigation: R0 is a plan-only file; implementation waits for a fresh `develop`.

## 8. Out of Scope

- Exact subscription quota calendars for every vendor plan.
- Dashboard scraping or account-page automation.
- Automatic purchases, plan upgrades, or account switching.
- Domain-based engine routing.
- Replacing `engine-scorecard.js` quality/cost qualification rows.
- Making quota state a hard pre-dispatch gate in v1.
- Injecting all Autopilot skills into every hetero prompt.
- Native skill support claims for agy, Codex, Grok, or cc-shim without a bench artifact.

## 9. Open Questions

- Should the externally visible implementation ship as v2.30.0, or stay patch-level if it remains report-only?
- Should `skill_mode` live in `.claude/review-loop-config.md` only, or also have a front-door shorthand for `/l5` and `/l6`?
- Should high-confidence exhausted state demote within the same vendor family first, or skip directly to a different family when available?

Recommended R0 defaults: ship as a minor version if resolver/config surfaces change; expose both config and CLI flags; demote within qualified runners while preserving decorrelation constraints.

## Review Log

### R0 Author Self-Review - 2026-07-02

Scope coverage:

- Quota/reset probe maps to P0/P1/P4/P5.
- Hetero worker skill consumption maps to P2/P3/P4/P5.
- Bench requirement maps to P3 and validation gates.
- No implementation files are changed by this R0 authoring step.

Placeholder scan:

- Phase steps use concrete files, flags, commands, and acceptance checks.
- No load-bearing implementation step depends on an unnamed mechanism.

Dependency review:

- Store precedes producers and consumers.
- Skill transport interface precedes bench.
- Bench precedes resolver trust.

Risk review:

- The plan deliberately starts report-only and opt-in to avoid turning uncertain quota or skill evidence into a dispatch blocker.
