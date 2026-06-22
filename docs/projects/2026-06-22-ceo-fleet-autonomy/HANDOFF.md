# HANDOFF — ceo-fleet-autonomy (resume at Phase 1)

> Self-contained resume note for a FRESH session (post `/clear`). Read this + the plan,
> then continue the L workflow at **P1**. Everything below is already committed.

## TL;DR

- **Branch**: `feat/ceo-fleet-autonomy` (off `develop`). Commits so far: `7a2786c` bootstrap → `10b6cab` P0 spike.
- **Status**: brainstorm → 3-round dialectic review (converged, APPROVE) → L-bootstrap → **P0 spike DONE (PASS)**. Next = **P1** (the build).
- **Plan / design spec**: [`docs/plans/2026-06-22-ceo-fleet-autonomy.md`](../../plans/2026-06-22-ceo-fleet-autonomy.md) — read it first; it's the source of truth (3-round-reviewed).
- **Project README**: [`./README.md`](./README.md) — goal / 6 success criteria / scope boundary / phases / review history.
- **Size**: L. dev-flow context-continuation (don't re-size). Tasks already exist (#1 L-1.5, #2 L-1.6, #3 P0 ✅done, #4 P1, #5 P2+, #6 L-5 finish-flow).

## Resume procedure

1. `git checkout feat/ceo-fleet-autonomy` (confirm on it).
2. Read the plan doc + this README's success criteria.
3. Do **L-1.6 skill routing** (task #2) + finish **L-1.5 scope audit** (task #1) if not done — they gate P1.
4. Execute **P1** (task #4). Then **L-5 = finish-flow** (task #6).

## What's LOCKED (don't re-litigate — these survived 3 review rounds)

- **Foreman = `sub-orchestrator` (depth 1), NOT `manager`** (manager is non-dispatchable, `resolve-dispatch.sh` exit 3, Amendment 11).
- **Depth-2 ceiling**: CEO(0) → foreman(1) → impl/review worker(2). Foreman runs dev-flow phases **INLINE at depth 1**; only impl/review **leaf-dispatch** to depth-2. Depth-3 **escalates, never nests**.
- **qc verdict at depth 0 is THE gate**; the foreman's own finish-flow qc is **first-pass/non-authoritative** (blind-dispatch clause 1).
- **`/l5` ships in v1 with REAL payload** = `/l4` with impl→agy/Gemini (already built in `dispatch-hetero.sh`; Gemini is a verified 2nd engine). NOT a no-op stub. Full routing table + more engines (codex/grok/gpt, each a ~10-min smoke test) are deferred.
- **The "Level" front-door is a NEW slash-command namespace** layered over the existing CEO Involvement enum (1/2/3 = every-step/phase/just-results, `ceo-agent/SKILL.md:159-166`). It does NOT redefine the old term.
- Deferred (gated, NOT in v1): full `role×task-type` routing table; codex/grok/gpt; tree-engine coordinator (gated on graduation, 3/50 samples); multi-node fleet + autonomous poll/wake.

## P0 spike result (PASS) — the control-loop mechanism P1 builds on

Empirically verified (real background sub-orchestrator dispatched + force-killed mid-run):
- `Agent(run_in_background: true, isolation: "worktree")` → returns `agentId` (usable as a `TaskStop` task_id).
- `TaskStop <agentId>` **force-kills a mid-run agent** (verified: killed on its 2nd work item; status `killed`).
- Foreman worktree path is **deterministic**: `.claude/worktrees/agent-<agentId>` (created `locked`).
- On kill: **unchanged** worktree **auto-cleans** (no leak); **changed** worktree is **kept** → reap via `git worktree remove --force .claude/worktrees/agent-<id>` + `git branch -D worktree-agent-<id>` + `git worktree prune`.

⇒ Depth-0 control loop = dispatch foreman in background+isolation → note wall-clock (depth-0 timing, `Monitor` can arm the deadline) → at cap `TaskStop` → reap worktree. **`/l4` ships unattended; `--solo` is the fallback, not the default.**

## P1 build list (task #4)

Build the v1 machine + the `/l3 /l4 /l5` front-door:

1. **`/l3 /l4 /l5` sugar** — decide mechanism (Open Q2: 3 thin slash-command skills vs one `/auto`+level vs NL `L<n>` prefix the ceo-agent recognizes). Each pre-fills the 4 CEO startup Qs (OKR from goal; involvement from level; scope=Hold; no-go=none). Overrides: `-x <no-go>`, `--expand`, `--solo`.
   - `/l3` = CEO executes itself (main thread), escalate at DOA boundary.
   - `/l4` = dispatch ONE sub-orchestrator foreman (background + isolation:worktree).
   - `/l5` = `/l4` with impl leaf-dispatched to agy/Gemini.
2. **Foreman behavior** (ceo-agent edits / new ref): runs dev-flow inline at depth 1; leaf-dispatches impl/review to depth-2; returns a **run-summary ledger** (step → runner/model → verdict → artifact).
3. **Depth-0 control loop** (owned by CEO, NOT the foreman — fox/henhouse): wall-clock + round-count **budget** (fail-closed → escalate); **stall detection** = the depth-0 clock tripping; **merge-back owned by depth 0** after qc passes, conflict → rebase-retry-once-else-escalate; **worktree GC** per the P0 mechanism.
4. **Outcome→action table** (foreman): committed→continue; no_op→verify-scope-then-done-or-retry-once; dirty/failure/question_suspected→escalate; precondition_failed→`--solo` fallback. (Outcomes are `dispatch-hetero.sh`'s set.)
5. **qc@depth-0**: re-dispatch the authoritative qc verdict from depth 0 reading artifacts.
6. **Engine provenance**: add a `runner`/`model` field to `dispatch-hetero.sh` outcome JSON (`:75`, one field from `$MODEL` `:58`) + the run-summary ledger. Doc-sync touch: `references/hetero-dispatch.md` + CLAUDE.md script inventory.
7. **Budget primitive**: rounds + wall-clock ONLY in v1 (token-estimate deferred — Open Q3).

### Verify P1 against the 6 success criteria (in README "Project Goal")

A dogfood `/l4` run showing: clean depth-0 gate distinct from foreman first-pass; budget-hit → escalate; no worktree leak; provenance in the ledger.

## Gotchas

- Worktree base ≠ HEAD (STEP-0 merge bootstrap if a dispatched agent must build on your latest) — see memory `worktree-dispatch-gotchas`.
- `git worktree prune` alone is a no-op on an on-disk worktree — must `remove --force` first.
- `dispatch-hetero.sh` NEVER merges (branches off pinned `$BASE_SHA`); merge-back is the caller's (depth-0's) job.
- New skills aren't dispatchable until a Claude Code restart (plugin caches at session start) — plan runtime dogfood accordingly.
- **L-5 finish-flow** includes the version bump (v2.21.0?) + CHANGELOG + README badge/count sync + `preflight-release.sh`. `check-readme-parity.js` (preflight #15) now gates EN↔zh README parity — keep zh-TW in sync.
