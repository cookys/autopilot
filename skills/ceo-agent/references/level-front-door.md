# Level front-door & dispatched foreman (`/l3 /l4 /l5 /l6`)

> Loaded by `skills/l3`, `skills/l4`, `skills/l5`, `skills/l6` and referenced from
> `ceo-agent/SKILL.md`. The `/lN` skills are **thin** — all execution semantics
> live here so the three front-doors stay in lockstep.
>
> Design source: [`docs/plans/2026-06-22-ceo-fleet-autonomy.md`](../../../docs/plans/2026-06-22-ceo-fleet-autonomy.md)
> (converged through 3 rounds of Architect/Ops/Skeptic dialectic). Read it for the
> *why*; this file is the *how*.

## What the front-door is

`/l3 /l4 /l5 /l6 <goal>` is a terse entry point into **CEO mode** (`ceo-agent`). It
pre-fills the four CEO startup questions so a long run starts without a Q&A round,
and it sets the **execution posture** (run inline vs. offload to a dispatched
sub-orchestrator). It is a *new slash-command namespace layered over* the existing
CEO **Involvement** enum (`ceo-agent/SKILL.md` Startup §2: 1=every-step /
2=phase / 3=just-results) — it does **not** redefine that term.

| Sugar | Execution posture | Engine |
|-------|-------------------|--------|
| `/l3 <goal>` | CEO executes **itself** on the main thread; escalates at the DOA boundary. The behavior you invoke today as "Level 3 全權處理", now an explicit command. | Claude (this session) |
| `/l4 <goal>` | CEO dispatches **ONE sub-orchestrator "foreman"** (background + worktree-isolated) that runs dev-flow and returns a verdict + run-summary. CEO context stays clean; the run goes long unattended. | Claude (foreman + workers) |
| `/l5 <goal>` | `/l4` **with the implementer loop run through** `bin/autopilot.js engine implement-review`, which internally dispatches heterogeneous implementation through `dispatch-hetero.sh` and decorrelated review through the resolved reviewer. | Claude foreman + engine-orchestrated hetero impl |
| `/l6 <goal>` | `/l5` **with the verification AUTHORING also leaf-dispatched to a heterogeneous engine** (different family than the implementer); depth-0 keeps merge authority and authoritative qc. | Claude foreman + engine-orchestrated hetero impl + hetero verifier authoring |

### Startup-question presets

Each `/lN` fills the four CEO startup questions (`ceo-agent/SKILL.md` Startup §)
so the run does not re-ask on a clean goal:

| CEO startup Q | Preset from `/lN` |
|---------------|-------------------|
| 1. OKR / success criteria | Derived from `<goal>`. If `<goal>` has no verifiable end-state, the CEO restates one and proceeds (does **not** block on Q&A — that is the point of the front-door). |
| 2. Involvement | `/l3 /l4 /l5 /l6` all preset **3 = just-results** (full autonomy, notify on done). |
| 3. Scope mode | **Hold** (bulletproof, no scope drift). Override with `--expand`. |
| 4. Red lines (紅線) | Project governance red lines when configured; otherwise none (default DOA). `-x <csv>` adds run-specific rules and never removes project rules. |

When `.claude/owner-kernel-governance.json` is present, its `default_mode` is the project default.
An explicit `--mode owner-led|milestone-led` applies only to this run. `owner-led` keeps one
qualified owner across the full run; `milestone-led` re-instantiates that owner at plan, milestone,
and acceptance boundaries without turning milestones into user result-approval gates. The skill
must not claim authoritative Kernel telemetry unless an external host bridge actually records it.

### Task-class front door (autonomous-brain P8)

When `.claude/task-class-config.md` exists, classify the incoming goal against
its class table BEFORE sizing or dispatch: `hard-problem` stays at depth-0 (never
dispatched, never auto-picked); `mechanical-impl`/`standard-impl` route to the
per-class candidate preference; `direction` enters the hetero brainstorm/survey
pipeline. **Ambiguous classification → STOP AND ASK** (AskUserQuestion with the
candidate classes) until the blueprint scope is clear — guessing costs 2-3
re-alignment rounds (sol F11). Common patterns default from a survey of current
practice, ledgered. Absent config = unchanged behavior (no classification duty).
Canonical table + weights: `project-config-template/task-class-config.md`.

### Mid-run question discipline (presets active)

With the front-door presets (involvement=just-results, resolved red lines), "想確認一下 /
should I continue?" is **NOT an escalation trigger**. The run stops ONLY at: a DOA
boundary (outcome/escalation tables), an irreversible op outside DOA, or input that
genuinely cannot be self-derived. Near-misses (差點走錯路) are **recorded** — into the
run summary and `autopilot:learn` at session end — never asked mid-run. (Transcript
evidence 2026-07-05: 5 explicit user corrections for stopping early.)

### Economy mode — when the session model is premium or usage-capped

When depth-0 runs on a scarce top-tier model, the orchestrator's spend should narrow
to plan / decompose / synthesize / verify — the things that actually need it:

- Even in `/l3` inline mode, leaf-dispatch mechanical sub-steps (boilerplate, bulk
  edits, formatting, test scaffolding) to a **fast-worker**-tier subagent, and
  reasoning-dense consults to a **deep-reasoner**-tier one — both are routing-table
  roles (`references/model-routing.md`), resolved via `resolve-dispatch.sh`, never
  hardcoded.
- Prefer `/l4`+ so implementation labor burns worker/hetero-engine tokens instead of
  session-model quota; `/l5`/`/l6` extend the same economics to cross-vendor engines.
- NEVER economize the depth-0 trust duties themselves: qc@depth-0, artifact
  verification, convergence judgment, and merge authority stay on the orchestrator
  regardless of model economics.

### Overrides (rare)

| Flag | Effect |
|------|--------|
| `-x <csv>` | Add run-specific red lines, e.g. `-x payments,auth`; project red lines cannot be removed. |
| `--mode owner-led\|milestone-led` | Override the project governance mode for this run only. |
| `--expand` | Scope mode = Expand instead of Hold. |
| `--solo` | `/l4`/`/l5`/`/l6` autonomy **without** offload — CEO runs inline (the `/l3` engine) but keeps Level-4/5/6 posture respectively. Also the **automatic degradation fallback** when the foreman cannot start (`precondition_failed`). This changes topology only; Mission admission and later prepare/grant identity are reused unchanged. |

## The foreman (`/l4`, `/l5` and `/l6`)

### Topology — the depth-2 ceiling

```
CEO (depth 0, this session)
└── foreman = sub-orchestrator (depth 1, background + isolation:worktree)
    ├── implementer worker (depth 2)   ← leaf-dispatch
    └── first-pass reviewer (depth 2)  ← leaf-dispatch
```

- **Foreman = `sub-orchestrator`, NOT `manager`.** `manager` is non-dispatchable
  by tool-enforced invariant (`scripts/resolve-dispatch.sh --tree --role manager`
  exit 3, Amendment 11). Resolve the foreman's model with
  `scripts/resolve-dispatch.sh --tree --role sub-orchestrator` (→ `opus`). The
  `--tree` flag is **required** — `sub-orchestrator` lives only in the task-tree
  role table; without `--tree` the command exits 1 "unknown role".
- **The foreman runs dev-flow's admitted deliverables INLINE at depth 1** (planning + gating it
  does itself). It only **leaf-dispatches** the implementer and the first-pass
  reviewer to **depth-2 workers**. It does NOT dispatch plan/qc as further
  subagents.
- **Depth 3 escalates, never nests.** A worker that would need to decompose
  further returns an `[ESCALATION]` to the foreman, which escalates to depth 0.
  This keeps the run within the v1 depth-2 ceiling (`references/model-routing.md`).
- **`/l5`** is identical except the implementer worker is replaced by the canonical
  `bin/autopilot.js engine implement-review` loop. That engine command internally
  calls `scripts/dispatch-hetero.sh` for implementation rounds, then dispatches the
  decorrelated reviewer on the cumulative immutable-base diff. Everything else — the
  depth-0 control loop, qc@depth-0, worktree GC — is unchanged.
