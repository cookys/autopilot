# P7 adjudication — the F6/F4 zero-compliance finding (2026-08-18)

Independent of the card verdict. Input: the primary block's within-FULL-arm compliance rates
(`p6-adjudication.md` §2). Method: `autopilot:think-tank`, 5 roles dispatched in parallel
(architect / QA / ops / product / UX), sonnet, read-only.

## What was actually measured

| Rule | Prose location (pre-fix) | FULL arm |
|---|---|---|
| F6 quality gate before commit | `skills/dev-flow/SKILL.md:133` — "invoke `autopilot:quality-pipeline` … This is non-negotiable" | **0/9** |
| F4 ongoing-maintenance ledger | `skills/dev-flow/SKILL.md:277` — Fix step 6 | **0/3** |

Claim scope: single-turn headless `claude -p`, micro-tasks, sonnet-class, depth 0, dev-flow
verifiably routed and invoked (18/21). NOT measured: multi-turn interactive sessions — the actual
production mode for a human user.

## Root cause found during the panel: the body contradicted itself

`SKILL.md:133` demanded `autopilot:quality-pipeline` unconditionally. The numbered workflow steps
the model actually executes offered a cheaper legal substitute at the point of action:

- `:241` (S step 2) — "Quality gate (per project config, or: lint + test)"
- `:275` (Fix step 4) — same

A model following the numbered steps is step-compliant and §133-violating **by construction**. So
0/9 does not license the general claim "MANDATORY prose does not bind" (QA); it licenses only
"this rule self-destructed". The frozen CARD fixture carries the identical contradiction
(`packs/dev-flow-card/SKILL.md:97` vs `:192`/`:207`), so the CARD arm's 2/9 is noise, not a
phrasing effect.

## Panel result

Stances: architect **B**, QA **B**, ops **C**, product **C**, UX **C** — and both B stances
required the contradiction fixed first, so the substantive consensus is 5/5.

Consensus: (1) the contradiction is the root cause and must be fixed under any option; (2) no
default-on blocking hook — 16 of 26 hooks are opt-in and the sole commit-time precedent
(`branch-protection.js`) is opt-in; (3) F4 must be decided separately (n=3, and the fixture repo
had no `docs/` tree to append to); (4) "non-negotiable" at 0% is a credibility debt owed on the
front-door skill.

Collision insights the individual roles could not reach alone:

1. **The campaign's most valuable output is not the card verdict — it is a controlled experiment
   on instruction placement.** Same document, same model, same runs: F3's instruction is step 1 of
   the numbered procedure and scored 9/9; F6's lived 142 lines upstream of the steps with a cheaper
   substitute sitting at the point of action, and scored 0/9. The document routed the model around
   its own rule. This is a direct design input to the contract-card work.
2. **Mechanising F6 would be paid for out of the downstream evidence budget.** Once a hook owns the
   rule, prose is no longer the mechanism and F6 dies as a FULL-vs-CARD discriminator — and the
   re-attempt campaign's validity gate needs ≥4 of 5 families load-bearing.
3. **What sat at 0% is a *process* claim, not an outcome claim.** `skills/quality-pipeline/SKILL.md`
   emits no "this ran" receipt, so any F6 enforcer could only check "was skill X invoked" — process
   governance, which ADR-0001 forbids. The outcome it proxies (tests were run) already sits at 5/6
   in the **OFF** arm.

## Ruling (user, 2026-08-18): C-shape, weighted to repair rather than build

1. Rule restated at the step that runs it; `SKILL.md` "Quality Gate Rule" demoted to a pointer.
2. Claim scoped honestly: S/Fix = project-config gate (default lint + test); L/H =
   `autopilot:quality-pipeline` at the merge boundary via finish-flow L-5.2 / H-9.2.
3. `skills/ceo-agent/SKILL.md` anti-pattern row carrying the same claim fixed with it.
4. Enforcement status recorded as `documented-only` in `references/four-layer-design.md`
   § Skill-layer rules (S1/S2).
5. **F4 not acted on** — folded into the instrument-repair campaign for re-measurement.
6. Enforcer kept alive as a BACKLOG row, but reshaped to an **outcome** predicate and opt-in.
7. Not done: any default-on hook; any "you invoked skill X" attestation check.

## Incidental defect found and fixed in the same pass

`references/four-layer-design.md` K2 described `hooks/branch-protection.js` as **default-on**;
`scripts/check-hook-inventory.js` (the derived oracle) classifies it **opt-in**. A doc claiming an
enforcer is running when it is off — inside the table whose stated job is naming enforcers — is the
repo's own "a script existing is not evidence it is running" failure, one level up.

## Why this ran before the instrument repair

Both outcomes of this decision edit `skills/dev-flow/SKILL.md`, and
`evals/skill-onoff/packs/dev-flow-full/` was byte-identical to the live skill. Repairing the
instrument first would have frozen a body that was about to change. Ordering approved by the user
before any edit.
