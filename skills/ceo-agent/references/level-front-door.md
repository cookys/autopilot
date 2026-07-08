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
| 4. No-go zones | **none** (default DOA). Override with `-x <csv>`. |

### Mid-run question discipline (presets active)

With the front-door presets (involvement=just-results, no-go=none), "想確認一下 /
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
| `-x <csv>` | No-go zones, e.g. `-x payments,auth`. |
| `--expand` | Scope mode = Expand instead of Hold. |
| `--solo` | `/l4`/`/l5`/`/l6` autonomy **without** offload — CEO runs inline (the `/l3` engine) but keeps Level-4/5/6 posture respectively. Also the **automatic degradation fallback** when the foreman cannot start (`precondition_failed`). |

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
- **The foreman runs dev-flow's phases INLINE at depth 1** (planning + gating it
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

### Heterogeneous engine loop details (/l5 and /l6)

Level-specific long-form lives with each level (this section stays common-protocol only):
`/l5` → [`../../l5/references/hetero-impl-loop.md`](../../l5/references/hetero-impl-loop.md);
`/l6` → [`../../l6/references/full-dispatch-pipeline.md`](../../l6/references/full-dispatch-pipeline.md).

When `/l5` or `/l6` is invoked, the foreman resolves the roster and execution parameters from `scripts/resolve-review-loop.sh` rather than hardcoding them. The loop parameters include:

- **Review and implementation engines** (`reviewer_engine`, `reviewer_effort`, `reviewer_runner`, `implementer_engine`, `implementer_effort`, `implementer_runner`): Resolved dynamically; models, effort levels, and runners should never be hardcoded inline.
- **`review_diff_scope`**: Controls what the impl-review reads each round:
  - `full` (default) ⇒ the reviewer reads the whole `<base>..HEAD` diff every round. Safe; cost grows O(n) as the diff accumulates.
  - `incremental-mitigated` ⇒ the reviewer reads `<prev-round>..HEAD` PLUS the full content of every file touched this round PLUS a standing invariants/prior-findings checklist; do a full `<base>..HEAD` re-read every 3–5 rounds or whenever a round touches shared/critical logic (classifiers, schemas, fixtures, harness control flow); and ALWAYS a final full `<base>..HEAD` review before merge. Use only on long loops — naive incremental-only misses cross-file regressions in untouched files. When this mode is on, `independent_harness` MUST run the FULL test suite, not just touched-file tests (real lesson 2026-06-26: a stale-fixture regression in an untouched test file slipped a too-narrow per-round scope to the final sweep). Reference driver: `resolve-review-loop.sh --field review_diff_scope`.
