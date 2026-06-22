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
| P1 v1 machine + sugar | ✅ **Built + dogfooded** (2026-06-22) — `/l3 /l4 /l5` skills + `level-front-door.md` (foreman + depth-0 control loop + outcome→action table + qc@depth-0 + run-summary ledger); `dispatch-hetero.sh` `runner`/`model` provenance; ceo-agent wired; release surfaces synced (v2.21.0, skills 20→23); all 16/16 preflight checks pass. **P1.f dogfood PASS — 6/6 criteria** (all three `/lN` exercised; criterion 6 retains one documented caveat: e2e provenance flow-through, see below). | `e96998d` (/l4) + `b274439` (/l5) |
| P2+ deferred | ⬜ Gated | — |

### P1.f dogfood result (2026-06-22) — 6/6 criteria (criterion 6 retains one documented caveat)

Three real dispatched runs at depth 0 (this session, post-`/clear` = the clean-state test):

- **`/l4`** (all-Claude) on goal *"add dispatched-subagent return contract → `team-tactics.md`"*: foreman (`aaa9be74…`, opus, bg+worktree) ran dev-flow inline, leaf-dispatched impl+review to depth-2 Claude workers, committed; depth-0 ran the **authoritative qc** (sonnet reviewer) reading the branch diff → pass; cherry-picked → `e96998d`; worktree reaped. ~105s.
- **`/l5`** (hetero) on goal *"`resolve-doa.sh` preset-column allowlist symmetry"*: foreman (`a137d1d6…`, opus, bg+worktree) leaf-dispatched impl to **Gemini 3.5 Flash (High)** via `dispatch-hetero.sh` → committed (`8fa6a96`, +8/-2); depth-0 authoritative qc (sonnet, **adversarial** — injection/quoting/condition-sense) → pass; cherry-picked → `b274439`; all worktrees reaped. ~7min.
- **criterion-4 micro-test** (`ae9239de…`): deliberate 75s cap on a slow read-only foreman → `Monitor` guard fired → `TaskStop` force-killed it **mid-work** (status `killed`) → escalated (fail-closed, not silent) → worktree auto-cleaned.
- **`/l3`** (inline, follow-up 2026-06-22): invoked on a clean goal (this README's criterion-2 update) — front-door loaded, pre-filled the 4 startup Qs (involvement=3 / scope=Hold / no-go=none), executed **inline with no Q&A round**. Closes criterion 2 for the inline path.

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | depth-0 wall-clock-kill spike | ✅ | P0 (prior session) + re-confirmed by the micro-test kill |
| 2 | `/lN` invokable, pre-fills 4 startup Qs on a clean goal | ✅ | all three exercised on clean goals with **no Q&A** — `/l4` + `/l5` on a fresh `/clear` session; **`/l3` directly dogfooded** (this follow-up: loaded inline, pre-filled involvement=3/scope=Hold/no-go=none, executed without a startup Q&A round) |
| 3 | foreman depth-1 → impl/review leaf-dispatch depth-2; authoritative qc **re-dispatched at depth 0**, distinct from foreman first-pass | ✅ | both ledgers show foreman first-pass (non-authoritative) **and** a separate depth-0 reviewer verdict |
| 4 | depth-0 budget cap, fail-closed → escalate | ✅ | micro-test: cap hit → `TaskStop` → `killed` mid-work → escalate; not a silent stall |
| 5 | no worktree leak | ✅ | after every run `git worktree list` = main only; `/l4` reaped via `remove --force`, `/l5` foreman + micro-test auto-cleaned, hetero `/tmp` worktree auto-removed on success |
| 6 | provenance `runner`/`model` per step | ✅ (with caveat) | `dispatch-hetero.sh:76/83` emits `runner`/`model` on the **shipped** branch; ledger records per-step provenance. *Caveat below.* |

**Key finding — worktree base ≠ CEO HEAD (sharper than documented).** `Agent(isolation:worktree)` branches the foreman off the **tracked base (`develop`)**, not the CEO's checked-out feature-branch HEAD. Two consequences observed empirically:
1. Merge-back had to be a **cherry-pick of the isolated commit**, not a branch merge (a two-dot `diff` showed phantom deletions of the absent P1 work). Clean only because both target files were byte-identical across `develop` and the feature HEAD.
2. The `/l5` foreman ran the **pre-P1 `dispatch-hetero.sh`** (develop's copy, which lacks the `runner`/`model` JSON fields), so criterion-6 provenance came from the script default + agent log rather than flowing through the JSON. **Criterion 6 holds on shipped code**, but the e2e flow-through can't be exercised by a foreman until the P1 work is on `develop` — i.e. it bites **self-referential changes** (modifying the very tooling the foreman runs). `level-front-door.md` already documents the gotcha + the STEP-0 merge-bootstrap remedy; the dogfood confirms it and pins down this self-reference edge. → candidate BACKLOG: optional STEP-0 base-bootstrap (build foreman worktree on CEO HEAD) for `/l4`/`/l5`.

## Review Loop History

- **Brainstorm** (2026-06-22): converged the 3 forks (axis-coupling, primitive, parallel-impl) + 2 user additions (fleet role assignment, invocation sugar). Design = 3 orthogonal axes (WHAT/WHICH/HOW-MUCH), SAE-style front-door, foreman=sub-orchestrator.
- **Dialectic review** (Architect/Ops/Skeptic, 3 rounds):
  - R1: all NEEDS_REWORK — over-designed ahead of unverified foundations (foreman=manager impossible; "split conflated Level" premise fabricated; routing table over-built; unattended had no control loop). Verified true against repo.
  - R2: big errors fixed (foreman→sub-orchestrator, premise corrected, routing cut/gated, tree-engine removed from v1, control-loop added). Architect APPROVE_WITH_CHANGES (inline-vs-dispatch), Ops NEEDS_REWORK (depth-0 enforcement / merge-back / GC), Skeptic APPROVE_WITH_CHANGES (cut /l5).
  - **User correction**: `/l5` is NOT blocked — agy=Gemini is an already-verified 2nd engine, so `/l5` ships with real payload (impl→Gemini). The Skeptic's "one engine" framing was wrong; spike shrinks to per-engine smoke tests for NEW engines.
  - R3: Architect **APPROVE**, Ops blockers **cleared**. Remaining = plan-phase mechanism + the P0 spike (depth-0 kill primitive) — both reviewers flagged it convergently.
