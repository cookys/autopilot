# Level front-door & dispatched foreman (`/l3 /l4 /l5`)

> Loaded by `skills/l3`, `skills/l4`, `skills/l5` and referenced from
> `ceo-agent/SKILL.md`. The `/lN` skills are **thin** — all execution semantics
> live here so the three front-doors stay in lockstep.
>
> Design source: [`docs/plans/2026-06-22-ceo-fleet-autonomy.md`](../../../docs/plans/2026-06-22-ceo-fleet-autonomy.md)
> (converged through 3 rounds of Architect/Ops/Skeptic dialectic). Read it for the
> *why*; this file is the *how*.

## What the front-door is

`/l3 /l4 /l5 <goal>` is a terse entry point into **CEO mode** (`ceo-agent`). It
pre-fills the four CEO startup questions so a long run starts without a Q&A round,
and it sets the **execution posture** (run inline vs. offload to a dispatched
sub-orchestrator). It is a *new slash-command namespace layered over* the existing
CEO **Involvement** enum (`ceo-agent/SKILL.md` Startup §2: 1=every-step /
2=phase / 3=just-results) — it does **not** redefine that term.

| Sugar | Execution posture | Engine |
|-------|-------------------|--------|
| `/l3 <goal>` | CEO executes **itself** on the main thread; escalates at the DOA boundary. The behavior you invoke today as "Level 3 全權處理", now an explicit command. | Claude (this session) |
| `/l4 <goal>` | CEO dispatches **ONE sub-orchestrator "foreman"** (background + worktree-isolated) that runs dev-flow and returns a verdict + run-summary. CEO context stays clean; the run goes long unattended. | Claude (foreman + workers) |
| `/l5 <goal>` | `/l4` **with the implementer leaf-dispatched to agy/Gemini** via `dispatch-hetero.sh` (already built — Gemini is a verified 2nd engine). | Claude foreman + Gemini impl |

### Startup-question presets

Each `/lN` fills the four CEO startup questions (`ceo-agent/SKILL.md` Startup §)
so the run does not re-ask on a clean goal:

| CEO startup Q | Preset from `/lN` |
|---------------|-------------------|
| 1. OKR / success criteria | Derived from `<goal>`. If `<goal>` has no verifiable end-state, the CEO restates one and proceeds (does **not** block on Q&A — that is the point of the front-door). |
| 2. Involvement | `/l3 /l4 /l5` all preset **3 = just-results** (full autonomy, notify on done). |
| 3. Scope mode | **Hold** (bulletproof, no scope drift). Override with `--expand`. |
| 4. No-go zones | **none** (default DOA). Override with `-x <csv>`. |

### Overrides (rare)

| Flag | Effect |
|------|--------|
| `-x <csv>` | No-go zones, e.g. `-x payments,auth`. |
| `--expand` | Scope mode = Expand instead of Hold. |
| `--solo` | `/l4`/`/l5` autonomy **without** offload — CEO runs inline (the `/l3` engine) but keeps Level-4 posture. Also the **automatic degradation fallback** when the foreman cannot start (`precondition_failed`). |

## The foreman (`/l4` and `/l5`)

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
- **`/l5`** is identical except the implementer worker is replaced by a
  `scripts/dispatch-hetero.sh` call (impl → agy/Gemini). Everything else — the
  depth-0 control loop, qc@depth-0, worktree GC — is unchanged.

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

#### Worktree base = `origin/develop`, NOT the CEO's HEAD (verified)

`Agent(isolation:"worktree")` always branches the new worktree from the repo's
**default/integration branch (`origin/develop` = `origin/HEAD`)** — never the
CEO's checked-out HEAD or current branch, and the `Agent` tool exposes **no base
parameter** to change this. Verified twice (2026-06-22): a foreman dispatched
from `feat@1048fd1` landed on `origin/develop@689dbea`; a probe with a HEAD-only
sentinel commit found the sentinel **absent** in the worktree.

⇒ **Base-currency decision the CEO makes BEFORE dispatch** — run
`git merge-base --is-ancestor HEAD origin/develop`: **exit 0** = HEAD is already in
`origin/develop` (no un-merged work → clean develop base is fine, no STEP-0);
**exit 1** = HEAD has commits not yet on develop (→ STEP-0 reset, see table):