- **`independent_harness:on`**: Depth-0 ALSO builds its own adversarial harness and never trusts the implementer's own green.
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
agentId = Agent(run_in_background: true, isolation: "worktree", subagent_type: "general-purpose", prompt: <foreman brief>)
```

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
- `Monitor` arms the deadline by emitting on a timer, not via a built-in clock —
  e.g. `Monitor(command: "sleep 1800; echo DEADLINE_HIT", timeout_ms: 1900000)`;
  when the `DEADLINE_HIT` event fires you `TaskStop` the foreman if still running.
  (Cancel the guard with `TaskStop <monitor-id>` once the foreman returns normally,
  else it fires a harmless stale event at the cap.) The wall-clock itself is plain
  depth-0 timing (no new primitive).
- **On timeout or cap-hit → `TaskStop <agentId>` then escalate.** Fail-closed:
  a hit cap is an escalation, never a silent continue. This is also the
  **foreman-tier stall detector** — a hung foreman trips the depth-0 clock.

### 1.b Quota/session-limit reset preflight recovery (R4)

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
   - Primary: `Monitor` one-shot timer, e.g.
     `Monitor(command: "sleep ${delay}; echo QUOTA_WAKEUP", timeout_ms: ...)`
   - Alternate portability path: `"/loop"` with a self-throttled checkpointed prompt
     that waits until `now >= wake_at` before leaving reset mode.
5. On wakeup, run the **separate probe budget** first:
   `node bin/autopilot.js endpoints doctor --json`.
   This is explicit SEPARATE-budget reachability/auth preflight to avoid immediately
   spending heavy implementation budget.
6. If probe is `outcome: ok` and status indicates recovery, execute the R3 path:
   `scripts/run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>`.
   This is the required idempotent continuation step; no bespoke resume branch.
7. If probe reports limit still active (`status` indicates 429 or equivalent `still_limited`)
   or is `auth_failed`/`network_failed` due to auth plane outage, do **not** retry
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
| `precondition_failed` | Fall back to `--solo` (the foreman could not start; run inline). For `/l5`/`/l6` this is a `dispatch-hetero.sh` JSON status; for native `/l4` it is any `Agent()` call failure (a tool error, not JSON). |
| `killed` (budget cap — CEO state, not a script status) | Escalate (see §1). |
| `failed`/`killed` (foreman died before normal outcome emission) | run `run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>` and let it perform recovery: locate last ledger stage, bump generation (`stage-acquire --allow-reopen`), hold resource lock, reconcile by `stage-reconcile` before any redo, adopt git-truth when available, and report `review_round_owed`. If `status=already_applied`, caller must treat as a true no-op recovery replay. On `quarantined`/D resources, resume must refuse the old resource and request a new resource path. |

### 3. qc@depth-0 is THE gate

The foreman runs dev-flow → finish-flow, which has its **own** L-5 qc. That qc is
explicitly **first-pass / non-authoritative**.

The authoritative gate is a **depth-0 QC panel** whose reviewer families/panel
come from `scripts/resolve-review-loop.sh` (`qc_panel` /
`required_review_families`); resolver unavailable → fall back to 3 reviewers.
Homogeneous (all-Claude) panels keep a **≥3-lens floor** (resolver emits
families, not panel size; until `min_panel_size` exists). Dispatch subagents,
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
**≥3-lens floor** above; resolver unavailable → fall back to 3 reviewers. For
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
feature branch, a two-dot `git diff <feature>..<foreman-branch>` shows phantom
deletions of the absent feature work, and a plain `git merge` drags the base's
history in — so **`git cherry-pick <foreman-commit>`** (the isolated commit) is the
correct integration when the touched files don't overlap the feature work
(empirically the case in the P1.f dogfood). Use a real branch merge only when the
foreman built on the CEO's actual HEAD (STEP-0 bootstrap, Gotchas). On conflict
(base moved during a long run): **rebase/cherry-pick-retry once, else escalate** —
never auto-resolve unattended.

### 5. Worktree GC

Every non-success outcome (`dirty` / `no_op` / `question_suspected` / `failure`)
**keeps** its worktree by design (caller's cleanup). The CEO reaps kept worktrees
and branches after handling the outcome:

```bash
git worktree remove --force <path>        # `prune` ALONE is a no-op on an on-disk worktree
git branch -D worktree-agent-<agentId>    # for a killed native foreman
git worktree prune
```

- For the `/l5`/`/l6` agy path, the worktree path is in the outcome JSON (`worktree`
  field) and the branch in the `branch` field — reap **both**:
  `git worktree remove --force <worktree>` (if non-null) **and**
  `git branch -D <branch>` (`git worktree remove` does NOT delete the branch, so a
  non-success hetero dispatch leaves a stale branch otherwise). On a `committed`
  outcome the worktree is already auto-removed (`worktree: null`); after the
  depth-0 cherry-pick, still `git branch -D <branch>` to clear the integrated branch.
- For a killed native Claude foreman, the path is deterministic
  (`.claude/worktrees/agent-<agentId>`); if unknown, discover via a
  `git worktree list` diff (worktree base ≠ HEAD — see memory
  `worktree-dispatch-gotchas`).

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
| **depth-0 qc panel (authoritative)** | resolver `qc_panel` / claude ×N (homogeneous ≥3-lens floor) | (depth-0 tier) | **pass/fail** (synthesized) | — | per-reviewer `file:line` findings over `git diff <base>..<branch>` |

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
  are Claude-Code-deep. On other agents the front-door degrades to `--solo`
  (inline CEO) — the offload is the part that needs the CC primitives.