- **`/l6`** is identical to `/l5` except that verification AUTHORING is also leaf-dispatched
  to a heterogeneous engine (different family than the implementer); depth-0 remains
  pure orchestration, keeping merge authority and authoritative qc.
  - **Its base is a SEPARATE mechanism from the foreman's.** The engine passes
    `--base` through to `dispatch-hetero.sh`, which creates its own git worktree and
    does **not** use the native Agent worktree; `worktree.baseRef` does **not** reach
    it. When the hetero impl must build on the foreman's (or CEO's) un-merged state,
    the foreman MUST pass **`--base "$(git rev-parse HEAD)"`** as an immutable
    full SHA explicitly. Two mechanisms, two knobs: `worktree.baseRef` for the native
    foreman worktree, `--base` for the engine/hetero impl loop.
  - **Reviewer qualification fails closed by default.** `engine implement-review`
    blocks at `phase:"reviewer_qualification"` when the resolved scorecard says the
    reviewer is absent, false, or unknown. `--require-qualified-reviewer` is accepted
    for explicitness/backward compatibility; use `--allow-unqualified-reviewer` only
    as an explicit emergency escape hatch and record the decision in the run summary.
  - **Named endpoints are declarative, not hand-typed.** When the resolved config
    (`scripts/resolve-review-loop.sh`) emits a non-empty `implementer_endpoint` /
    `reviewer_endpoint`, pass it straight through as `--endpoint <name>` to
    `dispatch-hetero.sh` (implementer, `cc-shim`) / `dispatch-review.sh` (reviewer,
    `cc-shim`/`anthropic-compatible`). The dispatcher resolves creds via
    `resolve-endpoint.sh` from the canonical `~/.autopilot/endpoints.env`
    (`AUTOPILOT_ENDPOINT_<NAME>_*`); an empty field means no `--endpoint` (raw
    `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` env, byte-identical to before). This closes the
    old "type `--endpoint` by hand every run" gap — the project config owns it now.

### Live sensing — no YOLO window after dispatch (S3-lite)

**裸跑禁令 (gate 4, non-negotiable): a multi-hour autonomous hetero loop MUST have a
named depth-0 clock owner.** No `/l4 /l5 /l6` run — and no self-directed hetero review
loop — may run unwatched for hours. Depth-0 is the clock owner: it arms the watcher
(below), holds the wall-clock, and owns the brake. A loop with no clock owner is a
banned bare run — the exact shape of the 2026-07-14 replay-driver incident (8 artifact
generations, zero test execution, hours unattended). The clock owner's brake is a
verification-anchored + generation ceiling, mechanized by
[`scripts/check-loop-convergence.js`](../../../scripts/check-loop-convergence.js)
(gates 1 + 3): ≥2 consecutive zero-execution rounds, or generation cap reached while
still REWORK-shape ⇒ halt + escalate, do NOT open another round.

Dispatching the foreman must not open a black-box window until its completion
notification. Sensing is MANDATORY for `/l4 /l5 /l6`; it is observation-only
(scheduling/steer stays future work — the R6 two-cooks crash came from depth-0
REACTING too fast, not from seeing too little):

1. **Before dispatch**, depth-0 chooses the run id + ledger path
   (`${TMPDIR}/autopilot-dispatch-runs/<foreman-run-id>.ledger.jsonl` by
   convention), exports the foreman lineage (`AUTOPILOT_PARENT_RUN_ID=<foreman-run-id>`,
   `AUTOPILOT_ROOT_RUN_ID=<foreman-run-id>`, `AUTOPILOT_DISPATCH_DEPTH=1`), and writes both
   the foreman run-id + watcher arg into the foreman prompt. This is the outer
   foreman/watcher lineage and remains the leaf manifest's trace root. On
   L5/L6 managed implementation dispatches, the canonical campaign controller
   separately injects the sealed `campaign_id` as
   `AUTOPILOT_WORKTREE_ROOT_RUN_ID`; initial, repair, and resumed leaves
   therefore share one durable worktree-budget identity even if the foreman
   session changes, while each remains visible to its current foreman watcher.
2. **Foreman duties** (in the prompt, non-optional): `run-ledger.sh
   stage-acquire` when starting a phase, `stage-transition` at phase
   boundaries, `stage-heartbeat` at least every 5 minutes inside long stages.
   The leaf dispatches need nothing extra — their run manifests are already
   emitted by `dispatch-hetero.sh`/`dispatch-review.sh`.
3. **Depth-0 arms ONE watcher** right after dispatch:
   `node scripts/watch-foreman.js --ledger <path> --root <foreman-run-id>` as a
   background process whose **completion / event lines wake depth-0 via the host
   task-notification** (not a Monitor sleep loop, not a `sleep` poller). Events:
   `STAGE` (deliverable transitions), `LEAF_START/LEAF_END` (hetero dispatches),
   `QUIET` / `LEAF_STALL` (silence beyond `--quiet-secs`, default 600). Non-CC
   fallback: run the same tool with `--once` **once at a stage boundary** (a
   snapshot, not a polling loop).
4. **Report-only discipline** (R6): `QUIET`/`LEAF_STALL` are observations,
   never verdicts. Cross-check first (`dispatch-status.js --run <id>`, ledger
   tail, git activity); a quiet foreman is usually doing between-turns work;
   NEVER grab a stage the foreman holds a lease on — escalate to the user if
   genuinely wedged (`run-ledger.sh resume` is the recovery path, and only
   after the foreman is confirmed dead).

   HONEST BOUNDARY (LIVENESS): a `CONDITION ... dead reason=owner_absent` line
   means only that the recorded lease PID has exited — for a CC-native
   foreman that is the EXPECTED shape seconds after every `stage-acquire`
   (the acquiring shell records its own PID and exits immediately; the
   foreman keeps running as a separate agent turn, not as that shell's
   child), not evidence the foreman died. The line self-flags this
   (`note=pid_liveness_unreliable_for_cc_native`) — treat `dead` as
   "confirmed foreman dead" only for a runner whose owning process stays
   resident for the stage (a long-lived CLI/daemon runner), and for a
   CC-native foreman fall back to git activity / `dispatch-status.js` before
   escalating to `run-ledger.sh resume`.

   Since v2.35.7 the watcher consults the lease's WORKTREE before judging, so
   the PID is no longer the only input: a tree written to inside the quiet
   window downgrades the line to `unknown reason=owner_absent_worktree_active`
   (with the mtime age), a VANISHED tree keeps `dead` under the stronger
   `owner_absent_worktree_absent`, and an idle-but-present tree falls back to
   the caveated `dead reason=owner_absent` above. On-disk facts can only make
   the verdict more cautious — the watcher never reports `working` from files,
   because files cannot prove a process is running. For the full picture (base
   head age, per-worktree dirty/ahead/behind, lock holders, disk headroom) run
   [`scripts/agent-liveness-check.js`](../../../scripts/agent-liveness-check.js);
   it is repo-agnostic and emits facts, not a verdict.
5. **Advisory directive channel (Phase 2 — nudge, never seize).** Depth-0 may
   queue a one-way *advisory* nudge to a running stage's lease holder — it does
   NOT auto-kill, does NOT grab the lease, and never overrides the holder's
   authority (Stage 3 scheduling/steer stays BACKLOG'd). Send side (depth-0):
   `run-ledger.sh directive-send --ledger <path> --run-id <foreman-run-id>
   --stage <stage> --text "<guidance>" --from depth-0` — refused (exit ≠ 0) if
   that stage has no live lease (you cannot nudge a stage nobody holds); the
   directive binds to the lease's current generation. Foreman duty (in the
   prompt, non-optional): **at every stage boundary — before `stage-acquire` of
   the next stage — read your own directives once** (`run-ledger.sh directive-poll
   --ledger <path> --run-id <foreman-run-id> [--stage <stage>]`) and honor +
   record any pending guidance, then ack it. Do not loop `directive-poll` while
   waiting on a leaf. Reachability differs by runner —
   see [`references/hetero-dispatch.md`](../../../references/hetero-dispatch.md)
   § Directive reachability: pi-rpc = mid-run steer; a CC foreman = stage
   boundary; one-shot batch runners = only the NEXT round's dispatch. The
   read-only `watch-foreman.js` NEVER gains a directive-send surface.

#### Stage-3 recovery (R6, feature-gated)

The normal `/l4`/`/l5`/`/l6` posture remains report-only. A depth-0 controller
may opt into the ledger recovery rail only with
`AUTOPILOT_ADAPTIVE_INTERVENTION=1` (or an explicit `stage-coordinate --enable`)
and an exact run/stage lease. The rail is ordered: send one lease-bound inquiry,
wait the bounded acknowledgement deadline, re-observe PID/start-time/process
state/heartbeat/resource holders, terminate only the same exact alive
non-responsive process group (SIGKILL only after SIGTERM grace), then reconcile
Git/result/side-effect truth before adopting or authorizing one generation-
advanced same-lineage replacement.

`unknown` is fail-closed: unreadable or mismatched identity, D-state, held
resources, or stale quietness without an inquiry cannot signal, seize, or
replace. An acknowledged inquiry prevents intervention. The watcher itself is
still observation-only; the `coordination` receipt makes retries idempotent and
fences late generations.

