# /l5 — hetero implementation loop (per-level reference)

> Level-specific long-form for the `/l5` shell. Common front-door semantics
> (startup presets, foreman topology) live in
> [`../../ceo-agent/references/level-front-door.md`](../../ceo-agent/references/level-front-door.md),
> and the depth-0 half (depth-0 control loop, qc@depth-0, merge-back, worktree GC,
> run-summary ledger) in
> [`../../ceo-agent/references/depth0-control-loop.md`](../../ceo-agent/references/depth0-control-loop.md) —
> read those FIRST. This file covers only what `/l5` adds on top of `/l4`.

## What /l5 changes vs /l4

Identical to `/l4` (background worktree-isolated foreman, depth-0 control loop +
authoritative qc) except the IMPLEMENTER is orchestrated by the engine CLI and
dispatched through the canonical `engine implement-review` path:

- **Implementation** is dispatched via [`../../../bin/autopilot.js`](../../../bin/autopilot.js)
  `engine implement-review`, which internally invokes
  [`../../../scripts/dispatch-hetero.sh`](../../../scripts/dispatch-hetero.sh) with an
  **immutable base SHA** and cgroup containment. Verification is by **git artifacts**
  (commit/diff/cleanliness), never agent self-report.
- **Review** (spec and code) runs the resolved decorrelated reviewer engine instead
  of Claude — the reviewer is a DIFFERENT engine family than the generator.
