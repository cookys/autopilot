# Plan — parallel READ/analysis fan-out (fix team's cap-3 conflation; NOT parallel code-mutation)

> **Status**: PROPOSED (via `research-to-ship`, 2026-06-04, after 3 research rounds + an empirical
> git-worktree spike). **Size**: small (Fix/S — mostly `team` skill + dispatch-config + doc).
> **Branch**: `feat/parallel-read-fanout` off develop when approved.

## 0. Thesis (what 3 research rounds + the Board's experience converged on)
autopilot's genuinely-parallelizable *recurring* LLM work is **structurally thin**, and the one thing that
makes parallel **code-mutation** unattractive is real: **merge-back conflict-resolution cost > the
wall-clock saved** (Board's field experience; confirmed by the worktree spike — disjoint files merge
clean, but overlapping files conflict per-pair and you can't reliably guarantee disjointness up front).

So the line is drawn by **"does the parallel work write back to shared files?"**:
- **READ / analysis / report-producing fan-out** (audit segments, parallel review dimensions,
  multi-perspective research) — results are **collected/synthesized**, never merged into shared files →
  **zero merge-back, zero conflict → SAFE and worth it.**
- **Parallel code-mutation** (worktree-per-unit edits) — merge-back conflicts cost more than saved →
  **explicitly NOT adopted.**

The actual bug blocking the safe case: **`team` conflates two regimes** and caps both at 3.

## 1. The regime bug (the core finding)
`team/SKILL.md:54` caps teams at 3 with rationale **"coordination cost exceeds parallelism benefit
beyond 3"** — i.e. the cost of agents **messaging/coordinating**. But the skill applies this cap
uniformly, with **no carve-out** for **independent fan-out** (disjoint units, zero inter-agent messaging,
results merely collected). For read/analysis fan-out there is **no coordination cost** — so the cap-3
rationale does not apply, yet the skill forbids it. Concretely this **caps `audit` Phase 2 at 3 when it
declares 5 independent segments** (`skills/audit/SKILL.md:37`).

## 2. OKR / KRs
**Objective**: let autopilot fan out **independent read/analysis units** to N (bounded), while keeping the
cap-3 discipline for genuinely collaborative teams — and explicitly rule out parallel code-mutation.

- **KR1** — `team` distinguishes two regimes: **(a) collaborative team** (agents coordinate/share state) →
  **cap 3** (coordination cost, unchanged); **(b) independent read/analysis fan-out** (disjoint units,
  zero coordination, results collected) → **cap = unit count, bounded ~8–10 concurrency** (the practical
  Claude-Code sweet spot from research; Amdahl + rate limits).
- **KR2** — The independent-fan-out regime is gated on **"produces findings/reports, does NOT write back
  to shared files"**. If a unit would mutate shared files → it is NOT this regime (fall back to the
  collaborative/sequential path + the existing file-overlap gate).
