# CEO autonomy front-door & dispatched foreman

> **Plan / design spec**: [`docs/plans/2026-06-22-ceo-fleet-autonomy.md`](../../plans/2026-06-22-ceo-fleet-autonomy.md)
> (brainstorm output, converged through 3 rounds of Architect/Ops/Skeptic dialectic review).
> **Branch**: `feat/ceo-fleet-autonomy` · **Target version**: v2.21.0 (tentative)
> **▶ RESUMING?** Read [`HANDOFF.md`](./HANDOFF.md) first — self-contained resume note (P0 done, continue at P1).

## Project Goal

> **Final goal**: A terse CEO front-door (`/l3 /l4 /l5 <goal>`) that offloads plan→impl→qc
> to a dispatched sub-orchestrator "foreman" so the orchestrator's own context stays clean
> and a run can go long **unattended**, with execution worktree-isolated + artifact-verified
> and the authoritative qc verdict held at depth 0.
>
> **Success criteria** (each measurable + how verified):
> 1. **Phase-0 spike** returns a recorded boolean: can depth-0 wall-clock-kill a native-`Agent`
>    foreman (`run_in_background` + `Monitor`/deadline + `TaskStop` + reap its worktree)?
>    Verified by a real dispatch that is force-killed at a cap and whose worktree is reaped
>    (`git worktree list` clean after). PASS ⇒ `/l4` unattended ships; FAIL ⇒ `/l4` degrades
>    to `--solo` (attended) and only the agy/subprocess path gets the guard.
> 2. `/l3`, `/l4`, `/l5` are invokable and pre-fill the 4 CEO startup questions (verified: each
>    runs without re-asking OKR/involvement/scope/no-go on a clean goal).
> 3. `/l4` dispatches ONE `sub-orchestrator` (depth 1) that runs dev-flow inline, leaf-dispatches
>    impl/review to depth-2 workers, and the **authoritative qc verdict is re-dispatched from
>    depth 0** reading artifacts (verified by a dogfood run + the run-summary ledger showing the
>    depth-0 gate distinct from the foreman's first-pass qc).
> 4. **Depth-0 control loop**: budget cap (rounds + wall-clock) enforced at depth 0, fail-closed
>    → escalate (verified by a run that hits the cap and escalates, not silently stalls).
> 5. **No worktree leak**: after any non-success outcome, `git worktree list` shows no orphaned
>    foreman worktree (verified).
> 6. **Provenance**: the run summary records `runner`/`model` per step (verified: ledger field
>    present; `dispatch-hetero.sh` outcome JSON gains the field).
>
> **Scope boundary**:
> - **IN (v1 / Phases 0-1)**: `/l3 /l4 /l5` sugar; single sub-orchestrator foreman; dev-flow
>   inline at depth-1 with impl/review leaf-dispatch at depth-2 (depth-3 escalates); depth-0
>   control loop (budget/kill/stall-detect, merge-back-owned-by-depth-0 with conflict→escalate,
>   worktree GC via `git worktree remove --force`); qc@depth-0; engine provenance; `/l5` =
>   `/l4` with impl→agy/Gemini (already built in `dispatch-hetero.sh`).
> - **OUT (deferred, each behind its own gate)**: full `role × task-type` auto-routing table;
>   additional engines beyond Claude+Gemini (codex/grok/gpt — each behind a ~10-min per-engine
>   smoke test, not one blocking spike); tree-engine as foreman coordinator (gated on its
>   graduation — currently 3/50 samples); multi-node parallel fleet + autonomous poll/wake.

## Phases

| Phase | What | Gate |
|-------|------|------|
| **P0** | **Spike**: depth-0 wall-clock-kill of a native-`Agent` foreman (`run_in_background` + `Monitor` + `TaskStop` + worktree reap) | Result decides whether `/l4` ships unattended or degrades to `--solo` |
| **P1** | `/l3` + `/l4` + `/l5` + the v1 machine (single sub-orchestrator foreman; dev-flow inline depth-1; impl/review leaf-dispatch depth-2; depth-0 control loop; qc@depth-0; provenance; run summary; outcome→action table) | Dogfood run + the 6 success criteria |
| **P2+** | Incremental, each gated: per-engine smoke test → routing-table rows (codex/grok/gpt); full auto-routing table; tree-engine coordinator (post-graduation); multi-node fleet + poll/wake | Each behind its own cheap gate |

## Progress

| Phase | Status | Commit |
|-------|--------|--------|
| P0 spike | ✅ **PASS** (2026-06-22) — depth-0 kill+reap verified empirically (`TaskStop` force-kills a mid-run `run_in_background` foreman; worktree at `.claude/worktrees/agent-<id>`; unchanged auto-cleans, changed → `remove --force`). `/l4` ships unattended. | (this commit) |
| P1 v1 machine + sugar | 🟡 **Built (impl done; dogfood pending restart)** (2026-06-22) — `/l3 /l4 /l5` skills + `level-front-door.md` (foreman + depth-0 control loop + outcome→action table + qc@depth-0 + run-summary ledger); `dispatch-hetero.sh` `runner`/`model` provenance; ceo-agent wired; release surfaces synced (v2.21.0, skills 20→23); all 16/16 preflight checks pass. Dogfood `/l4` (criteria 3-6) needs a CC restart — new skills cache at session start. | (this commit) |
| P2+ deferred | ⬜ Gated | — |

## Review Loop History

- **Brainstorm** (2026-06-22): converged the 3 forks (axis-coupling, primitive, parallel-impl) + 2 user additions (fleet role assignment, invocation sugar). Design = 3 orthogonal axes (WHAT/WHICH/HOW-MUCH), SAE-style front-door, foreman=sub-orchestrator.
- **Dialectic review** (Architect/Ops/Skeptic, 3 rounds):
  - R1: all NEEDS_REWORK — over-designed ahead of unverified foundations (foreman=manager impossible; "split conflated Level" premise fabricated; routing table over-built; unattended had no control loop). Verified true against repo.
  - R2: big errors fixed (foreman→sub-orchestrator, premise corrected, routing cut/gated, tree-engine removed from v1, control-loop added). Architect APPROVE_WITH_CHANGES (inline-vs-dispatch), Ops NEEDS_REWORK (depth-0 enforcement / merge-back / GC), Skeptic APPROVE_WITH_CHANGES (cut /l5).
  - **User correction**: `/l5` is NOT blocked — agy=Gemini is an already-verified 2nd engine, so `/l5` ships with real payload (impl→Gemini). The Skeptic's "one engine" framing was wrong; spike shrinks to per-engine smoke tests for NEW engines.
  - R3: Architect **APPROVE**, Ops blockers **cleared**. Remaining = plan-phase mechanism + the P0 spike (depth-0 kill primitive) — both reviewers flagged it convergently.