- **Harness & telemetry**: depth-0 runs independent verifications
  (`independent_harness:on` ⇒ depth-0 builds its own adversarial harness and never
  trusts the implementer's green) and captures diff-domain metrics per project config.

## Roster resolution (single source of truth)

Resolve the roster and execution parameters ONCE from
[`../../../scripts/resolve-review-loop.sh`](../../../scripts/resolve-review-loop.sh)
and treat its output as the only source of truth — never hardcode models, effort
levels, or runners inline. Fields consumed by the loop:

- `reviewer_engine` / `reviewer_effort` / `reviewer_runner`
- `reviewer_engine_low_risk` / `reviewer_effort_low_risk` — risk-tiered overlay: BOTH
  set AND computed `review_risk=low` ⇒ the per-round loop reviewer is this pair (same
  runner); high risk or any empty key ⇒ `reviewer_engine`/`reviewer_effort`. qc_panel
  is unaffected. (Selection rule canonical in front-door § roster notes; the engine
  CLI applies it automatically in `reviewDiff`.)
- `implementer_engine` / `implementer_effort` / `implementer_runner`
- `review_diff_scope` (`full` default; `incremental-mitigated` semantics — including
  the mandatory full re-reads and the full-suite harness requirement — are specified
  in front-door § "Heterogeneous engine loop details (/l5 and /l6)")
- `on_family_conflict` (`fallback` default) — same-family reviewer×implementer conflicts
  substitute a cross-family qualified scorecard-ladder row instead of hard-blocking the
  in-loop review (guards + allowlist in front-door § roster notes; `block` restores the
  pre-v2.32.25 hard block)
- `independent_harness`, `qc_panel`, `qc_panel_aggregation`
- `reviewer_endpoint` / `implementer_endpoint` (declarative `--endpoint`; credentials
  populate from `~/.autopilot/endpoints.env` via `load-endpoints-env.sh` +
  `resolve-endpoint.sh` — an empty field means no `--endpoint`, byte-identical env path)

## Live sensing

Foreman dispatch is never fire-and-forget: depth-0 pre-assigns the run-ledger
path, the foreman heartbeats it, and depth-0 watches
`node scripts/watch-foreman.js --ledger <path>` (background + task-notification
on CC; `--once` snapshot **only at a stage boundary** elsewhere). Ritual +
report-only discipline: front-door § "Live sensing". Foreman wait on leaves is
notification-only — see `/l5` Hard rules and `scripts/check-foreman-polling.js`,
and pair every background wait with a dead-man timer (task notifications drop).

When a CONDITION line disagrees with what you expect, get the on-disk picture
before acting: `node scripts/agent-liveness-check.js --repo-root <repo>` reports
base head + age, per-worktree dirty/ahead/behind, newest write, lock holders and
disk headroom as facts, never a verdict. The watcher already consults the
lease's worktree, so `dead reason=owner_absent` now means the tree was idle too
— but only `owner_absent_worktree_absent` is real death evidence.

## Capability-state surface rule

Before the **first implementation dispatch** of a unit, surface these roster values to the operator
when present. They describe one situation — the capability picture the run is about to proceed under —
so they are one rule, not five; a healthy run surfaces nothing.

- every string in `capability_warnings` (an engine was demoted, or lacks native skill support);
- `quota_reset_at` when non-null — say **a** configured engine's quota is constrained and when it
  clears. **Do not name a role**: the roster emits no per-role quota value, so the role the producer
  selected is not recoverable and any attribution would be invented;
- `capability_state_source` when it is exactly `none` — "capability-state consultation is off for this
  project; these values were not read from the capability store". Only `none`: the resolver
  distinguishes it from `unknown`, which means consulted-but-no-fresh-data;
- `skill_mode_requested` when it is `auto` **and** `skill_mode_effective` is `off` — skill transport was
  requested automatically and resolved to none. Only that pair: `off`/`prompt`/`native` pass through
  unchanged, so `auto` is the only mode that can diverge, and `auto → prompt` is ordinary resolution;
- `domain_source` whenever `work_domain` is reported, so a reader knows whether the domain was declared
  or inferred.

Rationale and evidence: `docs/plans/2026-07-25-roster-field-report.md` §1c — a plain path, not a
link: `docs/` is outside the Codex plugin payload, so a relative link here escapes it (`codex-plugin-package` test).

## Stage-3 coordination boundary

`watch-foreman.js` remains a report-only sensor. If a depth-0 controller is
explicitly authorized to use adaptive recovery, it must call the ledger
`stage-coordinate` rail with the exact generation/nonce and preserve the fixed
inquiry → bounded wait → identity re-observation → bounded termination →
reconciliation → one same-lineage replacement order. The gate is off by default;
unreadable identity, D-state, held resources, or stale quietness without an
inquiry is `unknown` and cannot be acted on. See the canonical Stage-3 contract
in [`references/orchestrator-state-machine.md`](../../../references/orchestrator-state-machine.md).

## Verify-first wiring rule

When `resolve-review-loop.sh` emits `verify_first: true`, the foreman MUST pass
`--verify-cmd` to `engine implement-review` using the unit's objective check:
the independent harness command or unit test suite invocation. The dispatcher
authors this command; never derive it from the implementer. Evidence: bench
2026-07-07 found reviewer-judge loops on capable models cost 4-12x or regress,
while verify-first eliminated both. `verify_first_signal_unused: true` in a run
summary is a protocol deviation to record.

## Wired runners

`codex`, `agy`/Gemini, `grok`, `cc-shim` (Anthropic-compatible endpoints — MiniMax-M3,
GLM, …). Recipes, preconditions, and the outcome table live in
[`../../../references/hetero-dispatch.md`](../../../references/hetero-dispatch.md).

## Depth-0 recipe for one managed deliverable (measured 2026-09-14, autopilot on itself)

The order below is what the rails actually accept; every step that cost a grant attempt when
done differently is marked. Paths are this repo's; a consumer substitutes its own.

1. **Plan + rubric** (content-bound): `docs/plans/<date>-<slug>.md` and `.rubric.md`; one plan id
   maps to exactly ONE graph node, so a plan whose phases must ship separately needs one plan
   file per campaign.
2. **Sources manifest** `docs/mission-<slug>-sources.json` with both sha256s; derive ids with
   `loadSourceCoverageManifest` from `scripts/mission-execution-graph-check.js`.
3. **Graph** `docs/mission-<slug>-execution-graph.json`: one node, `campaign.output_paths` naming
   every file the hand may touch INCLUDING each codex mirror (`--mirror-roots
   <(scripts/sync-codex-plugin-skills.sh --mirror-roots-json)` refuses a missing one at check
   time); `required_paths` must sit inside `allowed_path_prefixes`; `spec.path`/`section` must
   exist at the base commit — commit the plan BEFORE admission or admission says
   `spec.path missing at base`.
4. `.claude/mission-routing-config.json` → the new graph + sources; then
   `scripts/mission-terminal-reconcile.js legacy --repo-root . --graph-digest <digest>` (the
   legacy B/C disposition is bound to the current graph digest; without it admission fails with
   `exact legacy B/C terminal disposition is invalid`).
5. **Task authority**: build with the kernel, never by hand —
   `freezeTaskAuthorityEnvelope({taskId, policy, policyHash, intent, acceptance:{contract_hash:
   <plan sha>, criteria_hash: <rubric sha>, required_evidence}, resourceCeiling, escalationPolicy,
   finishReceiptSchema, effectPermissions, dataEgressRules, missionAuthority:{repoIdentity:
   'git-common-dir:<common dir>', graphDigest}})` with `policy`/`policyHash` from
   `resolveGovernancePolicy(.claude/owner-kernel-governance.json)`. Caller-supplied
   `authority_status` / `mission_lineage_id` are refused.
5b. **Plan hetero loop BEFORE the marker** (measured 2026-09-15): run `dispatch-plan-review.js` while
    no l5 marker is active — under one, codex seats die with `active session-mode=l5 blocks
    non-strict dispatch` and the artifact records an empty envelope. Manifest seats without an
    endpoint write `@none`, not null. A MiniMax seat that format-faults twice makes the generation
    `transport_exhausted` with ZERO ratified findings; swap the second family (codex/GLM) with a
    fresh `--state-dir`. Folding a finding changes the plan sha, so re-run the freeze chain
    (sources sha → graph ids → graph check → legacy reconcile → authority) after every fold; take
    the receipt (`check-phase-review-receipt.js --plan-artifact --dispositions`, every disposition
    needs `candidate_blocker: true|false`) on the REVIEWED bytes, then fold and re-freeze.
6. `node scripts/session-mode.js set --level l5 --repo-root <repo>` → `READY`. First check
   `~/.autopilot/session-mode/` for another ACTIVE managed marker of this repo: the bridge scans
   every marker and one with a different graph digest blocks intake (a deliberate concurrency
   fence). If that marker's deliverable is already integrated, retire it with evidence —
   `node scripts/session-mode.js retire --session <id> --integration-receipt <record-integration
   receipt>` re-derives lineage claim + git ancestry (v2.36.48); never delete a marker by hand.
6b. Run `bash scripts/resolve-review-loop.sh --check-scorecard --field override_admitted_seats` and
    read the stderr ⚠ notes. Every `qc_panel[N]` without evidence must be pinned first
    (`engine-capability-state.js pin-seat --role qc_panel …`); else intake refuses with
    `final_panel_seat_unqualified`.
7. `mission prepare --repo . --authority <envelope> --graph <graph> --out prepared.json`, then
   `mission grant --repo . --prepared prepared.json --node <id>` → `contract_path`, `seal_path`,
   `branch`, `base_sha`. Each grant is one attempt; a rejected INTAKE still consumes it. The graph's
   `required_paths` must exist at `base_sha` — a file the hand will CREATE goes in `authorized_creates`
   and `output_paths` only (2026-09-15: listing it burned an attempt). Changing the graph after a
   lineage exists needs a new lineage (amend `intent.objective`) — same adoption key + new digest is
   `MISSION_BINDING_MISMATCH`.
8. **Brief** ≤ 8 KB: paste `output_paths` verbatim; say the harness commits; forbid `git stash`
   and pushes; list the verify commands. Nothing the hand cannot see (evidence dirs) may be cited
   as a reading assignment. **Commit or keep OUTSIDE the repo every depth-0 evidence file (grant
   json, brief, run outputs) before dispatch** — the contract checker refuses a dirty tree and the
   refusal consumes the attempt (2026-09-15: attempt 1).
9. Dispatch: `AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=<contract.mission_runtime.root_run_id>`
   `node bin/autopilot.js engine implement-review --campaign-contract <contract> --campaign-seal
   <seal> --mission-prepared prepared.json --prompt-file <brief> --branch <branch> --base
   <base_sha> --cwd <repo> --max-rounds 3` — do NOT pass `--campaign-ledger`: any non-canonical
   path is `campaign_ledger_path_mismatch` at intake and burns the attempt. Watch the hands
   worktree from a report-only monitor; the artifact is the commit on `<branch>`. On
   `awaiting_disposition`, resume with `--resume --campaign-disposition-authority <file>` and
   DROP `--campaign-disposition-policy` (the two cannot be combined; cuda 2026-09-16).
10. **Verification is yours**: check out the hand's commit in a detached scratch worktree and run
    every verify command there; probe the reviewer's MUST-FIX claims by re-derivation
    (probe + mutation) before accepting or refuting; run a second-family `dispatch-review.sh`
    when the rail's seat returns `no_verdict`.
11. Known rail limits (BACKLOG rows): `status task` has no writer; disposition resume dies in
    `check-repair-scope.js` because `scope_implementation_sha` is never set from the ledger's
    `candidate_ref` (cuda e2e 2026-09-16, the v2.36.41 measurement point — open). Fixed since
    2026-09-14: `--campaign-ledger` intake v2.36.42, reviewer `no_verdict` durable wait v2.36.43,
    final-panel seats via standing pins v2.36.46, pre-claim repo facts v2.36.48.
    **After the merge**: run `record-integration.js` BEFORE reaping branches (accepted sha must be
    the checkout HEAD, source needs a live ref); do not edit the plan afterwards — even a Review-log
    line drifts the frozen source sha and every `session-mode set` is refused until routing is
    rolled back to a completed graph whose sources still match plus `mission-terminal-reconcile.js
    legacy` (2026-09-15).
    When the rail stops, degrade per the documented fallback
    (`session-mode.js set --level l3 --entry-level l5 --fallback precondition_failed`), repair on
    the mission branch in its retained worktree, merge on git evidence, and file the rail defect.

## Degradation

`--solo` → fall back to the `/l3` inline engine. This is also the automatic
degradation when the foreman returns `precondition_failed`.