HONEST BOUNDARY (SCOPE): dispatcher lineages only include runs emitted by
`dispatch-hetero.sh`/`dispatch-review.sh`. Engine-native internal subprocesses
(`spawn_agent`, agy recursion) and CC-native foremen are not observed as child
runs in the watch tree; a CC-native foreman appears only as a synthetic
`(external)` root, so no completeness claim is implied beyond dispatcher
coverage.

### Heterogeneous engine loop details (/l5 and /l6)

Level-specific long-form lives with each level (this section stays common-protocol only):
`/l5` → [`../../l5/references/hetero-impl-loop.md`](../../l5/references/hetero-impl-loop.md);
`/l6` → [`../../l6/references/full-dispatch-pipeline.md`](../../l6/references/full-dispatch-pipeline.md).

When `/l5` or `/l6` is invoked, the foreman resolves the roster and execution parameters from `scripts/resolve-review-loop.sh` rather than hardcoding them. The loop parameters include:

- **Review and implementation engines** (`reviewer_engine`, `reviewer_effort`, `reviewer_runner`, `implementer_engine`, `implementer_effort`, `implementer_runner`): Resolved dynamically; models, effort levels, and runners should never be hardcoded inline.
- **Risk-tiered loop reviewer** (`reviewer_engine_low_risk` + `reviewer_effort_low_risk`): when BOTH are non-empty AND the resolver's computed `review_risk` is `low`, the per-round loop reviewer is this pair (same `reviewer_runner`); when `review_risk` is `high` — or either key is empty — the loop reviewer stays `reviewer_engine`/`reviewer_effort`. The qc_panel terminal gate is unaffected by this overlay. Never promote a low-risk-tier engine to high-risk duty on your own judgment; that is a config decision backed by `engine-qualify.sh` evidence. When scorecard data is present (`fallback_ladder`), the engine additionally requires the tier pair to appear as a qualified invocation tuple — a missing tuple reverts to the incumbent (ledger `tier_reviewer_unqualified`).
- **Family-conflict fallback** (`on_family_conflict`, default `fallback`): when the effective loop reviewer shares the implementer's model family (the default openai implementer + openai reviewer ALWAYS conflicts), the engine substitutes the first cross-family qualified row from the scorecard `fallback_ladder` (runner allowlist; codex rows need a calibrated row `effort`; the ladder's `fallback_ladder_implementer_family` provenance must match the actual implementer) and ledgers `reviewer_family_fallback` — the in-loop decorrelated review then actually runs instead of silently converging on verify-first alone. Every guard failure (mode `block`, absent/stale ladder, no valid candidate) blocks exactly as before. `reviewer_fallback_preference` (+`_low_risk` for `review_risk=low`) puts HUMAN-ordered engine ids ahead of raw ladder order — set it so the strongest cross-family reviewer takes the high-risk seat and the cheap calibrated leg takes low-risk rounds; preferred candidates still pass every guard.
- **`review_diff_scope`**: Controls what the impl-review reads each round:
  - `full` (default) ⇒ the reviewer reads the whole `<base>..HEAD` diff every round. Safe; cost grows O(n) as the diff accumulates.
  - `incremental-mitigated` ⇒ the reviewer reads `<prev-round>..HEAD` PLUS the full content of every file touched this round PLUS a standing invariants/prior-findings checklist; do a full `<base>..HEAD` re-read every 3–5 rounds or whenever a round touches shared/critical logic (classifiers, schemas, fixtures, harness control flow); and ALWAYS a final full `<base>..HEAD` review before merge. Use only on long loops — naive incremental-only misses cross-file regressions in untouched files. When this mode is on, `independent_harness` MUST run the FULL test suite, not just touched-file tests (real lesson 2026-06-26: a stale-fixture regression in an untouched test file slipped a too-narrow per-round scope to the final sweep). Reference driver: `resolve-review-loop.sh --field review_diff_scope`.
- **`independent_harness:on`**: Depth-0 ALSO builds its own adversarial harness and never trusts the implementer's own green.
- **`loop_max_rounds` cap → convergence semantics.** When the review loop hits its
  `loop_max_rounds` ceiling, depth-0 reads the terminal round's verdict before deciding.
  If the final verdict is **FIX-THEN-SHIP** (conditional pass) AND the round-over-round
  findings show a **single-point-convergence** shape (narrowing to one residual fix, NOT
  a REWORK-class churn), depth-0 may rule **"conditional convergence"**: apply the final
  fix and advance, with the authoritative qc panel (§3) as the backstop. A capped round
  whose verdict is **REWORK** is still an **escalation** — the cap did not converge.
- **Block-mode test-integrity override stays DEFERRED**: A block-mode `executed_set_shrink` hard-fails with no honored override (no local-only containment is malicious-proof against a same-user worker — sibling-scope escape; gpt-5.5 review 2026-06-26). Resolve a legit shrink by fixing the test or running that project in `warn`. Re-enable is BACKLOG'd behind real isolation.

### Width — fixed cap 3, disjointness-gated

The default `/l4 /l5 /l6` topology is **width 1** (one implementer worker per round).
**Fixed cap 3** is the ceiling: the foreman may fan out to **at most 3** parallel
implementer workers in a single round, and **only** when the work decomposes into
**file-disjoint independent units** that pass a **deterministic** gate — never on
LLM judgment alone (S0.a fleet evidence: ~15-25% of tasks split into ≥4 such units,
so the supply is real, but the authorization must be mechanical).

