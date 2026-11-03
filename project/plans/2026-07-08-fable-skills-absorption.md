# Plan - fable-skills absorption

> Status: CLOSED-NOT-PURSUED (Board CEO-delegated ruling 2026-08-23) — largely superseded by evidence-discipline promotion, skill-contract-card, and review checklists; residual value does not clear 成績單前置 with zero demand signal. Re-entry: an incident an unabsorbed guardrail would have prevented. Original: R0 authored 2026-07-08, triaged 2026-07-31.
> Owner: pending Board decision.
> Branch: develop.
> Frame: absorb useful methodology from `DizzyMii/fable-skills` without vendoring the package.

## 0. Context / thesis

On 2026-07-08 we compared `DizzyMii/fable-skills` at commit
`ee07b52a5e4207cdfc0d99f59c7fbe1039e0896d` against autopilot at
`c4f2e80fa59cbf6c2bee94b48d030f2b25b78185`.

The comparison found that `fable-skills` is a small behavior-calibration layer:
six Claude Code skills for outcome-first reporting, turn completion, evidence
calibration, scope discipline, native code style, and context thrift.
Autopilot already owns the larger lifecycle, dispatch, quality-gate, and
cross-platform system. The useful move is therefore selective absorption:
adopt fable's skill-writing discipline and compact behavioral guardrails where
they strengthen autopilot's existing gates, without copying the six skills as
parallel surface area.

This plan is intentionally implementation-only-after-approval. Another worker is
currently modifying the repo, so this plan must not edit existing implementation,
skill, hook, agent, script, or generated plugin files until the Board explicitly
reopens implementation.

## 1. Problem

Autopilot has strong mechanical enforcement but some behavior rules are spread
across large references. Fable's strongest practices are local, readable, and
pressure-tested:

- docs TDD for behavior rules: baseline failure, rule change, verification flip;
- per-skill rationalization tables that name the model's likely self-excuses;
- lifecycle activation language for start, edit, claim, and end-of-turn moments;
- native-code style guardrails that catch over-commenting and defensive bloat;
- concise claim calibration language: written, runs, verified.

The problem is to absorb those practices without creating duplicate skills,
weakening existing gates, or colliding with in-flight work.

## 2. OKR / KRs

Objective: make autopilot's behavior-rule surface more evidence-backed and
easier to follow, while preserving its existing mechanical quality gates.

Key results:

1. New or changed methodology rules have an evidence path.
   Acceptance: contribution guidance states that non-trivial behavior-rule
   changes need a pressure scenario, captured baseline failure or justified
   baseline pass, and a verification result.
2. Scope discipline is clearer at implementation time, not only review time.
   Acceptance: the S/Fix implementation path points to a compact rationalization
   checklist for "adjacent but unasked" changes.
3. Review catches foreign code style explicitly.
   Acceptance: code review includes a native-code checklist for comment density,
   local naming vocabulary, defensive bloat, debug prints, and self-created TODOs.
4. Completion claims use calibrated evidence language.
   Acceptance: anti-rationalization guidance or final-report guidance names the
   `written / runs / verified` ladder and forbids stronger wording than evidence
   produced this session supports.
5. No new standalone fable clone is introduced.
   Acceptance: skill count does not increase solely for this absorption, and no
   `skills/fable-*` directories are added.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Do not vendor or copy `skills/fable-*` into this repo.
- Do not edit existing implementation files until the Board explicitly approves implementation.
- Preserve the severity vocabulary verbatim: `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`.
- Preserve verifier isolation: reviewers receive artifacts plus the original spec, never an implementer self-report.
- No change may weaken `quality-pipeline`, `finish-flow`, dispatch isolation, or pre-commit/pre-push gates.
- Generated Codex plugin mirrors must be updated only by the existing sync scripts during implementation.

## 3. File-structure map

Future implementation may touch these files. This plan itself touches only this
plan document.