- **KR3** — `audit` Phase 2 is freed to fan out all its segments (5, not capped at 3).
- **KR4** — **Explicit non-goal documented**: parallel code-mutation via git worktree is NOT adopted;
  record the reason (merge-back conflict-resolution cost; can't guarantee file-disjointness up front) so
  it isn't re-proposed. The empirical spike (worktree setup ~7ms but overlap = per-pair conflict) is cited.
- **KR5** — `workflow:parallel` added to the `## Parallel Dispatch` chain as a **capability-gated CC
  enhancement** for the read-fan-out (structured collection, the deterministic loop, background run);
  **native multi-Task fallback** unchanged for non-CC agents. No `team` logic depends on it (dispatcher's
  job, per the existing separation).

## 3. Design
- **`skills/team/SKILL.md`**: add the regime distinction + the "writes-to-shared-files?" gate; reword
  "Cap at 3" to "Cap collaborative teams at 3; independent read/analysis fan-out scales to unit count
  (≤~8–10)". Add the explicit non-goal (no parallel code-mutation) with the rationale.
- **`skills/team/references/team-tactics.md`**: the existing File Overlap Check (`:23-33`) becomes the
  regime selector — *None* overlap + read/report output → independent fan-out (cap N); any shared **write**
  → collaborative/sequential. Keep the conflict gate exactly as the reason mutation-fan-out is excluded.
- **`skills/audit/SKILL.md`**: note Phase 2 segments fan out to segment-count (not 3).
- **`.claude/dispatch-config.md` + `project-config-template/dispatch-config.md`**: add `workflow:parallel`
  before `native` in `## Parallel Dispatch`.
- **`references/multi-agent-portability.md` §7**: add `workflow:parallel` as a capability-gated primitive
  (like `/goal`, `Monitor`), native multi-Task fallback documented.

## 4. Explicitly OUT of scope (focus-as-subtraction)
- **Parallel code-mutation / worktree-per-unit edit fan-out** — KR4; the merge-back conflict cost is the
  dealbreaker. (If ever revisited, the trigger is a real workload of *large, provably file-disjoint,
  long-running* edits — not the typical small overlapping diff.)
- **A new "Workflow army" orchestration skill** — the mechanism (team + native multi-Task) already exists;
  this plan fixes a conceptual cap, it doesn't build an engine.
- **Parallelizing the deterministic scripts** (sync-version, preflight, validate) — sub-3s already; Amdahl
  says no point.
- **Parallelizing across the intentional methodology gates** (dev-flow L-1.6, quality-pipeline
  test→scan→review, finish-flow sequence) — those gates are the value, not inefficiency.

## 5. Phases (dev-flow sizes)
- **P0 — team regime split + non-goal doc (size: S)**: the `team` SKILL.md + team-tactics.md edits; the
  explicit no-mutation-fan-out rationale. The load-bearing change.
- **P1 — audit unlock + dispatch entry (size: Fix)**: audit Phase 2 cap note; `workflow:parallel` in both
  dispatch-config files; §7 portability row.
- **P-final — release (size: Fix)**: quality-pipeline self-review → validate → finish-flow (minor bump —
  new capability gating + a methodology regime).

## 6. Test / validation
Mostly doc + config — `scripts/validate.sh` (skills still valid) + `preflight-portability.sh` (dispatch
chain parses, fallback intact). No new deterministic script. Honest boundary: the *judgment* of "is this
work independent + read-only" is human/orchestrator-gated, not testable.

## 7. Risks + inversion
- **Mis-classifying mutating work as read-only fan-out** → parallel agents unexpectedly write shared files
  → the conflict cost KR4 avoids. Mitigation: KR2's gate is "produces findings/reports, no shared write" —
  if in doubt, it's NOT independent fan-out. The file-overlap check stays mandatory.
- **Inversion (what guarantees failure?)**: fanning out to N with no concurrency cap → rate-limit/cost
  blowup. Mitigation: bound ~8–10 (research-backed), `log()` the fan width.
- **Thin-slice risk**: if audit-segment + parallel-review is the only real consumer, is even this worth it?
  → It's cheap (doc + config), unblocks a real capped case today (audit), and the cap-3 conflation is a
  genuine conceptual bug worth fixing regardless. Low cost, bounded upside — acceptable.

## 8. Open questions — Board only
1. Concurrency cap: hard ~8–10, or configurable in `.claude/`? (Recommend a documented default of 8, no
   config knob until asked.)
2. Should `workflow:parallel` go in the shipped `.claude/dispatch-config.md` (autopilot's own) by default,
   or only in the template? (Recommend template + a commented example; don't flip autopilot's own default.)

## Review log
- **R0 (research-to-ship Phases 1-2)**: 2026-06-04. Three research rounds (parallel-orchestration survey +
  skeptic + internal map; worktree empirical spike; 4-way parallelizable-work inventory) + the Board's
  field insight that worktree merge-back conflict cost is the dealbreaker for parallel mutation. Thesis:
  parallelize read/analysis fan-out (fix team's cap-3 conflation); explicitly exclude parallel
  code-mutation.
- **R1 (light dialectic, Architect/Ops/Skeptic)**: 2026-06-04. → **DESCOPE to a ~3-line edit.**
  - **Skeptic (decisive, empirically grounded)**: 🔴 the cap-3 does **not bind audit** — `audit/SKILL.md:37`
    "Spawn one agent per segment" has zero team/TeamCreate/cap-3 reference; audit fans out freely today.
    KR3 "unlocks" a non-binding cap. 🟠 audit-segment is the only consumer and it's already free;
    `workflow:parallel` is dead config (no opt-in consumer). 🟡 the real value = the KR4 non-goal record.
  - **Architect**: 🔴 KR2's "will it write?" gate isn't decidable pre-dispatch → reframe to *imposing* a
    read-only task contract; 🟠 read-only fan-out makes the File Overlap Check vacuous → add an
    "output-only → overlap N/A" row, don't repurpose the table.
  - **Ops**: 🔴 the ~8 cap is prose not enforced; 🟠 fan-out hides partial failure → assert
    collected==dispatched. (Both fold into the team-size prose since we descoped the engine.)
  - **CEO synthesis + decision**: SHIPPED as a ~3-line clarification, not the full plan —
    (1) `skills/team/SKILL.md` Team Size Rules: cap-3 governs *collaborative coordination*, NOT
    independent read-only fan-out (which isn't a team, bound ~8, assert collected==dispatched —
    folds in Architect's read-only-contract + Ops's loud-failure points);
    (2) `team-tactics.md` File Overlap Check: an **output-only** row (Architect's fix) + the **non-goal**
    that parallel code-*mutation* via worktree is not adopted (merge-back conflict cost; disjointness
    unpredictable — the Board's field insight, the real takeaway of this whole exploration).
    **Dropped** (per Skeptic): audit-unlock (non-binding), `workflow:parallel` dispatch entry (dead),
    the team-tactics regime rewrite, the §7 portability row, the engine. This plan doc is retained as
    the research + descope record.
