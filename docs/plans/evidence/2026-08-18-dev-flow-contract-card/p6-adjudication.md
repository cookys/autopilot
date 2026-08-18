# P6 adjudication — primary block verdict and Board read (2026-08-18)

## Mechanical verdict (frozen rules, score-onoff.js)

Primary block: sonnet, 63/63 cells complete, **zero infra failures, zero excluded pairs**,
runner 2.1.234 stable throughout. `primary-sonnet-{results.jsonl,score.json}`.

| Family | n | FULL | CARD | OFF | Load-bearing (V2) |
|---|---|---|---|---|---|
| F1 sizing/workflow-selection | 9 | 6 | 4 | 6 | no |
| F3 branch discipline | 9 | **9** | **9** | **0** | **yes** |
| F4 maintenance ledger | 3 | 0 | 1 | 0 | no |
| F5 verification contract | 6 | 5 | 6 | 5 | no |
| F6 quality gate | 9 | **0** | 2 | 0 | no |

V1 manipulation check: PASS (dev-flow invoked 18/21 in FULL and in CARD; 0/21 in OFF —
the arms manipulated exactly the intended variable).
V2 sensitivity: **1/5 families load-bearing → INSTRUMENT-INVALID (vacuous)**. Per the frozen
verdict map: no card verdict is recorded; SHIP-GATE-MET is unreachable from this instrument.

## What the data actually says (Board read)

1. **The one family with discrimination is total**: F3 (fix/hotfix branch discipline) is
   FULL 9/9 · CARD 9/9 · OFF 0/9. Branch discipline at depth 0 is 100% skill-driven — and the
   499-line card preserved it perfectly. This is the only family where the instrument could
   see the skill, and there the card is exactly non-inferior.
2. **Two MANDATORY rules show ZERO compliance even with the full 713-line prose loaded**:
   F6 (invoke quality-pipeline before commit) FULL 0/9; F4 (ongoing-maintenance ledger row)
   FULL 0/3. The prose says non-negotiable; observed single-turn headless depth-0 compliance
   is 0%. This is the repo's "a script existing is not evidence it is running" lesson applied
   to skill prose itself — independent of the card question, these rules are currently
   documented-only in effect.
3. **Two families ceiling on generic competence**: F1 (sonnet's base rate for plan-writing /
   not-over-tracking is already high) and F5 (innate TDD instinct: OFF 5/6) leave no headroom.
   Harder tasks or a weaker subject model would be needed to see the skill in them.

## Advisory block (haiku, 21/21, 0 infra — non-gating)

Same qualitative picture at the weak end: F3 discriminates (FULL 2 / CARD 2 / OFF 0 of n=3),
F6 zero everywhere, F1/F5 flat, FULL≈CARD on every family. Additional finding: haiku's
dev-flow ROUTING rate is only 4/7 per arm (vs sonnet 18/21) — natural skill routing itself is
strong-model behavior; a weak-model primary block would need V1 re-margining.
`advisory-haiku-results.jsonl`.

## Budget arithmetic (why no re-run in this project)

Spent: 2 probe/smoke + 63 primary + 21 advisory (haiku, non-gating) = 86 of the 90 nominal /
111 hard-cap live calls. Repairing tasks (raising difficulty so F1/F5 discriminate; finding an
observable for F6/F4) and re-running a 63-run block = 149 > 111. The frozen budget rule wins:
instrument repair is a NEW evidence campaign, not a stretch of this one.

## Disposition (per plan §8 P7 non-SHIP branch, pre-registered)

- **Ship**: P0 prologue, P1 spec + per-skill ratchet, P3 instrument (+ its 3 green suites),
  P4 disposition ontology (+ its green suite). These stand regardless of card verdict.
- **Do NOT ship**: the card swap (P7). `skills/dev-flow/SKILL.md` keeps its 713-line body.
- **Record**: card draft stays as the frozen fixture `evals/skill-onoff/packs/dev-flow-card/`
  (digest-pinned); BACKLOG row carries the re-attempt trigger with this evidence pointer.
- **Independent finding** (F6/F4 zero-compliance) gets its own BACKLOG row — it is about
  dev-flow's enforcement reality, not about the card.

成績單前置 verdict: the gate did exactly its job — an unevidenced rewrite was stopped, and
the reason is recorded as measurement, not opinion.