| File | Responsibility |
|---|---|
| `AGENTS.md` | Add contribution guidance for pressure-scenario-backed methodology rules. |
| `references/plan-template.md` | Optionally add a plan-review note requiring evidence for behavior-rule changes when plans alter skills/agents. |
| `skills/dev-flow/SKILL.md` | Add or reference a compact implementation-time scope rationalization checklist. |
| `skills/quality-pipeline/references/code-review.md` | Add native-code style checklist and ensure scope creep scan stays canonical. |
| `skills/quality-pipeline/references/anti-rationalization.md` | Add the claim ladder and, if appropriate, cross-link scope/turn-completion rationalizations. |
| `scripts/check-canonical-invariants.sh` | Add seeds only if implementation introduces repeated load-bearing phrases. |
| `platforms/codex/plugin/**` | Regenerated mirrors only, via `scripts/sync-codex-plugin-skills.sh`, if any mirrored skill/reference changes. |
| `docs/BACKLOG.md` | Record deferred eval-harness work if not in scope for the first implementation pass. |

## 4. Phases

### P0 - Collision and freshness gate

Size: S.

Steps:

1. Re-check `git status --short --branch`.
2. Confirm no non-plan files changed by this plan-only phase except pre-existing
   user work.
3. Before implementation, ask the Board whether the other worker has finished.
4. If any target file has changed since this plan review, re-read it and revise
   the plan before editing.

Acceptance: clean understanding of current worktree and explicit implementation
approval from the Board.

### P1 - Evidence-backed skill-rule contribution guidance

Size: S.

Steps:

1. Add a concise "behavior-rule evidence gate" to `AGENTS.md` Contribution.
2. State the minimum evidence package:
   pressure scenario, baseline result, rule change, verification result, and
   honest provenance for observed vs predicted rationalizations.
3. Keep it guidance, not a mandatory gate for typo/docs-only edits.

Acceptance: `AGENTS.md` explains when a behavior-rule change needs evidence and
does not over-claim that every prose edit needs model evals.

### P2 - Scope rationalization checklist

Size: S.

Steps:

1. Add a compact rationalization checklist to `skills/dev-flow/SKILL.md` near S/Fix
   implementation rules, or add a small reference and link it from dev-flow.
2. Cover these exact failure modes:
   same function is not authorization; same defect class is not authorization;
   "arguably in scope" means separate task; unresolved design choice means
   separate task; quality preference means surface findings, not bundle changes.
3. Keep the existing S-scope TaskCreate gate intact.

Acceptance: implementers see the scope self-excuse checklist before writing
changes; canonical invariant seeds remain green.

### P3 - Native-code reviewer checklist

Size: S.

Steps:

1. Extend `skills/quality-pipeline/references/code-review.md` with a "Native Code
   Style" subsection under the scope/surgical review area.
2. The reviewer checks only changed hunks and local file conventions:
   naming vocabulary, error-handling idiom, comment density, import organization,
   defensive guards, logging, debug prints, and self-created TODOs.
3. Classify findings under the existing severity system; do not create new
   severity labels.

Acceptance: reviewers can flag foreign-style additions without confusing them
with broad scope creep, and the Verified Clean contract can mention native-style
coverage when the scan ran.

### P4 - Claim ladder and lifecycle reporting guardrails

Size: S.

Steps:

1. Update `skills/quality-pipeline/references/anti-rationalization.md` with the
   `written / runs / verified` wording.
2. Add a short end-of-turn check either there or in a reporting convention:
   do not end on a plan, a promise, or a tool-answerable question when the work is
   reversible and in scope.
3. Keep this as behavioral reporting discipline; do not create a separate
   `fable-prove-it` equivalent.

Acceptance: final reports can use calibrated evidence language without adding a
new skill surface.

### P5 - Validation, mirrors, and release hygiene

Size: S to L depending on files touched.

Steps:

1. Run `scripts/validate.sh`.
2. Run `scripts/check-canonical-invariants.sh`.
3. If mirrored plugin files should change, run `scripts/sync-codex-plugin-skills.sh`
   and re-run the relevant checks.
4. Run `node scripts/sync-version.js --check`.
5. Run targeted tests for any touched scripts; if only docs/skills changed, run
   the lightweight validation set above and document why full hook tests were not
   necessary.
