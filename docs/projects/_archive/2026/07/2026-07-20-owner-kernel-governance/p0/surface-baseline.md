# P0 step 2 — load-bearing surface baseline and post-P3 projection

> Plan § 3 "Deletion gate" requires P0 to record the current per-run load-bearing surfaces and the
> modules actually executed, then amend the plan with a **projected absolute post-P3 target**.
> KR10 requires the post-P3 number to be **lower** than both the baseline and this projection.
> *"Percentages alone cannot fund P1."*

## Method

Mechanical enumeration (`find`) for raw counts, then source-level tracing for execution proof:
`spawnSync` / `require` / unconditional `source` call sites, plus mandatory-step language in
`skills/ceo-agent/references/level-front-door.md`. Scope was deliberately bounded to four traced
entry points: `skills/l5/SKILL.md`, `level-front-door.md`, `src/engine/`, `bin/autopilot.js`.

A surface counts only when it is **proven to execute** on the default width-1 `/l5` happy path.
Anything reachable only under a flag, a non-default config, or a different run shape is recorded
separately as *possible but unproven* rather than folded into the headline.

## Legacy absolute baseline

| Class | Count | Members / basis |
|---|---:|---|
| Skills | 5 | `l5`, `ceo-agent`, `dev-flow`, `finish-flow`, `quality-pipeline` |
| Scripts | 20 | `resolve-review-loop.sh`, `dispatch-hetero.sh`, `dispatch-review.sh`, `run-ledger.sh`, `lib/worktree-reap.sh`, `lib/json-emit.sh`, `load-endpoints-env.sh`, `lib/prune-tmp-residue.sh`, `lib/output-quiescence.sh`, `lib/dispatch-detach.sh`, `dispatch-status.js`, `dispatch-contract.js`, `check-disjointness.sh`, `engine-scorecard.js`, `session-mode.js`, `watch-foreman.js`, `resolve-dispatch.sh`, `check-loop-convergence.js`, `reap-dispatch-branches.sh`, `probe-diff-domain.sh` |
| `src/engine` + `src/runners` | 5 | `autopilot-engine.js`, `index.js`, `resolve-review-loop.js`, `implementer.js`, `review.js` |
| Schemas (loaded at runtime) | 2 | `dispatch-unit-contract.schema.json`, `review-loop-contract.schema.json` |
| Hooks (default-on, guaranteed) | 10 | per `node scripts/check-hook-inventory.js` |

### **Legacy absolute baseline = 42**

`5 + 20 + 5 + 2 + 10 = 42`. With the two opt-in hooks `/l5` entry arms via `session-mode.js`
(`orchestrator-edit-gate`, `context-budget`), the practical figure is **44**.

### Denominators, for honesty about what is *not* counted

28 skills exist; 96 scripts exist (94 non-test); 6 schemas exist; 25 hooks are wired. So 76 of 96
scripts and 4 of 6 schemas have **no proven runtime consumer** on this path. They are not counted.
Likewise excluded, and named so the exclusion is auditable rather than silent:

- **Conditional**: `resolve-endpoint.sh`, `lib/pi-rpc-run.js`, `dispatch-batch.sh`,
  `dispatch-author.sh` (`/l6` only), `dispatch-anthropic-review.js`, `engine-capability-state.js`.
- **Untraced in this pass**: scripts fired by the foreman's inline `dev-flow` → `finish-flow` →
  `quality-pipeline` phases (`completeness-scan.sh`, `secret-scan-diff.js`, `resolve-qc-gate.sh`,
  `resolve-doa.sh`, and others). These almost certainly execute, but were not opened in this pass,
  so counting them would be inflation-by-assumption. **The true baseline is therefore ≥ 42**, and
  42 is a floor, not a ceiling.

That the baseline is a floor matters for the projection below: it makes the projection
*conservative in the plan's favour*, since an undercounted baseline makes the target easier to beat.

## Projected post-P3 absolute target

Derived from the plan's own § 3 file-structure map, applied to the same "proven executed on a
normal owner-led run" rule. Tagged **[INF]** — this is arithmetic over the plan's stated adds and
deletions, not a measurement of code that exists.

| Class | Baseline | Post-P3 | Change |
|---|---:|---:|---|
| Skills | 5 | 4 | `/l5` alias removed after its one compatibility cycle; entry becomes governance-resolved `ceo-agent` |
| Scripts | 20 | 21 | `+ scripts/owner-kernel.js`. `resolve-review-loop.sh` is *narrowed*, not deleted — it still executes |
| Engine modules | 5 | 13 | `+ src/engine/owner-kernel/` = `index` + `policy` + `events` + `transitions` + `authority` + `acceptance` + `reconciliation` + `disclosure` (`compatibility.js` retired with the aliases) |
| Schemas | 2 | 3 | `+ schemas/owner-event.schema.json` |
| Hooks (default-on) | 10 | 10 | `orchestrator-edit-gate` / `audit-log` are extended, not added |

### **Projected post-P3 target = 51**

`4 + 21 + 13 + 3 + 10 = 51`.

## This projection fails KR10 — a second, independent P0 finding

KR10 and the § 3 deletion gate both require the post-P3 total to **fall** below the baseline.
The plan's own map projects **42 → 51, a rise of 9**.

The cause is structural, not accounting noise. The plan's deletions are concentrated in **prose**
— `/l3`–`/l6` skill bodies, `level-front-door.md`, duplicated trust narration in `think-tank` and
`quality-pipeline`. Its additions are concentrated in **executed modules** — a nine-module engine
package, a CLI, and a schema. The deletion gate counts executed modules, and § 3 states the rule
plainly: *"Splitting a god-object into focused modules is not a regression by itself, but every
executed module counts. If the total does not fall, the refactor has failed its simplification
objective."*

For the total to fall below 42, P3 would need to remove roughly **nine or more currently-executed
surfaces** beyond what the map names. The map does not identify them, and the untraced
`quality-pipeline`/`finish-flow` scripts noted above are the plan's most plausible source — but
those are exactly the deterministic verification surfaces the plan elsewhere commits to preserving
(*"Deterministic verification and artifact provenance remain authoritative"*).

**[INF]** This is a genuine tension in the approved design, surfaced by the measurement P0 exists to
perform. It does not by itself stop the project — the host trust-root failure in
[`P0-FINDINGS.md`](P0-FINDINGS.md) § 1 already does that, on a hard step-7 condition. But it means
that even on a host with adequate trust roots, P1 would be funded against a deletion gate whose
arithmetic does not currently close. **Both findings should be resolved before P1 is reconsidered.**

## Recommendation for the Board

Before P1 is reconsidered, the plan needs one of:

1. A named deletion manifest identifying ≥ 9 currently-executed surfaces P3 will remove, or
2. A revised KR10 that counts something other than executed-module cardinality (for example,
   load-bearing *responsibility* surfaces, where nine cohesive modules behind one public entry
   point count as one authority path), or
3. An explicit Board decision that KR10 is not a release gate.

These three options are presented **without a recommendation, deliberately.**

An earlier draft of this document argued option 2 was "the most defensible" — and an independent
reviewer correctly pointed out that doing so undercuts the finding. Option 2 *is* redefining an
acceptance criterion after seeing it fail, which is precisely the move the plan's own § 6 risk
register names (*"The acceptance test is laundered"*). A measurement document that flags that risk
and then advocates the option embodying it is arguing against itself.

The foreman's role here is to report that KR10's arithmetic does not close and to hand the Board a
clean choice. Which option to take — including whether option 2's reasoning survives its own
laundering objection — is a Board decision, made with the measurement in front of it rather than
pre-framed by the party that produced it.