| CEO's state | Foreman brief STEP 0 |
|-------------|----------------------|
| Task is independent of any un-merged CEO work (HEAD already on/reachable-from `origin/develop`) | **none** — the clean `origin/develop` base is correct. |
| Task must build on the CEO's un-merged work (feature-branch-only or self-referential — e.g. exercising tooling that lives only on this branch) | **`git reset --hard <CEO-HEAD-sha>`** as the foreman's literal STEP 0. Git objects are shared across worktrees, so `<CEO-HEAD-sha>` always resolves; the throwaway worktree branch is then exactly the CEO's state. Verify a sentinel file from your HEAD exists, and **STOP (don't recreate)** if the reset fails. |

This is why the P1.f dogfood's `/l5` foreman ran the *pre-feature* `dispatch-hetero.sh`
(its develop base lacked the branch-only P1 work) — the self-referential case above,
which the STEP-0 reset prevents. After a STEP-0 foreman commits, its branch =
`CEO-HEAD + foreman-commit(s)`; integrate by cherry-picking the foreman commit(s)
(§4).

## Depth-0 control loop (owned by the CEO, NOT the foreman)

The control loop is enforced at **depth 0** — the child cannot be trusted to
police its own budget (fox/henhouse, Round-2 Ops 🔴 fix). The CEO wraps the
foreman dispatch in a guard it owns:

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
| `precondition_failed` | Fall back to `--solo` (the foreman could not start; run inline). For `/l5` this is a `dispatch-hetero.sh` JSON status; for native `/l4` it is any `Agent()` call failure (a tool error, not JSON). |
| `killed` (budget cap — CEO state, not a script status) | Escalate (see §1). |

### 3. qc@depth-0 is THE gate

The foreman runs dev-flow → finish-flow, which has its **own** L-5 qc. That qc is
explicitly **first-pass / non-authoritative**. The single **authoritative** gate
is a **depth-0 re-dispatch** of the qc verdict that reads the foreman's
**artifacts** (the branch diff), per blind-dispatch clause 1
([`references/blind-dispatch.md`](../../../references/blind-dispatch.md)). Not two
real gates — one gate (depth 0) + one self-check (foreman). The run-summary ledger
(below) must show the depth-0 gate **distinct from** the foreman's first-pass qc.

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

- For the `/l5` agy path, the worktree path is in the outcome JSON (`worktree`
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

## Run-summary ledger

The foreman returns — and the CEO records in the final CEO Report — a ledger with
one row per step:

| step | runner | model | verdict | artifact |
|------|--------|-------|---------|----------|
| plan | claude | (foreman tier) | n/a | (plan doc / inline) |
| impl | claude \| agy | sonnet \| Gemini 3.5 Flash | committed | `<branch>@<sha>` |
| foreman first-pass qc | claude | (foreman tier) | pass (non-authoritative) | (qc notes) |
| **depth-0 qc (authoritative)** | claude | (depth-0 tier) | **pass/fail** | `git diff <base>..<branch>` |

- **`runner`/`model` provenance** for the impl step comes straight from
  `dispatch-hetero.sh`'s outcome JSON (`runner`/`model` fields) for the `/l5`
  path, or is `claude`/`<worker tier>` for the native `/l4` path.
- The ledger makes success criterion #3 (depth-0 gate distinct from first-pass)
  and #6 (provenance present) verifiable from the report alone.

## Gotchas

- **New skills aren't dispatchable until a Claude Code restart** — the plugin
  caches skills at session start. After adding `/l3 /l4 /l5`, restart before the
  dogfood run.
- **Worktree base = `origin/develop`, NOT the CEO's HEAD.** See the canonical
  treatment + the base-currency STEP-0 decision table under "Dispatching the
  foreman" above. Short form: independent task → clean develop base is fine;
  build-on-un-merged-CEO-work → foreman STEP 0 = `git reset --hard <CEO-HEAD-sha>`
  (shared objects), verify a sentinel, STOP on failure; integrate via cherry-pick (§4).
- **`git worktree prune` alone is a no-op** on an on-disk worktree — `remove
  --force` first.
- **Cross-platform**: `/lN`, `Agent(run_in_background)`, `TaskStop`, and `Monitor`
  are Claude-Code-deep. On other agents the front-door degrades to `--solo`
  (inline CEO) — the offload is the part that needs the CC primitives.
