# P0 step 1 + 3 — semantic inventory of assessment and QC invocations

> Plan P0 step 1: inventory every invocation of think-tank, dialectic, engine review, quality
> review, and depth-0 QC; classify each as `decide` / `counsel` / `repair` / `challenge` / `verify`
> and name its current authority.
> Plan P0 step 3: *"Count a mandatory model-review dispatch only when omitting it violates a red
> line, required challenge, or acceptance policy. Report optional counsel and repair separately."*

## Method

Source-level read of the named surfaces (`skills/quality-pipeline/`, `skills/ceo-agent/` incl.
`references/level-front-door.md`, `skills/l3`–`l6`, `skills/think-tank*`, `agents/reviewer.md`,
`src/engine/autopilot-engine.js`, `scripts/dispatch-review.sh`, `scripts/resolve-review-loop.sh`,
`hooks/`, `.githooks/pre-push`). Every row is anchored to a file:line actually read. One site that
could not be resolved from source is flagged `unclear` rather than guessed.

## The headline number the plan actually needs

KR8 and KR9 are stated in terms of **mandatory model-review dispatches** — *"one whose absence
violates a red line, required challenge, or acceptance policy; optional counsel and repair are
reported separately and never counted as mandatory."*

That definition selects a much narrower set than "mandatory QC steps", and conflating them would
silently inflate the denominator that KR8's *"at least 30% fewer"* is measured against:

| Baseline | Count | What it is |
|---|---:|---|
| **Mandatory model-assessment dispatches** | **6** | `challenge`/`decide` purpose, dispatched to a model, omission violates policy. **This is the KR8/KR9 denominator.** Split below — 5 gating-authoritative + 1 mandatory-to-run but advisory. |
| Mandatory QC steps (all kinds) | 28 | Includes deterministic `verify` scripts and hooks |
| Optional / advisory-only | 8 | Counsel and repair — reported separately, never counted as mandatory |
| Unclear (flagged, not counted) | 1 | `spec_review` |
| **Total classified sites** | **37** | |

### The 6 mandatory model-assessment dispatches

| Site | Surface | Purpose | Authority |
|---|---|---|---|
| `skills/quality-pipeline/references/code-review.md:66-89`; `agents/reviewer.md` | quality-pipeline reviewer | `challenge` | gating — Critical/Major block commit; red line *"Every commit/merge requires code review. No exceptions."* |
| `level-front-door.md:488-546` | depth-0 qc | `challenge` | gating — *"qc@depth-0 is THE gate"* |
| `level-front-door.md:489-491` | foreman's own finish-flow pass | `challenge` | advisory — explicitly *"first-pass / non-authoritative"*, but still required to run |
| `level-front-door.md:510-526`; `dispatch-review.sh` | disjoint-family qc panel | `challenge` | gating — union-on-verified-critical veto (`/l5`,`/l6`) |
| `src/engine/autopilot-engine.js:1104-1490` (`reviewDiff`) | engine implement-review loop | `challenge` | gating — verdict drives continue/rework (`/l5`,`/l6`) |
| `src/engine/autopilot-engine.js:274-380,1230-1394` | family-conflict roster resolution | `decide` | gating — blocks in `block` mode, substitutes reviewer in default `fallback` mode |

**This distinction matters for P1 and should be carried into the plan.** A future claim of "30%
fewer mandatory dispatches" measured against 28 rather than 6 would be measuring mostly
deterministic scripts the plan explicitly commits to preserving — the reduction would be real on
paper and meaningless in substance.

### An ambiguity inside the 6, surfaced by independent review

Row 3 — the foreman's own finish-flow pass — is marked **advisory** (*"first-pass /
non-authoritative"*) yet counted in the mandatory 6. An independent reviewer flagged this as
self-contradictory. It is not, but the plan's wording lets it read that way, so both readings are
recorded rather than one being silently chosen:

- The plan defines mandatory by **omission**: *"one whose absence violates a red line, required
  challenge, or acceptance policy."* The foreman's pass is required to run, so its absence violates
  policy — **mandatory = 6**.
- If instead one counts only dispatches whose **verdict carries gate authority**, the foreman's
  non-authoritative pass drops out — **mandatory = 5**.

**P1 must state which definition KR8 uses before any reduction is claimed**, because the choice
moves the denominator by 17% on its own. **[INF]** The omission-based reading (6) is the more
faithful to the plan's literal text; the authority-based reading (5) is the more faithful to its
intent, since KR8 is about ceremony reduction and a mandatory-but-advisory pass is exactly the
ceremony being targeted. This is a Board/plan-authoring decision, not a foreman one.

## Purpose distribution across all 37 sites

| Purpose | Count | Note |
|---|---:|---|
| `verify` (deterministic) | 24 | Scripts/hooks producing executable evidence — the plan keeps `verify` outside the review-purpose enum, and the inventory supports that: these are not model assessments |
| `challenge` | 8 | Of which 5 are gating; the foreman's own pass is explicitly non-authoritative |
| `counsel` | 3 | think-tank, think-tank-dialectic, codex peer consult — all advisory, none gating |
| `decide` | 1 | Family-conflict roster resolution |
| `repair` | 0 | **No site currently occupies the `repair` purpose** |
| `unclear` | 1 | `spec_review` |

### Three observations that bear on the plan

1. **`repair` has no existing occupant.** The plan introduces `counsel` / `repair` / `challenge` as
   *"three non-overlapping purposes"*, but the current codebase has nothing to migrate into
   `repair`. It is a new capability, not a reclassification — so it adds surface rather than
   reorganising it. This is consistent with the surface-count rise recorded in
   [`surface-baseline.md`](surface-baseline.md).

2. **Counsel is already advisory everywhere.** think-tank (`skills/think-tank/SKILL.md`),
   dialectic, and the codex peer consult (`level-front-door.md:388-394`, explicitly *"never
   substitutes qc@depth-0 or merge authority"*) are already non-gating. The plan's P2 step 8
   ("think-tank becomes optional counsel") is therefore **already true in practice** — it
   documents the status quo rather than changing authority.

3. **Self-review is already excluded from acceptance.** The foreman's own finish-flow
   quality-pipeline pass is already marked non-authoritative, with depth-0 qc holding the gate.
   The plan's *"owner self-review never transfers acceptance authority"* invariant has a working
   precedent to build on.

## The one unresolved site

`scripts/resolve-review-loop.sh:31,256,884,969,980` emits a `spec_review` roster field, but no
branch in `src/engine/autopilot-engine.js` was found reading `roster.spec_review` to gate anything.
It is defined and plumbed but appears to have no consuming gate. Recorded as `unclear` rather than
counted in either direction; it needs owner confirmation. **[INF]** If it is genuinely unconsumed,
it is a candidate for the deletion manifest that `surface-baseline.md` says P3 needs.

**Resolution path** (required before any KR8 baseline is treated as final):

```bash
# 1. Confirm no runtime consumer reads the field.
grep -rn "spec_review" src/ scripts/ hooks/ bin/ --include=*.js --include=*.sh

# 2. Confirm it is emitted by the resolver and present in the contract schema.
scripts/resolve-review-loop.sh --field spec_review
grep -n "spec_review" schemas/review-loop-contract.schema.json
```

Outcome rule: a field emitted and schema-declared but read by nothing is **dead contract surface** →
add to the P3 deletion manifest. A field consumed by a caller outside the traced set → reclassify
into the inventory with its real purpose and authority, and restate the mandatory count. Until one
of those two holds, it stays `unclear` and outside every count in this document.

## Excluded, and why

`hooks/branch-protection.js`, `hooks/config-protection.js`, `hooks/dispatch-model-guard.js` were
searched and deliberately excluded: they are process/cost guardrails (protected-branch pushes,
config edits, expensive-model dispatch), not quality or correctness assessments of a change.