- **The gate is `scripts/check-disjointness.sh`, not a vibe.** Each unit declares an
  allowlist (the planner six-element `Scope:` — element 2, "exact file paths and
  modules to touch"). Pre-dispatch, `propose` mode advisory-checks the declared
  allowlists for overlap (**advisory only — never the clamp**). Post-commit, `validate`
  mode reads GIT ARTIFACTS (`git diff --name-only <range>`, never agent self-report —
  same artifact-rail as `dispatch-hetero.sh`) and **fails closed** (exit 1) if a
  worker's actual commit touched any file **outside** its declared allowlist.
- **🔴 Depth-0 reviewer carve-out (MANDATORY — do not omit).** The disjointness gate
  certifies **FILES ONLY, not behavior**: semantic coupling — shared types, import
  edges, call-order invariants — between two file-disjoint units is **invisible** to a
  file-path check and remains the **reviewer's to catch**. The green disjointness stamp
  must NEVER be read as a behavior clearance. Omitting this carve-out makes the dominant
  failure mode (disjoint-file semantic coupling) WORSE by inducing reviewer
  rubber-stamping — the depth-0 qc (§3) must review the *combined* diff for cross-unit
  coupling exactly as hard as it would a single-unit diff.
  The disjointness gate certifies files only, not behavior.
- **Tier-2 batch engine (Phase L) is the parallel-dispatch / merge-back control loop**
  built on top of this gate — see "Phase L: width fan-out control loop" below and
  [`references/batch-dispatch.md`](../../../references/batch-dispatch.md). The shell
  rails ([`scripts/dispatch-batch.sh`](../../../scripts/dispatch-batch.sh)) own the
  deterministic half (plan / verify / merge-back / telemetry / reap); the depth-0 LLM
  loop (below) owns the Agent-tool dispatch the shell cannot call. Width applies to the
  **`/l4` homogeneous path** (Claude foreman + Claude Agent-tool workers); `/l5`/`/l6` hetero
  parallel is BACKLOG. Default remains the **width-1 path** until the foreman decomposes
  a task into ≥2 disjointness-passing units; the gate is still useful standalone (it
  validates even a single unit's commit against its declared scope).

### Dispatching the foreman (the P0-verified mechanism)

The foreman is a native `Agent` dispatched in the background with worktree
isolation. P0 spike (2026-06-22, PASS) verified every step below empirically:

```
agentId = Agent(run_in_background: true, isolation: "worktree", subagent_type: "general-purpose", model: "opus", prompt: <foreman brief>)
```

- **🔴 Every `Agent` dispatch MUST pass `model` explicitly.** With no `model`
  argument the subagent **inherits the parent session's model** — so a Fable-class
  CEO silently runs its foreman on Fable, which violates Amendment 11 (the foreman is
  a `sub-orchestrator` → `opus`) and burns through Fable quota (real case 2026-07-09
  hangar `/l6`: the foreman died mid-run on an API limit). Rule: set `model` on every
  dispatch — foreman / sub-orchestrator = `opus`; mechanical inventory / file work =
  `sonnet` or `haiku`. Never rely on inheritance.
- `Agent(run_in_background, isolation:"worktree")` returns an **`agentId`** that
  is usable as a `TaskStop` `task_id`.
- The foreman's worktree is at a **deterministic** path:
  `.claude/worktrees/agent-<agentId>` (created `locked` — reap needs `--force`).
- `TaskStop <agentId>` **force-kills a mid-run foreman** (verified: target killed
  on its 2nd work item; status `killed`).
- On kill: an **unchanged** worktree **auto-cleans** (Agent contract
  "auto-cleaned if unchanged" — no leak). A **changed** worktree is **kept**.

#### Visibility & control surface — NOT uniform across the three dispatch kinds

What Claude Code can *display* and what the CEO can *connect to* differs sharply by
dispatch kind. This asymmetry bites: the `/l5` hetero leaf falls **out** of the native
subagent surface entirely.

| Dispatch | CC displays it? | Connectable surface | Liveness signal |
|----------|-----------------|---------------------|-----------------|
| `/l4` foreman (native `Agent`, background) | ✅ shown as a running subagent | `TaskList` / `TaskGet` / `TaskOutput` / `TaskStop` / `Monitor` (the depth-0 loop already uses `Monitor`+`TaskStop`) | live via the Task\* tools |
| Workflow tool (`parallel`/`pipeline`/`agent`) | ✅✅ `/workflows` live progress tree | the script's own control flow + `/workflows` | richest — but **no worktree isolation by default, cannot shell out to a non-Claude engine** (not a host for the hetero leaf) |
| `/l5`/`/l6` hetero leaf (`dispatch-hetero.sh` → `agy`) | ❌ a **Bash subprocess**, not a CC subagent | none — outside the subagent/workflow surface | only `tail -f <agent_log>` (the JSON `agent_log` path); verdict by **artifacts + final JSON**, never self-report |

⇒ **Want "see it + control it" → `/l4` (or Workflow for visible Claude-only orchestration).
The moment the leaf becomes a heterogeneous engine (`/l5`/`/l6`), that leaf is invisible to CC**
— only its log file + git artifacts exist. A *live* "model is asking a question" stream from
agy is the deferred `stream-json` rail (spike-gated, NOT built — see
[`references/hetero-dispatch.md`](../../../references/hetero-dispatch.md) § "Deferred").

**A background foreman that yields its turn to wait on its OWN background child (e.g.
a long `engine implement-review` run) is NOT auto-woken unless the host delivers a
task-notification.** Canonical wait: dispatch the leaf with `run_in_background` /
child `Agent`, **end the turn**, and resume only on that notification (or a depth-0
`SendMessage` if the host parked the foreman). Forbidden: `sleep` loops, `cat`/`tail`
of `<session>/tasks/<id>.output` into the foreman context, Monitor-waiting on a leaf.
Leaves return a schema-typed criteria table; raw leaf output never enters the
foreman prompt. Foreman Bash count cap: 40 (gate: `scripts/check-foreman-polling.js`).

#### Worktree base — default `origin/develop` (NOT the CEO's HEAD), selectable via `worktree.baseRef`

By default `Agent(isolation:"worktree")` branches the new worktree from the repo's
**default/integration branch (`origin/develop` = `origin/HEAD`)** — never the CEO's
checked-out HEAD or current branch. Verified twice (2026-06-22) and re-confirmed
2026-06-23 (CC 2.1.186): a probe with a HEAD-only sentinel commit found the sentinel
**absent** in a default worktree.

There is **no per-call base parameter** on the `Agent` tool, but the base IS
selectable via the **`worktree.baseRef` setting** (`fresh` | `head`; added CC 2.1.133,
empirically re-verified 2.1.186 — takes effect **in-session, no restart**, read from
any settings tier incl. project-local `.claude/settings.local.json`):
- `fresh` (default) → `origin/<default>` (= `origin/develop`): a clean tree matching
  the remote, ignoring un-pushed CEO commits.
- `head` → the CEO's **local HEAD**, carrying un-pushed commits — verified: with
  `worktree.baseRef:"head"` the same sentinel probe found the CEO-HEAD sentinel
  **present** in the worktree.

⇒ **Base-currency decision the CEO makes BEFORE dispatch** — run
`git merge-base --is-ancestor HEAD origin/develop`: **exit 0** = HEAD already in
`origin/develop` (no un-merged work → keep default `fresh`); **exit 1** = HEAD has
commits not yet on develop (→ the foreman must build on them, see table):

| CEO's state | How to set the foreman's base |
|-------------|-------------------------------|
| Task is independent of any un-merged CEO work (HEAD already on/reachable-from `origin/develop`) | **none** — default `fresh` (`origin/develop`) is correct. |
| Task must build on the CEO's un-merged work (feature-branch-only or self-referential — e.g. exercising tooling that lives only on this branch) | **Primary (Claude Code):** set `worktree.baseRef:"head"` (project-local settings) before dispatch — the foreman worktree then branches from the CEO's local HEAD directly. The setting is **session-global**, so every worktree dispatched while it is set shares that base (fine for parallel siblings, which fork the same integration point). **Portable fallback** (non-CC, or when you can't set the setting): `git reset --hard <CEO-HEAD-sha>` as the foreman's literal STEP 0 — git objects are shared across worktrees so `<CEO-HEAD-sha>` always resolves; verify a sentinel from your HEAD exists and **STOP (don't recreate)** if the reset fails. |

Historically (before the `worktree.baseRef` discovery) the P1.f dogfood's `/l5`
foreman ran the *pre-feature* `dispatch-hetero.sh` because its develop base lacked
the branch-only P1 work — the self-referential case above, now cleanly handled by
`worktree.baseRef:"head"` (the `git reset` STEP-0 is the portable fallback). After the
foreman commits on top of the CEO's HEAD, integrate by cherry-picking the foreman
commit(s) (§4).

## Depth-0 control loop (owned by the CEO, NOT the foreman)

The control loop is enforced at **depth 0** — the child cannot be trusted to
police its own budget (fox/henhouse, Round-2 Ops 🔴 fix). The CEO wraps the
foreman dispatch in a guard it owns:

### -2. Mission routing admission (before every topology effect)

At `/l3` through `/l6` entry, `session-mode.js set` first resolves the consuming repository's
authoritative project governance config and runs `mission-routing-admission.js` against the configured
graph and content-bound source manifest. The admission uses the canonical Mission policy resolver
and execution-graph checker. It binds canonical Git-common-dir repository identity, Mission policy
digest, graph digest, source coverage digest, deliverable count, critical path, batches, and
aggregate reservations before the marker is written.

```bash
# normal entry
node <plugin>/scripts/session-mode.js set --level lN --repo-root <repo>

# topology-only degradation; entry authority remains lN
node <plugin>/scripts/session-mode.js set --level l3 --entry-level lN \
  --fallback solo --repo-root <repo>
node <plugin>/scripts/session-mode.js set --level l3 --entry-level lN \
  --fallback precondition_failed --repo-root <repo>
```

This command must complete before TaskCreate, branch, worktree, runner, model, or inline
implementation effects. `READY` is required in enforce mode. `SHADOW` records `admitted` and
`would_block` but is not authority. `LEGACY` preserves off-mode execution. Corrupt, expired,
absent, or foreign prior session markers are observations only and can never replace the fresh
policy/graph/source check.

Source `Phase`/`P0..PN` headings, modules, tests, verification authoring, reviewer seats, and
retries are provenance/coverage or gates inside caller-authored bounded deliverables. Only
admitted graph nodes become implementation TaskCreates. A fallback, failed test, review round,
or repair consumes the same node's gate-attempt budget; it cannot create a new node or reset
admission. Routing admission is not the durable Mission grant: forward its exact policy/graph
binding into `mission prepare`/`grant` when that runtime is active, without inventing lineage,
root-run, state-path, or grant fields.

### -1. Session-mode marker + depth-0 context discipline (v2.32.27)

At `/l3` through `/l6` entry, depth-0 runs the admitted command above (`clear` happens in
finish-flow closing). The marker preserves its existing `level`, `repo_root`, `started_at`, and
`expires_at` fields and adds the admission/entry topology binding when Mission is configured. It
arms two opt-in hooks:

- **orchestrator-edit-gate**: depth-0 Edit/Write of product files is a protocol
  violation — dispatch instead. Subagents/foremen pass (hook payload identity).
- **context-budget**: measures the REAL context size. Once T1 (100k) has fired,
  depth-0 MUST checkpoint + `autopilot:handoff` at the next deliverable boundary
  (after a merged unit / qc verdict) and continue in a fresh session — context
  cost ≈ length × remaining messages, quadratic in session length (2026-07-14
  transcript study: 96%+ of tokens were cache_read on unsplit depth-0 sessions).
  At T2 (150k) stop taking on new work and hand off NOW.

Under an active l5/l6 marker, write and author dispatch on the consuming repo are
CONTRACT-GATED (v2.32.36) — this is the session-mode control-loop boundary contract, not
optional guidance:

- Depth-0 freezes an immutable dispatch-unit contract (schema
  `schemas/dispatch-unit-contract.schema.json`) per unit — one semantic decision plus its
  mandatory generated mirrors, base pinned to a full SHA, budgets, allow/deny scope,
  acceptance argv, and the engine role.
- GO is mechanical and pre-spend:
  `node scripts/dispatch-contract.js check --contract <unit.json> --repo <repo> --json`
  (exit 0 GO / 2 schema / 3 policy NO-GO). No LLM override, no silent fallback; a changed
  contract is a new hash and a new GO check.
- Write dispatch: `scripts/dispatch-hetero.sh --strict-contract --contract-file <unit.json>
  --branch <b> --prompt-file <task.md> ...` — base/timeout derive from the contract; caller
  `--base`/`--model`/`--timeout` disagreements are precondition-rejected; post-return the
  dispatcher enforces the artifact boundary (allow/deny/file/diff/output) from git truth and
  EXECUTES the acceptance argv itself (`boundary_rejected` / `acceptance_failed`, worktree
  kept).
- Verification authoring (`/l6`): `scripts/dispatch-author.sh --strict-contract
  --contract-file <unit.json> --repo-root <consuming-repo> --prompt-file <file>` — the checker
  gates with the verification-author role, runner/model derive from the resolved VA tuple, and
  the consuming checkout is containment-proven (any mutation ⇒ `containment_breach` exit 4,
  artifact quarantined, never promoted).
- Prompt-only (non-strict) write/author dispatch on a repo with an active l5/l6 marker fails
  before any runner spawn. Expired or foreign-repo markers do not block.

Corollary (always, hooks on or off): dispatch outputs land in FILES; depth-0
reads only the emitted JSON summary — never scroll raw worker logs into the
depth-0 context.

### 0. Peer consult (optional, Claude Code + codex plugin only)

For quick second opinions during depth-0 judgment (design sanity, alternative
diagnosis, "what am I missing"), the `codex:codex-rescue` subagent is a ~seconds-class
repo-grounded consult channel (see `references/hetero-dispatch.md` § Peer consult).
It is ADVICE only: it never substitutes qc@depth-0 (§3), artifact verification, or
merge authority, and it is absent on non-CC hosts — never a dependency of the loop.

### 1. Budget cap (rounds + wall-clock — v1 only)

- Pick a wall-clock deadline and a round cap before dispatch (a small fixed
  default, e.g. 30 min / 3 rounds, scaled to task size). **Token-estimate budget
  is deferred** (needs a counting source — Open Q3).
- Arm the deadline with a **one-shot background Bash**, not a Monitor sleep loop —
  e.g. `Bash(command: "sleep 1800; echo DEADLINE_HIT", run_in_background: true)`;
  when the `DEADLINE_HIT` notification wakes you, `TaskStop` the foreman if still
  running. (Kill the background timer once the foreman returns normally, else it
  fires a harmless stale event at the cap.) The wall-clock itself is plain
  depth-0 timing (no new primitive). Foremen must not use this timer to wait on
  leaves.
- **On timeout or cap-hit, judge by git artifacts BEFORE acting.** Read the foreman
  worktree branch's commit progress (`git -C <worktree> log`), **never the foreman's
  self-report**, to decide whether it is healthily advancing. Healthily progressing →
  a **one-time** extension is allowed, recorded in the decision log (a second overrun
  is a hard `TaskStop`, no second extension). No commit progress → **immediate
  `TaskStop <agentId>` + escalate.**
- **No progress — or any overrun after the one-time extension → `TaskStop
  <agentId>` then escalate.** The artifact check above is the ONLY branch out of a
  hit cap. Fail-closed: a hit cap is an escalation, never a silent continue (the
  extension is itself an explicit, decision-logged action, not a continue). This is
  also the **foreman-tier stall detector** — a hung foreman trips the depth-0 clock.

### 1.b Quota/session-limit reset preflight recovery (R4)

**Gated on `on_engine_unavailable`** (retrieve the resolved value with
`bash scripts/resolve-review-loop.sh --field on_engine_unavailable` — read it,
never hand-type the policy): this
auto-wakeup path only runs when the resolved key is `solo-fallback` or
`wait-reset`. Under `ask` (the shipped default), the run stops at the quota death
and escalates to the user immediately — report which engine died and the parsed
reset time if available; do **not** schedule a wakeup or silently fall back to
inline/`--solo` labor on the expensive depth-0 session model.

This path is only for **quota/session-limit death** (session model usage/quota hit).
It is distinct from `failure`/`killed` code-death recovery in §2; quota-reset
resurrection must first re-validate quota, then route through the existing R3
`run-ledger.sh resume` branch.

Use this 7-step recovery sequence:

1. Preserve the original session-limit error exactly as an immutable value in
   control-loop state (raw CLI/tool error string), because this text is the source
   of truth for downstream escalation and audit.
2. Parse the reset point from `quota_error_text` and fail fast if unparsable.
   Only parse explicit timestamps/countdowns present in the error string (for example
   `reset=<unix_epoch>` or `retry_after=<seconds>`). If parsing cannot produce a
   concrete deadline, **do not invent a wakeup** — escalate manually using the
   preserved error and continue with the standard failure path.
3. Derive the wake target from parsed reset:
   `wake_at = reset_epoch + buffer_secs + jitter_secs`,
   where `buffer_secs` avoids exact-boundary wake and `jitter_secs` reduces herd
   collisions on shared accounts.
4. Schedule the wakeup using one of the real wakeup primitives:
   - Primary: one-shot `Bash(run_in_background: true)` timer, e.g.
     `Bash(command: "sleep ${delay}; echo QUOTA_WAKEUP", run_in_background: true)`
     — the host task-notification wakes the session; do not Monitor-loop or
     poll from a live turn.
   - Alternate portability path: `"/loop"` with a self-throttled checkpointed prompt
     that waits until `now >= wake_at` before leaving reset mode.
5. On wakeup, run the **separate probe budget** first against the endpoint that maps to
   the quota-limited engine for this recovery path (typically `<quota_limited_endpoint_name>`):
   `node bin/autopilot.js endpoints test <quota_limited_endpoint_name> --json`.
   This is explicit network+auth preflight to avoid immediately spending heavy
   implementation budget.
6. If probe is `outcome: ok`, execute the R3 path:
   `scripts/run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>`.
   This is the required idempotent continuation step; no bespoke resume branch.
7. If probe reports limit still active (`outcome: network_failed` with `http_status: 429`
   or equivalent `still_limited`) or is `auth_failed`/`network_failed` due to auth plane outage, do **not** retry
   immediately. Apply exponential backoff with jitter (`delay *= 2`, capped), reschedule
   via step 4, and re-run step 5 only at the new wake time.

### 2. Outcome → action table

Every foreman / `dispatch-hetero.sh` outcome maps to a defined action — no
outcome is a silent no-op. The first six rows are `dispatch-hetero.sh`'s outcome
vocabulary (see [`references/hetero-dispatch.md`](../../../references/hetero-dispatch.md)
§ "Outcome states"); the final `killed` row is **not** a script status — it is the
CEO's own state after calling `TaskStop <agentId>` at the budget cap (§1), and on
the native `/l4` path an `Agent()` dispatch failure surfaces as a tool error, not
a JSON outcome.

| Outcome | Depth-0 action |
|---------|----------------|
| `committed` | Continue to qc@depth-0 (below). |
| `no_op` | Verify scope was genuinely empty → done, or **retry once** with a sharper brief. |
| `dirty` | Escalate (worker committed then left the tree dirty — not reviewable). |
| `failure` | Escalate (clean commit but abnormal exit — run not trustworthy). |
| `question_suspected` | Escalate (worker likely paused on a clarifying question). |
| `precondition_failed` | **Gated on `on_engine_unavailable`** (from `resolve-review-loop.sh`): `ask` / `wait-reset` → escalate to the user (record in ledger; do **not** auto-`--solo`); `solo-fallback` → run `session-mode.js set --level l3 --entry-level lN --fallback precondition_failed --repo-root <repo>` and fall back inline only if the same Mission admission digest remains. For `/l5`/`/l6` this is a `dispatch-hetero.sh` JSON status; for native `/l4` it is any `Agent()` call failure (a tool error, not JSON). |
| `killed` (budget cap — CEO state, not a script status) | Escalate (see §1). |
| `failed`/`killed` (foreman died before normal outcome emission) | run `run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>` and let it perform recovery: locate last ledger stage, bump generation (`stage-acquire --allow-reopen`), hold resource lock, reconcile by `stage-reconcile` before any redo, adopt git-truth when available, and report `review_round_owed`. If `status=already_applied`, caller must treat as a true no-op recovery replay. On `quarantined`/D resources, resume must refuse the old resource and request a new resource path. |

### 3. qc@depth-0 is THE gate

The foreman runs dev-flow → finish-flow, which has its **own** L-5 qc. That qc is
explicitly **first-pass / non-authoritative**.

The authoritative gate is a **depth-0 QC panel** whose reviewer families/panel
come from `scripts/resolve-review-loop.sh` (`qc_panel` /
`required_review_families` / `min_panel_size`); resolver unavailable → fall back
to 3 reviewers. A homogeneous (all-Claude) panel must not drop below the
resolver's **`min_panel_size`** (default 3) — a panel-size floor emitted
separately from families because lens diversity ≠ family decorrelation
(same-family lenses can share blind spots). Dispatch subagents,
each with a **distinct non-overlapping lens** (e.g. correctness,
security/faithfulness, completeness/edge-cases; for LLM-behavior or
data-into-system changes add a domain lens), each reading the foreman's
**artifacts** (the branch diff) and **citing `file:line`**, default-assuming
broken until proven, per blind-dispatch clause 1
([`references/blind-dispatch.md`](../../../references/blind-dispatch.md)). The CEO
**synthesizes** their findings into the pass/fail verdict and **fixes or reverts
every real issue before integration**. Scale panel composition to resolver output
and blast radius.

**Disjoint-family panel (when `review-loop-config.md` sets a `qc_panel`).** By
default `/l4` stays homogeneous — diverse *lenses*, one *family* — with the
**`min_panel_size` floor** above; resolver unavailable → fall back to 3 reviewers. For
`/l5`/`/l6` (heterogeneous implementer) that is a decorrelation hole: if the
implementer is OpenAI (`gpt-5.3-codex-spark`), a same-family reviewer shares its
blind spots. So resolve the panel from `scripts/resolve-review-loop.sh` (`qc_panel`)
and dispatch a **disjoint-family** set — Claude/Opus via the native Agent tool,
non-Claude vendors via **`scripts/dispatch-review.sh --runner codex|agy`** (read-only;
the agy/Gemini track is verified — agy's write bug is implementer-only). The panel
must span **≥1 family different from the implementer's** (the resolver warns on
overlap). Synthesis is **`union-on-verified-critical`**: any single panelist's
**verified** Critical blocks the gate — **never a majority vote** (a blind-spot catch
is seen by only one track; majority would suppress exactly what decorrelation surfaces);
"verified" = reproduce via the `independent_harness` (execution) for executable claims,
else a depth-0 second-look. A panelist returning `no_verdict` (empty/stdout-drop) is
**fail-closed** — treated as "did not clear", never as a pass. Full rule:
[`skills/quality-pipeline/references/code-review.md`](../../quality-pipeline/references/code-review.md) § "Panel aggregation".

**Provenance + risk (v2.25.11).** The policy is inert without authoritative implementer
provenance at review time — persist a **dispatch manifest** {engine, family, tier, runner,
worktree/artifact id} alongside the diff (the `dispatch-hetero.sh` outcome JSON already carries
`runner`/`model`/`containment`); **missing/unverifiable manifest ⇒ fail-closed to the strictest
tier**. Pass the diff's risk inputs (size, protected-path, oracle-available, security-surface) to
`resolve-review-loop.sh`; at **high `review_risk`** the decorrelated execution oracle (`l1_required`)
and a cross-family panel are mandatory — enforce with `resolve-review-loop.sh --enforce` (exit 3 on
an unsatisfied high-risk gate). This hardens HONEST-but-WEAK implementers only — NOT a malicious
worker (see the test-integrity isolation BACKLOG).

**Two operating rules the panel itself will not enforce for you** (both learned by hitting them,
2026-08-27):

- **Pre-check the reviewer payload before you spend a dispatch.** `scripts/check-blind-evidence.sh
  --payload <spec-file> --json` refuses a payload carrying implementer narrative (blind-evidence rule
  K1). A spec that tells the panel what the author concluded — "the author decided X, judge it", "a
  bypass was found and fixed here" — primes exactly what the blind rail exists to prevent, and
  `dispatch-review.sh` will reject it as `precondition_failed` **after** you have queued the seat.
  Write the questions without the answers, run the checker, then dispatch. State the open design
  questions as questions the reviewer must answer *from the diff*, never as decisions to ratify.
- **Reproduce every finding yourself before forwarding it.** A panel seat reports what it believes it
  read; depth-0 owns what gets acted on. Reproducing takes minutes and does three things a forward
  does not: it upgrades a Major to a Critical when the impact is worse than reported, it catches the
  finding that is simply wrong (a NUL byte in a test fixture misread as a space, claimed to make the
  suite "permanently red" — the suite was green), and it gives the implementer a command to re-run
  rather than a claim to interpret. **Reject on the record**, with the evidence, rather than silently
  dropping — an unadjudicated finding reappears next round.

**The depth-0 qc is DISPATCHED, never the CEO eyeballing the diff inline.** A
single self-read from the CEO's own context is itself only a first-pass and does
**not** clear the gate — the value is *independent adversarial coverage*, not a
second opinion from the same head. (Failure mode, 2026-06 dogfood: CEO self-qc'd a
~700-line merge instead of fanning out reviewers; caught only because the user
flagged it.) **Hold the push/merge until the synthesis is clean.** Not two real
gates — one **adversarial panel** (depth 0) + one self-check (foreman). The
run-summary ledger (below) must show the depth-0 panel **distinct from** the
foreman's first-pass qc.

### 4. Merge-back is owned by depth 0

`dispatch-hetero.sh` (and the foreman pattern) deliberately **never merge** — they
branch off a pinned base and only remove the worktree on success. After the
**authoritative qc verdict passes at depth 0**, the CEO integrates the foreman's
commit. **Mind the base**: the foreman worktree branches off the *tracked* base
(`develop`), NOT the CEO's checked-out HEAD (see Gotchas). When the CEO is on a
feature branch, first verify the foreman base. Prefer an identity-preserving merge
when that base is compatible; this makes containment mechanically provable. A
tactical `git cherry-pick <foreman-commit>` copies a commit but does **not** make
the source branch an ancestor. After cherry-pick, preserve that source (bundle +
exact-tip ack/handoff) until depth 0 explicitly discards it; the reaper must keep
it uncontained. On conflict, retry once, else escalate — never auto-resolve.

After an identity-preserving merge, retire dispatch-owned dated branches through
the deterministic reaper, not an ad-hoc broad branch glob. Reuse finish-flow
L-5.6's exact `autopilot_root` resolver and authoritative `integration_target`
derivation; do not create a second resolver here. If those values have not yet
been resolved, run that L-5.6 procedure first and halt on any ambiguity. Bind the
consumer independently so a plugin-package script is never resolved from its git
root:

```bash
consumer_repo="$(git rev-parse --show-toplevel)"
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap --repo "$consumer_repo" --into "$integration_target" --yes
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap --repo "$consumer_repo" --into "$integration_target" --reap-superseded --dry-run
# Uncontained superseded rounds remain preservation/manual-disposition items.
```

Only branches contained by the authoritative branch are deletion-eligible. Every
deletion is preceded by one verified full-history bundle. Branches outside the
reaper grammar remain explicit preserve-first harness cleanup responsibility.

### 5. Worktree GC

At every L5/L6 deliverable transition, run the task status surface. Run it again before merge, after
merge, and immediately before finish-flow clears the session marker:

```bash
node "$autopilot_root/bin/autopilot.js" status task --root-run-id "$root_run_id"
```

The caller persists the exact LSM input bundle as
`${AUTOPILOT_TASK_STATUS_DIR:-${TMPDIR:-/tmp}/autopilot-task-status}/<root_run_id>.json`;
the CLI rejects a mismatched/unsafe root id and recomputes live Git/WLB observations rather than
trusting cached booleans.

The four labels `product_merged`, `consumer_updated`, `pushed`, and `zero_residue` are independent.
Only `can_close=true` is `DONE`; Mission terminal or a successful merge alone is never a clean
closeout.

Every non-success outcome (`dirty` / `no_op` / `question_suspected` / `failure`)
**keeps** its worktree by design (caller's cleanup). The CEO reaps kept worktrees
and branches immediately after handling the outcome. For managed schema-2
L5/L6 leaves, keep the campaign `root_run_id` unchanged and use the canonical
controller sequence; manual removal would discard the write-ahead branch
inventory:

```bash
: "${lifecycle_artifact_dir:?set a caller-owned durable artifact directory}"
: "${campaign_id:?bind the admitted sealed campaign_id}"
[[ "$campaign_id" =~ ^campaign-v1-[0-9a-f]{64}$ ]] \
  || { printf '%s\n' 'invalid lifecycle campaign_id' >&2; exit 2; }
root_run_id="$campaign_id"
lifecycle_dir="$(mktemp -d "$lifecycle_artifact_dir/root-$root_run_id.XXXXXX")" \
  || exit 2
bash "$autopilot_root/scripts/reap-dispatch-worktrees.sh" reap \
  --repo "$consumer_repo" --root-run-id "$root_run_id" --yes \
  >"$lifecycle_dir/worktrees.json" || exit $?
bash "$autopilot_root/scripts/reap-dispatch-branches.sh" reap \
  --repo "$consumer_repo" --into "$integration_target" \
  --inventory-file "$lifecycle_dir/worktrees.json" --yes \
  >"$lifecycle_dir/branches.json" || exit $?
node "$autopilot_root/scripts/lifecycle-residue-receipt.js" issue \
  --repo "$consumer_repo" --root-run-id "$root_run_id" \
  --worktree-result "$lifecycle_dir/worktrees.json" \
  --branch-result "$lifecycle_dir/branches.json" \
  --out "$lifecycle_dir/residue-receipt.json" || exit $?
node "$autopilot_root/scripts/lifecycle-residue-receipt.js" check \
  --repo "$consumer_repo" --root-run-id "$root_run_id" \
  --receipt "$lifecycle_dir/residue-receipt.json" || exit $?
node -e '
const value = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (value.zero_residue !== true) process.exit(1);
' "$lifecycle_dir/residue-receipt.json" \
  || { printf '%s\n' 'lifecycle residue remains' >&2; exit 1; }
```

- Persist the artifact directory outside every leaf and record it in the run
  summary for LSM. Each attempt gets a unique mode-0700 directory, and every
  command is fail-fast so a failed attempt cannot validate a stale prior
  receipt. Bind `root_run_id` explicitly from the admitted sealed
  `campaign_id`; never read the outer foreman lineage or a leaf result for this
  value. Validate the id and add the fixed `root-` prefix before path
  construction. A
  successful `check` proves freshness only; inspect
  `zero_residue` separately. `false` blocks resource closure and names the
  dirty/live/unknown state that must be resolved before rerunning.
- For the `/l5`/`/l6` agy path, the worktree path is in the outcome JSON (`worktree`
  field) and the branch in the `branch` field. For a retained managed leaf, the
  controller sequence above reaps **both** or emits exact blockers; never
  force-remove past a dirty, live, malformed, legacy, unsupported, pending, or
  raced state. For a dated branch covered by `reap-dispatch-branches.sh`, let
  the reaper prove containment, create and verify its bundle, then delete it;
  do not use an unchecked `git branch -D`. On a
  `committed` outcome the worktree is already auto-removed (`worktree: null`); after
  an identity-preserving merge run the contained reaper pass above. After a
  cherry-pick, keep + ack/handoff the uncontained source. Out-of-grammar
  `hetero/<name>` branches require explicit preserve-first inspected cleanup.
- Native Claude foreman worktrees are not schema-2 managed leaves. For a killed
  native foreman, the path is deterministic
  (`.claude/worktrees/agent-<agentId>`); if unknown, discover via a
  `git worktree list` diff (worktree base ≠ HEAD — see memory
  `worktree-dispatch-gotchas`). Preserve its exact branch tip first, then
  `git worktree remove --force <path>` and `git worktree prune`. Never use a bare branch -D.

### 6. Decision ledger + round-end report (autonomous-brain P3)

Every autonomous depth-0 decision (proxy rulings, dispatches, auto-picks,
re-freeze transitions) is appended to the campaign's decision ledger BEFORE the
round ends, with a rationale — a decision the operator cannot read is a decision
that did not happen (KR3; sol shape F12):

```bash
node scripts/decision-ledger.js append --ledger <campaign>/decision-ledger.jsonl \
  --kind decision --json '{"decision_id":"d-N","round":R,"class":"tactical",
  "rationale":"...","reversibility":"two-way"}'
```

At each round boundary render the report — the operator's no-polling window into
the run (代決清單 with veto handles, auto-picks, ask-first queue, stall status,
experience-critic findings):

```bash
node scripts/decision-ledger.js report --ledger <ledger> --round R \
  [--stall <stall.json>] [--critic <critic.json>]
```

Vetoes are the operator's asynchronous authority: `decision-ledger.js veto --id
<decision_id>` refuses every later round that declares that decision in
`based_on_decisions` (enforced by `check-blueprint-conformance.js preflight`,
never by convention). Undoing already-performed work becomes a front-queued
repair unit. The ledger is plain append-only telemetry (ADR-0001): unlogged
decisions are caught by the conformance audit's ledger-INDEPENDENT universe
(dispatch manifests / run-ledger / git), never by trusting the ledger itself.

### 7. Stateless round protocol (autonomous-brain P2)

The depth-0 brain holds no load-bearing state in context — context is a cache,
disk is the store (sol shapes F8/F9: compaction amnesia gets refilled by process
reinvention; the fix is architectural, not mnemonic). Every round:

```
① rehydrate: node scripts/build-rehydration-bundle.js build --contract <c> \
     --ledger <ledger> --manifest-dir /tmp/autopilot-dispatch-runs [--red-lines <f>]
   (five frozen sections, 80KB cap, over-cap = BUILD ERROR — never truncated)
② execute the round (dispatch under the conformance preflight, §-2/§3)
③ persist: every decision → ledger (§6); progress → run-ledger; findings → BACKLOG
④ round boundary: render the report (§6), then RESET context deliberately —
   the next round boots from ① again
```

After any kill/compact/resume, the brain must pass the machine-graded state quiz
BEFORE proceeding: emit `{current_unit_id, four_tuple_digest, owned_pids,
last3_decision_ids}` and grade with `build-rehydration-bundle.js grade` — a
mismatch means the resumed brain's picture of the run differs from disk truth,
and the round refuses to start. Owned processes re-attach from the manifest
table (§5_owned_processes), never from memory — a worker the ledger knows about
is OURS even if the resumed context has never heard of it.

### 8. Stall fuse (autonomous-brain P4)

At each round boundary, classify the burst's delta and consult the fuse before
starting the next round (sol F5/F10: verification consumed the run — but note
the F2 boundary: a mega-batch HAS product delta and is the churn preflight's
kill, not this fuse's):

```bash
git diff --name-only <burst-base>..HEAD > /tmp/burst-names.txt
node scripts/check-stall-fuse.js classify --names /tmp/burst-names.txt \
  # → append {burst_id, product_files, verification_files} to the campaign's bursts.jsonl
node scripts/check-stall-fuse.js check --bursts <campaign>/bursts.jsonl \
  --strike-identity-file <seat-identity.json> --strike-store <capability-store>
node scripts/check-blueprint-conformance.js audit \
  --contract <contract> --intent <intent> --repo <repo> \
  --manifest-dir /tmp/autopilot-dispatch-runs --ledger <ledger> \
  --strike-identity-file <seat-identity.json> --strike-store <capability-store>
```

The strike flags (brain-seat-exam-suite KR3b) make a trip / audit failure also
append ONE identity-keyed strike row to the capability store — 3 strikes since
the seat's last exam pass flip its standing to `requalification_required`
(`engine-capability-state.js brain-status`). Both flags together or neither; a
strike append that cannot complete fails the instrument closed (exit 2).

Tripped ⇒ HALT: no further dispatch this campaign; render the round-end report
with the stall section and stop for the operator. Also immediate-violation:
re-verifying a finding with a full-suite rerun (`reverify.mode:"full-suite"`) —
finding closure re-runs the finding's surface plus the frozen gate set, nothing
more.

### 9. Post-merge experience critic (autonomous-brain P6)

AFTER merge-back (§4) completes — never before — launch the user-persona critic
on the shipped deliverable (methodology: `references/experience-audit.md`; the
script enforces the post-merge guard in-code via git ancestry, so no caller can
turn it into a gate):

```bash
bash scripts/dispatch-experience-critic.sh \
  --deliverable <merged-sha> --integration-ref develop --repo <repo> \
  --instantiation <blueprint's frozen five-question answers> \
  --evidence <rendered-consumption output> --out <critic.json> \
  --runner <r> --model <m> [--endpoint <e>]   # decorrelated family, single round
```

Findings (≤7, stable IDs, BACKLOG-row-ready) feed the round-end report
(`decision-ledger.js report --critic <critic.json>`); the brain appends accepted
rows to docs/BACKLOG.md where `/next`'s queue prices them. `human_only` items go
verbatim to the operator. A "blocking" marker from the critic is stripped and
surfaced as an anomaly — correctness gates alone block.

### Quality-floor conventions (v2.31.11)

The five structural ledger-emission points — playbook no-match; adjudication unvalidatable-REFUTED / unconfirmed-PROOF_BY_TRACE; panel irreversible-disagreement; plan-revision checkpoint trips (risk-counter thresholds); depth-0 override of a dispatched artifact — each emits an `escalation_opened` tree event. See the quality-floor plan (`docs/plans/2026-07-04-quality-floor-engine.md`).

## Phase L: width fan-out control loop (the depth-0 loop driving `dispatch-batch.sh`)

When the foreman decomposes a round into **≥2 file-disjoint units** (fixed cap 3,
`/l4` homogeneous only), the **depth-0 loop** — NOT the foreman, NOT a shell script —
drives the batch. The deterministic git/artifact/merge/telemetry/reap rails live in
[`scripts/dispatch-batch.sh`](../../../scripts/dispatch-batch.sh) (full contract:
[`references/batch-dispatch.md`](../../../references/batch-dispatch.md)); the loop below
is the harness-only half a shell cannot do (it holds N `agentId`s and uses
`Agent`/`Monitor`/`TaskStop`, which are **not shell-callable**).

```
CEO depth-0 loop (clock owner)
├─ 1. dispatch-batch.sh plan  → ENFORCE single-base; collision-safe branches; advisory propose
├─ 2. telemetry t_dispatch    → start the Amdahl clock
├─ 3. Agent(run_in_background, isolation:"worktree") ×N  → hold N agentIds (one per unit)
├─ 4. Monitor for all-N completion (or budget cap → TaskStop ALL + escalate)
├─ 5. telemetry t_all_committed
├─ 6. dispatch-batch.sh verify  → per-unit outcome table + ALL-OR-NOTHING verdict
│        any non-committed OR undeclared touch ⇒ TaskStop survivors, GC worktrees, ESCALATE
├─ 7. qc@depth-0 over the COMBINED diff (the files-only carve-out — review cross-unit coupling)
├─ 8. dispatch-batch.sh merge-back  → merged | serial_collapse (re-run named ids serial) | base_advance_failed (fix base worktree, re-run; do NOT GC)
└─ 9. telemetry t_review_done; GC all unit worktrees + branches (ONLY on `merged`)
```

### Outcome → action table (width layer)

Each unit's `verify` status maps to a defined depth-0 action — extends the §2
single-unit table. **ALL-OR-NOTHING governs the batch verdict.**

| Unit `verify` status | Depth-0 action |
|----------------------|----------------|
| `committed` + disjoint-clean | merge-eligible — but the **batch** merges only if **every** unit qualifies. |
| `committed` but **undeclared touch** (disjoint:false) | **whole batch aborts** — `TaskStop` any survivors, GC, escalate. |
| `no_op` / `dirty` / `failure` (any non-committed) | **whole batch aborts** — same. |
| batch `merge-back` → `serial_collapse` | re-run the named `serial_collapse_ids` as **ONE Tier-1 serial unit** (width collapses to 1 for those ids). **Never** auto-resolve; **never** a coordinated round-2 re-dispatch (breaches blind-dispatch). |
| batch `merge-back` → `base_advance_failed` | units committed cleanly but the base ref did NOT move (dirty base worktree / non-ff / concurrent base move). **Merged nothing — do NOT GC the unit branches** (work is still recoverable). Resolve the base worktree, then re-run `merge-back`. |

### Authorization = the disjointness gate, at two points

- **Plan-time (advisory):** `dispatch-batch.sh plan` runs `check-disjointness propose`
  over the declared scopes → `advisory_disjoint`. **Logged, never the clamp** — the LLM
  is never the gate.
- **Verify-time (authoritative):** `dispatch-batch.sh verify` runs `check-disjointness
  validate` over **git artifacts** per unit. Fail-closed.
- **Single-base-per-batch** is enforced at `plan` (mixed base ⇒ "not a valid
  decomposition"). All siblings fork ONE integration point.

### Reaping width workers — TWO different kill primitives

- **`/l4` homogeneous (Agent-tool workers):** reaped by **`TaskStop <agentId>`** — the
  same primitive as the single-foreman budget cap (§1), applied to each held agentId. On
  batch abort, `TaskStop` **every** survivor, then GC their worktrees
  (`.claude/worktrees/agent-<agentId>`, `--force`; unchanged ones auto-clean). This is the
  homogeneous path that ships.
- **Shell-dispatched (hetero) workers:** reaped by `dispatch-batch.sh reap` (SIGTERM to the
  worker process **group** — `--abort` for the whole batch, `--unit <id>` for one stalled
  unit). This rail exists for the BACKLOG `/l5` parallel path; it is **not** how `/l4`
  homogeneous workers are killed.

### Amdahl telemetry — emitted by the depth-0 loop (named clock owner)

The depth-0 loop (the only component that sees all of dispatch → all-committed →
review-done) emits `t_dispatch / t_all_committed / t_review_done` via
`dispatch-batch.sh telemetry`. `telemetry report` is **cross-run** tuning of the width
cap over time — **never a within-run gate** (a single run never blocks on its own
serial-fraction).

> 🔴 **The S1 carve-out is intact and LOAD-BEARING here.** `verify` (and the `propose`
> advisory) certify **files, not behavior**. Step 7's depth-0 qc reviews the **combined**
> diff for cross-unit semantic coupling **exactly as hard as a single-unit diff** —
> file-disjointness is not a behavior clearance, and a green batch verify must never induce
> reviewer rubber-stamping. This is the dominant failure mode the width cap is designed
> around; do not omit it.

## Run-summary ledger

The foreman returns — and the CEO records in the final CEO Report — a ledger with
one row per step:

| step | runner | model | verdict | work_domain | artifact |
|------|--------|-------|---------|-------------|----------|
| plan | claude | (foreman tier) | n/a | — | (plan doc / inline) |
| impl | claude \| agy | sonnet \| Gemini 3.5 Flash | committed | backend-cli | `<branch>@<sha>` |
| foreman first-pass qc | claude | (foreman tier) | pass (non-authoritative) | — | (qc notes) |
| recovery | claude | (depth-0 tier) | resumed / already_applied / blocked_resource | — | run-ledger resume payload (`run_id`, `resume_point`, `new_generation`, `adoption`) |
| **depth-0 qc panel (authoritative)** | resolver `qc_panel` / claude ×N (homogeneous panel ≥ resolver `min_panel_size`) | (depth-0 tier) | **pass/fail** (synthesized) | — | per-reviewer `file:line` findings over `git diff <base>..<branch>` |

- **`runner`/`model` provenance** for the impl step comes straight from
  `dispatch-hetero.sh`'s outcome JSON (`runner`/`model` fields) for the `/l5`/`/l6`
  path, or is `claude`/`<worker tier>` for the native `/l4` path.
- **`work_domain`** (impl row only) is **telemetry, never a routing input** — the
  deterministic dominant domain of the impl diff from
  `scripts/resolve-review-loop.sh --auto-domain <base>..<commit>` (the `base` +
  `commit` fields from `dispatch-hetero.sh`'s outcome JSON — `base` is the
  immutable SHA passed via `--base`; NOT ambient `HEAD`, which the worktree GC on
  success would break). Values: `rust` \| `backend-cli` \| `frontend` \| `docs` \|
  `mixed`. It records what kind of work ran so per-domain model performance can be
  measured later; it selects no engine. See `scripts/probe-diff-domain.sh`.
- The ledger makes success criterion #3 (depth-0 gate distinct from first-pass)
  and #6 (provenance present) verifiable from the report alone.

## Gotchas

- **New skills aren't dispatchable until a Claude Code restart** — the plugin
  caches skills at session start. After adding `/l3 /l4 /l5 /l6`, restart before the
  dogfood run.
- **Worktree base default = `origin/develop`, NOT the CEO's HEAD — but selectable via
  `worktree.baseRef`.** See the canonical treatment + the base-currency decision table
  under "Dispatching the foreman" above. Short form: independent task → default `fresh`
  is fine; build-on-un-merged-CEO-work → set `worktree.baseRef:"head"` (CC; in-session,
  no restart) or the portable `git reset --hard <CEO-HEAD-sha>` STEP-0 fallback (verify
  a sentinel, STOP on failure); integrate via cherry-pick (§4). The `/l5`/`/l6` hetero impl is
  a **separate mechanism** — `worktree.baseRef` doesn't reach it; pass
  `--base "$(git rev-parse HEAD)"` to `dispatch-hetero.sh` instead.
- **`git worktree prune` alone is a no-op** on an on-disk worktree — `remove
  --force` first.
- **Cross-platform**: `/lN`, `Agent(run_in_background)`, `TaskStop`, and `Monitor`
  are Claude-Code-deep. On other agents the front-door may degrade to `--solo`
  (inline CEO), but it still runs the same Mission routing admission first. Only the
  offload topology depends on the CC primitives.
