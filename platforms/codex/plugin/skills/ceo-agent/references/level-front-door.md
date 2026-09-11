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

**Note on merge as an "irreversible op"**: A `git merge --no-ff` into `develop` (or equivalent
team-default branch) is considered **within CEO DOA** for L-size workflows when all pre-merge
gates pass. This is tactical and locally reversible (`git reset --hard`). Merging to `main`
or force-pushing is NOT within DOA. The forcing function in `autopilot:finish-flow` treats
merge (L-5.3 / H-9.3) as an autonomous sub-task; CEO does not pause to ask before merging.
Deleting an **already-merged** feature branch during finish-flow cleanup (L-5.7 / F.5 /
H-9.5 — merged-status verified first) is likewise within CEO DOA; the "Delete
files/branches" escalation row in `SKILL.md` covers unmerged or protected branches.

### One confirmation per run (opt-in, v2.36.17)

The section above is the default: a front-door run never stops to ask "should I continue?".
Some owners want one gate anyway — approve the whole thing once at the start, then let it run
to the end without further checkpoints. That is what `run_approval` buys, and it is **off**
until configured:

```bash
node <plugin>/scripts/run-approval.js persist --mode ask-once   # turn it on (machine-local)
node <plugin>/scripts/run-approval.js status                     # {mode, source, config_path}
```

When it is on, depth-0 does two things at the top of a run:

1. **Print the pre-flight report BEFORE the first dispatch.** It is the one moment the owner
   can still redirect cheaply, so it states what the run will actually do, not what it hopes
   to achieve: the size verdict, the branch and worktree it will create, the admitted
   deliverables, which engine each one goes to, the file scope it expects to touch, and —
   the load-bearing line — **the irreversible operations it intends to perform inside DOA
   without asking again** (merge to `develop`, branch deletion, worktree teardown).
2. **Dispatch normally.** `hooks/run-approval-gate.js` turns that first `Task`/`Agent` call
   into a permission `ask`. The owner's answer to that dialog is the approval; approving it
   covers the rest of the run and the gate goes silent.

The receipt is never a model claim that consent was given: the ask writes a `pending` record
and only `PostToolUse` promotes it, so a model cannot mint approval by asserting it, and a
`PostToolUse` with no matching ask (the knob flipping mid-call, say) records nothing. What it
proves is "this gate asked and the call then ran" — not that a dialog was rendered and
answered, since the hook is never told the permission outcome. A host that auto-allows `Task`
would still execute it. That bound is stated rather than closed; closing it needs the host to
report the decision back.

A denial leaves no receipt, so the next dispatch asks again. The approval is bound to the
marker's `level:started_at`, so a second front-door command in the same session is a new run
and is approved on its own — **and so is a `--solo`/`precondition_failed` degradation**, which
re-runs `session-mode.js set` and therefore asks again. That is intended: the owner approved a
run that would offload to a foreman, and an inline `/l3` is a different run than the one
described to them.

**Approval does not widen authority.** Project red lines, irreversible operations outside DOA,
quota death and the stall fuse still stop the run exactly as they do without the knob. This
gate removes the ordinary checkpoints and nothing else — the same asymmetry as `-x`, which may
add red lines for a run but can never remove a project one.