6. Run hetero review over the final diff using `scripts/dispatch-review.sh` with
   the resolved reviewer engine and loop until `SHIP-AS-IS` or until every real
   finding is verified fixed/refuted.

Acceptance: validation commands are green or explicitly bounded, review reaches
an honest pass, and no implementation happens before Board approval.

## 5. Test / validation

Plan-review validation:

```bash
git diff --no-index -- /dev/null docs/plans/2026-07-08-fable-skills-absorption.md \
  > /tmp/fable-plan.diff || true
scripts/dispatch-review.sh --runner codex --model gpt-5.5 \
  --effort xhigh \
  --diff-file /tmp/fable-plan.diff \
  --spec-file /tmp/fable-plan-spec.md
```

Implementation validation, after approval:

```bash
scripts/validate.sh
scripts/check-canonical-invariants.sh
node scripts/sync-version.js --check
```

Conditional validation:

- If `AGENTS.md` changes, inspect cross-platform claims and avoid unverified
  platform assertions.
- If any mirrored Codex plugin content changes, regenerate mirrors with the
  existing sync script and verify the diff is mirror-only.
- If scripts are touched, run the corresponding `hooks/tests/*.test.sh` or
  script-specific test.
- If review reports a mechanizable recurring finding, consider adding a gate only
  after the finding class is stable and low false-positive.

## 6. Risks + inversion

Failure mode: duplicate fable skills inflate surface area.
Mitigation: global constraint forbids `skills/fable-*` vendoring; absorb concepts
into existing canonical surfaces.

Failure mode: guidance becomes unenforced prose.
Mitigation: use guidance only where enforcement would be overkill; add canonical
invariant seeds only for repeated load-bearing phrases; keep mechanical gates
unchanged.

Failure mode: pressure-scenario requirement blocks small doc fixes.
Mitigation: limit the evidence gate to non-trivial methodology behavior rules.

Failure mode: implementation collides with the other worker.
Mitigation: this plan phase edits only the plan document; implementation starts
only after Board approval and a fresh status/freshness check.

Failure mode: reviewer loop never returns literal `SHIP-AS-IS` because of a false
positive.
Mitigation: follow existing verify-reviewer-claims discipline: verify each finding
against files/commands, fix real findings, refute false positives with evidence,
and record the review log.

Failure mode: examples out-teach rules in a harmful way.
Mitigation: any example added to a skill/reference must model the desired hard
case; do not include a "bad" example that accidentally demonstrates an allowed
pattern ambiguously.

## 7. Out of scope

- No implementation in this turn beyond the plan and review artifacts.
- No direct installation or vendoring of `DizzyMii/fable-skills`.
- No new standalone behavior skill unless a later pressure scenario proves the
  existing surfaces cannot hold the rule.
- No claim of daily productivity lift; fable's evidence is scenario-level.
- No change to dispatch engine roster.
- No release/version bump in the planning phase.

## 8. Open questions

1. Should implementation be done inline by the main agent, by a hetero implementer,
   or by the worker already modifying the repo?
2. Should P1-P4 land as one docs/methodology commit, or split into one commit per
   canonical surface?
3. Should we build a small pressure-scenario harness for behavior-rule docs now, or
   defer it to BACKLOG after the first manual evidence-gated use?

## Review log

| Round | Reviewer | Verdict | Notes |
|---|---|---|---|
| R0 | main agent | Author draft | Based on local audit of fable-skills vs autopilot; implementation gated. |
| R1 | codex/gpt-5.5 xhigh | FIX-THEN-SHIP | Review saw an empty diff because the new plan was untracked and the validation snippet used plain `git diff`; fixed the snippet to use `git diff --no-index` for new plan files. |
| R2 | codex/gpt-5.5 xhigh | FIX-THEN-SHIP | Review requested a passing review-log row. The dispatcher will append the pass row only after receiving `SHIP-AS-IS`; absence of a future pass row is not a plan-body defect. |
| R3 | codex/gpt-5.5 xhigh | SHIP-AS-IS | No findings. Plan accepted for later implementation handoff; pass row appended after verdict. |
