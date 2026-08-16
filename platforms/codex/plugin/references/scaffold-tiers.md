# Scaffold tiers — capability-indexed dispatch scaffolding

**Canonical home for tier definitions and prompt skeletons.** Other docs
(`references/four-layer-design.md`, skills) link here; they never restate the tables or
skeleton text (no second canonical statement). Consumed mechanically by
`scripts/resolve-scaffold-tier.js` (tier resolution) and `scripts/dispatch-hetero.sh`, which
wraps the caller's `--prompt-file` with the tier skeleton ONCE, in the shared assembly before
the per-runner branches — every runner (codex/grok/cc-shim/agy/pi/qoder) consumes it
identically. Disable per project with dispatch-config `scaffold_tiers: off`.

Rationale (survey-bound, `docs/plans/2026-08-16-four-layer-redesign-survey.md`): scaffold
weight is not flatly good or bad — it is capability-indexed. Terminal-Bench 2.0: model swap
+52pp vs scaffold swap +17pp (scaffold matters less at the margin as capability rises, but not
zero); SWE-bench lineage shows opposed scaffold philosophies converging in one band once the
model is capable enough; over-scaffolding a capable engine dampens it, under-scaffolding a weak
one collapses accuracy.

## Tier definitions

| Tier | Condition (evaluated by `resolve-scaffold-tier.js`) | Prompt envelope |
|---|---|---|
| **T0** | Qualified for THIS role with **fresh, complete** evidence (within the freshness cutoff; all role dimensions covered) | contract-only |
| **T1** | Qualified for this role with **fresh but partial** evidence (within cutoff; some role dimensions missing) | contract + obligation checklist |
| **T2** | **Everything else** — unqualified, unknown engine, STALE evidence (past cutoff), or conflicting records | full prescribed process |

Fail-closure rule: any doubt resolves DOWNWARD (more scaffolding). T2 is the default; tiers are
earned by evidence, never assumed from a model's reputation or family. **Explicit overrides may
only ADD scaffolding**: `--scaffold-tier` accepts a tier at or below the resolved capability
(= equal or MORE scaffolding); requesting less scaffolding than resolved is rejected —
fail-closure applies to humans too.

Evidence inputs and precedence:
1. `engine-capability-state` (live qualification state) — authoritative;
2. scorecard telemetry — supporting;
3. imported model-level priors (e.g. AA imports) — advisory only, can never lift above T2 alone.

Freshness cutoff: the qualification record's own TTL/expiry field; records without an expiry are
treated as stale (fail-closed). Conflicting records (two sources disagree on qualification for
the same tuple+role) resolve to T2 with both refs recorded in `evidence_refs`.

Disk telemetry is same-UID-editable (survey: advisory priors, never admission authority) — the
resolver therefore records `evidence_refs` so every tier decision is auditable back to the
records it stood on.

## Prompt skeletons

The skeleton is PREPENDED by `dispatch-hetero.sh` to its runner-specific combined prompt; the
caller's prompt body (the task itself) is never modified.

### T0 — contract-only

```
You own this task end-to-end. Contract:
- GOAL: (caller's prompt body below)
- DONE means: every obligation in the evidence contract is green, and your work
  will be independently reviewed by an engine from another model family.
- RED LINES: {project red lines, verbatim}
- EVIDENCE: bind every claim to an artifact (commit, diff, receipt path).
  Unverifiable claims are treated as false.
Method is yours. Do not narrate completion — deliver evidence.
```

### T1 — contract + obligation checklist

T0 text, plus:

```
OBLIGATIONS (each must end green, in any order):
- run the named verify command(s) and record exit codes
- list every file you changed and why in one line each
- state what you did NOT do (deferred/out of scope)
Verify-first ordering is recommended: reproduce/red-case before fixing.
```

### T2 — full prescribed process

T1 text, plus the prescribed sequence:

```
PROCESS (follow in order, report each step):
1. Restate the task in your own words; list acceptance criteria.
2. Locate the relevant files; quote the exact lines you will change.
3. Make the smallest change that satisfies one criterion; run the verify
   command; record the result.
4. Repeat 3 per criterion. Never batch unverified changes.
5. Final pass: re-run ALL verify commands; report each exit code; list
   changed files; state deferred items.
Do not deviate from this sequence. If a step is impossible, stop and say so.
```

## Non-goals

- Tier effect on outcome quality is NOT claimed here — the A/B measurement is a BACKLOG item
  (成績單前置 applies before any skill consumes tiers for routing decisions).
- Tiers gate PROMPT SCAFFOLDING only; they never bypass review, qc, red lines, or gates.