**Headless runs must leave it off**: `ask` is auto-denied without a human to answer it.

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
    **`/l4` compiles the same live-probed, host-owned provider bootstrap as `/l5`/`/l6`**
    (v2.36.8) with the **l4 roster profile**: implementer + reviewer required, the
    verification-author seat and the QC panel optional (included when present, skipped
    otherwise). Seats outside the frozen policy run under the advisory override (stderr
    `POLICY OVERRIDE`, `policy_override` recorded, `claim_id: null`) — recorded, never
    blocked. The consumed bundle certifies the reviewer, so the v2.36.7 waiver fires only
    when the bootstrap does NOT certify the reviewer: then the ledger records
    `reviewer_qualification: waived` + the reason and the reviewer still runs; pass
    `--require-qualified-reviewer` to force the block instead. Enforce-mode
    `campaign_intake` now receives a real `strict_level: "l4"` readiness bundle. A consumed
    bundle marks the reviewer seat qualified for that invocation even when its seat is
    uncertified (`claim_id: null`) — advisory coverage semantics inherited from l5/l6
    (Board 2026-08-16), so `--require-qualified-reviewer` is satisfied by host readiness,
    not by a capability claim. Note the
    managed engine's level-independent terminal-QC gate (`prepare_implementation_loop`,
    `min_panel_size`) still needs a complete QC panel for any `--campaign-contract` run.
  - **Named endpoints are declarative, not hand-typed.** When the resolved config
    (`scripts/resolve-review-loop.sh`) emits a non-empty `implementer_endpoint` /
    `reviewer_endpoint`, pass it straight through as `--endpoint <name>` to
    `dispatch-hetero.sh` (implementer, `cc-shim`) / `dispatch-review.sh` (reviewer,
    `cc-shim`/`anthropic-compatible`). The dispatcher resolves creds via
    `resolve-endpoint.sh` from the canonical `~/.autopilot/endpoints.env`
    (`AUTOPILOT_ENDPOINT_<NAME>_*`); an empty field means no `--endpoint` (raw
    old "type `--endpoint` by hand every run" gap — the project config owns it now.

### Default dispatch topology — brain up, hands down (v2.35.16)

| tier | who | may | may not |
|------|-----|-----|---------|
| **T0 brain** | depth-0 (Fable/opus session) | brief, adjudicate review findings, run qc, merge | hand-author implementation/prose content itself (except via `--solo` escape) |
| **T1 hands** | hetero implementer ladder (cheapest qualified rung first, climb on red) or, when no hetero engine is qualified, `haiku` → `sonnet` | mechanical implementation/prose cuts | adjudicate its own work, merge, or skip the `Engine:` header |
| **T2 judge** | cross-family qc reviewer(s) | review, find, block | implement or merge |
| **review seats** | plan review panel, reviewer ladder, consult ladder resolved via `scripts/resolve-dispatch-topology.js --role <plan_reviewer\|reviewer\|consult>` | auto expands to topology seats; falls back to native claude-native seat if unavailable | silent skip |

Mechanical sources:
- Review seats: the plan review panel, the reviewer ladder, and the consult ladder are all resolved by `scripts/resolve-dispatch-topology.js --role <plan_reviewer|reviewer|consult>`. Each of the three review-related knobs (`plan_review`, `hetero_review`, `consult_dispatch`) supports `auto`, which expands to these topology-resolved seats; when topology resolution is unavailable the stage falls back to a native claude-native seat rather than being silently skipped.
- `implementer_ladder: auto` in `review-loop-config.md` expands the host topology written by `scripts/resolve-dispatch-topology.js` (cached at `~/.autopilot/topology.json`; `--check` detects drift).
- Rung 0 is the first attempt for every unit class now (`ladder_start_rung_judgment` restores the old rung-1-first behavior for `judgment`-class units only).
- `scripts/resolve-dispatch.sh` implementer default is `sonnet`; the new role `hands` resolves to `haiku`.
- `dispatch-model-guard` (hook) reminds the dispatching agent (a deny carrying the reason, never a human dialog — v2.36.9) before dispatching `fable`/`opus` for any implementation-shaped dispatch (i.e. `mode` != `plan`); the agent decides — re-dispatch cheaper, or mark line 1 `Engine: <model> (intentional: <why>)` to proceed. It denies any dispatch whose prompt's first line is not `Engine: <model>…` matching the dispatch's `model:` argument.
- Every foreman's DONE line includes the parallel section of the full suite (`hooks/tests/run.sh --parallel 4`) whenever the deliverable touches a shared contract (resolver fields, schema, template defaults) — a deliverable's own tests never see the fixtures it drifts (v2.36.0: 25 files; `references/evidence-discipline.md` §24–25).
- `hooks/cost-fuse.js` (PreToolUse, default-on, warn mode) trips when brain-tier spend crosses USD 150/host/day (configurable via `cost_fuse` in `~/.autopilot/config.json`); `scripts/cost-digest.js` is the ledger view for that spend.

Owner rulings (2026-09-04):
- An unqualified engine never enters the implementer ladder — it shows up only as a `candidates_to_qualify` entry until it passes qualification.
- `/l3` is now brain-briefs-and-dispatches-sonnet-hands, executed inline on the CEO's thread; `--solo` is the only true "depth-0 implements it directly" escape hatch, and the cost fuse still applies even under `--solo`.

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
  dispatch — foreman/sub-orchestrator defaults to `sonnet` (opus only when the dispatching brief
  states why opus is needed); hands defaults to `haiku`/`sonnet` or the hetero implementer ladder.
  Never rely on inheritance.
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
foreman prompt. Foreman Bash count cap: 40 (gates: `hooks/foreman-guard.js` in the loop at
PreToolUse — default-on since v2.35.15 — and `scripts/check-foreman-polling.js` post-hoc).

#### Foreman lifecycle — 一刀一命 (v2.35.15)

Source incident: cuda quota digest 2026-09-04 (`QUOTA-DIGEST-2026-09-04.md`): ≈$2,200 API-equivalent
in 36 h, 79 % from four resident Sonnet foremen alive 13–33 h with 1,900–7,400 Bash calls each,
34–97 万 cache-read tokens per call and ≈0 output; 413 wake-ups after cache TTL re-wrote the whole
context ($455); each takeover re-read brief + rulings + a 14,648-line ledger + 26K lines of kernel
source (≈300K to start). The prose rules existed; nothing was in the loop.

- **One deliverable per foreman life.** A foreman owns exactly ONE admitted deliverable. When it is
  integrated, when `foreman-guard` denies the 41st Bash, or when the foreman's own count nears the cap,
  it writes its handoff (`autopilot:handoff`) and **ends its turn**. Depth-0 spawns the next foreman
  for the next deliverable. A "resident" foreman waiting for its next assignment is forbidden.
- **In-loop enforcement.** `hooks/foreman-guard.js` (PreToolUse `Bash|Monitor`, scope = session-mode
  marker l4|l5|l6 AND payload `agent_id`): Bash cap per agent (default 40, `foreman_guard.bash_cap`),
  foreground polling denied (`true`/`:` spin, `sleep N`, `while … sleep|grep|test`, `pgrep`/`ps -p`/
  `kill -0`, reading `/tasks/*.output`), `Monitor` denied. `run_in_background` waits stay allowed.
  Modes block|warn|off (`foreman_guard.mode` / `AUTOPILOT_FOREMAN_GUARD_MODE`). Depth-0 is untouched.
- **Takeover read-list cap.** The next foreman reads the brief for THIS cut only (≤ 300 lines) and
  the ledger split for its lane. "Read the whole file first" chains (full ledger, kernel sources,
  historical rulings) are forbidden in a foreman brief; depth-0 owns the whole picture.
- **No inherited `[1m]`/Fable.** Every foreman dispatch names `model:`; `dispatch-model-guard`
  (default-on since v2.35.15) asks on an omitted model or a guarded engine. A 1M-window foreman
  auto-compacts at ≈967K — the multiplier behind the digest — so the operator's
  `~/.claude/settings.json` `model=…[1m]` must not be the foreman's model.
- **Cost visibility.** `cost-tracker` (default-on) prints a stderr line when a session's cumulative
  cache-read passes 50M tokens and each doubling after; `context-budget` (default-on) nudges at 100K
  and directs a handoff at 150K for depth-0 (both scaled to the REAL window when the status-line
  live file is present, v2.36.1). Foreman context IS measurable since v2.36.1: `foreman-guard`
  reads the foreman's own `tasks[].tokenCount` from the subagent status line's live file and denies
  its next Bash at T2 with the handoff directive (`hooks/README.md` § Live context feed). Without
  the feed (no codeforge, or an older one) the Bash cap stays the only ceiling.

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

> **The depth-0 half of this contract moved to [`depth0-control-loop.md`](depth0-control-loop.md)**
> in v2.36.21 — the CEO-owned control loop, Phase L width fan-out, run-summary
> ledger, and gotchas live there now (this file had grown past the Read tool's
> whole-file cap). Every front-door level MUST-READs both files.
