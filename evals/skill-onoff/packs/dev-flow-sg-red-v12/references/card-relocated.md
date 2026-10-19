# Relocated judgment prose (contract-card form of dev-flow SKILL.md)

Each section was moved verbatim from the pre-card SKILL.md; the card keeps a pointer at the original spot.


<a id="ladder-probe-terms"></a>
## Ladder probe — choosing `--terms`

(omitted ⇒ `~/.autopilot/ladder/<repo-hash>.jsonl`). Terms are the things the design depends on that you would have to
look up or verify before relying on them: unfamiliar libraries, internal modules you have not read, external services,
protocols or formats you are not certain about. A zero-hit term is novelty, so omit dependencies you can use confidently
from your own knowledge (standard library, mainstream platform APIs — they live outside the repo and miss by
construction) and never name what the task will create (a new command, flag, file or feature name). Nothing qualifies

<a id="drift-signals"></a>
## Drift signals (implement)

| Drift signal | Response |
|--------------|----------|
| "This unit has low ROI, skip it" | STOP — does it affect the final goal? |
| "We can do this later" | STOP — any hidden dependencies? |
| "Project is basically done" | STOP — has the final goal been achieved? |
| "User probably just wants..." | STOP — ask and confirm directly |

<a id="background-wait-rule-rationale"></a>
## Background Wait Rule — rationale

A turn must NEVER end waiting only on a background-task notification: Claude Code delivers subagent completion
notifications best-effort and drops them in practice (2026-09-02: 29 of 63 never arrived).

<a id="completeness-principle"></a>
## Completeness Principle


Complete (all edge cases, full test coverage, proper error handling) beats shortcut (happy path only) — always
choose complete, for tests, error handling, edge cases, docs and features alike.

<a id="anti-patterns"></a>
## Anti-patterns

| Wrong | Correct |
|-------|---------|
| `--size M!` or `!M` | `--size M --urgent`; `!` is written after the letter in prose only |
| Copying a node sequence into a plan or prompt | Cite `stage-graph.js nodes`; the JSON is the only definition |
| Retrying the refused `--to` after exit 3 or 4 | Exit 3: a `legal_next` node. Exit 4: bump, then `next` from the current stage |
| `for n in …; do stage-advance --to $n`, `--to <node> >/dev/null && <work>` | One call per node, its output read before the work (Stage protocol) |
| Skipping `verify`, `code-review` or `finish` because the change is small or already committed | The size chose the nodes; the walk ends at `finish` |
| Searching or researching before `session-mode.js set` | Session Start step 1 comes first |
| Stopping because research found no answer | Record the open unknown as an assumption and advance to `proposal` |
| Leaving `intent` without the ladder probe "because nothing is unknown" | Run `classify` anyway (Entry gate 7); its `U0` is the answer |
| Reading `recommend: none` as "no unknown" and skipping `research` | `eligible_max` above `U0` ⇒ `research`; `none` only says the rung is skipped |
| A delegated commit task that says only "commit changes" | It names the gate that runs before the commit |
| Sizing a bug L because it crosses 3 modules, or S while its cause is unlocated across several | Size the fix's footprint: a cause across several modules is at least M; L only for design / multi-phase work |
| `--terms` naming what the task will create, or a dependency you can use from your own knowledge | Terms are only what you would look up first; both miss the repo by construction and fake novelty |
| Raising the size for a risky change | Risk raises review strength, not size |
| Ask "continue?" after a unit | Proceed directly to the next unit |
| Re-sizing on context continuation | Use the marker's size; only the E1 bump moves it |
| Skipping the skill-routing or finish parent TaskCreate "because I remember" | The task IS the forcing function — memory is what keeps failing |
| Reading a skill file instead of invoking it | Read ≠ invoke: the Skill tool loads it and records the decision |
| Unit tasks without `blockedBy=[Skill routing]` | The dependency is the mechanical enforcement |
| Enumerating units before the Scope Completeness Audit | The audit decides which units exist |
| Inlining finish-flow steps or batching its sub-tasks | Invoke finish-flow; each sub-task is its own TaskCreate |
| Scope expansion without Board approval | Doubled estimate or new subsystem = Board decision, never CEO-tactical |
| Defer work that affects the final goal | Never defer goal-critical items |
| Force knowledge extraction when nothing happened | Skip — do not force it |
| Auto-execute context reduction without confirmation | List the operations with numbered choices |

<a id="capability-adaptive-compatibility"></a>
## Capability-adaptive compatibility

This skill remains the canonical guided compatibility path. When a verified profile session is
active, the host retains the full task graph, checklist, completed history, and future slices, then
sends the worker only the current six-field active slice plus its matching envelope and role grant.
A late profile/grant change requires a fresh-session handoff and never edits the project default.
The `profile-session.js` lane is a no-effect isolation probe, not an effectful handoff gate;
rehashable artifacts, same-process observations, and caller-authored traces cannot qualify one.

<a id="available-scripts"></a>
## Available Scripts

| Script | Purpose |
|---|---|
| `scripts/session-mode.js` | `set --size <XS\|S\|M\|L\|XL> [--urgent] [--bug]` creates or merges the session marker (size moves only up); `status` prints it. Session Start step 1. |
| `scripts/stage-graph.js` | Queries the canonical graph: `nodes`, `next --from`, `limits`, `validate`. Read the sequence and the next node here, never from prose. |
| `scripts/stage-advance.js` | Records entry into a node; refuses illegal moves (exit 3, `legal_next`) and requests the E1 size bump (exit 4, `bump_to`). Called on entering every prose-written node. |
| `scripts/check-stage-vocab.js` | Finds old stage ids, old size names and removed marker fields in shipped text; `--repo <consumer>` lists stale lines in a consumer's `.claude/*.md` and backlog with their replacement. |
| `scripts/mission-routing-admission.js` | Resolve project Mission policy and admit the authoritative bounded graph/source coverage before L/XL TaskCreate or execution topology effects. |
| `scripts/mission-execution-graph-check.js` | Validate graph limits, exact source/rubric coverage, critical path, batches, gate attempts, aggregate reservations, and ICC campaign projection bounds. In a repo with a codex mirror, pass `--mirror-roots <(scripts/sync-codex-plugin-skills.sh --mirror-roots-json)` so an `output_paths` entry under a mirrored dir must name its mirror too. |
| `scripts/plan-rubric-scaffold.js` | Generate structured rubric markdown skeletons from an input plan document for frozen review rubrics. |
| `scripts/hetero-review-loop.js` | Drive multi-seat review collection, disposition aggregation, verdict synthesis, and opt-out receipts for review loops. |
| `scripts/check-phase-review-receipt.js` | Validate review receipts against git history and review artifacts or validate plan artifact blocker dispositions. |
| `scripts/probe-unknown.js` | Unknown-escalation ladder probe: `classify` turns refuted hypotheses / loop non-convergence / stall / zero-hit terms / low consensus into one rung recommendation on the U0–U5 ladder (classify never emits U5 — the owner rung is reached only by the caller's own stop); `receipt` appends the ladder row after a rail returns. Call sites: `intent` / `diagnose` and the `plan` consult (this skill), debug step 4, think-tank Step 5, foreman round end. |
